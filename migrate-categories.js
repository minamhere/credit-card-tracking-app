const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrateCategoriesColumn() {
  console.log('Migrating categories column to support multiple categories...');

  try {
    // Step 1: Add new column for categories array
    console.log('Adding new categories column...');
    await pool.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS categories TEXT[]
    `);

    // Step 2: Migrate existing data from category to categories
    console.log('Migrating existing category data...');
    await pool.query(`
      UPDATE transactions
      SET categories = ARRAY[category]::TEXT[]
      WHERE categories IS NULL AND category IS NOT NULL AND category != ''
    `);

    // Set empty array for empty categories
    await pool.query(`
      UPDATE transactions
      SET categories = ARRAY[]::TEXT[]
      WHERE categories IS NULL
    `);

    // Step 3: Drop old category column
    console.log('Removing old category column...');
    await pool.query(`
      ALTER TABLE transactions
      DROP COLUMN IF EXISTS category
    `);

    console.log('Category migration completed successfully!');
  } catch (err) {
    console.error('Error migrating categories:', err);
    throw err;
  }
}

async function migrate() {
  try {
    console.log('Starting category migration...');
    await migrateCategoriesColumn();
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
