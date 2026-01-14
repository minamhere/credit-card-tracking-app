const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');

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
    const offers = result.rows.map(row => ({
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
      personId: row.person_id
    }));
    res.json(offers);
  } catch (err) {
    console.error('Error fetching offers:', err);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

app.post('/api/offers', async (req, res) => {
  try {
    const {
      name, type, startDate, endDate, spendingTarget, transactionTarget,
      minTransaction, categories, reward, bonusReward, tiers, description, monthlyTracking, personId,
      percentBack, maxBack, minSpendThreshold
    } = req.body;

    const result = await pool.query(`
      INSERT INTO offers (
        name, type, start_date, end_date, spending_target,
        transaction_target, min_transaction, categories, reward,
        bonus_reward, tiers, description, monthly_tracking, person_id,
        percent_back, max_back, min_spend_threshold
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      name, type, startDate, endDate, spendingTarget,
      transactionTarget, minTransaction, categories || [], reward,
      bonusReward, JSON.stringify(tiers || []), description, monthlyTracking, personId,
      percentBack, maxBack, minSpendThreshold
    ]);

    const offer = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      type: result.rows[0].type,
      startDate: result.rows[0].start_date,
      endDate: result.rows[0].end_date,
      spendingTarget: result.rows[0].spending_target,
      transactionTarget: result.rows[0].transaction_target,
      minTransaction: result.rows[0].min_transaction,
      categories: result.rows[0].categories || [],
      reward: result.rows[0].reward,
      bonusReward: result.rows[0].bonus_reward,
      tiers: result.rows[0].tiers || [],
      description: result.rows[0].description,
      monthlyTracking: result.rows[0].monthly_tracking,
      personId: result.rows[0].person_id,
      percentBack: result.rows[0].percent_back,
      maxBack: result.rows[0].max_back,
      minSpendThreshold: result.rows[0].min_spend_threshold
    };

    res.json(offer);
  } catch (err) {
    console.error('Error creating offer:', err);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

app.put('/api/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, type, startDate, endDate, spendingTarget, transactionTarget,
      minTransaction, categories, reward, bonusReward, tiers, description, monthlyTracking, personId,
      percentBack, maxBack, minSpendThreshold
    } = req.body;

    const result = await pool.query(`
      UPDATE offers SET
        name = $1, type = $2, start_date = $3, end_date = $4,
        spending_target = $5, transaction_target = $6, min_transaction = $7,
        categories = $8, reward = $9, bonus_reward = $10, tiers = $11, description = $12,
        monthly_tracking = $13, person_id = $14, percent_back = $15, max_back = $16, min_spend_threshold = $17
      WHERE id = $18
      RETURNING *
    `, [
      name, type, startDate, endDate, spendingTarget,
      transactionTarget, minTransaction, categories || [], reward,
      bonusReward, JSON.stringify(tiers || []), description, monthlyTracking, personId,
      percentBack, maxBack, minSpendThreshold, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const offer = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      type: result.rows[0].type,
      startDate: result.rows[0].start_date,
      endDate: result.rows[0].end_date,
      spendingTarget: result.rows[0].spending_target,
      transactionTarget: result.rows[0].transaction_target,
      minTransaction: result.rows[0].min_transaction,
      categories: result.rows[0].categories || [],
      reward: result.rows[0].reward,
      bonusReward: result.rows[0].bonus_reward,
      tiers: result.rows[0].tiers || [],
      description: result.rows[0].description,
      monthlyTracking: result.rows[0].monthly_tracking,
      personId: result.rows[0].person_id,
      percentBack: result.rows[0].percent_back,
      maxBack: result.rows[0].max_back,
      minSpendThreshold: result.rows[0].min_spend_threshold
    };

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

app.get('/api/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM offers WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const offer = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      type: result.rows[0].type,
      startDate: result.rows[0].start_date,
      endDate: result.rows[0].end_date,
      spendingTarget: result.rows[0].spending_target,
      transactionTarget: result.rows[0].transaction_target,
      minTransaction: result.rows[0].min_transaction,
      categories: result.rows[0].categories || [],
      reward: result.rows[0].reward,
      bonusReward: result.rows[0].bonus_reward,
      tiers: result.rows[0].tiers || [],
      description: result.rows[0].description,
      monthlyTracking: result.rows[0].monthly_tracking,
      personId: result.rows[0].person_id,
      percentBack: result.rows[0].percent_back,
      maxBack: result.rows[0].max_back,
      minSpendThreshold: result.rows[0].min_spend_threshold
    };

    res.json(offer);
  } catch (err) {
    console.error('Error fetching offer:', err);
    res.status(500).json({ error: 'Failed to fetch offer' });
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
      personId: row.person_id
    }));
    res.json(transactions);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { date, amount, merchant, categories, description, personId } = req.body;

    const result = await pool.query(`
      INSERT INTO transactions (date, amount, merchant, categories, description, person_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [date, amount, merchant, categories || [], description || '', personId]);

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

// Utility endpoints
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
});