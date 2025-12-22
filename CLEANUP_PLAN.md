# Voice Infrastructure Cleanup Plan

**Date:** December 19, 2025
**Goal:** Remove redundant services, old files, keep only essentials

---

## 🔍 Current Mess Analysis

### Redundant Voice Services (OVERLAPPING)
1. **Nerve System** (Port 7100, systemd) - ✅ KEEP (main orchestrator)
2. **Simple Exotel Caller** (Port 3151, systemd) - ❌ REMOVE (redundant alternative)
3. **Exotel Service** (Port 3100, Docker) - ❌ REMOVE (old version, redundant)
4. **Exotel UI** (Port 3101, Docker) - ❌ REMOVE (not needed)

### Essential Services (KEEP)
1. **TTS Service** (Port 7002, Docker: mangwale-tts) - ✅ KEEP
2. **ASR Service** (Port 7001, Docker: mangwale-asr) - ✅ KEEP
3. **Orchestrator** (Port 7000, Docker: mangwale-orchestrator) - ✅ KEEP
4. **Voice Streaming** (systemd) - ✅ KEEP (WebSocket gateway)
5. **Exotel Webhook Handler** (systemd) - ✅ KEEP (recording webhooks)

### Old Directories (CHECK & CLEAN)
```
/home/ubuntu/mangwale-voice/
├── simple-exotel-caller/       - ❌ REMOVE (redundant)
├── voice-agent/                - ❌ REMOVE (old version)
├── voice-agent-v2/             - ❌ REMOVE (old version)
├── orpheus-tts/                - ❌ REMOVE (using Indic Parler)
├── streaming-asr/              - ⚠️ EVALUATE (may be used by Voice Streaming)
├── voice-gateway/              - ⚠️ EVALUATE (may be Voice Streaming Service)
├── temp/                       - ✅ CLEAN (temporary files)
├── logs/                       - ✅ CLEAN (old logs)
└── escotel-stack/              - ✅ KEEP (main stack)
```

---

## 📋 Cleanup Steps

### Step 1: Stop Redundant Services
```bash
# Stop Simple Exotel Caller
sudo systemctl stop exotel-caller.service
sudo systemctl disable exotel-caller.service

# Stop Exotel Service + UI (Docker)
docker stop escotel-stack-exotel-service-1
docker stop escotel-stack-exotel-ui-1
docker rm escotel-stack-exotel-service-1
docker rm escotel-stack-exotel-ui-1
```

### Step 2: Remove Old Directories
```bash
cd /home/ubuntu/mangwale-voice

# Backup first (just in case)
tar -czf /tmp/voice-backup-$(date +%Y%m%d).tar.gz \
  simple-exotel-caller/ \
  voice-agent/ \
  voice-agent-v2/ \
  orpheus-tts/

# Remove redundant directories
rm -rf simple-exotel-caller/
rm -rf voice-agent/
rm -rf voice-agent-v2/
rm -rf orpheus-tts/

# Clean temp and logs
rm -rf temp/*
rm -f logs/*.log.old
find logs/ -name "*.log" -mtime +7 -delete  # Keep last 7 days
```

### Step 3: Clean Old systemd Services
```bash
# Remove Simple Exotel Caller service file
sudo rm /etc/systemd/system/exotel-caller.service

# Reload systemd
sudo systemctl daemon-reload
```

### Step 4: Clean Docker Images
```bash
# Remove unused Docker images
docker image prune -a --filter "until=720h"  # 30 days old

# Remove old Exotel images
docker images | grep exotel | awk '{print $3}' | xargs docker rmi -f
```

### Step 5: Verify Essential Services Still Running
```bash
# Check Docker containers (should have 5 voice services)
docker ps --filter "name=mangwale" --format "table {{.Names}}\t{{.Status}}"

# Check systemd services
systemctl status nerve-system.service
systemctl status exotel-webhook.service
systemctl status voice-streaming.service

# Check GPU services
nvidia-smi
```

---

## ✅ Expected Final State

### Running Services (7 total)
1. **Nerve System** (Port 7100) - Main voice orchestrator
2. **TTS Service** (Port 7002) - Text-to-Speech
3. **ASR Service** (Port 7001) - Speech-to-Text
4. **Orchestrator** (Port 7000) - Coordination
5. **Voice Streaming** - WebSocket gateway
6. **Exotel Webhook Handler** - Recording webhooks
7. **Supporting Services** (Postgres, Redis, RabbitMQ, Backend)

### Clean Directory Structure
```
/home/ubuntu/mangwale-voice/
├── escotel-stack/              - Main voice stack
│   ├── exotel-service/         - Nerve System
│   ├── backend/                - NestJS backend
│   ├── admin-frontend/         - Admin UI
│   └── docker-compose.yml
├── faster-whisper-asr/         - ASR Docker
├── indic-parler-tts/           - TTS Docker
├── models/                     - ML models
├── logs/                       - Recent logs only
└── config/                     - Configuration files
```

---

## 🚨 Rollback Plan

If something breaks:
```bash
# Restore backup
cd /home/ubuntu/mangwale-voice
tar -xzf /tmp/voice-backup-$(date +%Y%m%d).tar.gz

# Restart services
sudo systemctl start exotel-caller.service
docker start escotel-stack-exotel-service-1
docker start escotel-stack-exotel-ui-1
```

---

## 📊 Disk Space Savings

**Before Cleanup:** ~15-20GB
**After Cleanup:** ~8-10GB
**Space Freed:** ~7-10GB

---

*Ready to execute? Run the cleanup script next.*
