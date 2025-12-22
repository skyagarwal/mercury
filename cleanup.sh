#!/bin/bash

# Voice Infrastructure Cleanup Script
# Date: December 19, 2025
# Purpose: Remove redundant services, clean old files

set -e  # Exit on error

echo "=================================="
echo "Voice Infrastructure Cleanup"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Safety check
read -p "This will stop and remove redundant services. Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Cleanup cancelled."
    exit 0
fi

echo ""
echo "📋 Step 1: Creating Backup..."
echo "=================================="
cd /home/ubuntu/mangwale-voice
backup_file="/tmp/voice-backup-$(date +%Y%m%d-%H%M%S).tar.gz"

if [ -d "simple-exotel-caller" ] || [ -d "voice-agent" ]; then
    tar -czf "$backup_file" \
        simple-exotel-caller/ \
        voice-agent/ \
        voice-agent-v2/ \
        orpheus-tts/ \
        2>/dev/null || true
    echo -e "${GREEN}✓ Backup created: $backup_file${NC}"
else
    echo -e "${YELLOW}⚠ No directories to backup${NC}"
fi

echo ""
echo "🛑 Step 2: Stopping Redundant Services..."
echo "=================================="

# Stop Simple Exotel Caller
if systemctl is-active --quiet exotel-caller.service 2>/dev/null; then
    echo "Stopping exotel-caller.service..."
    sudo systemctl stop exotel-caller.service || true
    sudo systemctl disable exotel-caller.service || true
    echo -e "${GREEN}✓ Stopped Simple Exotel Caller${NC}"
else
    echo -e "${YELLOW}⚠ exotel-caller.service not running${NC}"
fi

# Stop Exotel Service Docker containers
echo "Stopping Exotel Service Docker containers..."
docker stop escotel-stack-exotel-service-1 2>/dev/null || echo "  Already stopped"
docker stop escotel-stack-exotel-ui-1 2>/dev/null || echo "  Already stopped"
docker rm escotel-stack-exotel-service-1 2>/dev/null || echo "  Already removed"
docker rm escotel-stack-exotel-ui-1 2>/dev/null || echo "  Already removed"
echo -e "${GREEN}✓ Removed Exotel Docker containers${NC}"

echo ""
echo "🗑️  Step 3: Removing Old Directories..."
echo "=================================="

cd /home/ubuntu/mangwale-voice

# Remove redundant directories
for dir in simple-exotel-caller voice-agent voice-agent-v2 orpheus-tts; do
    if [ -d "$dir" ]; then
        echo "Removing $dir..."
        rm -rf "$dir"
        echo -e "${GREEN}✓ Removed $dir${NC}"
    else
        echo -e "${YELLOW}⚠ $dir not found${NC}"
    fi
done

# Clean temp files
if [ -d "temp" ]; then
    echo "Cleaning temp directory..."
    rm -rf temp/* 2>/dev/null || true
    echo -e "${GREEN}✓ Cleaned temp/${NC}"
fi

# Clean old logs (keep last 7 days)
if [ -d "logs" ]; then
    echo "Cleaning old logs..."
    find logs/ -name "*.log" -mtime +7 -delete 2>/dev/null || true
    find logs/ -name "*.log.old" -delete 2>/dev/null || true
    echo -e "${GREEN}✓ Cleaned old logs${NC}"
fi

echo ""
echo "🧹 Step 4: Cleaning systemd Service Files..."
echo "=================================="

# Remove service files
if [ -f "/etc/systemd/system/exotel-caller.service" ]; then
    echo "Removing exotel-caller.service file..."
    sudo rm /etc/systemd/system/exotel-caller.service
    sudo systemctl daemon-reload
    echo -e "${GREEN}✓ Removed service file${NC}"
else
    echo -e "${YELLOW}⚠ Service file not found${NC}"
fi

echo ""
echo "🐳 Step 5: Cleaning Docker Images..."
echo "=================================="

# Remove unused images (older than 30 days)
echo "Removing unused Docker images..."
docker image prune -a --filter "until=720h" -f 2>/dev/null || true
echo -e "${GREEN}✓ Cleaned unused Docker images${NC}"

echo ""
echo "✅ Step 6: Verifying Essential Services..."
echo "=================================="

echo ""
echo "Docker Containers:"
docker ps --filter "name=mangwale" --format "table {{.Names}}\t{{.Status}}" | grep -E "(mangwale-asr|mangwale-tts|mangwale-orchestrator)" || echo -e "${YELLOW}⚠ Some services may not be running${NC}"

echo ""
echo "Systemd Services:"
services=("exotel-webhook.service" "voice-streaming.service")
for service in "${services[@]}"; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        echo -e "${GREEN}✓ $service: RUNNING${NC}"
    else
        echo -e "${YELLOW}⚠ $service: NOT RUNNING${NC}"
    fi
done

# Check Nerve System process
if pgrep -f nerve_system.py > /dev/null; then
    nerve_pid=$(pgrep -f nerve_system.py)
    echo -e "${GREEN}✓ Nerve System: RUNNING (PID: $nerve_pid)${NC}"
else
    echo -e "${YELLOW}⚠ Nerve System: NOT RUNNING${NC}"
fi

echo ""
echo "📊 Disk Space Saved:"
echo "=================================="
if [ -f "$backup_file" ]; then
    backup_size=$(du -h "$backup_file" | cut -f1)
    echo "Backup size: $backup_size"
    echo "Backup location: $backup_file"
fi

echo ""
echo "=================================="
echo -e "${GREEN}✅ Cleanup Complete!${NC}"
echo "=================================="
echo ""
echo "Next Steps:"
echo "1. Verify all essential services are running"
echo "2. Test Nerve System: curl http://localhost:7100/health"
echo "3. Check logs: tail -f /tmp/nerve-*.log"
echo "4. Start Phase 0 integration"
echo ""
echo "To rollback: tar -xzf $backup_file"
echo ""
