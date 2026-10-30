(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./offer-engine') : root.OfferEngine);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CreditMatcher = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Engine) {
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
        let available = details.filter(detail => detail.amount > 0);
        for (const credit of offer.credits || []) {
            const evidence = credit.matchEvidence || credit.match_evidence;
            let used = evidence?.transactionIds || evidence?.allocations?.map(a => a.transactionId);
            if (!used?.length) {
                const matching = available.filter(detail => close(detail.amount, credit.amount));
                used = matching.flatMap(detail => detail.transactions.map(t => t.id));
            }
            const consumed = new Set(used || []);
            available = available.filter(detail => !detail.transactions.some(t => consumed.has(t.id)));
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

    function earnedMonth(event) {
        const months = [];
        if (event.rewardMonth) {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(event.rewardMonth)) return { invalid: true };
            months.push(event.rewardMonth);
        }
        const ranges = [...String(event.description || '').matchAll(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/g)];
        function parse(value) {
            let [m,d,y] = value.split('/').map(Number);
            if (y < 100) y += 2000;
            const date = new Date(Date.UTC(y,m-1,d));
            return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d
                ? `${y}-${String(m).padStart(2,'0')}` : null;
        }
        for (const range of ranges) {
            const a = parse(range[1]), b = parse(range[2]);
            if (!a || !b || a !== b || Date.parse(range[1]) > Date.parse(range[2])) return { invalid: true };
            months.push(a);
        }
        if (new Set(months).size > 1) return { invalid: true };
        return { month: months[0] || null };
    }

    const cents = value => Math.round((Number(value) + Number.EPSILON) * 100);
    function eventIdentity(event) {
        return [String(event.date || '').slice(0,10), cents(Math.abs(Number(event.amount))),
            String(event.description || '').trim().replace(/\s+/g,' ').toUpperCase()].join('|');
    }

    function periodPlans(event, { offer: rawOffer, progress }) {
        const offer = Engine.normalizeOffer(rawOffer);
        if (!progress || (offer.reviewStatus && offer.reviewStatus !== 'confirmed')) return [];
        const amount = cents(Math.abs(Number(event.amount)));
        const requested = earnedMonth(event);
        if (requested.invalid) return [];
        const rows = [...(progress.eligibleTransactions || [])].sort((a,b) => String(a.date).localeCompare(String(b.date)) || Number(a.id)-Number(b.id));
        const monthly = offer.measurement.period === 'monthly';
        const periods = monthly ? [...new Set(rows.map(t => String(t.date).slice(0,7)))] : ['offer'];
        const rewards = new Map(periods.map(period => {
            const ts = rows.filter(t => !monthly || String(t.date).slice(0,7) === period);
            const metric = offer.measurement.kind === 'count' ? ts.length : ts.reduce((s,t)=>s+Number(t.amount),0);
            return [period, cents(Engine.calculateReward(metric,offer.rewardConfig).earnedReward)];
        }));
        const result = [];
        for (const period of periods) {
            if (requested.month && monthly && requested.month !== period) continue;
            const ts = rows.filter(t => !monthly || String(t.date).slice(0,7) === period);
            const expected = rewards.get(period);
            if (!expected || !ts.length || ts.some(t => !t.id)) continue;
            const credits = [];
            let uncertain = false;
            for (const credit of offer.credits || []) {
                const inferred = earnedMonth(credit);
                if (inferred.invalid) { uncertain = true; break; }
                let belongs = inferred.month;
                if (!belongs && monthly) {
                    const earningPeriods = periods.filter(p => rewards.get(p) > 0);
                    if (earningPeriods.length !== 1) { uncertain = true; break; }
                    belongs = earningPeriods[0];
                }
                if (!monthly || belongs === period) credits.push(credit);
            }
            if (uncertain) continue;
            const posted = credits.reduce((s,c)=>s+cents(c.amount),0);
            const outstanding = expected - posted;
            if (amount <= 0 || amount > outstanding) continue;
            const percentage = offer.rewardConfig.kind === 'percentage';
            let accumulated = 0, previous = 0;
            const budgets = ts.map(t => {
                accumulated += Number(t.amount);
                const gross = percentage ? Math.min(cents(accumulated * Number(offer.rewardConfig.rate) / 100),
                    offer.rewardConfig.cap == null ? Infinity : cents(offer.rewardConfig.cap)) : 0;
                const available = Math.max(0,gross-previous); previous = gross;
                return { transaction: t, available };
            });
            const threshold = Number(offer.rewardConfig.activationThreshold || 0);
            function options() {
                const candidates = [];
                const positive = budgets.filter(b=>b.available > 0);
                const add = (kind, list, value) => { if(value > 0) candidates.push({kind,list,value}); };
                if (percentage && threshold === 0) {
                    positive.forEach(b=>add('transaction',[b],b.available));
                    const days = new Map();
                    positive.forEach(b=>{const key=String(b.transaction.date).slice(0,10);days.set(key,[...(days.get(key)||[]),b]);});
                    for(const list of days.values()) if(list.length>1)add('day',list,list.reduce((s,b)=>s+b.available,0));
                }
                if (percentage && threshold > 0) {
                    let spend=0;
                    for(let i=0;i<ts.length;i++) {
                        spend += Number(ts[i].amount);
                        if(spend >= threshold) {
                            const list=budgets.slice(0,i+1).filter(b=>b.available>0);
                            add('checkpoint',list,list.reduce((s,b)=>s+b.available,0));
                        }
                    }
                }
                if (percentage) add('outstanding',positive,positive.reduce((s,b)=>s+b.available,0));
                return candidates;
            }
            if (percentage) {
                for (const credit of credits) {
                    const evidence = credit.matchEvidence || credit.match_evidence;
                    if (evidence?.allocations?.length) {
                        if (evidence.status === 'needs_review' || evidence.allocations.reduce((sum,a)=>sum+cents(a.amount),0) !== cents(credit.amount)) {uncertain=true;break;}
                        for (const allocation of evidence.allocations) {
                            const b = budgets.find(b=>Number(b.transaction.id)===Number(allocation.transactionId));
                            if (!b || cents(allocation.amount)>b.available) {uncertain=true;break;}
                            b.available -= cents(allocation.amount);
                        }
                    } else {
                        const matches = options().filter(o=>Math.abs(o.value-cents(credit.amount))<=2 && cents(credit.amount)<=o.value);
                        const unique = new Map(matches.map(o=>[o.list.map(b=>b.transaction.id).join(','),o]));
                        if(unique.size !== 1) {uncertain=true;break;}
                        let remaining=cents(credit.amount);
                        for(const b of [...unique.values()][0].list) {const used=Math.min(b.available,remaining); b.available-=used;remaining-=used;}
                        if(remaining) {uncertain=true;break;}
                    }
                    if(uncertain)break;
                }
                if(uncertain)continue;
                const matches=options().filter(o=>Math.abs(o.value-amount)<=2 && o.value>=amount);
                const unique=new Map(matches.map(o=>[o.list.map(b=>b.transaction.id).join(','),o]));
                if(unique.size!==1)continue;
                const chosen=[...unique.values()][0];
                let remaining=amount;
                const allocations=chosen.list.map(b=>{const used=Math.min(b.available,remaining);remaining-=used;return {transactionId:b.transaction.id,amount:used/100};}).filter(a=>a.amount>0);
                const transactionIds=allocations.map(a=>a.transactionId);
                result.push({offer,progress,rewardMonth:monthly?period:null,score:100,
                    reasons:[`amount matches ${chosen.kind === 'day' ? 'one day of qualifying purchases' : chosen.kind === 'transaction' ? 'one qualifying purchase' : chosen.kind === 'checkpoint' ? 'a reward checkpoint' : 'the remaining earned reward'}`],
                    evidence:{version:1,kind:chosen.kind,rewardMonth:monthly?period:null,transactionIds,allocations,
                        checkpointTransactionId:chosen.kind==='checkpoint'?transactionIds.at(-1):null,creditedAmount:amount/100}});
            } else {
                let metric=0;
                const checkpoints=ts.map(t=>{metric+=offer.measurement.kind==='count'?1:Number(t.amount);return {t,reward:cents(Engine.calculateReward(metric,offer.rewardConfig).earnedReward)-posted};});
                const checkpoint=checkpoints.find(c=>c.reward>=amount&&Math.abs(c.reward-amount)<=2);
                if(!checkpoint)continue;
                result.push({offer,progress,rewardMonth:monthly?period:null,score:100,reasons:['amount matches an unpaid reward checkpoint'],
                    evidence:{version:1,kind:'checkpoint',rewardMonth:monthly?period:null,transactionIds:ts.slice(0,ts.indexOf(checkpoint.t)+1).map(t=>t.id),allocations:[],checkpointTransactionId:checkpoint.t.id,creditedAmount:amount/100}});
            }
        }
        return result;
    }

    function findCreditMatch(event, candidates, { events = [] } = {}) {
        if (!Number.isFinite(Number(event.amount)) || !Number(event.amount) || !isPotentialOfferCredit(event))
            return { matched:false, reason:'not an offer credit', rankings:[] };
        if(events.some(other=>Number(other.id)!==Number(event.id) && eventIdentity(other)===eventIdentity(event)))
            return {matched:false,reason:'Possible duplicate statement credit; review source records',rankings:[]};
        const rankings=candidates.flatMap(candidate=>periodPlans(event,candidate));
        if(rankings.length!==1)return {matched:false,reason:rankings.length?'ambiguous offer or earned month':'No unique unpaid purchase evidence',rankings};
        const best=rankings[0];
        best.evidence.reasons=best.reasons;
        return {matched:true,offerId:best.offer.id,offerName:best.offer.name,score:best.score,reasons:best.reasons,
            rewardMonth:best.rewardMonth,evidence:best.evidence,rankings};
    }

    return { isPotentialOfferCredit, percentageCheckpointDetails, percentageCheckpoints, percentagePurchaseDetails, scoreCandidate, earnedMonth, eventIdentity, findCreditMatch };
});
