(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.OfferEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    const dateOnly = value => String(value || '').split('T')[0];
    const normalizeText = value => String(value || '').trim().toLowerCase();

    function normalizeOffer(offer) {
        const eligibility = offer.eligibility || {
            transactionTypes: ['purchase'],
            includeCategories: offer.categories || [],
            excludeCategories: offer.excludeCategories || [],
            includeMerchants: [],
            excludeMerchants: [],
            minimumAmount: offer.minTransaction || null
        };
        const measurement = offer.measurement || {
            kind: offer.type === 'transactions' ? 'count' : 'spend',
            period: offer.monthlyTracking ? 'monthly' : 'offer'
        };

        let reward = offer.rewardConfig;
        if (!reward) {
            if (offer.tiers && offer.tiers.length) {
                reward = { kind: 'tiers', tiers: offer.tiers };
            } else if (offer.type === 'percent-back') {
                reward = {
                    kind: 'percentage',
                    rate: Number(offer.percentBack || 0),
                    activationThreshold: Number(offer.minSpendThreshold || 0),
                    cap: offer.maxBack == null ? null : Number(offer.maxBack)
                };
            } else {
                reward = {
                    kind: 'fixed',
                    threshold: Number(measurement.kind === 'count' ? offer.transactionTarget : offer.spendingTarget) || 0,
                    amount: Number(offer.reward || 0)
                };
            }
        }

        return {
            ...offer,
            startDate: dateOnly(offer.startDate),
            endDate: dateOnly(offer.endDate),
            eligibility: {
                transactionTypes: eligibility.transactionTypes || ['purchase'],
                includeCategories: eligibility.includeCategories || [],
                excludeCategories: eligibility.excludeCategories || [],
                includeMerchants: eligibility.includeMerchants || [],
                excludeMerchants: eligibility.excludeMerchants || [],
                minimumAmount: eligibility.minimumAmount == null ? null : Number(eligibility.minimumAmount),
                maximumAmount: eligibility.maximumAmount == null ? null : Number(eligibility.maximumAmount)
            },
            measurement,
            rewardConfig: reward
        };
    }

    function evaluateEligibility(transaction, rawOffer) {
        const offer = normalizeOffer(rawOffer);
        const reasons = [];
        const transactionDate = dateOnly(transaction.date);
        const amount = Number(transaction.amount);
        const categories = (transaction.categories || []).map(normalizeText);
        const merchant = normalizeText(transaction.merchant);
        const transactionType = normalizeText(transaction.transactionType || (amount > 0 ? 'purchase' : 'credit'));
        const rule = offer.eligibility;

        if (transactionDate < offer.startDate || transactionDate > offer.endDate) reasons.push('outside offer dates');
        if (rule.transactionTypes.length && !rule.transactionTypes.map(normalizeText).includes(transactionType)) reasons.push(`transaction type is ${transactionType}`);
        if (rule.minimumAmount != null && amount < rule.minimumAmount) reasons.push(`below minimum amount`);
        if (rule.maximumAmount != null && amount > rule.maximumAmount) reasons.push(`above maximum amount`);

        const includes = rule.includeCategories.map(normalizeText);
        const excludes = rule.excludeCategories.map(normalizeText);
        if (includes.length && !categories.some(category => includes.includes(category))) reasons.push('category not included');
        if (excludes.length && categories.some(category => excludes.includes(category))) reasons.push('category excluded');

        const includeMerchants = rule.includeMerchants.map(normalizeText);
        const excludeMerchants = rule.excludeMerchants.map(normalizeText);
        if (includeMerchants.length && !includeMerchants.some(pattern => merchant.includes(pattern))) reasons.push('merchant not included');
        if (excludeMerchants.some(pattern => merchant.includes(pattern))) reasons.push('merchant excluded');

        return { eligible: reasons.length === 0, reasons };
    }

    function calculateReward(metric, rewardConfig) {
        const reward = rewardConfig || { kind: 'fixed', threshold: 0, amount: 0 };
        if (reward.kind === 'percentage') {
            const threshold = Number(reward.activationThreshold || 0);
            const cap = reward.cap == null ? null : Number(reward.cap);
            const rate = Number(reward.rate || 0);
            const activated = metric >= threshold;
            const earned = activated ? Math.min(metric * rate / 100, cap == null ? Infinity : cap) : 0;
            const target = cap != null && rate > 0 ? Math.max(threshold, cap / (rate / 100)) : threshold;
            return {
                earnedReward: roundMoney(earned),
                completed: cap != null ? earned >= cap : activated,
                partiallyCompleted: activated && cap != null && earned < cap,
                progress: target > 0 ? Math.min(metric / target * 100, 100) : (metric > 0 ? 100 : 0),
                nextTarget: metric < threshold ? threshold : (target > metric ? target : null),
                tierReached: null
            };
        }

        if (reward.kind === 'tiers') {
            const tiers = [...(reward.tiers || [])].map(tier => ({ threshold: Number(tier.threshold), reward: Number(tier.reward) })).sort((a, b) => a.threshold - b.threshold);
            const reached = [...tiers].reverse().find(tier => metric >= tier.threshold) || null;
            const highest = tiers[tiers.length - 1] || null;
            const next = tiers.find(tier => metric < tier.threshold) || null;
            return {
                earnedReward: roundMoney(reached ? reached.reward : 0),
                completed: Boolean(highest && metric >= highest.threshold),
                partiallyCompleted: Boolean(reached && highest && reached.threshold < highest.threshold),
                progress: highest ? Math.min(metric / highest.threshold * 100, 100) : 0,
                nextTarget: next ? next.threshold : null,
                tierReached: reached
            };
        }

        const threshold = Number(reward.threshold || 0);
        const completed = metric >= threshold;
        return {
            earnedReward: roundMoney(completed ? Number(reward.amount || 0) : 0),
            completed,
            partiallyCompleted: false,
            progress: threshold > 0 ? Math.min(metric / threshold * 100, 100) : 0,
            nextTarget: completed ? null : threshold,
            tierReached: null
        };
    }

    function evaluatePeriod(transactions, offer) {
        const spending = roundMoney(transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0));
        const count = transactions.length;
        const metric = offer.measurement.kind === 'count' ? count : spending;
        return { spending, transactionCount: count, metric, ...calculateReward(metric, offer.rewardConfig) };
    }

    function partitionRewardTransactions(transactions, offer) {
        const contributing = [];
        const saturated = [];
        const metrics = new Map();
        const sorted = [...transactions].sort((a, b) => dateOnly(a.date).localeCompare(dateOnly(b.date)) || Number(a.id || 0) - Number(b.id || 0));
        const reward = offer.rewardConfig;
        let terminalMetric = Infinity;
        if (reward.kind === 'percentage' && reward.cap != null && Number(reward.rate) > 0) {
            terminalMetric = Math.max(Number(reward.activationThreshold || 0), Number(reward.cap) / (Number(reward.rate) / 100));
        } else if (reward.kind === 'tiers') {
            terminalMetric = Math.max(0, ...(reward.tiers || []).map(tier => Number(tier.threshold)));
        } else if (reward.kind === 'fixed') {
            terminalMetric = Number(reward.threshold || 0);
        }

        for (const transaction of sorted) {
            const period = offer.measurement.period === 'monthly' ? dateOnly(transaction.date).slice(0, 7) : 'offer';
            const before = Number(metrics.get(period) || 0);
            if (before >= terminalMetric) saturated.push(transaction);
            else contributing.push(transaction);
            metrics.set(period, before + (offer.measurement.kind === 'count' ? 1 : Number(transaction.amount || 0)));
        }
        return { rewardTransactions: contributing, saturatedTransactions: saturated };
    }

    function endOfMonthAfter(dateText, count) {
        const [year, month] = dateOnly(dateText).split('-').map(Number);
        return new Date(Date.UTC(year, month - 1 + count + 1, 0)).toISOString().slice(0, 10);
    }

    function reconcileCredits(offer, expectedReward, postedCredits, matureExpected, eligibleTransactions, excludedTransactions) {
        const tolerance = 0.02;
        const difference = roundMoney(postedCredits - expectedReward);
        let status = 'pending';
        let message = expectedReward > 0
            ? 'Waiting for the remaining statement credit or for the posting window to close.'
            : 'No earned credit is expected from the transactions currently categorized as eligible.';

        if (postedCredits > expectedReward + tolerance) {
            status = 'mismatch';
            message = `Posted credits exceed the categorized expectation by $${Math.abs(difference).toFixed(2)}.`;
        } else if (postedCredits + tolerance < matureExpected) {
            status = 'mismatch';
            message = `Posted credits are $${roundMoney(matureExpected - postedCredits).toFixed(2)} below the amount whose posting window has closed.`;
        } else if (expectedReward > 0 && Math.abs(difference) <= tolerance) {
            status = 'matched';
            message = 'Posted credits match the reward expected from the categorized purchases.';
        } else if (postedCredits === 0 && expectedReward === 0) {
            status = 'none';
            message = 'No credit is currently expected or posted.';
        }

        const rate = offer.rewardConfig.kind === 'percentage' ? Number(offer.rewardConfig.rate || 0) : 0;
        return {
            status,
            expected: expectedReward,
            matureExpected: roundMoney(matureExpected),
            posted: postedCredits,
            difference,
            message,
            impliedQualifyingSpend: rate > 0 && postedCredits > 0 ? roundMoney(postedCredits / (rate / 100)) : null,
            categorizedQualifyingSpend: roundMoney(eligibleTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)),
            reviewEligibleTransactions: status === 'mismatch' ? eligibleTransactions : [],
            reviewExcludedTransactions: status === 'mismatch' ? excludedTransactions : []
        };
    }

    function calculateOfferProgress(rawOffer, transactions, options = {}) {
        const offer = normalizeOffer(rawOffer);
        const asOf = dateOnly(options.asOf || new Date().toISOString());
        const status = asOf < offer.startDate ? 'upcoming' : asOf > offer.endDate ? 'expired' : 'active';
        const evaluated = transactions.map(transaction => ({ transaction, result: evaluateEligibility(transaction, offer) }));
        const eligibleTransactions = evaluated.filter(item => item.result.eligible).map(item => item.transaction);
        const excludedTransactions = evaluated.filter(item => !item.result.eligible).map(item => ({ ...item.transaction, exclusionReasons: item.result.reasons }));
        const transactionContribution = partitionRewardTransactions(eligibleTransactions, offer);
        const postedCredits = roundMoney((offer.credits || []).reduce((sum, credit) => sum + Number(credit.amount || 0), 0));

        if (offer.measurement.period === 'monthly') {
            const months = [];
            const cursor = new Date(`${offer.startDate}T12:00:00`);
            const end = new Date(`${offer.endDate}T12:00:00`);
            cursor.setDate(1);
            while (cursor <= end) {
                const year = cursor.getFullYear();
                const month = cursor.getMonth();
                const monthTransactions = eligibleTransactions.filter(transaction => {
                    const date = new Date(`${dateOnly(transaction.date)}T12:00:00`);
                    return date.getFullYear() === year && date.getMonth() === month;
                });
                months.push({
                    month: cursor.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    periodStart: dateOnly(new Date(year, month, 1, 12).toISOString()),
                    periodEnd: dateOnly(new Date(year, month + 1, 0, 12).toISOString()),
                    ...evaluatePeriod(monthTransactions, offer)
                });
                cursor.setMonth(cursor.getMonth() + 1);
            }
            const expectedReward = roundMoney(months.reduce((sum, month) => sum + month.earnedReward, 0));
            const matureExpected = roundMoney(months
                .filter(month => endOfMonthAfter(month.periodEnd, 2) <= asOf)
                .reduce((sum, month) => sum + month.earnedReward, 0));
            return {
                status,
                months,
                totalCompleted: months.filter(month => month.completed).length,
                totalSpending: roundMoney(eligibleTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0)),
                totalTransactions: eligibleTransactions.length,
                earnedReward: expectedReward,
                expectedReward,
                postedCredits,
                outstandingReward: roundMoney(Math.max(expectedReward - postedCredits, 0)),
                reconciliation: reconcileCredits(offer, expectedReward, postedCredits, matureExpected, eligibleTransactions, excludedTransactions),
                ...transactionContribution,
                eligibleTransactions,
                excludedTransactions
            };
        }

        const period = evaluatePeriod(eligibleTransactions, offer);
        const matureExpected = endOfMonthAfter(offer.endDate, 2) <= asOf ? period.earnedReward : 0;
        return {
            status,
            ...period,
            totalSpending: period.spending,
            totalTransactions: period.transactionCount,
            expectedReward: period.earnedReward,
            postedCredits,
            outstandingReward: roundMoney(Math.max(period.earnedReward - postedCredits, 0)),
            reconciliation: reconcileCredits(offer, period.earnedReward, postedCredits, matureExpected, eligibleTransactions, excludedTransactions),
            ...transactionContribution,
            eligibleTransactions,
            excludedTransactions
        };
    }

    return { normalizeOffer, evaluateEligibility, calculateReward, calculateOfferProgress, roundMoney };
});
