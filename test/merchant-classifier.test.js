const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMerchant } = require('../merchant-classifier');
test('saved rules override defaults and normalize raw whitespace', () => {
  assert.deepEqual(classifyMerchant('  TARGET   #123 ', [{id:1, pattern:'TARGET', merchant:'Target online', categories:['retail','online'], matchType:'contains'}]).categories, ['retail','online']);
});
test('conflicting equally specific rules need review', () => {
  const rules = [{id:1,pattern:'ABC',merchant:'One',categories:['gas']},{id:2,pattern:'ABC',merchant:'Two',categories:['restaurant']}];
  assert.equal(classifyMerchant('ABC SHOP', rules).confident, false);
});
test('unknown merchants remain unknown', () => {
  assert.deepEqual(classifyMerchant('UNFAMILIAR SHOP', []).categories, []);
  assert.equal(classifyMerchant('UNFAMILIAR SHOP', []).confident, false);
});
test('home improvement retains its exclusion', () => {
  assert.deepEqual(classifyMerchant('THE HOME DEPOT #123', []).categories, ['retail','home-improvement']);
});
test('a more specific saved rule wins and exact wins ties', () => {
  const rules = [{id:1,pattern:'SHOP',categories:['retail']},{id:2,pattern:'SHOP CAFE',matchType:'exact',categories:['restaurant']}];
  assert.deepEqual(classifyMerchant('SHOP CAFE', rules).categories, ['restaurant']);
});
