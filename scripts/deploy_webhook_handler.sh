#!/bin/bash
# Deploy Exotel Webhook Handler to Mercury

set -e

echo "========================================="
echo "🚀 EXOTEL WEBHOOK HANDLER DEPLOYMENT"
echo "========================================="
echo ""

# Configuration
MERCURY_HOST="192.168.0.151"
MERCURY_USER="ubuntu"
SERVICE_DIR="/home/ubuntu/mangwale-voice/escotel-stack/exotel-service"
SERVICE_NAME="exotel-webhook"

echo "📋 Deployment Configuration:"
echo "   Server: $MERCURY_HOST"
echo "   Service Directory: $SERVICE_DIR"
echo "   Service Name: $SERVICE_NAME"
echo ""

# Check if we're on Mercury or need to deploy remotely
if [[ $(hostname -I | grep -c "$MERCURY_HOST") -gt 0 ]]; then
    echo "✅ Running on Mercury - local deployment"
    IS_LOCAL=true
else
    echo "📡 Running remotely - will deploy via SSH"
    IS_LOCAL=false
fi

# Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."
if [ "$IS_LOCAL" = true ]; then
    pip3 install fastapi uvicorn asyncpg minio soundfile librosa numpy aiohttp --quiet
else
    ssh $MERCURY_USER@$MERCURY_HOST "pip3 install fastapi uvicorn asyncpg minio soundfile librosa numpy aiohttp --quiet"
fi
echo "✅ Dependencies installed"

# Copy service file
echo ""
echo "📁 Copying service files..."
if [ "$IS_LOCAL" = false ]; then
    # Copy webhook handler
    scp /home/ubuntu/mangwale-voice/escotel-stack/exotel-service/exotel_webhook_handler.py \
        $MERCURY_USER@$MERCURY_HOST:$SERVICE_DIR/
    
    # Copy systemd service file
    scp /home/ubuntu/mangwale-voice/escotel-stack/exotel-webhook.service \
        $MERCURY_USER@$MERCURY_HOST:/tmp/
fi
echo "✅ Files copied"

# Create database table if not exists
echo ""
echo "🗄️  Creating database table..."
ssh jupiter@192.168.0.156 "psql -U headless headless_mangwale -c \"
CREATE TABLE IF NOT EXISTS call_recordings (
    id SERIAL PRIMARY KEY,
    call_sid VARCHAR(255) UNIQUE NOT NULL,
    recording_url TEXT,
    minio_url TEXT NOT NULL,
    duration INTEGER,
    from_number VARCHAR(50),
    to_number VARCHAR(50),
    transcript TEXT,
    language VARCHAR(10),
    confidence FLOAT,
    quality_score FLOAT,
    label_studio_task_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    annotation_completed BOOLEAN DEFAULT FALSE,
    training_dataset_exported BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_call_sid ON call_recordings(call_sid);
CREATE INDEX IF NOT EXISTS idx_call_recordings_quality ON call_recordings(quality_score);
CREATE INDEX IF NOT EXISTS idx_call_recordings_created_at ON call_recordings(created_at);

GRANT ALL ON call_recordings TO headless;
GRANT ALL ON call_recordings_id_seq TO headless;
\" 2>&1" || echo "⚠️  Table might already exist"
echo "✅ Database table ready"

# Install and start systemd service
echo ""
echo "⚙️  Installing systemd service..."

if [ "$IS_LOCAL" = true ]; then
    sudo cp /home/ubuntu/mangwale-voice/escotel-stack/exotel-webhook.service /etc/systemd/system/
else
    ssh $MERCURY_USER@$MERCURY_HOST "sudo mv /tmp/exotel-webhook.service /etc/systemd/system/"
fi

# Reload systemd and start service
COMMANDS="
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
sudo systemctl restart $SERVICE_NAME
sleep 3
sudo systemctl status $SERVICE_NAME --no-pager
"

if [ "$IS_LOCAL" = true ]; then
    eval "$COMMANDS"
else
    ssh $MERCURY_USER@$MERCURY_HOST "$COMMANDS"
fi

echo ""
echo "✅ Service installed and started"

# Check health
echo ""
echo "🏥 Health Check..."
sleep 2
HEALTH=$(curl -s http://192.168.0.151:3150/health 2>&1 || echo "ERROR")
if [[ "$HEALTH" == *"healthy"* ]]; then
    echo "✅ Webhook handler is healthy!"
else
    echo "⚠️  Health check returned: $HEALTH"
fi

echo ""
echo "========================================="
echo "✅ DEPLOYMENT COMPLETE!"
echo "========================================="
echo ""
echo "📊 Service Information:"
echo "   Webhook URL: http://192.168.0.151:3150/webhook/exotel/recording"
echo "   Health Check: http://192.168.0.151:3150/health"
echo "   Service Status: sudo systemctl status exotel-webhook"
echo ""
echo "📝 NEXT STEPS:"
echo ""
echo "1. Get Label Studio API Key:"
echo "   - Login: http://192.168.0.156:8080"
echo "   - Go to: Account & Settings → API Token"
echo "   - Copy token"
echo ""
echo "2. Update Service with API Key:"
echo "   sudo nano /etc/systemd/system/exotel-webhook.service"
echo "   Set: Environment=\"LABEL_STUDIO_API_KEY=your_token_here\""
echo "   Then: sudo systemctl daemon-reload && sudo systemctl restart exotel-webhook"
echo ""
echo "3. Configure Exotel Webhook:"
echo "   - Login: https://my.exotel.com"
echo "   - Settings → Webhooks"
echo "   - Add Recording Webhook:"
echo "     URL: http://192.168.0.151:3150/webhook/exotel/recording"
echo "     Method: POST"
echo "     Event: recording.completed"
echo ""
echo "4. Test with Sample Call:"
echo "   Make a test call with recording enabled"
echo "   Check logs: sudo journalctl -u exotel-webhook -f"
echo ""
echo "📁 View Logs:"
echo "   sudo journalctl -u exotel-webhook -f"
echo ""
echo "🔄 Restart Service:"
echo "   sudo systemctl restart exotel-webhook"
echo ""
echo "⚠️  IMPORTANT: Set LABEL_STUDIO_API_KEY before testing!"
echo ""
