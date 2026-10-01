(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MonthlyDashboard = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const money = value => Math.round(Number(value || 0) * 100) / 100;
    const close = (a, b) => Math.abs(money(a) - money(b)) <= 0.02;
    const key = month => String(month.periodStart).slice(0, 7);
    function localMonth(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    function buildMonthlyView(offer, progress, today = new Date(), matcher) {
        const months = (progress.months || []).map(month => ({ ...month, key: key(month), credits: [] }));
        const byKey = new Map(months.map(month => [month.key, month]));
        let unassigned = [];
        for (const credit of offer.credits || []) {
            if (byKey.has(credit.rewardMonth)) byKey.get(credit.rewardMonth).credits.push({ ...credit, inferred: false });
            else unassigned.push(credit);
        }
        // A posting date is not an earned month. Suggest a month only when
        // reward/purchase evidence identifies exactly one possible period.
        let changed;
        do {
            changed = false;
            const remaining = [];
            for (const credit of unassigned) {
                if (credit.rewardMonth) { remaining.push(credit); continue; }
                const candidates = months.filter(month => {
                    const posted = money(month.credits.reduce((sum, item) => sum + Number(item.amount), 0));
                    const outstanding = money(Number(month.earnedReward || 0) - posted);
                    if (outstanding <= 0 || Number(credit.amount) > outstanding + 0.02) return false;
                    if (close(credit.amount, outstanding)) return true;
                    const rows = (progress.eligibleTransactions || []).filter(transaction => String(transaction.date).slice(0, 7) === month.key);
                    const periodProgress = { ...progress, eligibleTransactions: rows,
                        rewardTransactions: (progress.rewardTransactions || rows).filter(transaction => String(transaction.date).slice(0, 7) === month.key), postedCredits: posted };
                    return (matcher?.percentageCheckpointDetails(offer, periodProgress) || []).some(item => close(item.amount, credit.amount)) ||
                        (matcher?.percentagePurchaseDetails({ ...offer, credits: month.credits }, periodProgress) || []).some(item => close(item.amount, credit.amount));
                });
                if (candidates.length === 1) {
                    candidates[0].credits.push({ ...credit, inferred: true });
                    changed = true;
                } else remaining.push(credit);
            }
            unassigned = remaining;
        } while (changed);
        months.forEach(month => { month.postedCredits = money(month.credits.reduce((sum, credit) => sum + Number(credit.amount), 0)); });
        const currentKey = localMonth(today);
        const previousKey = localMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1));
        return { months, current: byKey.get(currentKey), previous: byKey.get(previousKey),
            history: months.filter(month => month.key < previousKey).sort((a, b) => b.key.localeCompare(a.key)),
            upcoming: months.filter(month => month.key > currentKey), unassigned, currentKey };
    }

    function renderMonthlyDashboard(offer, progress, escapeHtml, today = new Date(), matcher) {
        const view = buildMonthlyView(offer, progress, today, matcher);
        const currency = value => `$${money(value).toFixed(2)}`;
        function renderCredit(credit) {
            const options = view.months.map(month => `<option value="${month.key}" ${credit.rewardMonth === month.key ? 'selected' : ''}>${escapeHtml(month.month)}</option>`).join('');
            return `<div class="posted-credit-row">
                <div class="posted-credit-amount">+${currency(credit.amount)}</div>
                <div><strong>${escapeHtml(credit.description || 'Statement credit')}</strong>
                <small>${credit.postedDate ? `Citi date ${escapeHtml(String(credit.postedDate).slice(0, 10))} (may be backdated)` : 'Posting date unavailable'}${credit.inferred ? ' · Suggested earned month; confirm below' : ''}</small>
                ${credit.id ? `<label class="credit-month-label">Earned month <select aria-label="Earned month for credit ${Number(credit.id)}" onchange="tracker.assignCreditMonth(${Number(offer.id)}, ${Number(credit.id)}, this.value)"><option value="">Choose / confirm month</option>${options}</select></label>` : ''}
                </div></div>`;
        }
        function renderPeriod(month, label) {
            const ended = month.key < view.currentKey;
            const future = month.key > view.currentKey;
            const status = future ? 'Upcoming' : month.completed ? 'Goal reached' : ended ? 'Month ended' : 'In progress';
            const tiers = offer.rewardConfig?.tiers || offer.tiers || [];
            const countBased = offer.measurement?.kind === 'count' || offer.type === 'transactions';
            const metric = Number(month.metric ?? (countBased ? month.transactionCount : month.spending) ?? 0);
            const tierText = tiers.map(tier => `<span>${countBased ? `${Number(tier.threshold)} purchases` : currency(tier.threshold)} → ${currency(tier.reward)}${metric >= Number(tier.threshold) ? ' ✓' : ''}</span>`).join('');
            const rows = (progress.eligibleTransactions || offer.transactions || []).filter(transaction => String(transaction.date).slice(0, 7) === month.key);
            return `<section class="monthly-period ${label === 'Current month' ? 'monthly-period-current' : ''}" data-month="${month.key}">
                <div class="monthly-period-heading"><h3>${escapeHtml(label ? `${label} · ${month.month}` : month.month)}</h3><span>${status}</span></div>
                <div class="dashboard-metrics">
                    <div><span>${countBased ? 'Qualifying purchases' : 'Qualifying spend'}</span><strong>${countBased ? Number(month.transactionCount || 0) : currency(month.spending)}</strong></div>
                    <div><span>Expected credit</span><strong>${currency(month.earnedReward)}</strong></div>
                    <div><span>Posted credit${month.credits.some(credit => credit.inferred) ? ' *' : ''}</span><strong>${currency(month.postedCredits)}</strong></div>
                </div>
                <div class="offer-progress monthly-progress" role="progressbar" aria-label="${escapeHtml(month.month)} reward progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0, Math.min(100, Number(month.progress || 0)))}"><div class="progress-bar" style="width:${Math.max(0, Math.min(100, Number(month.progress || 0)))}%"></div></div>
                ${tierText ? `<div class="monthly-tier-labels">${tierText}</div>` : ''}
                ${month.nextTarget != null && !ended && !future ? `<p class="monthly-next-target">${countBased ? `${Math.max(0, Number(month.nextTarget) - metric)} more purchases` : `Spend ${currency(Math.max(0, Number(month.nextTarget) - metric))} more`} to reach the next reward target.</p>` : ''}
                <section class="posted-credits"><div class="posted-credits-heading"><strong>Credits for ${escapeHtml(month.month)}</strong><span>${month.credits.length} posted</span></div>${month.credits.map(renderCredit).join('') || '<div class="posted-credit-empty">No credit assigned to this month yet.</div>'}</section>
                <details class="dashboard-details"><summary>Qualifying purchases (${rows.length})</summary><div class="dashboard-transaction-list">${rows.map(transaction => `<div class="dashboard-credit-transaction">${escapeHtml(String(transaction.date).slice(0, 10))} · ${escapeHtml(transaction.merchant)} · ${currency(transaction.amount)}</div>`).join('') || 'No qualifying purchases yet.'}</div></details>
            </section>`;
        }
        const details = (label, content) => `<details class="dashboard-details monthly-history"><summary>${escapeHtml(label)}</summary>${content}</details>`;
        return `<div class="monthly-dashboard">
            ${view.current ? renderPeriod(view.current, 'Current month') : '<p class="dashboard-empty-note">This offer is not active in the current month.</p>'}
            ${view.previous ? details(`Last month · ${view.previous.month}`, renderPeriod(view.previous, '')) : ''}
            ${view.history.length ? details(`Previous month history (${view.history.length})`, view.history.map(month => details(month.month, renderPeriod(month, ''))).join('')) : ''}
            ${view.upcoming.length ? details(`Upcoming months (${view.upcoming.length})`, view.upcoming.map(month => renderPeriod(month, '')).join('')) : ''}
            ${view.unassigned.length ? `<section class="posted-credits monthly-unassigned"><div class="posted-credits-heading"><strong>Credits needing an earned month</strong><span>${view.unassigned.length}</span></div><p class="monthly-credit-help">The earned month is unclear. Choose a month; the posting date alone is not enough.</p>${view.unassigned.map(renderCredit).join('')}</section>` : ''}
            ${view.months.some(month => month.credits.some(credit => credit.inferred)) ? '<p class="monthly-credit-help">* Includes suggested month assignments based on reward amounts or purchase checkpoints. Confirm using the earned-month selector.</p>' : ''}
        </div>`;
    }
    return { localMonth, buildMonthlyView, renderMonthlyDashboard };
});
