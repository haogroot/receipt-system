#!/bin/bash
set -e

# ═══════════════════════════════════════════════
# Receipt System - Debian VM Setup Script
# ═══════════════════════════════════════════════

APP_DIR="/opt/receipt-system"
APP_USER="www-data"

echo "══════════════════════════════════════"
echo "  📦 Receipt System Setup"
echo "══════════════════════════════════════"

# 1. System packages
echo "➤ Installing system packages..."
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip nginx

# 2. Create app directory
echo "➤ Setting up application directory..."
sudo mkdir -p $APP_DIR
sudo cp -r ./* $APP_DIR/
sudo cp .env $APP_DIR/.env 2>/dev/null || echo "⚠️  No .env file found. Please create $APP_DIR/.env with your GEMINI_API_KEY"

# 3. Python virtual environment
echo "➤ Creating Python virtual environment..."
sudo python3 -m venv $APP_DIR/venv
sudo $APP_DIR/venv/bin/pip install --upgrade pip
sudo $APP_DIR/venv/bin/pip install -r $APP_DIR/requirements.txt

# 4. Create uploads directory
echo "➤ Creating uploads directory..."
sudo mkdir -p $APP_DIR/uploads
sudo chown -R $APP_USER:$APP_USER $APP_DIR

# 5. Initialize database
echo "➤ Initializing database..."
sudo -u $APP_USER $APP_DIR/venv/bin/python -c "
import sys; sys.path.insert(0, '$APP_DIR')
from database import init_db; init_db()
print('Database initialized.')
"

# 6. Systemd service
echo "➤ Setting up systemd service..."
sudo cp $APP_DIR/deploy/receipt-system.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable receipt-system
sudo systemctl start receipt-system

# 7. Nginx configuration
echo "➤ Configuring Nginx..."
sudo cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/receipt-system
sudo ln -sf /etc/nginx/sites-available/receipt-system /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "══════════════════════════════════════"
echo "  ✅ Setup Complete!"
echo "══════════════════════════════════════"
echo ""
echo "  App URL: http://$(hostname -I | awk '{print $1}')"
echo ""
echo "  Useful commands:"
echo "    sudo systemctl status receipt-system"
echo "    sudo systemctl restart receipt-system"
echo "    sudo journalctl -u receipt-system -f"
echo ""
echo "  ⚠️  Remember to set your GEMINI_API_KEY in $APP_DIR/.env"
echo ""
