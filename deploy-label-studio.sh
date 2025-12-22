#!/bin/bash
# Label Studio Deployment Script for Mangwale Voice Training Pipeline
# Server: Jupiter (192.168.0.156)
# Date: December 19, 2025

set -e

echo "🚀 Deploying Label Studio for Mangwale Voice Training..."
echo "=================================================="

# Configuration
LABEL_STUDIO_DIR="/data/label-studio"
MEDIA_DIR="/data/label-studio/media"
POSTGRES_DIR="/data/postgres-label"
BACKUP_DIR="/data/backups/label-studio"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running on Jupiter
echo -e "${YELLOW}→${NC} Checking server..."
HOSTNAME=$(hostname)
if [[ "$HOSTNAME" != *"jupiter"* ]] && [[ "$HOSTNAME" != "192.168.0.156" ]]; then
    echo -e "${RED}✗${NC} This script should run on Jupiter (192.168.0.156)"
    echo "Current host: $HOSTNAME"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create directories
echo -e "${YELLOW}→${NC} Creating directories..."
sudo mkdir -p "$LABEL_STUDIO_DIR"
sudo mkdir -p "$MEDIA_DIR"
sudo mkdir -p "$POSTGRES_DIR"
sudo mkdir -p "$BACKUP_DIR"

# Set permissions
echo -e "${YELLOW}→${NC} Setting permissions..."
sudo chown -R 1001:1001 "$LABEL_STUDIO_DIR"
sudo chown -R 1001:1001 "$MEDIA_DIR"
sudo chmod -R 755 "$LABEL_STUDIO_DIR"

# Create MinIO symlink for audio files
echo -e "${YELLOW}→${NC} Linking MinIO audio storage..."
if [ -d "/data/minio/voice-audio" ]; then
    sudo ln -sf /data/minio/voice-audio "$MEDIA_DIR/voice-audio" || true
    sudo ln -sf /data/minio/call-recordings "$MEDIA_DIR/call-recordings" || true
    sudo ln -sf /data/minio/training-data "$MEDIA_DIR/training-data" || true
    echo -e "${GREEN}✓${NC} MinIO storage linked"
else
    echo -e "${YELLOW}!${NC} MinIO storage not found at /data/minio"
fi

# Check if Docker network exists
echo -e "${YELLOW}→${NC} Checking Docker network..."
if ! docker network inspect mangwale-network >/dev/null 2>&1; then
    echo -e "${YELLOW}→${NC} Creating mangwale-network..."
    docker network create mangwale-network
    echo -e "${GREEN}✓${NC} Network created"
else
    echo -e "${GREEN}✓${NC} Network exists"
fi

# Pull images
echo -e "${YELLOW}→${NC} Pulling Docker images..."
docker-compose -f docker-compose-label-studio.yml pull

# Stop existing containers
echo -e "${YELLOW}→${NC} Stopping existing containers..."
docker-compose -f docker-compose-label-studio.yml down || true

# Start services
echo -e "${YELLOW}→${NC} Starting Label Studio..."
docker-compose -f docker-compose-label-studio.yml up -d

# Wait for services
echo -e "${YELLOW}→${NC} Waiting for services to start..."
sleep 10

# Check health
echo -e "${YELLOW}→${NC} Checking service health..."
if curl -s http://localhost:8080/health >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Label Studio is running"
else
    echo -e "${RED}✗${NC} Label Studio health check failed"
    echo "Checking logs..."
    docker-compose -f docker-compose-label-studio.yml logs --tail=50 label-studio
fi

# Display status
echo ""
echo "=================================================="
echo -e "${GREEN}✓ Label Studio Deployment Complete${NC}"
echo "=================================================="
echo ""
echo "📊 Service URLs:"
echo "  Label Studio: http://192.168.0.156:8080"
echo "  Domain: http://label.mangwale.ai"
echo ""
echo "🔐 Default Credentials:"
echo "  Email: admin@mangwale.ai"
echo "  Password: mangwale_admin_2025"
echo ""
echo "📁 Data Directories:"
echo "  App Data: $LABEL_STUDIO_DIR"
echo "  Media: $MEDIA_DIR"
echo "  Database: $POSTGRES_DIR"
echo "  Backups: $BACKUP_DIR"
echo ""
echo "🔧 Management Commands:"
echo "  View logs: docker-compose -f docker-compose-label-studio.yml logs -f"
echo "  Restart: docker-compose -f docker-compose-label-studio.yml restart"
echo "  Stop: docker-compose -f docker-compose-label-studio.yml down"
echo "  Backup: ./backup-label-studio.sh"
echo ""
echo "📝 Next Steps:"
echo "  1. Login to http://192.168.0.156:8080"
echo "  2. Create ASR annotation project"
echo "  3. Create TTS quality rating project"
echo "  4. Import annotation templates"
echo "  5. Test with sample audio files"
echo ""
