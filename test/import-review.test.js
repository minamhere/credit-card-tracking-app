const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(checkedIndices = []) {
  const controls = Array.from({ length: 3 }, (_, index) => ({
    dataset: { index: String(index) }, checked: false,
    remember: { checked: false, disabled: true },
    addEventListener(_event, listener) { this.change = listener; },
    closest() { return { classList: { toggle() {} } }; }
  }));
  const preview = { innerHTML: '', classList: { remove() {} }, querySelectorAll: () => controls,
    querySelector: selector => controls[Number(selector.match(/data-index="(\d+)"/)[1])].remember };
  const button = {};
  const document = {
    getElementById: id => id === 'csv-import-preview' ? preview : button,
    querySelectorAll: () => checkedIndices.map(index => ({ dataset: { index: String(index) } })),
    querySelector: selector => ({ value: selector.includes('categories') ? 'general' : 'Reviewed merchant', checked: false })
  };
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const context = vm.createContext({ document });
  vm.runInContext(source.slice(0, source.lastIndexOf('const tracker = new OfferTracker();')) + '\nglobalThis.Tracker = OfferTracker;', context);
  const tracker = Object.create(context.Tracker.prototype);
  const submissions = [];
  const messages = [];
  Object.assign(tracker, {
    importPreview: [
      { date: '2026-09-29', amount: 20, merchant: 'Purchase', originalMerchant: 'Purchase', transactionType: 'purchase', categories: ['general'] },
      { date: '2026-09-29', amount: -5, merchant: 'Credit', originalMerchant: 'Credit', transactionType: 'credit', categories: [] },
      { date: '2026-09-29', amount: -100, merchant: 'Payment', originalMerchant: 'Payment', transactionType: 'payment', categories: [] }
    ],
    importMetadata: { source: 'plaid' },
    escapeHtml: value => String(value),
    setImportMessage: message => messages.push(message),
    dataManager: { dbManager: { confirmTransactionImport: async (...args) => {
      submissions.push(args);
      return { imported: args[0].length, eventsImported: args[2].length, skipped: 0 };
    } } },
    clearImportPreview() {}, addCategory() {},
    async renderTransactions() {}, async renderDashboard() {},
    async renderMerchantRules() {}, async renderAccountEvents() {}
  });
  return { tracker, preview, controls, submissions, messages };
}

test('purchase, credit, and payment review checkboxes all start unselected', () => {
  const { tracker, preview } = harness();
  tracker.renderImportPreview();
  const inputs = preview.innerHTML.match(/<input[^>]+class="import-select"[^>]*>/g);
  assert.equal(inputs.length, 3);
  assert.ok(inputs.every(input => !/checked|disabled/.test(input)));
  const rules = preview.innerHTML.match(/<input[^>]+class="import-save-rule"[^>]*>/g);
  assert.ok(rules.every(input => !/checked/.test(input) && /disabled/.test(input)));
});

test('duplicates, ambiguous rows, invalid rows, and conflicts cannot be selected', () => {
  const { tracker, preview } = harness();
  tracker.importPreview = ['duplicate', 'ambiguous', 'invalid', 'lifecycleStatus'].map(field => ({
    ...tracker.importPreview[0], [field]: field === 'lifecycleStatus' ? 'conflicted' : true
  }));
  tracker.renderImportPreview();
  const inputs = preview.innerHTML.match(/<input[^>]+class="import-select"[^>]*>/g);
  assert.equal(inputs.length, 4);
  assert.ok(inputs.every(input => /disabled/.test(input) && !/checked/.test(input)));
});

test('selecting a purchase enables optional rule saving; credits do not save rules', () => {
  const { tracker, controls } = harness();
  tracker.renderImportPreview();
  controls[0].checked = true;
  controls[0].change();
  assert.equal(controls[0].remember.disabled, false);
  assert.equal(controls[0].remember.checked, false);
  controls[0].remember.checked = true;
  controls[0].checked = false;
  controls[0].change();
  assert.equal(controls[0].remember.disabled, true);
  assert.equal(controls[0].remember.checked, false);
  controls[1].checked = true;
  controls[1].change();
  assert.equal(controls[1].remember.disabled, true);
});

test('confirm with nothing selected does not automatically import account events', async () => {
  const { tracker, submissions, messages } = harness();
  await tracker.confirmCitiImport();
  assert.equal(submissions.length, 0);
  assert.match(messages.at(-1), /Select at least one/);
});

test('confirm submits only explicitly selected purchases and account events', async () => {
  const { tracker, submissions } = harness([0, 1]);
  await tracker.confirmCitiImport();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0][0].length, 1);
  assert.equal(submissions[0][2].length, 1);
  assert.equal(submissions[0][2][0].transactionType, 'credit');
  assert.equal(submissions[0][0][0].saveRule, false);
});

test('a selected credit can be imported without selecting a purchase', async () => {
  const { tracker, submissions } = harness([1]);
  await tracker.confirmCitiImport();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0][0].length, 0);
  assert.equal(submissions[0][2].length, 1);
});

test('history cutoff migration is fixed, repeatable, and does not delete records', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS import_start_date DATE/);
  assert.match(sql, /SET import_start_date = created_at::date - 60\s+WHERE import_start_date IS NULL/);
  assert.doesNotMatch(sql, /DELETE FROM (external_transactions|transactions|account_events)/i);
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  // Review and both purchase/event confirmation enforce the same fixed boundary.
  assert.equal((server.match(/et.transaction_date >= c.import_start_date/g) || []).length, 3);
});
