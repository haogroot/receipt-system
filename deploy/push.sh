#!/bin/bash
# 🚀 Deployment script for Receipt System
# This script bundles the local code and pushes it to the GCloud VPS.

VM_NAME="receipt-system-vm"
ZONE="asia-east1-b"
APP_DIR="/opt/receipt-system"
APP_USER="www-data"

echo "📦 Bundling application..."
tar -czf update.tar.gz \
    --exclude='venv' \
    --exclude='uploads' \
    --exclude='.git' \
    --exclude='.env' \
    --exclude='*.db' \
    --exclude='__pycache__' \
    --exclude='update.tar.gz' \
    --exclude='deploy/push.sh' \
    .

echo "🚀 Uploading to $VM_NAME..."
gcloud compute scp update.tar.gz $VM_NAME:/tmp/update.tar.gz --zone=$ZONE

echo "🔧 Extracting and restarting service on $VM_NAME..."
gcloud compute ssh $VM_NAME --zone=$ZONE --command="
    sudo tar xzf /tmp/update.tar.gz -C $APP_DIR/
    sudo chown -R $APP_USER:$APP_USER $APP_DIR
    
    # Check if venv is broken (contains Mac-style homebrew paths)
    if [ -L '$APP_DIR/venv/bin/python3' ] && ls -l '$APP_DIR/venv/bin/python3' | grep -q '/opt/homebrew'; then
        echo '⚠️  Detected broken Mac venv on server. Re-creating...'
        sudo rm -rf $APP_DIR/venv
    fi
    
    # Create venv if missing
    if [ ! -d '$APP_DIR/venv' ]; then
        echo '✨ Creating fresh Python virtual environment...'
        sudo python3 -m venv $APP_DIR/venv
        sudo chown -R $APP_USER:$APP_USER $APP_DIR/venv
    fi
    
    # Update dependencies
    echo '📥 Updating requirements...'
    sudo $APP_DIR/venv/bin/pip install --upgrade pip
    sudo $APP_DIR/venv/bin/pip install -r $APP_DIR/requirements.txt
    
    # Initialize/Migrate database if needed
    echo '🗄️  Migrating database...'
    sudo -u $APP_USER $APP_DIR/venv/bin/python3 -c \"import sys; sys.path.insert(0, '$APP_DIR'); from database import init_db; init_db()\"
    
    # Restart service
    echo '🔄 Restarting service...'
    sudo systemctl restart receipt-system
    
    echo '✅ Deployment successful!'
    sudo systemctl status receipt-system --no-pager -l | head -n 15
"

rm update.tar.gz
