const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonthlyView, renderMonthlyDashboard, localMonth } = require('../monthly-dashboard');
const matcher = require('../credit-matcher');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function month(key, earnedReward = 0) {
  const date = new Date(`${key}-01T12:00:00`);
  return { month: date.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    periodStart: `${key}-01`, periodEnd: `${key}-28`, earnedReward, spending: earnedReward * 20, metric: earnedReward * 20, progress: 50 };
}
const today = new Date(2026, 9, 1);
const progress = { months: [month('2026-07', 10), month('2026-08', 20), month('2026-09', 30), month('2026-10', 5), month('2026-11')], eligibleTransactions: [] };
const offer = { id: 1, monthlyTracking: true, credits: [] };

test('current month is prominent, last month collapses separately, history is newest first', () => {
  const view = buildMonthlyView(offer, progress, today);
  assert.equal(view.current.key, '2026-10');
  assert.equal(view.previous.key, '2026-09');
  assert.deepEqual(view.history.map(item => item.key), ['2026-08', '2026-07']);
  assert.deepEqual(view.upcoming.map(item => item.key), ['2026-11']);
  const html = renderMonthlyDashboard(offer, progress, escapeHtml, today);
  assert.match(html, /monthly-period-current.*data-month="2026-10"/);
  assert.match(html, /Last month · September 2026/);
  assert.match(html, /Previous month history \(2\)/);
  assert.ok(html.indexOf('Current month · October') < html.indexOf('Last month'));
  assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
});
test('credits belong to their explicit earned month, not their posting month', () => {
  const view = buildMonthlyView({ ...offer, credits: [{ id: 1, amount: 30, postedDate: '2026-10-15', rewardMonth: '2026-09' }] }, progress, today);
  assert.equal(view.previous.postedCredits, 30);
  assert.equal(view.current.postedCredits, 0);
  assert.equal(view.previous.credits[0].inferred, false);
});
test('unique reward evidence suggests a month and preserves the actual Citi date', () => {
  const withCredit = { ...offer, credits: [{ id: 1, amount: 30, postedDate: '2026-10-15', description: 'Reward' }] };
  const view = buildMonthlyView(withCredit, progress, today);
  assert.equal(view.previous.credits[0].inferred, true);
  assert.equal(view.previous.postedCredits, 30);
  const html = renderMonthlyDashboard(withCredit, progress, escapeHtml, today);
  assert.match(html, /Citi date 2026-10-15/);
  assert.match(html, /Suggested earned month/);
});
test('same reward in multiple months stays unassigned despite a posting date', () => {
  const view = buildMonthlyView({ ...offer, credits: [{ id: 1, amount: 30, postedDate: '2026-09-01' }] },
    { months: [month('2026-08', 30), month('2026-09', 30)] }, today);
  assert.equal(view.unassigned.length, 1);
  assert.equal(view.previous.postedCredits, 0);
});
test('partial percentage credits use month-specific purchase checkpoints', () => {
  const view = buildMonthlyView({ ...offer, measurement: { period: 'monthly' }, rewardConfig: { kind: 'percentage', rate: 5 },
    credits: [{ id: 1, amount: 5, postedDate: '2026-08-01' }] },
  { months: [month('2026-09', 20), month('2026-10', 30)], eligibleTransactions: [
    { id: 1, date: '2026-09-20', amount: 100, merchant: 'Store' },
    { id: 2, date: '2026-09-21', amount: 300, merchant: 'Store' },
    { id: 3, date: '2026-10-02', amount: 600, merchant: 'Store' }
  ] }, today, matcher);
  assert.equal(view.previous.postedCredits, 5);
  assert.equal(view.current.postedCredits, 0);
});
test('credits are shown once and totals include unassigned credits without duplicating periods', () => {
  const credits = [{ id: 1, amount: 10 }, { id: 2, amount: 20 }, { id: 3, amount: 500 }];
  const view = buildMonthlyView({ ...offer, credits }, progress, today);
  assert.equal(view.months.reduce((sum, item) => sum + item.credits.length, 0) + view.unassigned.length, 3);
  assert.equal(view.months.reduce((sum, item) => sum + item.postedCredits, 0) + view.unassigned.reduce((sum, item) => sum + item.amount, 0), 530);
});
test('January groups December as last month across a year boundary', () => {
  const date = new Date(2027, 0, 1);
  const view = buildMonthlyView(offer, { months: [month('2026-11'), month('2026-12'), month('2027-01')] }, date);
  assert.equal(localMonth(date), '2027-01');
  assert.equal(view.previous.key, '2026-12');
  assert.equal(view.history[0].key, '2026-11');
});
test('expired and upcoming offers do not mislabel a past or future month as current', () => {
  for (const months of [[month('2026-08')], [month('2026-12')]]) {
    const html = renderMonthlyDashboard(offer, { months }, escapeHtml, today);
    assert.match(html, /not active in the current month/);
    assert.doesNotMatch(html, /class="monthly-period monthly-period-current"/);
  }
});
test('count-based and tiered trackers show purchase counts and reward targets', () => {
  const html = renderMonthlyDashboard({ ...offer, type: 'transactions', tiers: [{ threshold: 5, reward: 25 }] },
    { months: [{ ...month('2026-10'), transactionCount: 3, metric: 3, nextTarget: 5 }] }, escapeHtml, today);
  assert.match(html, /Qualifying purchases/);
  assert.match(html, /2 more purchases/);
  assert.match(html, /5 purchases → \$25.00/);
});
test('merchant and credit descriptions are escaped', () => {
  const html = renderMonthlyDashboard({ ...offer, credits: [{ id: 1, amount: 5, rewardMonth: '2026-10', description: '<script>alert(1)</script>' }] }, progress, escapeHtml, today);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('the actual dashboard integrates monthly sections without repeating credits or changing single-period cards', async () => {
  const date = new Date();
  const current = localMonth(date);
  const previous = localMonth(new Date(date.getFullYear(), date.getMonth() - 1, 1));
  const container = { innerHTML: '' };
  const shared = { id: 1, name: 'Monthly offer', monthlyTracking: true,
    startDate: new Date(date.getFullYear(), date.getMonth() - 1, 1), endDate: new Date(date.getFullYear(), date.getMonth() + 1, 1),
    categories: ['general'], transactions: [], credits: [{ id: 1, amount: 10, rewardMonth: previous, description: 'Unique previous reward' }],
    progress: { status: 'active', months: [month(previous, 10), month(current, 20)], expectedReward: 30, postedCredits: 10 } };
  const single = { ...shared, id: 2, name: 'Single-period offer', monthlyTracking: false, credits: [],
    type: 'spending', spendingTarget: 200, reward: 5,
    progress: { status: 'active', totalSpending: 100, spending: 100, earnedReward: 0, expectedReward: 0, postedCredits: 0 } };
  const context = vm.createContext({ document: { getElementById: () => container }, console,
    CreditMatcher: matcher, MonthlyDashboard: require('../monthly-dashboard') });
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  vm.runInContext(source.slice(0, source.lastIndexOf('const tracker = new OfferTracker();')) + '\nglobalThis.Tracker = OfferTracker;', context);
  const tracker = Object.create(context.Tracker.prototype);
  tracker.escapeHtml = escapeHtml;
  tracker.dataManager = { getSimplifiedOfferList: async () => [shared, single], dbManager: { getAccountEvents: async () => [] } };
  await tracker.renderDashboard();
  assert.doesNotMatch(container.innerHTML, /Error loading dashboard/);
  assert.match(container.innerHTML, /Current month/);
  assert.match(container.innerHTML, /Last month/);
  assert.equal((container.innerHTML.match(/Unique previous reward/g) || []).length, 1);
  assert.match(container.innerHTML, /Single-period offer/);
  assert.match(container.innerHTML, /Progress and offer details/);
});
