const test = require('node:test');
const assert = require('node:assert/strict');

function raw(id, accountId = 'selected-account', overrides = {}) {
  return {
    transaction_id: id, account_id: accountId, date: '2026-09-28', authorized_date: null,
    amount: 10, name: `MERCHANT ${id}`, merchant_name: `Merchant ${id}`, pending: false,
    pending_transaction_id: null, personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE' },
    ...overrides
  };
}

function fakeDb(options = {}) {
  const calls = [];
  let upserts = 0;
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (normalized.includes('INSERT INTO external_transactions')) {
        upserts++;
        if (options.failUpsertAt === upserts) throw new Error('database write failed');
        return { rows: [{ id: upserts }] };
      }
      if (normalized.startsWith('SELECT id, person_id FROM financial_connections')) {
        return { rows: options.healthyConnections || [] };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); }
  };
  return { calls, query: client.query, connect: async () => client };
}

function connectionService(overrides = {}) {
  return {
    async getActiveConnection(personId, connectionId) {
      if (overrides.failConnectionId === connectionId) throw new Error('connection unavailable');
      return {
        id: connectionId, personId, financialAccountId: connectionId * 10,
        providerAccountId: 'selected-account', cursor: overrides.cursor || null,
        accessToken: `access-${connectionId}`
      };
    }
  };
}

test('applies all sync pages, ignores unselected accounts, and advances cursor atomically', async () => {
  const { createSyncService } = require('../plaid-sync');
  const db = fakeDb();
  const plaidCalls = [];
  const plaidClient = {
    async syncTransactions(token, cursor) {
      plaidCalls.push([token, cursor]);
      if (!cursor) return { added: [raw('add-1'), raw('ignored', 'other-account')], modified: [], removed: [], nextCursor: 'cursor-1', hasMore: true };
      return { added: [], modified: [raw('modified-1')], removed: [{ transaction_id: 'removed-1' }], nextCursor: 'cursor-2', hasMore: false };
    }
  };
  const service = createSyncService({ pool: db, plaidClient, connectionService: connectionService() });
  const result = await service.syncConnection(7, 3);

  assert.deepEqual(result, { connectionId: 3, added: 1, modified: 1, removed: 1, cursor: 'cursor-2' });
  assert.deepEqual(plaidCalls, [['access-3', null], ['access-3', 'cursor-1']]);
  const upserts = db.calls.filter(call => call.sql.includes('INSERT INTO external_transactions'));
  assert.equal(upserts.length, 2);
  assert.ok(upserts.every(call => call.sql.includes('ON CONFLICT (provider, provider_transaction_id) DO UPDATE')));
  assert.equal(db.calls.some(call => call.params.includes('ignored')), false);
  assert.ok(db.calls.some(call => call.sql.includes('pg_advisory_xact_lock')));
  const cursorUpdate = db.calls.find(call => call.sql.includes('sync_cursor = $1'));
  assert.equal(cursorUpdate.params[0], 'cursor-2');
  assert.ok(db.calls.findIndex(call => call.sql === 'COMMIT') > db.calls.indexOf(cursorUpdate));
});

test('rolls back staged records and leaves cursor unchanged after a database failure', async () => {
  const { createSyncService } = require('../plaid-sync');
  const db = fakeDb({ failUpsertAt: 1 });
  const plaidClient = { async syncTransactions() { return { added: [raw('add-1')], modified: [], removed: [], nextCursor: 'cursor-1', hasMore: false, requestId: 'req-1' }; } };
  const service = createSyncService({ pool: db, plaidClient, connectionService: connectionService() });

  await assert.rejects(service.syncConnection(7, 3), /database write failed/);
  assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
  assert.equal(db.calls.some(call => call.sql.includes('sync_cursor = $1')), false);
  assert.ok(db.calls.some(call => call.sql.includes("status = 'error'")));
});

test('subsequent sync stages all new transactions without a rolling date filter', async () => {
  const { createSyncService } = require('../plaid-sync');
  const db = fakeDb();
  const plaidClient = { async syncTransactions(_token, cursor) {
    assert.equal(cursor, 'saved-cursor');
    return { added: [raw('new-after-long-gap', 'selected-account', { date: '2026-01-01' })],
      modified: [], removed: [], nextCursor: 'next-cursor', hasMore: false };
  } };
  const service = createSyncService({ pool: db, plaidClient, connectionService: connectionService({ cursor: 'saved-cursor' }) });
  const result = await service.syncConnection(7, 3);
  assert.equal(result.added, 1);
  assert.ok(db.calls.some(call => call.sql.includes('INSERT INTO external_transactions') && call.params.includes('new-after-long-gap')));
});

test('restarts from the committed cursor after a pagination mutation', async () => {
  const { createSyncService } = require('../plaid-sync');
  const db = fakeDb();
  let calls = 0;
  const cursors = [];
  const plaidClient = {
    async syncTransactions(_token, cursor) {
      calls++;
      cursors.push(cursor);
      if (calls === 1) return { added: [raw('temporary')], modified: [], removed: [], nextCursor: 'page-2', hasMore: true };
      if (calls === 2) {
        const error = new Error('mutation');
        error.code = 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';
        throw error;
      }
      return { added: [raw('stable')], modified: [], removed: [], nextCursor: 'stable-cursor', hasMore: false };
    }
  };
  const service = createSyncService({ pool: db, plaidClient, connectionService: connectionService({ cursor: 'committed-cursor' }) });
  const result = await service.syncConnection(7, 3);

  assert.deepEqual(cursors, ['committed-cursor', 'page-2', 'committed-cursor']);
  assert.equal(result.cursor, 'stable-cursor');
  assert.equal(db.calls.filter(call => call.sql === 'ROLLBACK').length, 1);
  assert.equal(db.calls.filter(call => call.sql === 'COMMIT').length, 1);
});

test('syncAllHealthy isolates connection failures and continues', async () => {
  const { createSyncService } = require('../plaid-sync');
  const db = fakeDb({ healthyConnections: [{ id: 1, person_id: 7 }, { id: 2, person_id: 8 }] });
  const plaidClient = { async syncTransactions() { return { added: [], modified: [], removed: [], nextCursor: 'done', hasMore: false }; } };
  const service = createSyncService({ pool: db, plaidClient, connectionService: connectionService({ failConnectionId: 1 }) });
  const results = await service.syncAllHealthy();

  assert.equal(results.length, 2);
  assert.equal(results[0].connectionId, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[1].connectionId, 2);
  assert.equal(results[1].ok, true);
});

test('syncAllHealthy can retry only failed connection ids', async () => {
  const { createSyncService } = require('../plaid-sync');
  const db = fakeDb({ healthyConnections: [{ id: 1, person_id: 7 }, { id: 2, person_id: 8 }] });
  const calls = [];
  const plaidClient = { async syncTransactions(token) { calls.push(token); return { added: [], modified: [], removed: [], nextCursor: 'done', hasMore: false }; } };
  const service = createSyncService({ pool: db, plaidClient, connectionService: connectionService() });
  const results = await service.syncAllHealthy([2]);
  assert.deepEqual(results.map(row => row.connectionId), [2]);
  assert.deepEqual(calls, ['access-2']);
});

test('marks expired login and consent errors as attention required', async () => {
  const { createSyncService } = require('../plaid-sync');
  for (const code of ['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION']) {
    const db = fakeDb();
    const plaidClient = { async syncTransactions() { const error = new Error('safe'); error.code = code; error.requestId = 'request-id'; throw error; } };
    const service = createSyncService({ pool: db, plaidClient, connectionService: connectionService() });
    await assert.rejects(service.syncConnection(7, 3));
    const failure = db.calls.find(call => call.sql.includes('last_error_code'));
    assert.ok(failure.sql.includes("status = 'attention_required'"));
    assert.deepEqual(failure.params, [code, 'request-id', 3, 7]);
  }
});

test('keeps rate limiting retryable without requiring reconnection', async () => {
  const { createSyncService } = require('../plaid-sync');
  const db = fakeDb();
  const plaidClient = { async syncTransactions() { const error = new Error('safe'); error.code = 'RATE_LIMIT_EXCEEDED'; throw error; } };
  const service = createSyncService({ pool: db, plaidClient, connectionService: connectionService() });
  await assert.rejects(service.syncConnection(7, 3));
  const failure = db.calls.find(call => call.sql.includes('last_error_code'));
  assert.ok(failure.sql.includes("status = 'error'"));
});
