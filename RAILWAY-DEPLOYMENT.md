# Railway.app Deployment Guide

This guide will help you deploy your Credit Card Tracking App to Railway.app with PostgreSQL.

## Prerequisites

1. **GitHub Account** - Your code needs to be in a GitHub repository
2. **Railway Account** - Sign up at [railway.app](https://railway.app)

## Step-by-Step Railway Deployment

### 1. Push Your Code to GitHub

```bash
# Initialize git repository (if not already done)
git init

# Add all files
git add .

# Make initial commit
git commit -m "Initial commit - Credit Card Tracking App"

# Add your GitHub repository as origin
git remote add origin https://github.com/yourusername/credit-card-tracker.git

# Push to GitHub
git push -u origin main
```

### 2. Deploy to Railway

1. **Login to Railway**
   - Go to [railway.app](https://railway.app)
   - Click "Login" and connect with GitHub

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your credit card tracker repository

3. **Add PostgreSQL Database**
   - In your project dashboard, click "New"
   - Select "Database" → "Add PostgreSQL"
   - Railway will automatically create a PostgreSQL database

4. **Configure Environment Variables**
   - Railway automatically sets `DATABASE_URL` from your PostgreSQL service
   - No additional environment variables needed

5. **Deploy**
   - Railway will automatically:
     - Install dependencies (`npm install`)
     - Run migration (`npm run migrate`)
     - Start the server (`npm start`)

### 3. Access Your App

1. **Get Your App URL**
   - In Railway dashboard, click on your web service
   - Look for "Domains" section
   - Railway provides a free domain like: `yourapp.railway.app`

2. **Custom Domain (Optional)**
   - Click "Settings" → "Domains"
   - Add your custom domain
   - Follow DNS configuration instructions

## Important Files Created for Railway

- **`package.json`** - Node.js dependencies and scripts
- **`server.js`** - Express server with API endpoints
- **`migrate.js`** - Database schema and initial data setup
- **`database.js`** - PostgreSQL API client (replaces SQLite)
- **`railway.json`** - Railway deployment configuration
- **`Procfile`** - Process definitions for Railway

## How It Works

### Database Migration
- Railway automatically runs `npm run migrate` on deployment
- This creates tables and inserts your initial offers
- Your existing offer data is preserved in the migration

### API Endpoints
Your app now has a REST API:
- `GET /api/offers` - Get all offers
- `POST /api/offers` - Create new offer
- `PUT /api/offers/:id` - Update offer
- `DELETE /api/offers/:id` - Delete offer
- `GET /api/transactions` - Get all transactions
- `POST /api/transactions` - Create transaction
- Plus utility endpoints for merchants, etc.

### Frontend Changes
- Removed SQLite and SQL.js dependencies
- Removed database file picker modal
- Frontend now calls API endpoints instead of direct SQLite
- **Identical functionality** - all features work the same

## Cost

- **PostgreSQL**: Free tier (512 MB storage, 1 GB transfer)
- **Web Service**: $5/month after free trial
- **Total**: ~$5/month

## Troubleshooting

### If Migration Fails
1. Check Railway logs in the dashboard
2. Ensure `DATABASE_URL` environment variable is set
3. Try manually running migration:
   ```bash
   railway run npm run migrate
   ```

### If App Won't Start
1. Check logs for errors
2. Ensure all dependencies are in `package.json`
3. Verify `PORT` environment variable usage

### Database Connection Issues
1. Verify PostgreSQL service is running
2. Check `DATABASE_URL` format
3. Ensure SSL settings match environment

## Local Development

To run locally with PostgreSQL:

```bash
# Install dependencies
npm install

# Set up local PostgreSQL database
# Update DATABASE_URL in your environment

# Run migration
npm run migrate

# Start development server
npm run dev
```

## Support

- **Railway Docs**: [docs.railway.app](https://docs.railway.app)
- **Railway Discord**: [discord.gg/railway](https://discord.gg/railway)
- **This App**: All functionality remains identical to SQLite version