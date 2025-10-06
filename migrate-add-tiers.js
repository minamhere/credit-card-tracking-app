const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addTiersColumn() {
  console.log('Adding tiers column to offers table...');

  try {
    // Add tiers column (JSONB for storing array of tier objects)
    await pool.query(`
      ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS tiers JSONB DEFAULT '[]'::jsonb
    `);

    console.log('Tiers column added successfully!');
  } catch (err) {
    console.error('Error adding tiers column:', err);
    throw err;
  }
}

async function migrate() {
  try {
    console.log('Starting tiers migration...');
    await addTiersColumn();
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
