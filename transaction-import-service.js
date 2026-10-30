const crypto = require('node:crypto');
const CreditMatcher = require('./credit-matcher');
const { projectExternalTransaction, normalizeMerchant } = require('./transaction-reconciliation');
const { findPurchaseMatches } = require('./purchase-reconciliation');
const { withPersonLock } = require('./review-lock');
function positiveInteger(value,name) {const id=Number(value);if(!Number.isInteger(id)||id<=0)throw new Error(`${name} must be a positive integer`);return id;}
function transactionHash(personId, transaction) {
  // Keep the fingerprint tied to Citi's original description even when a rule
  // replaces it with a cleaner display name.
  const sourceMerchant = transaction.originalMerchant || transaction.merchant;
  const occurrence = Number(transaction.importOccurrence) || 1;
  const identity = [personId, transaction.date, Number(transaction.amount).toFixed(2), normalizeMerchant(sourceMerchant), occurrence].join('|');
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function providerTransactionHash(personId, providerTransactionId) {
  return crypto.createHash('sha256').update(`plaid|${personId}|${providerTransactionId}`).digest('hex');
}


function createTransactionImportService({pool,creditReview,environment='production'}) {
 const plaidConfig={environment};
 async function importInTransaction(client,input,{automatic=false}={}) {
    const { personId, transactions, importMetadata = {}, accountEvents = [] } = input;
    if (!personId || !Array.isArray(transactions) || !Array.isArray(accountEvents) || transactions.length + accountEvents.length > 2000) {
      throw new Error('A card holder and up to 2,000 transactions are required.');
    }

    const batchResult = await client.query(`
      INSERT INTO import_batches (person_id, source, filename, file_hash, record_count)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [personId, importMetadata.source || 'citi_csv', importMetadata.filename || null,
        importMetadata.fileHash || null, importMetadata.recordCount || transactions.length + accountEvents.length]);
    const importBatchId = batchResult.rows[0].id;
    let imported = 0;
    let eventsImported = 0;
    let skipped = 0;
    const consumedTransactionIds = new Set((importMetadata.reconciledTransactionIds || []).map(Number));
    const consumedEventIds = new Set((importMetadata.reconciledEventIds || []).map(Number));
    const importedEvents = [];
    for (const item of transactions) {
      let amount = Number(item.amount);
      const merchant = String(item.merchant || '').trim();
      let transactionType = String(item.transactionType || 'purchase').toLowerCase();
      let transactionDate = item.date;
      let rawMerchant = item.originalMerchant || merchant;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '') || !merchant || !Number.isFinite(amount) || amount <= 0 || transactionType !== 'purchase') {
        skipped++;
        continue;
      }
      let hash = transactionHash(personId, item);
      let externalRow = null;
      if (item.externalTransactionId != null) {
        const externalResult = await client.query(`
          SELECT et.* FROM external_transactions et
          JOIN financial_accounts a ON a.id = et.financial_account_id AND a.selected = TRUE
          JOIN financial_connections c ON c.id = et.connection_id AND c.environment = $3
          WHERE et.id = $1 AND et.person_id = $2 AND et.pending = FALSE
            AND et.lifecycle_status = 'awaiting_review'
            AND et.transaction_date >= c.import_start_date
            AND et.item_generation = c.item_generation AND a.available = TRUE
            AND c.status IN ('healthy','error')
          FOR UPDATE OF et
        `, [positiveInteger(item.externalTransactionId, 'externalTransactionId'), personId, plaidConfig.environment]);
        if (!externalResult.rows.length) {
          skipped++;
          continue;
        }
        externalRow = externalResult.rows[0];
        if (!item.externalUpdatedAt || new Date(item.externalUpdatedAt).getTime() !== new Date(externalRow.updated_at).getTime()) {
          skipped++;
          continue;
        }
        transactionDate = projectExternalTransaction(externalRow).date;
        amount = Math.abs(Number(externalRow.amount));
        transactionType = externalRow.transaction_kind;
        rawMerchant = externalRow.raw_description;
        hash = providerTransactionHash(personId, externalRow.provider_transaction_id);
        if (transactionType !== 'purchase') { skipped++; continue; }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate || '') || !merchant || !Number.isFinite(amount) || amount <= 0 || transactionType !== 'purchase') { skipped++; continue; }
      if (externalRow) {
        const crossSource = { rows: await findPurchaseMatches(client, {
          personId, date: transactionDate, amount, merchant, rawMerchant, external: true,
          connectionId: externalRow.connection_id, itemGeneration: externalRow.item_generation, accountId: externalRow.financial_account_id
        }, { lock: true }) };
        if (crossSource.rows.length === 1) {
          if (crossSource.rows[0].old_external_id) {
            await client.query('UPDATE external_transactions SET linked_transaction_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [crossSource.rows[0].old_external_id]);
            await client.query(`UPDATE external_transactions SET lifecycle_status = 'imported', linked_transaction_id = $1, supersedes_external_transaction_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [crossSource.rows[0].id, crossSource.rows[0].old_external_id, externalRow.id]);
          } else {
            await client.query(`UPDATE external_transactions SET lifecycle_status = 'imported', linked_transaction_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [crossSource.rows[0].id, externalRow.id]);
          }
          skipped++;
          continue;
        }
        if (crossSource.rows.length > 1) { skipped++; continue; }
      }
      const duplicate = await client.query(`
        SELECT id FROM transactions
        WHERE person_id = $1 AND transaction_type = $7 AND (
          source_hash = $2 OR
          ($6 = FALSE AND source = 'plaid' AND date::date BETWEEN $3::date - 3 AND $3::date + 3
            AND ABS(ABS(amount) - ABS($4)) < 0.001
            AND UPPER(TRIM(COALESCE(raw_merchant, merchant))) = $5) OR
          (source_hash IS NULL AND date::date = $3::date AND ABS(amount - $4) < 0.001 AND UPPER(TRIM(merchant)) = $5)
        ) LIMIT 20
      `, [personId, hash, transactionDate, amount, normalizeMerchant(rawMerchant), Boolean(externalRow), transactionType]);
      const duplicateRows = externalRow ? duplicate.rows : duplicate.rows.filter(row => !consumedTransactionIds.has(Number(row.id)));
      if (!externalRow) {
        const matches = await findPurchaseMatches(client, {
          personId, date: transactionDate, amount, merchant, rawMerchant, external: false
        }, { lock: true });
        for (const match of matches) {
          if (!consumedTransactionIds.has(Number(match.id)) && !duplicateRows.some(row => Number(row.id) === Number(match.id))) duplicateRows.push(match);
        }
      }
      if (duplicateRows.length > 0) {
        if (externalRow && duplicateRows.length === 1) {
          await client.query(`UPDATE external_transactions SET lifecycle_status = 'imported', linked_transaction_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [duplicateRows[0].id, externalRow.id]);
        }
        if (!externalRow && duplicateRows.length === 1) consumedTransactionIds.add(Number(duplicateRows[0].id));
        skipped++;
        continue;
      }

      const categories = Array.isArray(item.categories)
        ? [...new Set(item.categories.map(value => String(value).trim().toLowerCase()).filter(Boolean))]
        : [];
      const insertedTransaction = await client.query(`
        INSERT INTO transactions
          (date, amount, merchant, categories, description, person_id, source, source_hash, raw_merchant, transaction_type, import_batch_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [transactionDate, amount, merchant, categories, item.description || '', personId,
          externalRow ? 'plaid' : 'citi_csv', hash, rawMerchant, transactionType, importBatchId]);
      if (externalRow) {
        await client.query(`UPDATE external_transactions SET lifecycle_status = 'imported', linked_transaction_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [insertedTransaction.rows[0].id, externalRow.id]);
      }
      await client.query('UPDATE transactions SET review_metadata=$1 WHERE id=$2', [{ method: automatic ? 'automatic' : 'manual', ruleId: item.matchedRuleId || null, reason: item.reviewReason || 'Manually reviewed' }, insertedTransaction.rows[0].id]);
      imported++;

      if (!automatic && item.saveRule && categories.length > 0) {
        const pattern = normalizeMerchant(item.rulePattern || item.originalMerchant || merchant);
        await client.query(`
          INSERT INTO merchant_category_rules
            (merchant_pattern, merchant_name, match_type, categories)
          VALUES ($1, $2, 'contains', $3)
          ON CONFLICT (merchant_pattern, match_type)
          DO UPDATE SET merchant_name = EXCLUDED.merchant_name,
                        categories = EXCLUDED.categories,
                        updated_at = CURRENT_TIMESTAMP
        `, [pattern, merchant, categories]);
      }
    }
    for (const item of accountEvents) {
      let amount = Number(item.amount);
      let description = String(item.originalMerchant || item.merchant || '').trim();
      let eventType = String(item.transactionType || item.description || 'account event').toLowerCase();
      let eventDate = item.date;
      let hash = transactionHash(personId, item);
      let externalRow = null;
      if (item.externalTransactionId != null) {
        const externalResult = await client.query(`
          SELECT et.* FROM external_transactions et
          JOIN financial_accounts a ON a.id = et.financial_account_id AND a.selected = TRUE
          JOIN financial_connections c ON c.id = et.connection_id AND c.environment = $3
          WHERE et.id = $1 AND et.person_id = $2 AND et.pending = FALSE
            AND et.lifecycle_status = 'awaiting_review'
            AND et.transaction_date >= c.import_start_date
            AND et.item_generation = c.item_generation AND a.available = TRUE
            AND c.status IN ('healthy','error')
          FOR UPDATE OF et
        `, [positiveInteger(item.externalTransactionId, 'externalTransactionId'), personId, plaidConfig.environment]);
        if (!externalResult.rows.length) {
          skipped++;
          continue;
        }
        externalRow = externalResult.rows[0];
        if (!item.externalUpdatedAt || new Date(item.externalUpdatedAt).getTime() !== new Date(externalRow.updated_at).getTime()) { skipped++; continue; }
        eventDate = projectExternalTransaction(externalRow).date;
        amount = -Math.abs(Number(externalRow.amount));
        description = externalRow.raw_description;
        eventType = externalRow.transaction_kind;
        hash = providerTransactionHash(personId, externalRow.provider_transaction_id);
        if (eventType === 'purchase') { skipped++; continue; }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate || '') || !description || !Number.isFinite(amount)) { skipped++; continue; }
      const eventMatches = await client.query(`
        SELECT ae.id, old.id AS old_external_id FROM account_events ae
        JOIN import_batches ib ON ib.id = ae.import_batch_id
        LEFT JOIN external_transactions old ON old.linked_account_event_id = ae.id
          AND old.connection_id = $6 AND old.item_generation < $7
        LEFT JOIN financial_accounts old_account ON old_account.id = old.financial_account_id
        LEFT JOIN financial_accounts new_account ON new_account.id = $8
        WHERE ae.person_id = $1 AND ae.event_date BETWEEN $2::date - 3 AND $2::date + 3
          AND ABS(ABS(ae.amount) - ABS($3)) < 0.001
          AND (ae.event_type = $4 OR (ae.event_type IN ('payment', 'credit') AND $4 IN ('payment', 'credit')))
          AND UPPER(TRIM(ae.description)) = $5
          AND (
            ($9 = TRUE AND ib.source <> 'plaid' AND NOT EXISTS (SELECT 1 FROM external_transactions linked WHERE linked.linked_account_event_id = ae.id))
            OR ($9 = FALSE AND ib.source = 'plaid')
            OR (old.id IS NOT NULL
              AND COALESCE(old_account.persistent_account_id, old_account.provider_account_id)
                = COALESCE(new_account.persistent_account_id, new_account.provider_account_id)
              AND NOT EXISTS (SELECT 1 FROM external_transactions successor WHERE successor.supersedes_external_transaction_id = old.id))
          )
        LIMIT 20
      `, [personId, eventDate, amount, eventType, normalizeMerchant(description), externalRow?.connection_id || 0,
        externalRow?.item_generation || 0, externalRow?.financial_account_id || 0, Boolean(externalRow)]);
      const availableEvents = externalRow ? eventMatches.rows : eventMatches.rows.filter(row => !consumedEventIds.has(Number(row.id)));
      if (availableEvents.length === 1) {
        if (externalRow && availableEvents[0].old_external_id) {
          await client.query('UPDATE external_transactions SET linked_account_event_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [availableEvents[0].old_external_id]);
          await client.query(`UPDATE external_transactions SET lifecycle_status = 'imported', linked_account_event_id = $1, supersedes_external_transaction_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [availableEvents[0].id, availableEvents[0].old_external_id, externalRow.id]);
        } else if (externalRow) {
          await client.query(`UPDATE external_transactions SET lifecycle_status = 'imported', linked_account_event_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [availableEvents[0].id, externalRow.id]);
        }
        consumedEventIds.add(Number(availableEvents[0].id));
        skipped++;
        continue;
      }
      if (availableEvents.length > 1) { skipped++; continue; }
      const result = await client.query(`
        INSERT INTO account_events
          (person_id, import_batch_id, event_date, amount, description, event_type, source_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (person_id, source_hash) DO NOTHING
        RETURNING id
      `, [personId, importBatchId, eventDate, amount, description, eventType, hash]);
      if (result.rows.length) {
        eventsImported++;
        importedEvents.push({ id: result.rows[0].id, date: eventDate, amount, description, eventType });
        if (externalRow) await client.query(`UPDATE external_transactions SET lifecycle_status = 'imported', linked_account_event_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [result.rows[0].id, externalRow.id]);
      }
      else skipped++;
    }
    const autoMatchedCredits = await creditReview.reviewCredits(client, personId);
    const potentialOfferCredits = importedEvents.filter(event => CreditMatcher.isPotentialOfferCredit(event)).length;
    await client.query('UPDATE import_batches SET imported_count = $1 WHERE id = $2', [imported, importBatchId]);

    return {imported,eventsImported,skipped,importBatchId,autoMatchedCredits,
      unmatchedOfferCredits:Math.max(potentialOfferCredits-autoMatchedCredits.length,0)};
 }
 async function importReviewed(input,options) {return withPersonLock(pool,input.personId,client=>importInTransaction(client,input,options));}
 return {importReviewed,importInTransaction};
}
module.exports={createTransactionImportService};
