const { normalizeMerchant } = require('./transaction-reconciliation');
const defaultMerchantRules = [
  { pattern: 'LOST ISLAND', merchant: 'Lost Island', categories: ['entertainment'] },
  { pattern: 'TRADER JOE', merchant: "Trader Joe's", categories: ['grocery'] },
  { pattern: 'KING SOOPERS', merchant: 'King Soopers', categories: ['grocery'] },
  { pattern: 'MAVERIK', merchant: 'Maverik', categories: ['gas'] },
  { pattern: 'TARGET', merchant: 'Target', categories: ['retail'] },
  { pattern: 'TJMAXX', merchant: 'TJ Maxx', categories: ['retail'] },
  { pattern: 'HOME DEPOT', merchant: 'Home Depot', categories: ['retail','home-improvement'] },
  { pattern: 'WELCOME TO LV', merchant: 'Welcome to Las Vegas', categories: ['retail'] },
  { pattern: 'COORS FIELD MRC', merchant: 'Coors Field Merchandise', categories: ['retail'] },
  { pattern: 'UBER CASH', merchant: 'Uber Cash', categories: ['transportation'] },
  { pattern: "CHILI'S", merchant: "Chili's", categories: ['restaurant'] },
  { pattern: 'ILLEGAL PETE', merchant: "Illegal Pete's", categories: ['restaurant'] },
  { pattern: 'PORT OF SUBS', merchant: 'Port of Subs', categories: ['restaurant'] },
  { pattern: 'TOKYO JOES', merchant: "Tokyo Joe's", categories: ['restaurant'] },
  { pattern: 'KB COFFEE', merchant: 'KB Coffee & Bakery', categories: ['restaurant'] },
  { pattern: 'LOST FRIEND BREWIN', merchant: 'Lost Friend Brewing', categories: ['restaurant'] },
  { pattern: 'GOAT PATCH', merchant: 'Goat Patch Brewing', categories: ['restaurant'] },
  { pattern: 'GREATDIVIDEBREWERY', merchant: 'Great Divide Brewery', categories: ['restaurant'] },
  { pattern: 'CARBOY WINERY', merchant: 'Carboy Winery', categories: ['restaurant'] },
  { pattern: 'FRESH ATTRACTION', merchant: 'Fresh Attraction', categories: ['restaurant'] },
  { pattern: 'COORS FIELD GENER', merchant: 'Coors Field Concessions', categories: ['restaurant'] }
];


function classifyMerchant(rawMerchant, rules = []) {
  const candidate = normalizeMerchant(rawMerchant);
  const matches = rules.map(rule => ({
    id: rule.id, pattern: normalizeMerchant(rule.merchant_pattern ?? rule.pattern),
    merchant: rule.merchant_name ?? rule.merchant ?? String(rawMerchant).trim(),
    categories: [...new Set((rule.categories || []).map(value => String(value).trim().toLowerCase()).filter(Boolean))],
    exact: (rule.match_type ?? rule.matchType) === 'exact'
  })).filter(rule => rule.pattern && (rule.exact ? candidate === rule.pattern : candidate.includes(rule.pattern)))
    .sort((a,b) => b.pattern.length - a.pattern.length || Number(b.exact) - Number(a.exact));
  const best = matches[0];
  if (best) {
    const tied = matches.filter(rule => rule.pattern.length === best.pattern.length && rule.exact === best.exact);
    const conflict = tied.some(rule => JSON.stringify([...rule.categories].sort()) !== JSON.stringify([...best.categories].sort()) || rule.merchant !== best.merchant);
    return { merchant: best.merchant, categories: conflict ? [] : best.categories, matchedRuleId: best.id,
      source: 'saved', confident: !conflict && best.categories.length > 0,
      reason: conflict ? 'Conflicting merchant rules; review categories' : 'Matched saved merchant rule' };
  }
  const fallback = defaultMerchantRules.find(rule => candidate.includes(rule.pattern));
  return { merchant: fallback?.merchant || String(rawMerchant || '').trim(), categories: fallback?.categories || [],
    matchedRuleId: null, source: fallback ? 'default' : 'unknown', confident: Boolean(fallback),
    reason: fallback ? 'Matched known merchant' : 'Unknown merchant; review categories' };
}
module.exports = { classifyMerchant, defaultMerchantRules };
