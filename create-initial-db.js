// Script to create initial SQLite database with prepopulated offers
// Run this once to create the database, then delete this file

async function createInitialDatabase() {
    console.log('Creating initial database with offers...');

    // Initialize SQL.js
    const SQL = await initSqlJs({
        locateFile: file => `https://sql.js.org/dist/${file}`
    });

    // Create new database
    const db = new SQL.Database();

    // Create tables
    db.run(`
        CREATE TABLE offers (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            spending_target REAL,
            transaction_target INTEGER,
            min_transaction REAL,
            category TEXT,
            reward REAL NOT NULL,
            bonus_reward REAL,
            description TEXT,
            monthly_tracking BOOLEAN NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE transactions (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL,
            amount REAL NOT NULL,
            merchant TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Insert your current offers
    const offers = [
        {
            id: 1,
            name: "Monthly Spending Bonus",
            type: "spending",
            startDate: "2025-09-01",
            endDate: "2025-11-30",
            spendingTarget: 750,
            transactionTarget: null,
            minTransaction: null,
            category: "",
            reward: 25,
            bonusReward: 50,
            description: "Spend $750 in September, October, or November and get $25 for each month. If completed in all 3 months, get a bonus $50.",
            monthlyTracking: true
        },
        {
            id: 2,
            name: "Large Purchase Bonus",
            type: "transactions",
            startDate: "2025-09-01",
            endDate: "2025-11-30",
            spendingTarget: null,
            transactionTarget: 5,
            minTransaction: 75,
            category: "",
            reward: 40,
            bonusReward: null,
            description: "Make 5 purchases of $75 or more in September, October, or November and get $40 for each month.",
            monthlyTracking: true
        },
        {
            id: 3,
            name: "Online Shopping Bonus",
            type: "spending",
            startDate: "2025-09-15",
            endDate: "2025-10-14",
            spendingTarget: 750,
            transactionTarget: null,
            minTransaction: null,
            category: "online",
            reward: 75,
            bonusReward: null,
            description: "Spend $750 at Online merchants from 9/15 until 10/14, earn $75 cash back",
            monthlyTracking: false
        }
    ];

    // Insert offers into database
    offers.forEach(offer => {
        db.run(`
            INSERT INTO offers (
                id, name, type, start_date, end_date, spending_target,
                transaction_target, min_transaction, category, reward,
                bonus_reward, description, monthly_tracking
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            offer.id,
            offer.name,
            offer.type,
            offer.startDate,
            offer.endDate,
            offer.spendingTarget,
            offer.transactionTarget,
            offer.minTransaction,
            offer.category || '',
            offer.reward,
            offer.bonusReward,
            offer.description,
            offer.monthlyTracking ? 1 : 0
        ]);
    });

    console.log(`Inserted ${offers.length} offers into database`);

    // Export database
    const data = db.export();
    const blob = new Blob([data], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'credit-card-tracker.db';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('Database created and downloaded as credit-card-tracker.db');
    console.log('Replace your existing database file with this new one, then delete this create-initial-db.js file');
}

// Auto-run when page loads
window.addEventListener('load', createInitialDatabase);