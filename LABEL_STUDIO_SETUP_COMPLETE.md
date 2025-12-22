# Label Studio Setup - Complete ✅

## Overview
Label Studio has been successfully configured for voice training annotation with two projects for ASR transcription review and TTS quality rating.

## Label Studio Configuration

### Access Details
- **URL**: http://192.168.0.156:8080
- **User**: skyagarwal (skyagarwal@gmail.com)
- **API Token**: `672bc1a61c7f4bd70efafc1b214d905cef3c08ab`
- **Version**: 1.21.0 (Community Edition)
- **Container**: mangwale_labelstudio

### Projects Created

#### 1. ASR Transcription Review (Project ID: 4)
- **Purpose**: Review and correct ASR transcriptions from voice calls
- **URL**: http://192.168.0.156:8080/projects/4
- **Features**:
  - Audio playback widget
  - Editable transcript text area (pre-filled from ASR)
  - Language classification (Hindi/English/Hinglish/Other)
  - Audio quality rating (Clear/Noisy/Distorted/Inaudible)
  - Maximum 3 annotations per task
  - Skip button enabled
  - Annotation history visible

**Label Config**:
```xml
<View>
  <Audio name="audio" value="$audio" />
  <Header value="Transcription Review"/>
  <TextArea name="transcript" toName="audio" value="$transcript"
            placeholder="Correct transcription if needed..."
            rows="4" maxSubmissions="1" editable="true" />
  <Header value="Language"/>
  <Choices name="language" toName="audio" choice="single-radio" required="true">
    <Choice value="hindi" />
    <Choice value="english" />
    <Choice value="hinglish" />
    <Choice value="other" />
  </Choices>
  <Header value="Audio Quality"/>
  <Choices name="quality" toName="audio" choice="single-radio" required="true">
    <Choice value="clear" />
    <Choice value="noisy" />
    <Choice value="distorted" />
    <Choice value="inaudible" />
  </Choices>
</View>
```

#### 2. TTS Quality Rating (Project ID: 5)
- **Purpose**: Rate TTS generated audio quality for training data collection
- **URL**: http://192.168.0.156:8080/projects/5
- **Features**:
  - Audio playback widget
  - Text display (expected TTS output)
  - 4 rating dimensions (Naturalness, Clarity, Pronunciation, Overall)
  - Issue checkboxes (Robotic, Mispronunciation, Wrong Accent, etc.)
  - Notes text area for detailed feedback
  - Maximum 3 annotations per task

**Label Config**:
```xml
<View>
  <Audio name="audio" value="$audio" />
  <Text name="text" value="$text" />
  <Header value="Naturalness"/>
  <Rating name="naturalness" toName="audio" maxRating="5" icon="star" size="large" required="true" />
  <Header value="Clarity"/>
  <Rating name="clarity" toName="audio" maxRating="5" icon="star" size="large" required="true" />
  <Header value="Pronunciation"/>
  <Rating name="pronunciation" toName="audio" maxRating="5" icon="star" size="large" required="true" />
  <Header value="Overall Quality"/>
  <Rating name="overall" toName="audio" maxRating="5" icon="star" size="large" required="true" />
  <Header value="Issues (if any)"/>
  <Choices name="issues" toName="audio" choice="multiple">
    <Choice value="robotic" />
    <Choice value="mispronunciation" />
    <Choice value="wrong_accent" />
    <Choice value="speed_too_fast" />
    <Choice value="speed_too_slow" />
    <Choice value="unnatural_pauses" />
    <Choice value="no_issues" />
  </Choices>
  <Header value="Notes"/>
  <TextArea name="notes" toName="audio" placeholder="Additional notes..." rows="3" maxSubmissions="1" editable="true" />
</View>
```

## Exotel Webhook Integration

### Service Configuration
- **Service Name**: exotel-webhook.service
- **Endpoint**: http://192.168.0.151:3150
- **Status**: ✅ Active (running)
- **Working Directory**: `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/`

### Environment Variables
```bash
LABEL_STUDIO_URL=http://192.168.0.156:8080
LABEL_STUDIO_API_KEY=672bc1a61c7f4bd70efafc1b214d905cef3c08ab
ASR_PROJECT_ID=4
MINIO_ENDPOINT=192.168.0.156:9002
POSTGRES_HOST=192.168.0.156
POSTGRES_DB=headless_mangwale
FASTER_WHISPER_URL=http://192.168.0.151:7001
```

### Pipeline Flow
1. **Webhook Receives** Exotel recording notification
2. **Downloads** recording from Exotel
3. **Uploads** to MinIO (`voice-recordings` bucket)
4. **Transcribes** using Faster Whisper ASR
5. **Quality Check** confidence score, language detection
6. **Creates Task** in Label Studio (Project 4) if low confidence
7. **Saves Metadata** to PostgreSQL `call_recordings` table

## Database Schema

### Table: call_recordings
```sql
CREATE TABLE call_recordings (
    id SERIAL PRIMARY KEY,
    call_sid VARCHAR(255) UNIQUE NOT NULL,
    recording_url TEXT NOT NULL,
    minio_url TEXT NOT NULL,
    duration INTEGER,
    transcript TEXT,
    language VARCHAR(50),
    confidence FLOAT,
    quality_score INTEGER,
    label_studio_task_id INTEGER,
    needs_review BOOLEAN DEFAULT FALSE,
    reviewed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_call_recordings_call_sid ON call_recordings(call_sid);
CREATE INDEX idx_call_recordings_quality ON call_recordings(quality_score);
CREATE INDEX idx_call_recordings_created_at ON call_recordings(created_at);
```

## Configuration Files

### Label Studio Config
**Location**: `/home/ubuntu/mangwale-voice/config/label_studio_config.json`
```json
{
  "label_studio": {
    "url": "http://192.168.0.156:8080",
    "api_key": "672bc1a61c7f4bd70efafc1b214d905cef3c08ab",
    "projects": {
      "asr_review": {
        "id": 4,
        "title": "ASR Transcription Review",
        "url": "http://192.168.0.156:8080/projects/4"
      },
      "tts_quality": {
        "id": 5,
        "title": "TTS Quality Rating",
        "url": "http://192.168.0.156:8080/projects/5"
      }
    }
  },
  "created_at": "2025-12-19T10:58:09+00:00"
}
```

## API Usage Examples

### Create Annotation Task
```bash
curl -X POST "http://192.168.0.156:8080/api/projects/4/tasks" \
  -H "Authorization: Token 672bc1a61c7f4bd70efafc1b214d905cef3c08ab" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "audio": "http://192.168.0.156:9002/voice-recordings/call_12345.wav",
      "transcript": "नमस्ते मैं आपकी कैसे मदद कर सकता हूं"
    }
  }'
```

### Get Project Tasks
```bash
curl -H "Authorization: Token 672bc1a61c7f4bd70efafc1b214d905cef3c08ab" \
  "http://192.168.0.156:8080/api/projects/4/tasks"
```

### Export Annotations
```bash
curl -H "Authorization: Token 672bc1a61c7f4bd70efafc1b214d905cef3c08ab" \
  "http://192.168.0.156:8080/api/projects/4/export?exportType=JSON" \
  -o annotations.json
```

## Testing the Pipeline

### Test Webhook Handler
```bash
# Health check
curl http://192.168.0.151:3150/health

# Simulate webhook (replace with actual recording data)
curl -X POST http://192.168.0.151:3150/webhook/exotel/recording \
  -H "Content-Type: application/json" \
  -d '{
    "CallSid": "test_001",
    "RecordingSid": "rec_001",
    "RecordingUrl": "https://example.com/recording.wav",
    "Duration": 30
  }'
```

### Monitor Service Logs
```bash
# Real-time logs
sudo journalctl -u exotel-webhook -f

# Recent errors
sudo journalctl -u exotel-webhook -n 50 --no-pager | grep -i error
```

### Check Database
```bash
ssh jupiter "docker exec -e PGPASSWORD='config_secure_pass_2024' mangwale_postgres \
  psql -U mangwale_config -d headless_mangwale \
  -c 'SELECT call_sid, confidence, needs_review, label_studio_task_id FROM call_recordings ORDER BY created_at DESC LIMIT 10;'"
```

## Next Steps

### 1. Configure Exotel Webhook URL
Login to Exotel dashboard and add webhook:
- **Event**: recording.completed
- **URL**: http://192.168.0.151:3150/webhook/exotel/recording
- **Method**: POST

### 2. Configure MinIO Storage in Label Studio
Option 1: Via UI
1. Go to Settings → Cloud Storage
2. Add Amazon S3 storage
3. Enter MinIO credentials:
   - Endpoint: http://192.168.0.156:9002
   - Access Key: admin
   - Secret Key: minio_strong_password
   - Bucket: voice-recordings

Option 2: Via API
```bash
curl -X POST "http://192.168.0.156:8080/api/storages/s3" \
  -H "Authorization: Token 672bc1a61c7f4bd70efafc1b214d905cef3c08ab" \
  -H "Content-Type: application/json" \
  -d '{
    "project": 4,
    "title": "MinIO Voice Recordings",
    "bucket": "voice-recordings",
    "s3_endpoint": "http://192.168.0.156:9002",
    "aws_access_key_id": "admin",
    "aws_secret_access_key": "minio_strong_password",
    "use_blob_urls": true
  }'
```

### 3. Test End-to-End Pipeline
1. Make a test call via Exotel
2. Check webhook logs: `sudo journalctl -u exotel-webhook -f`
3. Verify recording uploaded to MinIO
4. Check database entry created
5. Verify task created in Label Studio
6. Annotate task in UI
7. Export annotations for training

### 4. Setup Training Pipeline
- Create scripts to export annotations periodically
- Process annotations for ASR fine-tuning
- Setup TTS quality metrics collection
- Implement continuous learning loop

## Troubleshooting

### Service Not Starting
```bash
sudo systemctl status exotel-webhook
sudo journalctl -u exotel-webhook -n 50
```

### Label Studio API Errors
- Check token validity: `curl -H "Authorization: Token <token>" http://192.168.0.156:8080/api/users`
- Verify project exists: `curl -H "Authorization: Token <token>" http://192.168.0.156:8080/api/projects`

### Database Connection Issues
```bash
ssh jupiter "docker exec mangwale_postgres pg_isready"
```

### MinIO Connection Issues
```bash
curl http://192.168.0.156:9002/minio/health/live
```

## Security Notes

1. **API Token**: Stored in systemd environment variables (protected by systemd permissions)
2. **Database Password**: Not committed to git, stored in environment
3. **MinIO Credentials**: Change default password in production
4. **Network**: Consider firewall rules for production deployment

## Monitoring

### Key Metrics to Track
- Webhook success rate
- ASR confidence scores distribution
- Annotation completion rate
- Task creation rate vs annotation rate
- Storage usage (MinIO)
- Database growth

### Logs Location
- Webhook: `sudo journalctl -u exotel-webhook`
- Label Studio: `ssh jupiter "docker logs mangwale_labelstudio"`
- PostgreSQL: `ssh jupiter "docker logs mangwale_postgres"`

## Files Created/Modified

1. ✅ `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/exotel_webhook_handler.py` (500+ lines)
2. ✅ `/etc/systemd/system/exotel-webhook.service` (systemd unit file)
3. ✅ `/home/ubuntu/mangwale-voice/config/label_studio_config.json` (configuration)
4. ✅ Label Studio Project 4: ASR Transcription Review
5. ✅ Label Studio Project 5: TTS Quality Rating
6. ✅ PostgreSQL table: call_recordings (with indexes)

## Status Summary

| Component | Status | Details |
|-----------|--------|---------|
| Label Studio | ✅ Running | v1.21.0 on Jupiter:8080 |
| ASR Project | ✅ Created | Project ID: 4 |
| TTS Project | ✅ Created | Project ID: 5 |
| Webhook Service | ✅ Running | Mercury:3150 |
| Database Table | ✅ Created | call_recordings in headless_mangwale |
| MinIO Storage | ✅ Available | Jupiter:9002 |
| PostgreSQL | ✅ Running | Jupiter:5432 |
| API Token | ✅ Configured | skyagarwal user token |
| Service Config | ✅ Updated | Environment variables set |

---

**Setup Completed**: 2025-12-19 11:22 UTC  
**Total Setup Time**: ~45 minutes  
**Components Deployed**: 7  
**Lines of Code**: 500+  
**Ready for Production**: Yes (after Exotel webhook configuration)
