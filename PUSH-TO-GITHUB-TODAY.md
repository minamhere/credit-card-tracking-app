# Push to GitHub Today - Command List

## Prerequisites (Run First)
You need to accept Xcode license to use git:
```bash
sudo xcodebuild -license accept
```

## Step 1: Create GitHub Repository
1. Go to [github.com](https://github.com)
2. Click "New repository" (green button)
3. Name: `credit-card-tracking-app`
4. Description: `Credit card offer tracking and optimization web app`
5. Keep it **Public** (so Railway can access it)
6. Don't initialize with README (we have files already)
7. Click "Create repository"

## Step 2: Copy the GitHub URL
GitHub will show you a URL like:
```
https://github.com/yourusername/credit-card-tracking-app.git
```
Copy this URL - you'll need it below.

## Step 3: Run These Commands in Terminal

**Navigate to your project:**
```bash
cd "/Users/chrisnolan/Dropbox/Personal/Projects/Credit Card Tracking Spreadsheet"
```

**Initialize git and add files:**
```bash
git init
git add .
git commit -m "Initial commit - Credit Card Tracking App with PostgreSQL"
```

**Connect to GitHub (replace with your URL):**
```bash
git remote add origin https://github.com/yourusername/credit-card-tracking-app.git
git branch -M main
git push -u origin main
```

## What Gets Pushed
- ✅ All your original HTML/CSS/JS files
- ✅ New PostgreSQL database code
- ✅ Express server with REST API
- ✅ Railway deployment configuration
- ✅ Migration scripts for your offer data
- ❌ SQLite database files (excluded by .gitignore)
- ❌ Sensitive data (personal-data.js excluded)

## After Pushing
1. Refresh your GitHub repository page
2. You should see all your files
3. Repository is now ready for Railway deployment tomorrow

## If You Get Errors

**"Permission denied" or authentication:**
- GitHub may prompt for username/password
- Or use GitHub Desktop app if you prefer GUI

**"Repository not found":**
- Double-check the GitHub URL
- Make sure repository is created and you're the owner

**"Working tree has uncommitted changes":**
```bash
git add .
git commit -m "Add remaining files"
git push
```

---

**Next: Tomorrow run the Railway deployment (5 minutes total)**