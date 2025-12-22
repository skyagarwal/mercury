# ✅ DEPLOYMENT PROGRESS - December 19, 2025

## COMPLETED ✅

### 1. Infrastructure Verified
- ✅ Label Studio running on Jupiter:8080 (v1.21.0)
- ✅ MinIO accessible (192.168.0.156:9002)
- ✅ PostgreSQL accessible (Jupiter)
- ✅ Faster-Whisper ASR operational (Mercury:7001)

### 2. Database Setup
- ✅ `call_recordings` table created
- ✅ Indexes created (call_sid, quality_score, created_at)
- ✅ Correct credentials configured (mangwale_config user)

### 3. Webhook Handler Deployed
- ✅ Virtual environment created
- ✅ All dependencies installed (fastapi, uvicorn, asyncpg, minio, etc.)
- ✅ Systemd service installed
- ✅ Service running and healthy
- ✅ **Health Check**: http://192.168.0.151:3150/health

```bash
curl http://192.168.0.151:3150/health
# Response: {"status":"healthy","service":"exotel-webhook","timestamp":"..."}
```

---

## NEXT STEPS (10 minutes)

### Step 1: Get Label Studio API Token (3 min)

1. **Open Label Studio**:
   ```
   http://192.168.0.156:8080
   ```

2. **Login** (if you need credentials, check docker logs):
   ```bash
   ssh jupiter "docker logs mangwale_labelstudio 2>&1 | grep -i 'signup\|admin\|user'"
   ```

3. **Get API Token**:
   - Click profile icon (top right)
   - Go to "Account & Settings"
   - Find "Access Token" section
   - **Copy the token**

### Step 2: Configure Webhook Service (2 min)

Once you have the token:

```bash
# Edit the service file
sudo nano /etc/systemd/system/exotel-webhook.service

# Find this line and add your token:
Environment="LABEL_STUDIO_API_KEY="

# Change to:
Environment="LABEL_STUDIO_API_KEY=YOUR_TOKEN_HERE"

# Restart service
sudo systemctl daemon-reload
sudo systemctl restart exotel-webhook

# Verify
sudo systemctl status exotel-webhook
```

### Step 3: Create Label Studio Projects (5 min)

```bash
cd /home/ubuntu/mangwale-voice/scripts

# Edit setup script with your token
nano setup_label_studio_projects.py
# Line 14: API_KEY = "YOUR_TOKEN_HERE"

# Run setup
python3 setup_label_studio_projects.py
```

**Expected output:**
```
✅ Label Studio is accessible
✅ ASR Project Created - ID: 1
✅ TTS Project Created - ID: 2
☁️  Storage connected (MinIO)
✅ SETUP COMPLETE!
```

### Step 4: Configure Exotel Webhook (2 min)

1. **Login to Exotel**: https://my.exotel.com

2. **Add Webhook**:
   - Settings → Webhooks → Add Webhook
   - **Name**: Mangwale Voice Training
   - **URL**: `http://192.168.0.151:3150/webhook/exotel/recording`
   - **Method**: POST
   - **Event**: recording.completed

3. **Save**

---

## TESTING

### Quick Test - Webhook Endpoint

```bash
# Test webhook with dummy data
curl -X POST http://192.168.0.151:3150/webhook/exotel/recording \
  -H "Content-Type: application/json" \
  -d '{
    "CallSid": "test_call_001",
    "RecordingSid": "test_rec_001",
    "RecordingUrl": "https://s3-ap-southeast-1.amazonaws.com/exotel-recordings-prod/test.mp3",
    "Duration": "30",
    "From": "+919876543210",
    "To": "+919123456789"
  }'

# Check logs
sudo journalctl -u exotel-webhook -f
```

### Check Database

```bash
# View recordings
ssh jupiter "docker exec -e PGPASSWORD='config_secure_pass_2024' mangwale_postgres psql -U mangwale_config -d headless_mangwale -c 'SELECT call_sid, duration, language, quality_score FROM call_recordings ORDER BY created_at DESC LIMIT 5;'"
```

---

## MONITORING

### Service Status
```bash
# Webhook handler
sudo systemctl status exotel-webhook
sudo journalctl -u exotel-webhook -f

# Health check
curl http://192.168.0.151:3150/health
```

### View Logs
```bash
# Real-time logs
sudo journalctl -u exotel-webhook -f

# Last 50 entries
sudo journalctl -u exotel-webhook -n 50

# Errors only
sudo journalctl -u exotel-webhook | grep -i error
```

### Database Queries
```bash
# Today's recordings
ssh jupiter "docker exec -e PGPASSWORD='config_secure_pass_2024' mangwale_postgres psql -U mangwale_config -d headless_mangwale -c \"
SELECT 
  COUNT(*) as total_recordings,
  AVG(quality_score) as avg_quality,
  AVG(confidence) as avg_confidence
FROM call_recordings 
WHERE created_at > CURRENT_DATE;
\""
```

---

## TROUBLESHOOTING

### Service Not Starting
```bash
# Check status
sudo systemctl status exotel-webhook

# View logs
sudo journalctl -u exotel-webhook -n 50

# Restart
sudo systemctl restart exotel-webhook
```

### Database Connection Issues
```bash
# Test database connection
ssh jupiter "docker exec -e PGPASSWORD='config_secure_pass_2024' mangwale_postgres psql -U mangwale_config -d headless_mangwale -c 'SELECT NOW();'"
```

### Label Studio Connection
```bash
# Test Label Studio API
curl http://192.168.0.156:8080/api/version

# With token
curl -H "Authorization: Token YOUR_TOKEN" http://192.168.0.156:8080/api/projects
```

---

## FILES CREATED

| File | Location | Purpose |
|------|----------|---------|
| Webhook Handler | `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/exotel_webhook_handler.py` | Main service |
| Virtual Environment | `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/venv/` | Python dependencies |
| Systemd Service | `/etc/systemd/system/exotel-webhook.service` | Service configuration |
| Setup Script | `/home/ubuntu/mangwale-voice/scripts/setup_label_studio_projects.py` | Creates LS projects |

---

## QUICK REFERENCE

### Services
- **Webhook Handler**: http://192.168.0.151:3150
- **Label Studio**: http://192.168.0.156:8080
- **MinIO**: http://192.168.0.156:9002

### Service Commands
```bash
sudo systemctl {status|start|stop|restart} exotel-webhook
sudo journalctl -u exotel-webhook -f
```

### Database
```bash
# Connect
ssh jupiter "docker exec -it -e PGPASSWORD='config_secure_pass_2024' mangwale_postgres psql -U mangwale_config -d headless_mangwale"

# Query recordings
SELECT * FROM call_recordings ORDER BY created_at DESC LIMIT 5;
```

---

## STATUS SUMMARY

✅ **Webhook Handler**: Running on Mercury:3150  
⏳ **Label Studio Projects**: Waiting for API token  
⏳ **Exotel Webhook**: Needs URL configuration  
✅ **Database**: Table created and ready  
✅ **Documentation**: All guides created  

**Next Action**: Get Label Studio API token from UI and complete Step 2 & 3 above

---

**Created**: December 19, 2025 10:38 UTC  
**Server**: Mercury (192.168.0.151)  
**Status**: Webhook Handler Deployed Successfully ✅
