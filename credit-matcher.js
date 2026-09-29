(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CreditMatcher = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const money = value => Math.round(Number(value || 0) * 100) / 100;
    const close = (a, b) => Math.abs(money(a) - money(b)) <= 0.02;

    function percentageCheckpointDetails(offer, progress) {
        const reward = offer.rewardConfig || {};
        if (reward.kind !== 'percentage' || !Number(reward.rate)) return [];
        const rate = Number(reward.rate) / 100;
        const threshold = Number(reward.activationThreshold || 0);
        const cap = reward.cap == null ? Infinity : Number(reward.cap);
        const monthly = offer.measurement?.period === 'monthly';
        const posted = Number(progress.postedCredits || 0);
        const periodSpend = new Map();
        const checkpoints = [];
        const transactions = [...(progress.eligibleTransactions || [])]
            .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id || 0) - Number(b.id || 0));

        for (const transaction of transactions) {
            const period = monthly ? String(transaction.date).slice(0, 7) : 'offer';
            periodSpend.set(period, Number(periodSpend.get(period) || 0) + Number(transaction.amount || 0));
            const totalExpected = [...periodSpend.values()].reduce((sum, spend) => {
                return sum + (spend >= threshold ? Math.min(spend * rate, cap) : 0);
            }, 0);
            checkpoints.push({
                amount: money(Math.max(totalExpected - posted, 0)),
                expectedReward: money(totalExpected),
                qualifyingSpend: money([...periodSpend.values()].reduce((sum, spend) => sum + spend, 0)),
                transaction
            });
        }
        return checkpoints;
    }

    function percentageCheckpoints(offer, progress) {
        return percentageCheckpointDetails(offer, progress).map(checkpoint => checkpoint.amount);
    }

    function percentagePurchaseDetails(offer, progress) {
        const reward = offer.rewardConfig || {};
        const rate = Number(reward.rate || 0) / 100;
        // Purchase-level and daily payouts are only plausible when each dollar
        // earns immediately. Threshold offers are handled by cumulative checkpoints.
        if (reward.kind !== 'percentage' || !rate || Number(reward.activationThreshold || 0) > 0) return [];
        const transactions = [...(progress.rewardTransactions || progress.eligibleTransactions || [])]
            .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id || 0) - Number(b.id || 0));
        const details = transactions.map(transaction => ({
            kind: 'transaction',
            key: `transaction:${transaction.id || `${transaction.date}:${transaction.merchant}:${transaction.amount}`}`,
            amount: money(Number(transaction.amount || 0) * rate),
            qualifyingSpend: money(transaction.amount),
            transactions: [transaction]
        }));
        const byDay = new Map();
        transactions.forEach(transaction => {
            const day = String(transaction.date).slice(0, 10);
            const rows = byDay.get(day) || [];
            rows.push(transaction);
            byDay.set(day, rows);
        });
        byDay.forEach((rows, day) => {
            if (rows.length < 2) return;
            const qualifyingSpend = money(rows.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0));
            details.push({ kind: 'day', key: `day:${day}`, amount: money(qualifyingSpend * rate), qualifyingSpend, transactions: rows });
        });
        const available = details.filter(detail => detail.amount > 0);
        // Do not reuse the same purchase/day evidence for repeated credits.
        // Existing credits consume one matching evidence candidate each.
        for (const credit of offer.credits || []) {
            const index = available.findIndex(detail => close(detail.amount, credit.amount));
            if (index >= 0) available.splice(index, 1);
        }
        return available;
    }

    function isPotentialOfferCredit(event) {
        const text = `${event.description || ''} ${event.eventType || ''}`.toLowerCase();
        if (/payment|autopay|interest|fee|refund|returned purchase/.test(text)) return false;
        return /statement credit|specific credit|reward|bonus|promotional credit|offer credit/.test(text);
    }

    function scoreCandidate(event, candidate) {
        const amount = Math.abs(Number(event.amount || 0));
        const { offer, progress } = candidate;
        if (!amount || !progress) return { score: 0, reasons: [] };

        const reasons = [];
        let score = 0;
        const outstanding = money(Math.max(Number(progress.expectedReward || 0) - Number(progress.postedCredits || 0), 0));
        const expected = money(progress.expectedReward || 0);
        const monthRewards = (progress.months || []).map(month => money(month.earnedReward || 0)).filter(Boolean);
        const checkpoints = percentageCheckpoints(offer, progress);
        const purchaseDetails = percentagePurchaseDetails(offer, progress);

        if (outstanding > 0 && close(amount, outstanding)) {
            score += 100;
            reasons.push('amount matches expected outstanding credit');
        } else if (checkpoints.some(value => close(amount, value))) {
            score += 100;
            reasons.push('amount matches a percentage reward at a transaction checkpoint');
        } else if (purchaseDetails.some(detail => close(amount, detail.amount))) {
            const detail = purchaseDetails.find(item => close(amount, item.amount));
            score += 85;
            reasons.push(detail.kind === 'day'
                ? 'amount matches the percentage reward for one day of qualifying purchases'
                : 'amount matches the percentage reward for one qualifying purchase');
        } else if (expected > 0 && close(amount, expected)) {
            score += 90;
            reasons.push('amount matches the expected credit');
        } else if (monthRewards.some(reward => close(amount, reward))) {
            score += 80;
            reasons.push('amount matches an earned monthly reward');
        } else if (offer.rewardConfig?.kind === 'percentage' && expected > 0 && amount < outstanding) {
            score += 45;
            reasons.push('amount is a plausible partial percentage credit');
        }

        const configuredAmounts = [offer.rewardConfig?.cap, ...(offer.rewardConfig?.tiers || []).map(tier => tier.reward)]
            .map(money).filter(Boolean);
        if (configuredAmounts.some(value => close(amount, value))) {
            score += 25;
            reasons.push('amount matches a configured reward or cap');
        }

        return { score, reasons };
    }

    function findCreditMatch(event, candidates) {
        if (!isPotentialOfferCredit(event)) return { matched: false, reason: 'not an offer credit', rankings: [] };
        const rankings = candidates
            .map(candidate => ({ ...candidate, ...scoreCandidate(event, candidate) }))
            .filter(candidate => candidate.score > 0)
            .sort((a, b) => b.score - a.score);
        const best = rankings[0];
        const runnerUp = rankings[1];
        const confident = best && best.score >= 80 && (!runnerUp || best.score - runnerUp.score >= 20);
        return confident
            ? { matched: true, offerId: best.offer.id, offerName: best.offer.name, score: best.score, reasons: best.reasons, rankings }
            : { matched: false, reason: best ? 'ambiguous offer credit' : 'no matching offer', rankings };
    }

    return { isPotentialOfferCredit, percentageCheckpointDetails, percentageCheckpoints, percentagePurchaseDetails, scoreCandidate, findCreditMatch };
});
