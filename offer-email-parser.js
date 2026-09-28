(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.OfferEmailParser = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const money = value => Number(String(value).replace(/[$,]/g, ''));

    function isoDate(value) {
        const match = String(value || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!match) return null;
        return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    }

    function unique(values) {
        return [...new Set(values.filter(Boolean))];
    }

    function parseTiers(text) {
        const tiers = [];
        const patterns = [
            /(?:get|earn|receive)\s+\$([\d,]+(?:\.\d{1,2})?).{0,100}?(?:spend|purchases? (?:of|totaling))\s+\$([\d,]+(?:\.\d{1,2})?)/gi,
            /(?:spend|purchases? (?:of|totaling))\s+\$([\d,]+(?:\.\d{1,2})?).{0,100}?(?:get|earn|receive)\s+\$([\d,]+(?:\.\d{1,2})?)/gi,
            /\$([\d,]+(?:\.\d{1,2})?)\s+statement credit.{0,180}?(?:spend|totaling)\s+\$([\d,]+(?:\.\d{1,2})?)/gi,
            /earn(?: back)?(?: a)?\s*\$([\d,]+(?:\.\d{1,2})?)\s+statement credit.{0,180}?totaling\s+\$([\d,]+(?:\.\d{1,2})?)/gi
        ];
        let match;
        while ((match = patterns[0].exec(text))) tiers.push({ threshold: money(match[2]), reward: money(match[1]) });
        while ((match = patterns[1].exec(text))) tiers.push({ threshold: money(match[1]), reward: money(match[2]) });
        while ((match = patterns[2].exec(text))) tiers.push({ threshold: money(match[2]), reward: money(match[1]) });
        while ((match = patterns[3].exec(text))) tiers.push({ threshold: money(match[2]), reward: money(match[1]) });
        return unique(tiers.map(tier => `${tier.threshold}:${tier.reward}`))
            .map(value => { const [threshold, reward] = value.split(':').map(Number); return { threshold, reward }; })
            .sort((a, b) => a.threshold - b.threshold);
    }

    function parseOfferEmail(rawText) {
        const raw = String(rawText || '').replace(/\r/g, '');
        const text = raw.replace(/[\t\u00a0]+/g, ' ').replace(/ +/g, ' ');
        if (!text.trim()) throw new Error('Paste the Citi offer email first.');

        const percentageMatch = text.match(/earn\s+(\d+(?:\.\d+)?)%\s+back/i);
        const rate = percentageMatch ? Number(percentageMatch[1]) : null;
        const dateMatch = text.match(/from\s+(\d{1,2}\/\d{1,2}\/\d{4}).{0,180}?through\s+(\d{1,2}\/\d{1,2}\/\d{4})/is);
        const endOnlyMatch = text.match(/offer ends?\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
        const ownerMatch = text.match(/Security Zone:\s*([^\n]+)/i) || text.match(/Cardmember:\s*([^\n]+)/i);
        const accountMatch = text.match(/Account ending in:\s*(\d{4})/i);
        const monthly = /(?:each|per|this) month/i.test(text.slice(0, 5000));
        const capMatch = text.match(/maximum total of\s+\$([\d,]+(?:\.\d{1,2})?)/i) || text.match(/up to (?:a maximum total of )?\$([\d,]+(?:\.\d{1,2})?)/i);
        const offerSummary = text.slice(0, 5000);
        const thresholdMatch = offerSummary.match(/(?:if|when) you (?:make|spend).{0,80}?\$([\d,]+(?:\.\d{1,2})?)/i)
            || offerSummary.match(/spend\s+\$([\d,]+(?:\.\d{1,2})?)\s+or more each month/i)
            || offerSummary.match(/eligible purchases.{0,100}?total\s+\$([\d,]+(?:\.\d{1,2})?)\s+or more each month/is);
        const tiers = parseTiers(text.slice(0, 8000));

        let categories = [];
        let categoryLabel = 'Qualifying Purchases';
        if (/eligible retail purchases/i.test(offerSummary)) {
            categories = ['retail'];
            categoryLabel = 'Retail Purchases';
        } else if (/eligible gas station,?\s*grocery store and restaurant purchases|eligible gas station.{0,30}grocery store.{0,30}restaurant purchases/is.test(offerSummary)) {
            categories = ['gas', 'grocery', 'restaurant'];
            categoryLabel = 'Gas, Grocery, and Restaurant';
        }

        const excludedCategories = [];
        const exclusionMatch = text.match(/Purchases not eligible for this offer include purchases made at ([^.]+)\./i);
        if (exclusionMatch) {
            const exclusions = exclusionMatch[1].toLowerCase();
            if (exclusions.includes('home improvement')) excludedCategories.push('home-improvement');
            if (exclusions.includes('wholesale')) excludedCategories.push('wholesale-club');
            if (exclusions.includes('grocery')) excludedCategories.push('grocery');
            if (exclusions.includes('special event')) excludedCategories.push('special-event');
        }

        const startDate = dateMatch ? isoDate(dateMatch[1]) : null;
        const endDate = dateMatch ? isoDate(dateMatch[2]) : (endOnlyMatch ? isoDate(endOnlyMatch[1]) : null);
        const warnings = [];
        if (/or the date you activate(?:d)? this offer, whichever is later/i.test(text)) {
            warnings.push('The effective start date is the later of the stated date and activation date. Verify the activation date.');
        }
        if (!startDate) warnings.push('Start date was not found.');
        if (!endDate) warnings.push('End date was not found.');
        if (rate == null && !tiers.length) warnings.push('Reward rate or tiers were not found.');

        const type = rate != null ? 'percent-back' : 'spending';
        const descriptionParts = [
            `${rate != null ? `${rate}% back` : 'Tiered reward'} on ${categoryLabel.toLowerCase()}`,
            monthly && capMatch ? `Maximum $${money(capMatch[1]).toFixed(2)} per month` : null,
            warnings.length ? warnings.join(' ') : null
        ].filter(Boolean);

        return {
            name: `${rate != null ? `${rate}%` : 'Tiered'} ${categoryLabel}`,
            type,
            startDate,
            endDate,
            categories,
            excludeCategories: unique(excludedCategories),
            monthlyTracking: monthly,
            percentBack: rate,
            maxBack: capMatch ? money(capMatch[1]) : null,
            minSpendThreshold: thresholdMatch ? money(thresholdMatch[1]) : null,
            spendingTarget: tiers.length ? tiers[tiers.length - 1].threshold : null,
            transactionTarget: null,
            minTransaction: null,
            reward: 0,
            bonusReward: null,
            tiers,
            description: descriptionParts.join('. '),
            ownerName: ownerMatch ? ownerMatch[1].trim() : null,
            accountLastFour: accountMatch ? accountMatch[1] : null,
            warnings,
            sourceMetadata: {
                parser: 'citi-email-v1',
                ownerName: ownerMatch ? ownerMatch[1].trim() : null,
                accountLastFour: accountMatch ? accountMatch[1] : null,
                activationDateRequired: warnings.some(warning => warning.includes('activation date'))
            }
        };
    }

    return { parseOfferEmail, parseTiers, isoDate };
});
