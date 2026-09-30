const { normalizePlaidTransaction } = require('./plaid-transactions');

const PAGINATION_MUTATION = 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';

function createSyncService({ pool, plaidClient, connectionService }) {
  async function recordFailure(personId, connectionId, error) {
    await pool.query(`
      UPDATE financial_connections SET status = 'error', last_error_code = $1,
        last_error_request_id = $2, last_attempt_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND person_id = $4
    `, [error.code || 'SYNC_FAILED', error.requestId || null, connectionId, personId]);
  }

  async function persistTransaction(client, connection, transaction) {
    const lifecycle = transaction.pending ? 'staged' : 'awaiting_review';
    await client.query(`
      INSERT INTO external_transactions
        (provider_transaction_id, connection_id, financial_account_id, person_id,
         pending_provider_transaction_id, pending, transaction_date, authorized_date,
         amount, raw_description, merchant_name, provider_category, transaction_kind,
         raw_payload, lifecycle_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (provider, provider_transaction_id) DO UPDATE SET
        pending_provider_transaction_id = EXCLUDED.pending_provider_transaction_id,
        pending = EXCLUDED.pending,
        transaction_date = EXCLUDED.transaction_date,
        authorized_date = EXCLUDED.authorized_date,
        amount = EXCLUDED.amount,
        raw_description = EXCLUDED.raw_description,
        merchant_name = EXCLUDED.merchant_name,
        provider_category = EXCLUDED.provider_category,
        transaction_kind = EXCLUDED.transaction_kind,
        raw_payload = EXCLUDED.raw_payload,
        lifecycle_status = CASE
          WHEN external_transactions.lifecycle_status IN ('imported', 'conflicted')
            THEN external_transactions.lifecycle_status
          ELSE EXCLUDED.lifecycle_status
        END,
        updated_at = CURRENT_TIMESTAMP
    `, [transaction.providerTransactionId, connection.id, connection.financialAccountId,
      connection.personId, transaction.pendingProviderTransactionId, transaction.pending,
      transaction.date, transaction.authorizedDate, transaction.amount, transaction.rawDescription,
      transaction.merchantName, transaction.providerCategory, transaction.transactionKind,
      transaction.rawPayload, lifecycle]);
    if (transaction.pendingProviderTransactionId) {
      await client.query(`
        UPDATE external_transactions SET lifecycle_status = 'removed', updated_at = CURRENT_TIMESTAMP
        WHERE provider = 'plaid' AND provider_transaction_id = $1
          AND connection_id = $2 AND linked_transaction_id IS NULL AND linked_account_event_id IS NULL
      `, [transaction.pendingProviderTransactionId, connection.id]);
    }
  }

  async function runAttempt(personId, connectionId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [connectionId]);
      const connection = await connectionService.getActiveConnection(personId, connectionId, client);
      let cursor = connection.cursor || null;
      let added = 0;
      let modified = 0;
      let removed = 0;
      let hasMore = true;

      while (hasMore) {
        const page = await plaidClient.syncTransactions(connection.accessToken, cursor);
        for (const raw of page.added) {
          if (raw.account_id !== connection.providerAccountId) continue;
          await persistTransaction(client, connection, normalizePlaidTransaction(raw));
          added++;
        }
        for (const raw of page.modified) {
          if (raw.account_id !== connection.providerAccountId) continue;
          await persistTransaction(client, connection, normalizePlaidTransaction(raw));
          modified++;
        }
        for (const removedRow of page.removed) {
          const providerTransactionId = removedRow.transaction_id;
          if (!providerTransactionId) continue;
          const result = await client.query(`
            UPDATE external_transactions SET
              lifecycle_status = CASE
                WHEN linked_transaction_id IS NOT NULL OR linked_account_event_id IS NOT NULL THEN 'conflicted'
                ELSE 'removed'
              END,
              updated_at = CURRENT_TIMESTAMP
            WHERE provider = 'plaid' AND provider_transaction_id = $1
              AND connection_id = $2 AND financial_account_id = $3
            RETURNING id
          `, [providerTransactionId, connection.id, connection.financialAccountId]);
          if (result.rows.length || !Object.prototype.hasOwnProperty.call(result, 'rowCount')) removed++;
        }
        cursor = page.nextCursor;
        hasMore = page.hasMore;
      }

      await client.query(`
        UPDATE financial_connections SET sync_cursor = $1, status = 'healthy',
          last_error_code = NULL, last_error_request_id = NULL,
          last_attempt_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND person_id = $3
      `, [cursor, connectionId, personId]);
      await client.query('COMMIT');
      return { connectionId, added, modified, removed, cursor };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function syncConnection(personId, connectionId) {
    let mutationRetries = 0;
    while (true) {
      try {
        return await runAttempt(personId, connectionId);
      } catch (error) {
        if (error.code === PAGINATION_MUTATION && mutationRetries < 2) {
          mutationRetries++;
          continue;
        }
        await recordFailure(personId, connectionId, error);
        throw error;
      }
    }
  }

  async function syncAllHealthy() {
    const result = await pool.query("SELECT id, person_id FROM financial_connections WHERE status = 'healthy' ORDER BY id");
    const outcomes = [];
    for (const connection of result.rows) {
      try {
        outcomes.push({ connectionId: connection.id, ok: true, summary: await syncConnection(connection.person_id, connection.id) });
      } catch (error) {
        outcomes.push({ connectionId: connection.id, ok: false, code: error.code || 'SYNC_FAILED' });
      }
    }
    return outcomes;
  }

  return { syncConnection, syncAllHealthy };
}

module.exports = { createSyncService, PAGINATION_MUTATION };
