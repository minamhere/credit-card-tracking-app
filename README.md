# Citi Shop Your Way - Offer Tracker

A web application to track credit card spending offers and bonus qualifications for multiple cardholders. Data is stored persistently in PostgreSQL.

## Features

- **Multi-User Support**: Track offers and transactions for multiple cardholders
- **Dashboard**: Visual progress tracking for all active offers
- **Transaction Management**: Add, view, and delete transactions
- **Offer Management**: Create, edit, and manage multiple overlapping offers
- **Persistent Storage**: All data stored in PostgreSQL database (survives restarts)
- **Responsive Design**: Works on desktop and mobile devices
- **Docker Support**: Easy deployment with Docker and Docker Compose

## Storage & Persistence

This app uses **PostgreSQL** for persistent data storage. Your data will remain saved as long as the database exists.

**Recommended Deployment**: Docker on your own hardware (e.g., Synology NAS) for:
- ✅ True data persistence (no 30-day limits)
- ✅ Complete control over your data
- ✅ No recurring cloud costs
- ✅ Easy backups

## Multi-User Setup

1. When you first load the app, it creates two default cardholders: "Person 1" and "Person 2"
2. Use the dropdown in the header to switch between cardholders
3. Click "Manage" to:
   - Rename cardholders
   - Add more cardholders
   - Delete cardholders (this will delete all their data)

Each cardholder has:
- Their own set of transactions
- Their own set of offers
- Independent progress tracking

## Getting Started

### Docker Deployment (Recommended for Synology NAS)

**See [DOCKER-DEPLOYMENT.md](DOCKER-DEPLOYMENT.md) for detailed instructions.**

Quick start:
```bash
# 1. Copy project to your Synology (e.g., /volume1/docker/credit-card-tracker)
# 2. SSH into Synology or use Docker GUI
# 3. Start the containers:
docker-compose up -d

# 4. Access at http://your-synology-ip:3000
```

Your data will be persisted in the `postgres-data` folder.

### Deploying to Render (Cloud - Free tier has 30-day database limit)

⚠️ **Note**: Render's free PostgreSQL tier deletes databases after 30 days of inactivity.

1. Connect your repository to Render
2. The `render.yaml` file will automatically:
   - Create a PostgreSQL database
   - Run all migrations
   - Deploy the web service

### Local Development

1. Set up a PostgreSQL database and set the `DATABASE_URL` environment variable
2. Run migrations: `npm run migrate && npm run migrate-categories && npm run migrate-offer-categories && npm run migrate-add-tiers && npm run migrate-multi-user`
3. Start the server: `npm start`
4. Open http://localhost:3000

## How to Use

### Adding Transactions
1. Go to the "Transactions" tab
2. Fill in the transaction details (date, amount, merchant, category)
3. Click "Add Transaction"
4. The dashboard will automatically update your progress

### Managing Offers
1. Go to the "Offers" tab
2. Click "Add New Offer" to create additional offers
3. Fill in the offer criteria and rewards
4. Use the Edit/Delete buttons to manage existing offers

### Viewing Progress
1. The "Dashboard" tab shows your real-time progress
2. See monthly progress for offers that track by month
3. View total earned vs. potential earnings

## Offer Types Supported

- **Spending Amount**: Reach a target spending amount
- **Number of Transactions**: Complete a certain number of transactions
- **Combination**: Mix of spending and transaction requirements
- **Monthly Tracking**: Separate tracking for each month
- **Category Requirements**: Specific merchant categories (online, grocery, etc.)
- **Minimum Transaction**: Minimum amount per transaction
- **Bonus Rewards**: Additional rewards for completing all months

## Offer Types Shared Across Cardholders

When you create an offer, it's associated with a specific cardholder. The offer "types" can be the same between cardholders, but:
- Spending amounts can be different
- Progress is tracked independently
- Transactions are separate

For example:
- Person 1: "Monthly Spending Bonus" - $750 target
- Person 2: "Monthly Spending Bonus" - $500 target (different spending requirement)

## Browser Compatibility

Works with modern browsers that support:
- ES6 Classes
- localStorage
- CSS Grid and Flexbox