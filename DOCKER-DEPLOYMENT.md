# Docker Deployment Guide for Synology NAS

This guide will help you deploy the Credit Card Tracker app on your Synology NAS using Docker.

## Prerequisites

- Synology NAS with Docker installed (via Package Center)
- SSH access to your Synology (optional, for command-line deployment)
- Port 3000 available (or choose a different port)

## Quick Start (Recommended)

### Option 1: Using Git (Easiest - Recommended for DSM 7.x)

**For Synology DSM 7.x with Container Manager**, the easiest method is using Git via SSH:

#### Step 1: Install Git on Synology

1. **Open Package Center**
2. Search for **"Git Server"** and install it
   - If Git Server isn't available, we'll install via command line (see Option 1B below)

#### Step 1B: Install Git via Command Line (if Git Server not available)

SSH into your Synology and run:
```bash
# Install via SynoCommunity (recommended)
# First, add SynoCommunity repository to Package Center:
# Settings → Package Sources → Add
# Name: SynoCommunity
# Location: https://packages.synocommunity.com/

# Then install Git from Package Center, or via command line:
ssh your-username@your-synology-ip
sudo -i

# Install Git (if not using Package Center)
# For DSM 7.x, Git is available via opkg or ipkg
wget -O - http://bin.entware.net/x64-k3.2/installer/generic.sh | sh
opkg update
opkg install git
```

#### Step 2: Clone Repository and Deploy

```bash
# SSH into Synology
ssh your-username@your-synology-ip
sudo -i

# Navigate to docker directory
cd /volume1/docker

# Clone the repository
git clone https://github.com/minamhere/credit-card-tracking-app.git credit-card-tracker
cd credit-card-tracker

# Optional: Set a secure password
cp .env.example .env
nano .env  # Change POSTGRES_PASSWORD

# Start the containers
docker-compose up -d

# Check status
docker-compose logs -f app
```

#### Step 3: Access the App
- Open browser to `http://your-synology-ip:3000`
- First load takes ~30 seconds (running migrations)

Your data will be stored in `/volume1/docker/credit-card-tracker/postgres-data/`

---

### Option 2: Manual File Upload (No Git Required)

If you prefer not to install Git, use this method:

1. **Install Container Manager** via Synology Package Center

2. **Copy Project to Synology** (choose one):

   **Method A: Download ZIP from GitHub**
   - Go to: https://github.com/minamhere/credit-card-tracking-app
   - Click the green "Code" button → "Download ZIP"
   - Extract the ZIP on your computer
   - Use Synology File Station to upload the folder to `/volume1/docker/credit-card-tracker`

   **Method B: Using File Station Web UI**
   - Open Synology File Station in your browser
   - Navigate to `/docker/` (create if needed)
   - Click "Upload" → upload all project files
   - Create folder: `/docker/credit-card-tracker/`

   **Method C: SFTP/SCP**
   - Use SCP: `scp -r . your-username@your-synology-ip:/volume1/docker/credit-card-tracker`
   - Or use FileZilla, WinSCP, or Cyberduck

3. **Start via SSH**:
   ```bash
   # SSH into Synology
   ssh your-username@your-synology-ip
   sudo -i
   cd /volume1/docker/credit-card-tracker

   # Start containers
   docker-compose up -d
   ```

4. **Or Create Project in Container Manager GUI**:
   - Open Container Manager
   - Go to "Project" tab → "Create"
   - Set project path: `/volume1/docker/credit-card-tracker`
   - Name: `credit-card-tracker`
   - The compose file will be auto-detected
   - Click "Build" then "Start"

5. **Access**:
   - Open browser to `http://your-synology-ip:3000`

### Option 3: Using Command Line (SSH)

1. **SSH into your Synology**:
   ```bash
   ssh your-username@your-synology-ip
   sudo -i
   cd /volume1/docker
   ```

2. **Download project from GitHub**:
   ```bash
   # Download and extract
   wget https://github.com/minamhere/credit-card-tracking-app/archive/refs/heads/claude/persistent-storage-multi-user-017t2U76x49T9VjvuSen4snd.zip -O project.zip
   unzip project.zip
   mv credit-card-tracking-app-* credit-card-tracking-app
   cd credit-card-tracking-app
   ```

3. **Create .env file (recommended)**:
   ```bash
   cp .env.example .env
   nano .env  # or vi .env
   ```

   Edit the password:
   ```
   POSTGRES_PASSWORD=your_secure_password_here
   ```

4. **Start the containers**:
   ```bash
   docker-compose up -d
   ```

5. **Check status**:
   ```bash
   docker-compose ps
   docker-compose logs -f app
   ```

6. **Access the app**:
   - Open browser to `http://your-synology-ip:3000`

## Data Persistence

Your data is stored in the `postgres-data` directory in your project folder. This ensures:
- **Data survives container restarts**
- **Data survives container rebuilds**
- **Easy backups** - just backup the `postgres-data` folder

### Where is my data stored?

If you deployed to `/volume1/docker/credit-card-tracker`, your database data is in:
```
/volume1/docker/credit-card-tracker/postgres-data/
```

### Backup Your Data

To backup your data:

**Option 1: Simple folder backup**
```bash
# On Synology
sudo tar -czf credit-card-backup-$(date +%Y%m%d).tar.gz postgres-data
```

**Option 2: PostgreSQL dump (recommended)**
```bash
docker-compose exec db pg_dump -U credit_card_user credit_card_tracker > backup.sql
```

To restore from SQL dump:
```bash
cat backup.sql | docker-compose exec -T db psql -U credit_card_user credit_card_tracker
```

## Changing the Port

If port 3000 is already in use, edit `docker-compose.yml`:

```yaml
services:
  app:
    ports:
      - "8080:3000"  # Change 8080 to your desired port
```

Then restart:
```bash
docker-compose down
docker-compose up -d
```

## Updating the Application

When you want to update the app with new features:

```bash
# Pull latest code (if using git)
git pull

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

**Your data will be preserved** because it's stored in the mapped volume.

## Troubleshooting

### Check container logs
```bash
docker-compose logs app
docker-compose logs db
```

### Container won't start
```bash
# Check if containers are running
docker-compose ps

# See detailed status
docker-compose logs -f
```

### Database connection issues
```bash
# Restart both containers
docker-compose restart

# Or restart just the app
docker-compose restart app
```

### Reset everything (WARNING: deletes all data)
```bash
docker-compose down -v
rm -rf postgres-data
docker-compose up -d
```

### Check database health
```bash
docker-compose exec db psql -U credit_card_user -d credit_card_tracker -c "\dt"
```

## Security Recommendations

1. **Change the default password**: Edit `.env` and set a strong `POSTGRES_PASSWORD`

2. **Firewall**: Only expose port 3000 to your local network, not the internet

3. **Regular backups**: Set up a cron job to backup `postgres-data` regularly

4. **Access control**: If you want to access from outside your home:
   - Use Synology's built-in reverse proxy with HTTPS
   - Or use a VPN to access your home network
   - Don't expose port 3000 directly to the internet

## Accessing from Outside Your Home Network

### Option 1: Synology Reverse Proxy (Recommended)

1. In Synology DSM, go to Control Panel → Login Portal → Advanced → Reverse Proxy
2. Create new reverse proxy:
   - Description: Credit Card Tracker
   - Source: External (HTTPS, port 443, hostname: your-ddns.synology.me)
   - Destination: localhost, port 3000
3. Enable HTTPS certificate (via Let's Encrypt in Synology)

### Option 2: Synology QuickConnect

Use QuickConnect with port forwarding (less secure, not recommended)

### Option 3: VPN (Most Secure)

Set up Synology VPN Server and connect to your home network first

## Running Multiple Instances

If you want to run multiple completely separate instances (different databases):

1. Copy the entire project to a new folder
2. Edit `docker-compose.yml` in the new folder:
   - Change container names
   - Change external port (e.g., 3001)
   - Change database volume name
3. Run `docker-compose up -d` in the new folder

## Monitoring and Maintenance

### View resource usage
```bash
docker stats credit-card-tracker-app credit-card-tracker-db
```

### Auto-restart on Synology reboot

The `restart: unless-stopped` policy ensures containers start automatically when your Synology reboots.

### Database maintenance
```bash
# Vacuum database (optimize)
docker-compose exec db psql -U credit_card_user -d credit_card_tracker -c "VACUUM ANALYZE;"
```

## Support

For issues with:
- **Docker setup**: Check Synology Docker documentation
- **Application bugs**: Open an issue on GitHub
- **Data loss**: Restore from your `postgres-data` backup

## Summary

✅ Your data is persistent in `./postgres-data/`
✅ Containers auto-restart after Synology reboot
✅ Easy to backup (just backup one folder)
✅ Easy to update (rebuild containers, data persists)
✅ Runs entirely on your Synology (no cloud dependencies)
