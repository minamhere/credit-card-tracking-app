const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('earned-month assignments persist without changing credits and enforce offer/cardholder scope', {
  skip: !process.env.PGLITE_TEST_MODULE
}, async () => {
  const { PGlite } = require(process.env.PGLITE_TEST_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE offers (id INTEGER PRIMARY KEY, person_id INTEGER,
      monthly_tracking BOOLEAN, start_date TEXT, end_date TEXT);
      CREATE TABLE offer_credits (id INTEGER PRIMARY KEY, offer_id INTEGER, amount NUMERIC,
        posted_date DATE, description TEXT, reward_month TEXT);
      INSERT INTO offers VALUES (1, 7, TRUE, '2026-07-15', '2026-11-15'),
        (2, 8, TRUE, '2026-07-15', '2026-11-15'), (3, 7, FALSE, '2026-07-15', '2026-11-15');
      INSERT INTO offer_credits VALUES (10, 1, 30, '2026-10-15', 'Reward', NULL),
        (11, 2, 20, '2026-10-15', 'Other cardholder', NULL), (12, 3, 10, '2026-10-15', 'Single period', NULL);`);
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = source.indexOf("app.patch('/api/offers/:offerId/credits/:creditId/month'");
    let handler;
    vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 5), {
      app: { patch(_path, callback) { handler = callback; } }, pool: db,
      positiveInteger(value) { const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid id'); return id; },
      console: { error() {} }
    });
    async function request(rewardMonth, { offerId = 1, creditId = 10, personId = 7 } = {}) {
      let status = 200;
      let body;
      const response = { status(code) { status = code; return this; }, json(data) { body = data; return this; } };
      await handler({ params: { offerId, creditId }, body: { rewardMonth, personId } }, response);
      return { status, body };
    }
    assert.equal((await request('2026-09')).status, 200);
    const stored = (await db.query('SELECT * FROM offer_credits WHERE id = 10')).rows[0];
    assert.equal(stored.reward_month, '2026-09');
    assert.equal(Number(stored.amount), 30);
    assert.equal(stored.description, 'Reward');
    assert.equal((await request('2026-09', { personId: 8 })).status, 404);
    assert.equal((await request('2026-09', { creditId: 11 })).status, 404);
    assert.equal((await request('2026-09', { offerId: 3, creditId: 12 })).status, 400);
    for (const month of ['2026-06', '2026-12', '2026-00', '2026-13', 'September', '<script>']) {
      assert.equal((await request(month)).status, 400);
    }
    assert.equal((await request(null)).status, 200);
    assert.equal((await db.query('SELECT reward_month FROM offer_credits WHERE id = 10')).rows[0].reward_month, null);
    assert.equal((await db.query('SELECT reward_month FROM offer_credits WHERE id = 11')).rows[0].reward_month, null);
  } finally { await db.close(); }
});
