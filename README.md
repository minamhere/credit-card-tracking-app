# Citi Shop Your Way - Offer Tracker

A fully local web application to track credit card spending offers and bonus qualifications for the Citi Shop Your Way Mastercard.

## Features

- **Dashboard**: Visual progress tracking for all active offers
- **Transaction Management**: Add, view, and delete transactions
- **Offer Management**: Create, edit, and manage multiple overlapping offers
- **Local Storage**: All data stored locally in your browser (no external servers)
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

1. Open `index.html` in your web browser
2. The app comes pre-loaded with your 3 current offers:
   - Monthly Spending Bonus ($750/month for $25 each + $50 bonus)
   - Large Purchase Bonus (5 purchases of $75+ for $40/month)
   - Online Shopping Bonus ($750 online spending for $75)

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

## Data Storage

All data is stored locally in your browser using localStorage. Your data will persist between sessions but is specific to the browser and device you're using.

## Browser Compatibility

Works with modern browsers that support:
- ES6 Classes
- localStorage
- CSS Grid and Flexbox