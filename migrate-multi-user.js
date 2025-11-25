const { Pool } = require('pg');

// Determine if we should use SSL based on environment
const dbUrl = process.env.DATABASE_URL || '';
const isLocalDocker = dbUrl.includes('@db:') || dbUrl.includes('@localhost:');
const shouldUseSSL = process.env.NODE_ENV === 'production' && !isLocalDocker;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false
});

async function migrateToMultiUser() {
  console.log('Starting multi-user migration...');

  try {
    // Create people table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS people (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('People table created');

    // Check if people already exist
    const existingPeople = await pool.query('SELECT COUNT(*) FROM people');
    if (parseInt(existingPeople.rows[0].count) === 0) {
      // Insert default people
      await pool.query(`
        INSERT INTO people (name) VALUES ('Person 1'), ('Person 2')
      `);
      console.log('Default people inserted');
    }

    // Check if person_id column already exists in offers table
    const offersColumns = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'offers' AND column_name = 'person_id'
    `);

    if (offersColumns.rows.length === 0) {
      // Add person_id to offers table
      await pool.query(`
        ALTER TABLE offers
        ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE CASCADE
      `);
      console.log('Added person_id to offers table');

      // Set default person_id for existing offers (Person 1)
      const firstPerson = await pool.query('SELECT id FROM people ORDER BY id LIMIT 1');
      if (firstPerson.rows.length > 0) {
        await pool.query(`
          UPDATE offers SET person_id = $1 WHERE person_id IS NULL
        `, [firstPerson.rows[0].id]);
        console.log('Set default person_id for existing offers');
      }

      // Make person_id NOT NULL after setting defaults
      await pool.query(`
        ALTER TABLE offers
        ALTER COLUMN person_id SET NOT NULL
      `);
      console.log('Made person_id NOT NULL in offers table');
    } else {
      console.log('person_id already exists in offers table');
    }

    // Check if person_id column already exists in transactions table
    const transactionsColumns = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'person_id'
    `);

    if (transactionsColumns.rows.length === 0) {
      // Add person_id to transactions table
      await pool.query(`
        ALTER TABLE transactions
        ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE CASCADE
      `);
      console.log('Added person_id to transactions table');

      // Set default person_id for existing transactions (Person 1)
      const firstPerson = await pool.query('SELECT id FROM people ORDER BY id LIMIT 1');
      if (firstPerson.rows.length > 0) {
        await pool.query(`
          UPDATE transactions SET person_id = $1 WHERE person_id IS NULL
        `, [firstPerson.rows[0].id]);
        console.log('Set default person_id for existing transactions');
      }

      // Make person_id NOT NULL after setting defaults
      await pool.query(`
        ALTER TABLE transactions
        ALTER COLUMN person_id SET NOT NULL
      `);
      console.log('Made person_id NOT NULL in transactions table');
    } else {
      console.log('person_id already exists in transactions table');
    }

    console.log('Multi-user migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateToMultiUser();
}

module.exports = { migrateToMultiUser };
