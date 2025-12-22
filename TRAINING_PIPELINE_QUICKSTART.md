# 🚀 MANGWALE VOICE - TRAINING PIPELINE QUICK START

**Status**: Label Studio Running ✅ | Webhook Handler Ready ✅ | Database Ready ✅  
**Time to Deploy**: 15 minutes  
**Date**: December 19, 2025

---

## 📋 OVERVIEW

Automated pipeline: **Exotel Call** → **Recording** → **MinIO Storage** → **Auto-Transcribe** → **Label Studio** → **Training Dataset** → **Model Fine-tuning**

### What's Ready:
- ✅ Label Studio (v1.21.0) running on Jupiter:8080
- ✅ MinIO storage with 3 buckets (voice-audio, call-recordings, training-data)
- ✅ Faster-Whisper ASR on Mercury:7001
- ✅ PostgreSQL on Jupiter:5432
- ✅ Webhook handler code ready
- ✅ Annotation templates created
- ✅ Deployment scripts ready

### What We'll Setup (15 min):
1. Label Studio annotation projects (3 min)
2. Webhook handler deployment (5 min)
3. Exotel webhook configuration (2 min)
4. Test recording pipeline (5 min)

---

## 🎯 STEP 1: SETUP LABEL STUDIO PROJECTS (3 min)

### 1.1 Get API Token

```bash
# Open Label Studio
http://192.168.0.156:8080

# Login credentials (if needed):
# Check existing docker compose for credentials
```

**Get your API token:**
1. Click your profile (top right)
2. Go to "Account & Settings"
3. Copy the **API Token**

### 1.2 Create Projects

```bash
cd /home/ubuntu/mangwale-voice/scripts

# Edit script and add your API token
nano setup_label_studio_projects.py
# Set: API_KEY = "your_token_here"  (around line 14)

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

**Projects created:**
- **ASR Transcription Review** - Correct auto-generated transcripts
- **TTS Quality Rating** - Rate synthesized speech quality (MOS scores)

### 1.3 Verify Projects

```bash
# Check projects
curl -H "Authorization: Token YOUR_TOKEN" \
     http://192.168.0.156:8080/api/projects | jq '.results[] | {id, title}'
```

---

## 🚀 STEP 2: DEPLOY WEBHOOK HANDLER (5 min)

The webhook handler automatically:
1. Downloads recordings from Exotel
2. Uploads to MinIO
3. Transcribes with Faster-Whisper
4. Calculates audio quality
5. Creates Label Studio annotation tasks
6. Saves metadata to database

### 2.1 Update Service Configuration

```bash
# Edit the service file
nano /home/ubuntu/mangwale-voice/escotel-stack/exotel-webhook.service

# Update this line with your Label Studio API token:
Environment="LABEL_STUDIO_API_KEY=your_token_here"

# Update ASR_PROJECT_ID if different from 1:
Environment="ASR_PROJECT_ID=1"
```

### 2.2 Deploy to Mercury

```bash
cd /home/ubuntu/mangwale-voice/scripts

# Run deployment script
./deploy_webhook_handler.sh
```

**What it does:**
- Installs Python dependencies on Mercury
- Creates `call_recordings` database table
- Copies webhook handler to Mercury
- Installs as systemd service
- Starts the service
- Runs health check

**Expected output:**
```
✅ Dependencies installed
✅ Files copied
✅ Database table ready
✅ Service installed and started
✅ Webhook handler is healthy!

Webhook URL: http://192.168.0.151:3150/webhook/exotel/recording
```

### 2.3 Verify Service

```bash
# Check service status
ssh ubuntu@192.168.0.151 "sudo systemctl status exotel-webhook"

# Check health
curl http://192.168.0.151:3150/health

# View logs
ssh ubuntu@192.168.0.151 "sudo journalctl -u exotel-webhook -f"
```

---

## 📞 STEP 3: CONFIGURE EXOTEL WEBHOOK (2 min)

### 3.1 Login to Exotel Dashboard

```
URL: https://my.exotel.com
```

### 3.2 Add Recording Webhook

1. Navigate to: **Settings** → **Webhooks**
2. Click: **Add Webhook**
3. Configure:
   - **Name**: Mangwale Voice Training
   - **URL**: `http://192.168.0.151:3150/webhook/exotel/recording`
   - **Method**: POST
   - **Event**: recording.completed
   - **Format**: JSON

4. **Save**

### 3.3 Enable Recording on Calls

When making calls via Exotel API, add:
```json
{
  "Record": true,
  "RecordingStatusCallback": "http://192.168.0.151:3150/webhook/exotel/recording"
}
```

Or update your current call flow to enable recording.

---

## 🧪 STEP 4: TEST THE PIPELINE (5 min)

### 4.1 Make a Test Call

**Option A: Via API**
```bash
curl -X POST https://api.exotel.com/v1/Accounts/{EXOTEL_SID}/Calls/connect \
  -u {API_KEY}:{API_TOKEN} \
  -d "From=YOUR_PHONE" \
  -d "To=VENDOR_PHONE" \
  -d "CallerId=EXOTEL_NUMBER" \
  -d "Record=true" \
  -d "RecordingStatusCallback=http://192.168.0.151:3150/webhook/exotel/recording"
```

**Option B: Via Dashboard**
- Use Exotel dashboard to initiate a test call
- Make sure recording is enabled

### 4.2 Monitor Webhook Processing

```bash
# Watch webhook logs in real-time
ssh ubuntu@192.168.0.151 "sudo journalctl -u exotel-webhook -f"
```

**Expected log flow:**
```
INFO: Received webhook for call: CAxxxxxx
INFO: Downloaded recording: 45 seconds
INFO: Uploaded to MinIO: call-recordings/CAxxxxxx.wav
INFO: Transcription started...
INFO: Transcription complete: "नमस्ते, मैं आपकी मदद कर सकता हूं"
INFO: Quality score: 0.85
INFO: Created Label Studio task: 42
INFO: Saved to database
INFO: Processing complete in 2.3s
```

### 4.3 Verify in Label Studio

```bash
# Open Label Studio
http://192.168.0.156:8080/projects/1

# You should see:
# - New task with audio file
# - Auto-generated transcript
# - Quality/confidence scores
```

### 4.4 Check Database

```bash
# Connect to database
ssh jupiter@192.168.0.156
psql -U headless headless_mangwale

# Query recordings
SELECT call_sid, duration, language, confidence, quality_score, created_at
FROM call_recordings
ORDER BY created_at DESC
LIMIT 5;

# Check MinIO
SELECT minio_url FROM call_recordings WHERE call_sid = 'YOUR_CALL_SID';
```

---

## ✅ SUCCESS CRITERIA

After completing setup, you should have:

- [x] Label Studio accessible at http://192.168.0.156:8080
- [x] ASR and TTS projects created
- [x] Webhook handler running: `systemctl status exotel-webhook`
- [x] Health check passing: `curl http://192.168.0.151:3150/health`
- [x] Exotel webhook configured
- [x] Test call recorded and processed
- [x] Annotation task created in Label Studio
- [x] Database entry created

---

## 📊 MONITORING & MAINTENANCE

### Check System Health

```bash
# Label Studio
curl http://192.168.0.156:8080/api/version

# Webhook Handler
curl http://192.168.0.151:3150/health

# MinIO
curl http://192.168.0.156:9002/minio/health/live

# Database
ssh jupiter "psql -U headless headless_mangwale -c 'SELECT COUNT(*) FROM call_recordings;'"
```

### View Logs

```bash
# Webhook handler
ssh ubuntu@192.168.0.151 "sudo journalctl -u exotel-webhook -f"

# Label Studio
ssh jupiter "docker logs -f mangwale_labelstudio"

# Exotel service (main)
ssh ubuntu@192.168.0.151 "docker logs -f exotel-service"
```

### Daily Metrics

```bash
# Recordings today
ssh jupiter "psql -U headless headless_mangwale -c \"
SELECT 
  DATE(created_at) as date,
  COUNT(*) as recordings,
  AVG(quality_score) as avg_quality,
  AVG(confidence) as avg_confidence
FROM call_recordings
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY DATE(created_at);
\""

# Annotation progress
curl -H "Authorization: Token YOUR_TOKEN" \
     "http://192.168.0.156:8080/api/projects/1/tasks?page_size=1" | \
     jq '.count'
```

---

## 🚨 TROUBLESHOOTING

### Webhook Not Receiving Calls

```bash
# Check service is running
ssh ubuntu@192.168.0.151 "sudo systemctl status exotel-webhook"

# Check port is open
curl http://192.168.0.151:3150/health

# Check Exotel webhook logs on their dashboard
# Settings → Webhooks → View Logs
```

### Transcription Failing

```bash
# Check Faster-Whisper is running
curl http://192.168.0.151:7001/health

# Check webhook logs for ASR errors
ssh ubuntu@192.168.0.151 "sudo journalctl -u exotel-webhook | grep -i 'transcription\|asr\|error'"
```

### Label Studio Tasks Not Created

```bash
# Verify API key is set
ssh ubuntu@192.168.0.151 "sudo systemctl cat exotel-webhook | grep LABEL_STUDIO_API_KEY"

# Test Label Studio API manually
curl -H "Authorization: Token YOUR_TOKEN" \
     http://192.168.0.156:8080/api/projects/1
```

### Database Connection Issues

```bash
# Test database connection
ssh jupiter "psql -U headless headless_mangwale -c 'SELECT 1;'"

# Check credentials in webhook service
ssh ubuntu@192.168.0.151 "sudo systemctl cat exotel-webhook | grep POSTGRES"
```

---

## 📈 NEXT PHASE: ANNOTATION & TRAINING

Once recordings are flowing:

### Week 1: Data Collection
- **Goal**: 50+ recordings with quality > 0.7
- **Action**: Monitor daily, adjust quality thresholds
- **Output**: Baseline dataset ready

### Week 2: Annotation
- **Goal**: Annotate 50 samples
- **Action**: Train annotators, define guidelines
- **Output**: Gold standard annotations

### Week 3-4: Model Training
- **Goal**: Fine-tune ASR/TTS models
- **Action**: Export dataset, run training scripts
- **Output**: v1.1 models ready

### Week 5: A/B Testing
- **Goal**: Deploy and compare models
- **Action**: Monitor WER/MOS improvements
- **Output**: Production-ready models

---

## 📝 QUICK REFERENCE

| Component | URL | Port | Health Check |
|-----------|-----|------|--------------|
| Label Studio | http://192.168.0.156:8080 | 8080 | `/api/version` |
| Webhook Handler | http://192.168.0.151:3150 | 3150 | `/health` |
| MinIO | http://192.168.0.156:9002 | 9002 | `/minio/health/live` |
| Faster-Whisper | http://192.168.0.151:7001 | 7001 | `/health` |
| PostgreSQL | 192.168.0.156 | 5432 | `psql -c 'SELECT 1'` |

### Service Management

```bash
# Webhook Handler (Mercury)
sudo systemctl status exotel-webhook
sudo systemctl restart exotel-webhook
sudo systemctl stop exotel-webhook
sudo journalctl -u exotel-webhook -f

# Label Studio (Jupiter)
ssh jupiter "docker ps | grep labelstudio"
ssh jupiter "docker logs -f mangwale_labelstudio"
ssh jupiter "docker restart mangwale_labelstudio"
```

### API Examples

```bash
# Get Label Studio projects
curl -H "Authorization: Token YOUR_TOKEN" \
     http://192.168.0.156:8080/api/projects

# Get recording details
curl http://192.168.0.151:3150/recordings/CAxxxxxx

# Submit test webhook
curl -X POST http://192.168.0.151:3150/webhook/exotel/recording \
  -H "Content-Type: application/json" \
  -d '{
    "RecordingSid": "test123",
    "RecordingUrl": "https://example.com/recording.wav",
    "CallSid": "CAtest123",
    "Duration": "45",
    "From": "+919876543210",
    "To": "+919123456789"
  }'
```

---

## 🎓 TRAINING RESOURCES

### For Annotators:
- [Label Studio Guide](https://labelstud.io/guide/)
- ASR Annotation Guidelines: `/home/ubuntu/mangwale-voice/docs/asr_guidelines.md`
- TTS Rating Guidelines: `/home/ubuntu/mangwale-voice/docs/tts_guidelines.md`

### For Developers:
- [Exotel API Docs](https://developer.exotel.com/)
- [Faster-Whisper](https://github.com/guillaumekln/faster-whisper)
- [MinIO Python SDK](https://min.io/docs/minio/linux/developers/python/minio-py.html)

---

## 📞 SUPPORT

### Log Locations:
- Webhook: `sudo journalctl -u exotel-webhook -f`
- Label Studio: `docker logs -f mangwale_labelstudio`
- Database: `/var/log/postgresql/`

### Common Commands:
```bash
# Full system status
ssh jupiter "docker ps --format 'table {{.Names}}\t{{.Status}}'"
ssh ubuntu@192.168.0.151 "sudo systemctl status exotel-webhook"

# Restart everything
ssh jupiter "docker restart mangwale_labelstudio"
ssh ubuntu@192.168.0.151 "sudo systemctl restart exotel-webhook"

# Check disk space
ssh jupiter "df -h"
du -sh /data/label-studio/*
```

---

**Last Updated**: December 19, 2025  
**Status**: ✅ Ready to Deploy  
**Estimated Setup Time**: 15 minutes  
**Support**: Check logs and documentation above
