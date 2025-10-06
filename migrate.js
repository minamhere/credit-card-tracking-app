const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createTables() {
  console.log('Creating database tables...');

  try {
    // Create offers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        spending_target REAL,
        transaction_target INTEGER,
        min_transaction REAL,
        categories TEXT[] NOT NULL DEFAULT '{}',
        reward REAL NOT NULL,
        bonus_reward REAL,
        tiers JSONB DEFAULT '[]'::jsonb,
        description TEXT DEFAULT '',
        monthly_tracking BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        amount REAL NOT NULL,
        merchant TEXT NOT NULL,
        categories TEXT[] NOT NULL DEFAULT '{}',
        description TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Tables created successfully');
  } catch (err) {
    console.error('Error creating tables:', err);
    throw err;
  }
}

async function insertInitialData() {
  console.log('Inserting initial offer data...');

  try {
    // Check if offers already exist
    const existingOffers = await pool.query('SELECT COUNT(*) FROM offers');
    if (parseInt(existingOffers.rows[0].count) > 0) {
      console.log('Offers already exist, skipping initial data insertion');
      return;
    }

    // Insert your current offers
    const offers = [
      {
        name: "2025 - Sept-Nov Monthly Spending Bonus",
        type: "spending",
        startDate: "2025-09-01",
        endDate: "2025-11-30",
        spendingTarget: 750,
        transactionTarget: null,
        minTransaction: null,
        categories: [],
        reward: 25,
        bonusReward: 50,
        description: "Spend $750 in September, October, or November and get $25 for each month. If completed in all 3 months, get a bonus $50.",
        monthlyTracking: true
      },
      {
        name: "Large Purchase Bonus",
        type: "transactions",
        startDate: "2025-09-01",
        endDate: "2025-11-30",
        spendingTarget: null,
        transactionTarget: 5,
        minTransaction: 75,
        categories: [],
        reward: 40,
        bonusReward: null,
        description: "Make 5 purchases of $75 or more in September, October, or November and get $40 for each month.",
        monthlyTracking: true
      },
      {
        name: "Online Shopping Bonus",
        type: "spending",
        startDate: "2025-09-15",
        endDate: "2025-10-14",
        spendingTarget: 750,
        transactionTarget: null,
        minTransaction: null,
        categories: ["online"],
        reward: 75,
        bonusReward: null,
        description: "Spend $750 at Online merchants from 9/15 until 10/14, earn $75 cash back",
        monthlyTracking: false
      }
    ];

    // Insert offers into database
    for (const offer of offers) {
      await pool.query(`
        INSERT INTO offers (
          name, type, start_date, end_date, spending_target,
          transaction_target, min_transaction, categories, reward,
          bonus_reward, description, monthly_tracking
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        offer.name,
        offer.type,
        offer.startDate,
        offer.endDate,
        offer.spendingTarget,
        offer.transactionTarget,
        offer.minTransaction,
        offer.categories || [],
        offer.reward,
        offer.bonusReward,
        offer.description,
        offer.monthlyTracking
      ]);
    }

    console.log(`Inserted ${offers.length} offers into database`);
  } catch (err) {
    console.error('Error inserting initial data:', err);
    throw err;
  }
}

async function migrate() {
  try {
    console.log('Starting database migration...');
    await createTables();
    await insertInitialData();
    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrate();
}

module.exports = { migrate };