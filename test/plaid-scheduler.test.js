const test = require('node:test');
const assert = require('node:assert/strict');

function fakeTimers() {
  const scheduled = [];
  const cleared = [];
  return {
    scheduled, cleared,
    setTimeoutFn(fn, delay) { const handle = { fn, delay }; scheduled.push(handle); return handle; },
    clearTimeoutFn(handle) { cleared.push(handle); }
  };
}

test('disabled auto-sync schedules no work', () => {
  const { createPlaidScheduler } = require('../plaid-scheduler');
  const timers = fakeTimers();
  const scheduler = createPlaidScheduler({ syncService: { syncAllHealthy: async () => [] }, intervalMs: 1000, enabled: false, ...timers });
  scheduler.start();
  assert.equal(timers.scheduled.length, 0);
});

test('delays the first run and never overlaps sync attempts', async () => {
  const { createPlaidScheduler } = require('../plaid-scheduler');
  const timers = fakeTimers();
  let resolveSync;
  let calls = 0;
  const syncService = { syncAllHealthy: () => { calls++; return new Promise(resolve => { resolveSync = resolve; }); } };
  const scheduler = createPlaidScheduler({ syncService, intervalMs: 1000, initialDelayMs: 200, ...timers });
  scheduler.start();
  assert.equal(calls, 0);
  assert.equal(timers.scheduled[0].delay, 200);
  const running = timers.scheduled[0].fn();
  assert.equal(calls, 1);
  assert.equal(timers.scheduled.length, 1);
  resolveSync([]);
  await running;
  assert.equal(timers.scheduled.length, 2);
  assert.equal(timers.scheduled[1].delay, 1000);
});

test('backs off after repeated scheduler failures and resets after success', async () => {
  const { createPlaidScheduler } = require('../plaid-scheduler');
  const timers = fakeTimers();
  const outcomes = [new Error('one'), new Error('two'), []];
  const scheduler = createPlaidScheduler({ syncService: { syncAllHealthy: async () => { const next = outcomes.shift(); if (next instanceof Error) throw next; return next; } }, intervalMs: 1000, initialDelayMs: 10, maxBackoffMs: 8000, logger: { error() {} }, ...timers });
  scheduler.start();
  await timers.scheduled[0].fn();
  assert.equal(timers.scheduled[1].delay, 2000);
  await timers.scheduled[1].fn();
  assert.equal(timers.scheduled[2].delay, 4000);
  await timers.scheduled[2].fn();
  assert.equal(timers.scheduled[3].delay, 1000);
});

test('logs per-connection failure safely and continues scheduling', async () => {
  const { createPlaidScheduler } = require('../plaid-scheduler');
  const timers = fakeTimers();
  const logs = [];
  const calls = [];
  const scheduler = createPlaidScheduler({ syncService: { syncAllHealthy: async ids => { calls.push(ids); return calls.length === 1 ? [{ connectionId: 2, ok: false, code: 'RATE_LIMIT_EXCEEDED' }, { connectionId: 3, ok: true }] : [{ connectionId: 2, ok: true }]; } }, intervalMs: 1000, logger: { error(message, details) { logs.push([message, details]); } }, ...timers });
  scheduler.start();
  await timers.scheduled[0].fn();
  assert.deepEqual(logs, [['Plaid connection sync failed', { connectionId: 2, code: 'RATE_LIMIT_EXCEEDED' }]]);
  assert.equal(timers.scheduled.length, 2);
  assert.equal(timers.scheduled[1].delay, 2000);
  await timers.scheduled[1].fn();
  assert.deepEqual(calls, [null, [2]]);
  assert.equal(timers.scheduled[2].delay, 1000);
});

test('stop clears pending work and prevents a running attempt from rescheduling', async () => {
  const { createPlaidScheduler } = require('../plaid-scheduler');
  const timers = fakeTimers();
  let finish;
  const scheduler = createPlaidScheduler({ syncService: { syncAllHealthy: () => new Promise(resolve => { finish = resolve; }) }, intervalMs: 1000, ...timers });
  scheduler.start();
  const running = timers.scheduled[0].fn();
  scheduler.stop();
  finish([]);
  await running;
  assert.equal(timers.scheduled.length, 1);

  const pendingTimers = fakeTimers();
  const pending = createPlaidScheduler({ syncService: { syncAllHealthy: async () => [] }, intervalMs: 1000, ...pendingTimers });
  pending.start();
  pending.stop();
  assert.deepEqual(pendingTimers.cleared, [pendingTimers.scheduled[0]]);
});
