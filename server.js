const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const crypto = require('crypto');
const OfferEngine = require('./offer-engine');
const OfferEmailParser = require('./offer-email-parser');
const CreditMatcher = require('./credit-matcher');
const M365 = require('./m365');
const { loadPlaidConfig } = require('./plaid-config');
const { createPlaidClient } = require('./plaid-client');
const { createConnectionService } = require('./plaid-connections');

const app = express();
const port = process.env.PORT || 3000;

// Determine if we should use SSL based on environment
// For local Docker (db hostname), don't use SSL
// For cloud providers (render, heroku, etc.), use SSL
const dbUrl = process.env.DATABASE_URL || '';
const isLocalDocker = dbUrl.includes('@db:') || dbUrl.includes('@localhost:');
const shouldUseSSL = process.env.NODE_ENV === 'production' && !isLocalDocker;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false
});

const plaidConfig = loadPlaidConfig();
const plaidClient = plaidConfig.clientId ? createPlaidClient(plaidConfig) : null;
const plaidConnections = plaidClient ? createConnectionService({ pool, plaidClient, config: plaidConfig }) : null;

function requirePlaid(res) {
  if (plaidConnections) return true;
  res.status(503).json({ error: 'Plaid is not configured.' });
  return false;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function plaidRouteError(res, error) {
  const status = /not found/i.test(error.message) ? 404 : 400;
  res.status(status).json({ error: error.message, code: error.code || undefined, requestId: error.requestId || undefined });
}

function normalizeMerchant(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function transactionHash(personId, transaction) {
  // Keep the fingerprint tied to Citi's original description even when a rule
  // replaces it with a cleaner display name.
  const sourceMerchant = transaction.originalMerchant || transaction.merchant;
  const occurrence = Number(transaction.importOccurrence) || 1;
  const identity = [personId, transaction.date, Number(transaction.amount).toFixed(2), normalizeMerchant(sourceMerchant), occurrence].join('|');
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function ruleMatches(rule, merchant) {
  const candidate = normalizeMerchant(merchant);
  const pattern = normalizeMerchant(rule.merchant_pattern);
  return rule.match_type === 'exact' ? candidate === pattern : candidate.includes(pattern);
}

// Starting suggestions for merchants observed in Citi exports. User-saved rules
// are checked first and always override these defaults.
const defaultMerchantRules = [
  { pattern: 'LOST ISLAND', merchant: 'Lost Island', categories: ['entertainment'] },
  { pattern: 'TRADER JOE', merchant: "Trader Joe's", categories: ['grocery'] },
  { pattern: 'KING SOOPERS', merchant: 'King Soopers', categories: ['grocery'] },
  { pattern: 'MAVERIK', merchant: 'Maverik', categories: ['gas'] },
  { pattern: 'TARGET', merchant: 'Target', categories: ['retail'] },
  { pattern: 'TJMAXX', merchant: 'TJ Maxx', categories: ['retail'] },
  { pattern: 'HOME DEPOT', merchant: 'Home Depot', categories: ['retail'] },
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

function findDefaultMerchantRule(merchant) {
  const candidate = normalizeMerchant(merchant);
  return defaultMerchantRules.find(rule => candidate.includes(rule.pattern));
}

function serializeOffer(row, credits = []) {
  const legacy = {
    id: row.id,
    name: row.name,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    spendingTarget: row.spending_target,
    transactionTarget: row.transaction_target,
    minTransaction: row.min_transaction,
    categories: row.categories || [],
    reward: row.reward,
    bonusReward: row.bonus_reward,
    tiers: row.tiers || [],
    description: row.description,
    monthlyTracking: row.monthly_tracking,
    personId: row.person_id,
    percentBack: row.percent_back,
    maxBack: row.max_back,
    minSpendThreshold: row.min_spend_threshold,
    bonusPosted: row.bonus_posted,
    bonusPostedDate: row.bonus_posted_date,
    bonusPostedAmount: row.bonus_posted_amount,
    hidden: row.hidden,
    sourceType: row.source_type || 'manual',
    sourceExternalId: row.source_external_id,
    sourceMetadata: row.source_metadata || {},
    reviewStatus: row.review_status || 'confirmed',
    offerFingerprint: row.offer_fingerprint,
    credits
  };
  const normalized = OfferEngine.normalizeOffer({
    ...legacy,
    eligibility: row.eligibility || undefined,
    measurement: row.measurement || undefined,
    rewardConfig: row.reward_config || undefined
  });
  return {
    ...legacy,
    eligibility: normalized.eligibility,
    measurement: normalized.measurement,
    rewardConfig: normalized.rewardConfig,
    engineVersion: row.engine_version || 2
  };
}

function configsForOffer(input) {
  const normalized = OfferEngine.normalizeOffer(input);
  return {
    eligibility: normalized.eligibility,
    measurement: normalized.measurement,
    rewardConfig: normalized.rewardConfig
  };
}

function fingerprintForStoredOffer(row) {
  const offer = serializeOffer(row);
  return OfferEmailParser.offerFingerprint({
    ...offer,
    excludeCategories: offer.eligibility.excludeCategories || []
  });
}

async function findDuplicateOffer(personId, fingerprint) {
  const exact = await pool.query(
    'SELECT * FROM offers WHERE person_id = $1 AND offer_fingerprint = $2 LIMIT 1',
    [personId, fingerprint]
  );
  if (exact.rows.length) return exact.rows[0];

  // Offers created before fingerprints were introduced still need to block a
  // repeated email, so derive their identity from their saved terms.
  const existing = await pool.query('SELECT * FROM offers WHERE person_id = $1', [personId]);
  return existing.rows.find(row => fingerprintForStoredOffer(row) === fingerprint) || null;
}

async function autoMatchOfferCredits(client, personId, events) {
  if (!events.length) return [];
  const offersResult = await client.query('SELECT * FROM offers WHERE person_id = $1', [personId]);
  if (!offersResult.rows.length) return [];
  const offerIds = offersResult.rows.map(row => row.id);
  const transactionsResult = await client.query('SELECT * FROM transactions WHERE person_id = $1 ORDER BY date, id', [personId]);
  const creditsResult = await client.query('SELECT * FROM offer_credits WHERE offer_id = ANY($1::int[]) ORDER BY posted_date, id', [offerIds]);
  const transactions = transactionsResult.rows.map(row => ({
    id: row.id,
    date: row.date,
    amount: Number(row.amount),
    merchant: row.merchant,
    categories: row.categories || [],
    transactionType: row.transaction_type || 'purchase'
  }));
  const creditsByOffer = new Map(offerIds.map(id => [id, []]));
  creditsResult.rows.forEach(row => creditsByOffer.get(row.offer_id).push({
    id: row.id, amount: Number(row.amount), postedDate: row.posted_date, description: row.description
  }));

  const matches = [];
  let pendingEvents = [...events].sort((a, b) => Number(a.id) - Number(b.id));
  let matchedThisPass = 0;
  do {
    matchedThisPass = 0;
    const stillPending = [];
    for (const event of pendingEvents) {
      const eventDate = String(event.date).slice(0, 10);
      const candidates = offersResult.rows.map(row => {
        const offer = serializeOffer(row, creditsByOffer.get(row.id));
        const progress = OfferEngine.calculateOfferProgress(offer, transactions, { asOf: new Date().toISOString().slice(0, 10) });
        return { offer, progress };
      });
      const match = CreditMatcher.findCreditMatch(event, candidates);
      if (!match.matched) {
        stillPending.push(event);
        continue;
      }

      const amount = Math.abs(Number(event.amount));
      const creditResult = await client.query(`
        INSERT INTO offer_credits (offer_id, amount, posted_date, description)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [match.offerId, amount, eventDate, event.description]);
      await client.query('UPDATE account_events SET assigned_offer_credit_id = $1 WHERE id = $2', [creditResult.rows[0].id, event.id]);
      creditsByOffer.get(match.offerId).push({ id: creditResult.rows[0].id, amount, postedDate: eventDate, description: event.description });
      matches.push({ eventId: event.id, amount, offerId: match.offerId, offerName: match.offerName, reasons: match.reasons });
      matchedThisPass++;
    }
    pendingEvents = stillPending;
  } while (matchedThisPass > 0 && pendingEvents.length > 0);
  return matches;
}

// Run migrations on startup
async function runMigrations() {
  try {
    const migrationsPath = path.join(__dirname, 'migrations.sql');
    if (fs.existsSync(migrationsPath)) {
      const sql = fs.readFileSync(migrationsPath, 'utf8');
      await pool.query(sql);
      console.log('Migrations completed successfully');
    }
  } catch (err) {
    console.error('Error running migrations:', err);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API Routes

// People endpoints
app.get('/api/people', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM people ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching people:', err);
    res.status(500).json({ error: 'Failed to fetch people' });
  }
});

app.post('/api/people', async (req, res) => {
  try {
    const { name } = req.body;
    const result = await pool.query(
      'INSERT INTO people (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating person:', err);
    res.status(500).json({ error: 'Failed to create person' });
  }
});

app.put('/api/people/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const result = await pool.query(
      'UPDATE people SET name = $1 WHERE id = $2 RETURNING *',
      [name, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating person:', err);
    res.status(500).json({ error: 'Failed to update person' });
  }
});

app.delete('/api/people/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM people WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting person:', err);
    res.status(500).json({ error: 'Failed to delete person' });
  }
});

app.post('/api/plaid/link-token', async (req, res) => {
  if (!requirePlaid(res)) return;
  try {
    res.json(await plaidConnections.createLinkToken(positiveInteger(req.body.personId, 'personId')));
  } catch (error) {
    plaidRouteError(res, error);
  }
});

app.post('/api/plaid/exchange', async (req, res) => {
  if (!requirePlaid(res)) return;
  try {
    const personId = positiveInteger(req.body.personId, 'personId');
    res.json(await plaidConnections.exchangeAndDiscover(personId, req.body.publicToken));
  } catch (error) {
    plaidRouteError(res, error);
  }
});

app.put('/api/plaid/connections/:id/account', async (req, res) => {
  if (!requirePlaid(res)) return;
  try {
    const personId = positiveInteger(req.body.personId, 'personId');
    const connectionId = positiveInteger(req.params.id, 'connectionId');
    const accountId = positiveInteger(req.body.accountId, 'accountId');
    res.json(await plaidConnections.selectAccount(personId, connectionId, accountId));
  } catch (error) {
    plaidRouteError(res, error);
  }
});

app.get('/api/plaid/status', async (req, res) => {
  if (!requirePlaid(res)) return;
  try {
    res.json(await plaidConnections.getStatus(positiveInteger(req.query.personId, 'personId')));
  } catch (error) {
    plaidRouteError(res, error);
  }
});

app.delete('/api/plaid/connections/:id', async (req, res) => {
  if (!requirePlaid(res)) return;
  try {
    const personId = positiveInteger(req.body.personId, 'personId');
    const connectionId = positiveInteger(req.params.id, 'connectionId');
    res.json(await plaidConnections.disconnect(personId, connectionId));
  } catch (error) {
    plaidRouteError(res, error);
  }
});

// Offers endpoints
app.get('/api/offers', async (req, res) => {
  try {
    const { personId } = req.query;
    let query = 'SELECT * FROM offers';
    let params = [];

    if (personId) {
      query += ' WHERE person_id = $1';
      params.push(personId);
    }

    query += ' ORDER BY start_date';

    const result = await pool.query(query, params);
    const offerIds = result.rows.map(row => row.id);
    const creditsResult = offerIds.length ? await pool.query(
      'SELECT * FROM offer_credits WHERE offer_id = ANY($1::int[]) ORDER BY posted_date, id',
      [offerIds]
    ) : { rows: [] };
    const offers = result.rows.map(row => serializeOffer(row, creditsResult.rows
      .filter(credit => credit.offer_id === row.id)
      .map(credit => ({ id: credit.id, amount: Number(credit.amount), postedDate: credit.posted_date, description: credit.description }))));
    res.json(offers);
  } catch (err) {
    console.error('Error fetching offers:', err);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

app.get('/api/offers/check-duplicate', async (req, res) => {
  try {
    const { personId, fingerprint } = req.query;
    if (!personId || !fingerprint) return res.status(400).json({ error: 'personId and fingerprint are required' });
    const duplicate = await findDuplicateOffer(personId, fingerprint);
    res.json({
      duplicate: Boolean(duplicate),
      offer: duplicate ? {
        id: duplicate.id,
        name: duplicate.name,
        startDate: duplicate.start_date,
        endDate: duplicate.end_date
      } : null
    });
  } catch (err) {
    console.error('Error checking duplicate offer:', err);
    res.status(500).json({ error: 'Failed to check duplicate offer' });
  }
});

app.post('/api/offers', async (req, res) => {
  try {
    const configs = configsForOffer(req.body);
    const {
      name, type, startDate, endDate, spendingTarget, transactionTarget,
      minTransaction, categories, reward, bonusReward, tiers, description, monthlyTracking, personId,
      percentBack, maxBack, minSpendThreshold, sourceType, sourceExternalId, sourceMetadata, reviewStatus,
      offerFingerprint, forceAllowDuplicate
    } = req.body;

    if (offerFingerprint && !forceAllowDuplicate) {
      const duplicate = await findDuplicateOffer(personId, offerFingerprint);
      if (duplicate) {
        return res.status(409).json({
          error: 'This offer was already imported.',
          duplicateOffer: { id: duplicate.id, name: duplicate.name }
        });
      }
    }

    const result = await pool.query(`
      INSERT INTO offers (
        name, type, start_date, end_date, spending_target,
        transaction_target, min_transaction, categories, reward,
        bonus_reward, tiers, description, monthly_tracking, person_id,
        percent_back, max_back, min_spend_threshold, eligibility, measurement, reward_config,
        source_type, source_external_id, source_metadata, review_status, offer_fingerprint
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      RETURNING *
    `, [
      name, type, startDate, endDate, spendingTarget,
      transactionTarget, minTransaction, categories || [], reward,
      bonusReward, JSON.stringify(tiers || []), description, monthlyTracking, personId,
      percentBack, maxBack, minSpendThreshold,
      JSON.stringify(configs.eligibility), JSON.stringify(configs.measurement), JSON.stringify(configs.rewardConfig),
      sourceType || 'manual', sourceExternalId || null, JSON.stringify(sourceMetadata || {}), reviewStatus || 'confirmed',
      offerFingerprint || null
    ]);

    const offer = serializeOffer(result.rows[0]);

    res.json(offer);
  } catch (err) {
    console.error('Error creating offer:', err);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

app.put('/api/offers/:id', async (req, res) => {
  try {
    const configs = configsForOffer(req.body);
    const { id } = req.params;
    const {
      name, type, startDate, endDate, spendingTarget, transactionTarget,
      minTransaction, categories, reward, bonusReward, tiers, description, monthlyTracking, personId,
      percentBack, maxBack, minSpendThreshold, sourceType, sourceExternalId, sourceMetadata, reviewStatus,
      offerFingerprint
    } = req.body;

    const result = await pool.query(`
      UPDATE offers SET
        name = $1, type = $2, start_date = $3, end_date = $4,
        spending_target = $5, transaction_target = $6, min_transaction = $7,
        categories = $8, reward = $9, bonus_reward = $10, tiers = $11, description = $12,
        monthly_tracking = $13, person_id = $14, percent_back = $15, max_back = $16, min_spend_threshold = $17,
        eligibility = $18, measurement = $19, reward_config = $20, engine_version = 2,
        source_type = $21, source_external_id = $22, source_metadata = $23, review_status = $24,
        offer_fingerprint = $25
      WHERE id = $26
      RETURNING *
    `, [
      name, type, startDate, endDate, spendingTarget,
      transactionTarget, minTransaction, categories || [], reward,
      bonusReward, JSON.stringify(tiers || []), description, monthlyTracking, personId,
      percentBack, maxBack, minSpendThreshold,
      JSON.stringify(configs.eligibility), JSON.stringify(configs.measurement), JSON.stringify(configs.rewardConfig),
      sourceType || 'manual', sourceExternalId || null, JSON.stringify(sourceMetadata || {}), reviewStatus || 'confirmed',
      offerFingerprint || null, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const offer = serializeOffer(result.rows[0]);

    res.json(offer);
  } catch (err) {
    console.error('Error updating offer:', err);
    res.status(500).json({ error: 'Failed to update offer' });
  }
});

app.delete('/api/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM offers WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting offer:', err);
    res.status(500).json({ error: 'Failed to delete offer' });
  }
});

app.patch('/api/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { bonusPosted, bonusPostedDate, bonusPostedAmount, hidden } = req.body;

    const result = await pool.query(`
      UPDATE offers
      SET bonus_posted = $1, bonus_posted_date = $2, bonus_posted_amount = $3, hidden = $4
      WHERE id = $5
      RETURNING *
    `, [bonusPosted, bonusPostedDate, bonusPostedAmount, hidden, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const offer = serializeOffer(result.rows[0]);

    res.json(offer);
  } catch (err) {
    console.error('Error updating offer status:', err);
    res.status(500).json({ error: 'Failed to update offer status' });
  }
});

app.get('/api/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM offers WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const creditsResult = await pool.query('SELECT * FROM offer_credits WHERE offer_id = $1 ORDER BY posted_date, id', [id]);
    const offer = serializeOffer(result.rows[0], creditsResult.rows.map(credit => ({
      id: credit.id,
      amount: Number(credit.amount),
      postedDate: credit.posted_date,
      description: credit.description
    })));

    res.json(offer);
  } catch (err) {
    console.error('Error fetching offer:', err);
    res.status(500).json({ error: 'Failed to fetch offer' });
  }
});

app.post('/api/offers/:id/credits', async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'A positive credit amount is required.' });
    }
    const result = await pool.query(`
      INSERT INTO offer_credits (offer_id, amount, posted_date, description, source_transaction_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.params.id, amount, req.body.postedDate || null, req.body.description || '', req.body.sourceTransactionId || null]);
    const credit = result.rows[0];
    res.json({ id: credit.id, amount: Number(credit.amount), postedDate: credit.posted_date, description: credit.description });
  } catch (err) {
    console.error('Error adding offer credit:', err);
    res.status(500).json({ error: 'Failed to add offer credit' });
  }
});

app.delete('/api/offers/:offerId/credits/:creditId', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM offer_credits WHERE id = $1 AND offer_id = $2 RETURNING id',
      [req.params.creditId, req.params.offerId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Offer credit not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting offer credit:', err);
    res.status(500).json({ error: 'Failed to delete offer credit' });
  }
});

// Transactions endpoints
app.get('/api/transactions', async (req, res) => {
  try {
    const { personId } = req.query;
    let query = 'SELECT * FROM transactions';
    let params = [];

    if (personId) {
      query += ' WHERE person_id = $1';
      params.push(personId);
    }

    query += ' ORDER BY date DESC';

    const result = await pool.query(query, params);
    const transactions = result.rows.map(row => ({
      id: row.id,
      date: row.date,
      amount: row.amount,
      merchant: row.merchant,
      categories: row.categories || [],
      description: row.description,
      personId: row.person_id,
      rawMerchant: row.raw_merchant || row.merchant,
      transactionType: row.transaction_type || 'purchase',
      source: row.source || 'manual',
      importBatchId: row.import_batch_id
    }));
    res.json(transactions);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { date, amount, merchant, categories, description, personId, transactionType } = req.body;

    const result = await pool.query(`
      INSERT INTO transactions (date, amount, merchant, categories, description, person_id, raw_merchant, transaction_type)
      VALUES ($1, $2, $3, $4, $5, $6, $3, $7)
      RETURNING *
    `, [date, amount, merchant, categories || [], description || '', personId, transactionType || 'purchase']);

    const transaction = {
      id: result.rows[0].id,
      date: result.rows[0].date,
      amount: result.rows[0].amount,
      merchant: result.rows[0].merchant,
      categories: result.rows[0].categories || [],
      description: result.rows[0].description,
      personId: result.rows[0].person_id,
      rawMerchant: result.rows[0].raw_merchant || result.rows[0].merchant,
      transactionType: result.rows[0].transaction_type || 'purchase'
    };

    res.json(transaction);
  } catch (err) {
    console.error('Error creating transaction:', err);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

app.put('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, amount, merchant, categories, description, personId } = req.body;

    const result = await pool.query(`
      UPDATE transactions SET
        date = $1, amount = $2, merchant = $3, categories = $4, description = $5, person_id = $6
      WHERE id = $7
      RETURNING *
    `, [date, amount, merchant, categories || [], description || '', personId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = {
      id: result.rows[0].id,
      date: result.rows[0].date,
      amount: result.rows[0].amount,
      merchant: result.rows[0].merchant,
      categories: result.rows[0].categories || [],
      description: result.rows[0].description,
      personId: result.rows[0].person_id
    };

    res.json(transaction);
  } catch (err) {
    console.error('Error updating transaction:', err);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM transactions WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting transaction:', err);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// Preview a normalized Citi CSV import. Parsing happens in the browser; the
// server applies saved category rules and checks the authoritative database.
app.post('/api/transaction-imports/preview', async (req, res) => {
  try {
    const { personId, transactions } = req.body;
    if (!personId || !Array.isArray(transactions) || transactions.length > 2000) {
      return res.status(400).json({ error: 'A card holder and up to 2,000 transactions are required.' });
    }

    const rulesResult = await pool.query(
      'SELECT * FROM merchant_category_rules ORDER BY LENGTH(merchant_pattern) DESC, id'
    );

    const preview = [];
    const occurrences = new Map();
    for (const item of transactions) {
      const amount = Number(item.amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '') || !String(item.merchant || '').trim() || !Number.isFinite(amount)) {
        preview.push({ ...item, invalid: true, duplicate: false, categories: [] });
        continue;
      }
      const occurrenceKey = [item.date, Number(item.amount).toFixed(2), normalizeMerchant(item.merchant)].join('|');
      const importOccurrence = (occurrences.get(occurrenceKey) || 0) + 1;
      occurrences.set(occurrenceKey, importOccurrence);
      const itemWithOccurrence = { ...item, importOccurrence };
      const hash = transactionHash(personId, itemWithOccurrence);
      const duplicateResult = await pool.query(`
        SELECT id FROM transactions
        WHERE person_id = $1 AND (
          source_hash = $2 OR
          (source_hash IS NULL AND date = $3 AND ABS(amount - $4) < 0.001 AND UPPER(TRIM(merchant)) = $5)
        ) LIMIT 1
      `, [personId, hash, item.date, amount, normalizeMerchant(item.merchant)]);
      const matchingRule = rulesResult.rows.find(rule => ruleMatches(rule, item.merchant));
      const defaultRule = matchingRule ? null : findDefaultMerchantRule(item.merchant);
      preview.push({
        ...item,
        amount,
        importOccurrence,
        originalMerchant: String(item.merchant).trim(),
        sourceHash: hash,
        duplicate: duplicateResult.rows.length > 0,
        invalid: false,
        categories: matchingRule ? matchingRule.categories : (defaultRule ? defaultRule.categories : []),
        merchant: matchingRule ? matchingRule.merchant_name : (defaultRule ? defaultRule.merchant : String(item.merchant).trim()),
        matchedRuleId: matchingRule ? matchingRule.id : null
      });
    }
    res.json({ transactions: preview });
  } catch (err) {
    console.error('Error previewing transaction import:', err);
    res.status(500).json({ error: 'Failed to preview transaction import' });
  }
});

app.post('/api/transaction-imports/confirm', async (req, res) => {
  const client = await pool.connect();
  try {
    const { personId, transactions, importMetadata = {}, accountEvents = [] } = req.body;
    if (!personId || !Array.isArray(transactions) || !Array.isArray(accountEvents) || transactions.length + accountEvents.length > 2000) {
      return res.status(400).json({ error: 'A card holder and up to 2,000 transactions are required.' });
    }

    await client.query('BEGIN');
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
    const importedEvents = [];
    for (const item of transactions) {
      const amount = Number(item.amount);
      const merchant = String(item.merchant || '').trim();
      const transactionType = String(item.transactionType || 'purchase').toLowerCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '') || !merchant || !Number.isFinite(amount) || amount <= 0 || transactionType !== 'purchase') {
        skipped++;
        continue;
      }
      const hash = transactionHash(personId, item);
      const duplicate = await client.query(`
        SELECT id FROM transactions
        WHERE person_id = $1 AND (
          source_hash = $2 OR
          (source_hash IS NULL AND date = $3 AND ABS(amount - $4) < 0.001 AND UPPER(TRIM(merchant)) = $5)
        ) LIMIT 1
      `, [personId, hash, item.date, amount, normalizeMerchant(merchant)]);
      if (duplicate.rows.length > 0) {
        skipped++;
        continue;
      }

      const categories = Array.isArray(item.categories)
        ? [...new Set(item.categories.map(value => String(value).trim().toLowerCase()).filter(Boolean))]
        : [];
      await client.query(`
        INSERT INTO transactions
          (date, amount, merchant, categories, description, person_id, source, source_hash, raw_merchant, transaction_type, import_batch_id)
        VALUES ($1, $2, $3, $4, $5, $6, 'citi_csv', $7, $8, $9, $10)
      `, [item.date, amount, merchant, categories, item.description || '', personId, hash,
          item.originalMerchant || merchant, transactionType, importBatchId]);
      imported++;

      if (item.saveRule && categories.length > 0) {
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
      const amount = Number(item.amount);
      const description = String(item.originalMerchant || item.merchant || '').trim();
      const eventType = String(item.transactionType || item.description || 'account event').toLowerCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '') || !description || !Number.isFinite(amount)) {
        skipped++;
        continue;
      }
      const hash = transactionHash(personId, item);
      const result = await client.query(`
        INSERT INTO account_events
          (person_id, import_batch_id, event_date, amount, description, event_type, source_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (person_id, source_hash) DO NOTHING
        RETURNING id
      `, [personId, importBatchId, item.date, amount, description, eventType, hash]);
      if (result.rows.length) {
        eventsImported++;
        importedEvents.push({ id: result.rows[0].id, date: item.date, amount, description, eventType });
      }
      else skipped++;
    }
    const autoMatchedCredits = await autoMatchOfferCredits(client, personId, importedEvents);
    const potentialOfferCredits = importedEvents.filter(event => CreditMatcher.isPotentialOfferCredit(event)).length;
    await client.query('UPDATE import_batches SET imported_count = $1 WHERE id = $2', [imported, importBatchId]);
    await client.query('COMMIT');
    res.json({
      imported,
      eventsImported,
      skipped,
      importBatchId,
      autoMatchedCredits,
      unmatchedOfferCredits: Math.max(potentialOfferCredits - autoMatchedCredits.length, 0)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error importing transactions:', err);
    res.status(500).json({ error: 'Failed to import transactions' });
  } finally {
    client.release();
  }
});

app.get('/api/merchant-rules', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM merchant_category_rules ORDER BY merchant_name'
    );
    res.json(result.rows.map(row => ({
      id: row.id,
      pattern: row.merchant_pattern,
      merchant: row.merchant_name,
      matchType: row.match_type,
      categories: row.categories || []
    })));
  } catch (err) {
    console.error('Error fetching merchant rules:', err);
    res.status(500).json({ error: 'Failed to fetch merchant rules' });
  }
});

app.delete('/api/merchant-rules/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM merchant_category_rules WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Merchant rule not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting merchant rule:', err);
    res.status(500).json({ error: 'Failed to delete merchant rule' });
  }
});

app.get('/api/account-events', async (req, res) => {
  try {
    if (!req.query.personId) return res.status(400).json({ error: 'personId is required' });
    const result = await pool.query(`
      SELECT * FROM account_events
      WHERE person_id = $1
      ORDER BY event_date DESC, id DESC
    `, [req.query.personId]);
    res.json(result.rows.map(row => ({
      id: row.id,
      date: row.event_date,
      amount: Number(row.amount),
      description: row.description,
      eventType: row.event_type,
      assignedOfferCreditId: row.assigned_offer_credit_id
    })));
  } catch (err) {
    console.error('Error fetching account events:', err);
    res.status(500).json({ error: 'Failed to fetch account events' });
  }
});

app.post('/api/account-events/auto-match', async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.body.personId) return res.status(400).json({ error: 'personId is required' });
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT id, event_date AS date, amount, description, event_type AS "eventType"
      FROM account_events
      WHERE person_id = $1 AND assigned_offer_credit_id IS NULL
      ORDER BY id
      FOR UPDATE
    `, [req.body.personId]);
    const matches = await autoMatchOfferCredits(client, req.body.personId, result.rows);
    await client.query('COMMIT');
    res.json({ matched: matches.length, matches });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error auto-matching account events:', err);
    res.status(500).json({ error: 'Failed to auto-match account events' });
  } finally {
    client.release();
  }
});

app.post('/api/account-events/:id/assign-offer', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query(
      'SELECT * FROM account_events WHERE id = $1 AND person_id = $2 FOR UPDATE',
      [req.params.id, req.body.personId]
    );
    if (!eventResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Account event not found' });
    }
    const event = eventResult.rows[0];
    if (event.assigned_offer_credit_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Account event is already assigned' });
    }
    const offerResult = await client.query('SELECT id FROM offers WHERE id = $1 AND person_id = $2', [req.body.offerId, req.body.personId]);
    if (!offerResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Offer not found for this card holder' });
    }
    const creditResult = await client.query(`
      INSERT INTO offer_credits (offer_id, amount, posted_date, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.body.offerId, Math.abs(Number(event.amount)), event.event_date, event.description]);
    await client.query('UPDATE account_events SET assigned_offer_credit_id = $1 WHERE id = $2', [creditResult.rows[0].id, event.id]);
    await client.query('COMMIT');
    res.json({ success: true, creditId: creditResult.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error assigning account event:', err);
    res.status(500).json({ error: 'Failed to assign account event' });
  } finally {
    client.release();
  }
});

// Utility endpoints
app.get('/api/m365/status', async (req, res) => {
  const config = M365.configFromEnv();
  const states = await pool.query('SELECT * FROM m365_sync_state ORDER BY folder_path');
  res.json({
    configured: Boolean(config.tenantId && config.clientId && config.thumbprint && config.mailbox),
    certificatePresent: fs.existsSync(config.privateKeyPath),
    mailbox: config.mailbox,
    folders: config.folders,
    syncState: states.rows
  });
});

app.post('/api/m365/test', async (req, res) => {
  try {
    const config = M365.configFromEnv();
    const token = await M365.acquireToken(config);
    const folders = [];
    for (const folderPath of config.folders) folders.push({ folderPath, folderId: await M365.findFolder(config, token, folderPath) });
    res.json({ success: true, mailbox: config.mailbox, folders });
  } catch (err) {
    console.error('M365 connection test failed:', err);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/m365/sync', async (req, res) => {
  try {
    res.json({ success: true, results: await M365.syncAll(pool) });
  } catch (err) {
    console.error('M365 synchronization failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/m365/messages', async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (req.query.personId) { params.push(req.query.personId); where = 'WHERE e.person_id = $1 OR e.person_id IS NULL'; }
    const result = await pool.query(`
      SELECT e.*, p.name AS person_name, o.name AS linked_offer_name
      FROM email_ingestions e
      LEFT JOIN people p ON p.id = e.person_id
      LEFT JOIN offers o ON o.id = e.linked_offer_id
      ${where}
      ORDER BY e.received_at DESC NULLS LAST, e.id DESC
      LIMIT 200
    `, params);
    res.json(result.rows.map(row => ({
      id: row.id, graphMessageId: row.graph_message_id, receivedAt: row.received_at, sender: row.sender,
      subject: row.subject, folderPath: row.folder_path, personId: row.person_id, personName: row.person_name,
      classification: row.classification, processingStatus: row.processing_status, parsedOffer: row.parsed_offer,
      fingerprint: row.offer_fingerprint, linkedOfferId: row.linked_offer_id, linkedOfferName: row.linked_offer_name,
      reason: row.classification_reason
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load ingested email' });
  }
});

app.patch('/api/m365/messages/:id', async (req, res) => {
  try {
    const allowed = ['ignored', 'review', 'linked', 'imported'];
    if (!allowed.includes(req.body.processingStatus)) return res.status(400).json({ error: 'Invalid processing status' });
    const result = await pool.query(
      'UPDATE email_ingestions SET processing_status=$1, linked_offer_id=COALESCE($2, linked_offer_id), updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING id',
      [req.body.processingStatus, req.body.linkedOfferId || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Email not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update email' });
  }
});

app.get('/api/merchants', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT merchant FROM transactions ORDER BY merchant');
    const merchants = result.rows.map(row => row.merchant);
    res.json(merchants);
  } catch (err) {
    console.error('Error fetching merchants:', err);
    res.status(500).json({ error: 'Failed to fetch merchants' });
  }
});

app.get('/api/merchants/:merchant/category', async (req, res) => {
  try {
    const { merchant } = req.params;
    const result = await pool.query(`
      SELECT UNNEST(categories) as category, COUNT(*) as count
      FROM transactions
      WHERE merchant = $1
      GROUP BY category
      ORDER BY count DESC
    `, [merchant]);

    const categories = result.rows.map(row => row.category);
    res.json({ categories });
  } catch (err) {
    console.error('Error fetching merchant categories:', err);
    res.status(500).json({ error: 'Failed to fetch merchant categories' });
  }
});

// Database initialization endpoint
app.post('/api/initialize', async (req, res) => {
  try {
    // This endpoint can be used to trigger any initialization logic
    res.json({ success: true, message: 'Database initialized' });
  } catch (err) {
    console.error('Error initializing:', err);
    res.status(500).json({ error: 'Failed to initialize' });
  }
});

app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  console.log(`Visit http://localhost:${port} to view the app`);
  await runMigrations();
  const m365Config = M365.configFromEnv();
  const m365Configured = m365Config.tenantId && m365Config.clientId && m365Config.thumbprint;
  if (m365Configured && process.env.M365_AUTO_SYNC !== 'false') {
    setTimeout(() => M365.syncAll(pool).catch(error => console.error('Scheduled M365 sync failed:', error)), 60000);
    setInterval(() => M365.syncAll(pool).catch(error => console.error('Scheduled M365 sync failed:', error)), 24 * 60 * 60 * 1000);
  }
});
