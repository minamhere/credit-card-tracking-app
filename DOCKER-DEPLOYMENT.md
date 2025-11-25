# Docker Deployment Guide for Synology NAS

This guide will help you deploy the Credit Card Tracker app on your Synology NAS using Docker.

## Prerequisites

- Synology NAS with Docker installed (via Package Center)
- SSH access to your Synology (optional, for command-line deployment)
- Port 3000 available (or choose a different port)

## Quick Start (Recommended)

### Option 1: Using Synology Docker GUI

1. **Install Docker** via Synology Package Center if not already installed

2. **Copy Project to Synology** (choose one method):

   **Method A: Download ZIP from GitHub** (Easiest)
   - Go to: https://github.com/minamhere/credit-card-tracking-app
   - Click the green "Code" button → "Download ZIP"
   - Extract the ZIP on your computer
   - Use Synology File Station to upload the extracted folder to `/volume1/docker/credit-card-tracker`

   **Method B: Using File Station Web UI**
   - Open Synology File Station in your browser
   - Navigate to `/docker/` (create the folder if it doesn't exist)
   - Click "Upload" → "Upload - Skip"
   - Upload all project files to create `/docker/credit-card-tracker/`

   **Method C: Using SFTP/SCP** (if you prefer command line)
   - On your computer, navigate to the project folder
   - Use SCP: `scp -r . your-username@your-synology-ip:/volume1/docker/credit-card-tracker`
   - Or use an SFTP client like FileZilla, WinSCP, or Cyberduck

3. **Open Synology Docker App**

4. **Import docker-compose.yml**:
   - Go to "Project" tab
   - Click "Create"
   - Set project path: `/volume1/docker/credit-card-tracker`
   - Name: `credit-card-tracker`
   - Click "Set up via docker-compose.yml"
   - The compose file will be auto-detected

5. **Configure Environment (Optional)**:
   - Before building, you can click "Web Station" → "Environment"
   - Add `POSTGRES_PASSWORD` with your secure password
   - Or leave default (will use `changeme123`)

6. **Build and Start**:
   - Click "Build" to build the images
   - Once built, click "Start" to run the containers

7. **Access the App**:
   - Open browser to `http://your-synology-ip:3000`

### Option 2: Using Command Line (SSH)

1. **SSH into your Synology**:
   ```bash
   ssh your-username@your-synology-ip
   ```

2. **Navigate to Docker directory**:
   ```bash
   sudo -i
   cd /volume1/docker
   ```

3. **Get the project files onto Synology** (choose one):

   **Option A: Download from GitHub**
   ```bash
   # Download and extract ZIP
   cd /volume1/docker
   wget https://github.com/minamhere/credit-card-tracking-app/archive/refs/heads/claude/persistent-storage-multi-user-017t2U76x49T9VjvuSen4snd.zip
   unzip persistent-storage-multi-user-017t2U76x49T9VjvuSen4snd.zip
   mv credit-card-tracking-app-* credit-card-tracking-app
   cd credit-card-tracking-app
   ```

   **Option B: Copy via SFTP/SCP first**
   ```bash
   # After copying files via SFTP/SCP
   cd /volume1/docker/credit-card-tracking-app
   ```

   **Option C: Use Synology File Station**
   - Upload files via the web interface first
   - Then SSH in and navigate to the folder:
   ```bash
   cd /volume1/docker/credit-card-tracking-app
   ```

4. **Create .env file (recommended)**:
   ```bash
   cp .env.example .env
   nano .env  # or vi .env
   ```

   Edit the password:
   ```
   POSTGRES_PASSWORD=your_secure_password_here
   ```

5. **Start the containers**:
   ```bash
   docker-compose up -d
   ```

6. **Check status**:
   ```bash
   docker-compose ps
   docker-compose logs -f app
   ```

7. **Access the app**:
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
