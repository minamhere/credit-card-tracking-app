const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API Routes

// Offers endpoints
app.get('/api/offers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM offers ORDER BY start_date');
    const offers = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      startDate: row.start_date,
      endDate: row.end_date,
      spendingTarget: row.spending_target,
      transactionTarget: row.transaction_target,
      minTransaction: row.min_transaction,
      category: row.category,
      reward: row.reward,
      bonusReward: row.bonus_reward,
      description: row.description,
      monthlyTracking: row.monthly_tracking
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
      minTransaction, category, reward, bonusReward, description, monthlyTracking
    } = req.body;

    const result = await pool.query(`
      INSERT INTO offers (
        name, type, start_date, end_date, spending_target,
        transaction_target, min_transaction, category, reward,
        bonus_reward, description, monthly_tracking
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      name, type, startDate, endDate, spendingTarget,
      transactionTarget, minTransaction, category || '', reward,
      bonusReward, description, monthlyTracking
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
      category: result.rows[0].category,
      reward: result.rows[0].reward,
      bonusReward: result.rows[0].bonus_reward,
      description: result.rows[0].description,
      monthlyTracking: result.rows[0].monthly_tracking
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
      minTransaction, category, reward, bonusReward, description, monthlyTracking
    } = req.body;

    const result = await pool.query(`
      UPDATE offers SET
        name = $1, type = $2, start_date = $3, end_date = $4,
        spending_target = $5, transaction_target = $6, min_transaction = $7,
        category = $8, reward = $9, bonus_reward = $10, description = $11,
        monthly_tracking = $12
      WHERE id = $13
      RETURNING *
    `, [
      name, type, startDate, endDate, spendingTarget,
      transactionTarget, minTransaction, category || '', reward,
      bonusReward, description, monthlyTracking, id
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
      category: result.rows[0].category,
      reward: result.rows[0].reward,
      bonusReward: result.rows[0].bonus_reward,
      description: result.rows[0].description,
      monthlyTracking: result.rows[0].monthly_tracking
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
      category: result.rows[0].category,
      reward: result.rows[0].reward,
      bonusReward: result.rows[0].bonus_reward,
      description: result.rows[0].description,
      monthlyTracking: result.rows[0].monthly_tracking
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
    const result = await pool.query('SELECT * FROM transactions ORDER BY date DESC');
    const transactions = result.rows.map(row => ({
      id: row.id,
      date: row.date,
      amount: row.amount,
      merchant: row.merchant,
      category: row.category,
      description: row.description
    }));
    res.json(transactions);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { date, amount, merchant, category, description } = req.body;

    const result = await pool.query(`
      INSERT INTO transactions (date, amount, merchant, category, description)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [date, amount, merchant, category, description || '']);

    const transaction = {
      id: result.rows[0].id,
      date: result.rows[0].date,
      amount: result.rows[0].amount,
      merchant: result.rows[0].merchant,
      category: result.rows[0].category,
      description: result.rows[0].description
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
    const { date, amount, merchant, category, description } = req.body;

    const result = await pool.query(`
      UPDATE transactions SET
        date = $1, amount = $2, merchant = $3, category = $4, description = $5
      WHERE id = $6
      RETURNING *
    `, [date, amount, merchant, category, description || '', id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = {
      id: result.rows[0].id,
      date: result.rows[0].date,
      amount: result.rows[0].amount,
      merchant: result.rows[0].merchant,
      category: result.rows[0].category,
      description: result.rows[0].description
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
      SELECT category, COUNT(*) as count
      FROM transactions
      WHERE merchant = $1
      GROUP BY category
      ORDER BY count DESC
      LIMIT 1
    `, [merchant]);

    const category = result.rows.length > 0 ? result.rows[0].category : '';
    res.json({ category });
  } catch (err) {
    console.error('Error fetching merchant category:', err);
    res.status(500).json({ error: 'Failed to fetch merchant category' });
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Visit http://localhost:${port} to view the app`);
});