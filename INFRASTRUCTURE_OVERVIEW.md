# 🎯 Complete Voice Infrastructure Overview - Mercury Server

**Date**: December 19, 2025
**Server**: Mercury (192.168.0.151)
**GPU**: NVIDIA RTX 3060 12GB (8GB used, 0% utilization)

---

## 🖥️ Server Architecture

### Mercury (192.168.0.151) - Voice Processing Server
- **Role**: Voice AI, TTS, ASR, Exotel Integration
- **GPU**: RTX 3060 12GB
- **Access**: Private network (behind Traefik on Jupiter)

### Jupiter (192.168.0.156) - Orchestration Server  
- **Role**: Database, API Gateway, Business Logic, Traefik
- **Public IP**: 103.184.155.61
- **Access**: Public-facing with reverse proxy

---

## 🚀 Currently Running Services

### 1. **Nerve System** ✅ RUNNING (Port 7100)
**Status**: HEALTHY
**Process**: PID 984197 (.venv/bin/python nerve_system.py)
**Purpose**: Main voice call orchestration for Exotel
**Location**: `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/`
**Config**: 
- IVR App ID: 1145356
- USE_DIRECT_CALLBACK: false
- Exotel Caller ID: 02048556923

**Components**:
- ✅ TTS Cache: 32 phrases loaded
- ✅ Exotel Client: Connected
- ✅ Jupiter Reporter: Enabled
- ✅ Active Calls: 0

**Endpoints**:
- `POST /api/nerve/vendor-order-confirmation` - Vendor calls
- `POST /api/nerve/rider-assignment` - Rider calls
- `GET /api/nerve/callback` - Exotel Passthru callback (ExoML)
- `GET /api/nerve/gather` - Programmable Gather (JSON)
- `POST /api/nerve/status` - Call status webhook
- `GET /api/nerve/audio/{audio_id}` - TTS audio files

**Call Flow**:
```
Jupiter Backend → POST /api/nerve/vendor-order-confirmation
                     ↓
              Exotel API (Call Connect)
                     ↓
              IVR App 1145356 (Dashboard Passthru)
                     ↓
              GET /api/nerve/callback (ExoML XML)
                     ↓
              Exotel Plays TTS → Collects DTMF
                     ↓
              GET /api/nerve/callback?digits=1
                     ↓
              Next ExoML step...
```

---

### 2. **TTS Service** ✅ RUNNING (Port 7002)
**Status**: HEALTHY (Docker: mangwale-tts)
**Uptime**: 28 hours
**Purpose**: Text-to-Speech synthesis (multilingual)

**Providers Available**:
- ✅ Kokoro (Fast, good quality)
- ✅ Indic Parler (Hindi, Marathi, etc.)
- ✅ ElevenLabs (Cloud API)
- ✅ Deepgram (Cloud API)

**GPU**: Available (RTX 3060)

**Endpoint**: `POST http://localhost:7002/synthesize`

---

### 3. **ASR Service** ✅ RUNNING (Port 7001)
**Status**: HEALTHY (Docker: mangwale-asr)
**Uptime**: 29 hours
**Purpose**: Speech-to-Text transcription

**Technology**: Faster Whisper

**Endpoint**: `POST http://localhost:7001/transcribe`

---

### 4. **Orchestrator** ✅ RUNNING (Port 7000)
**Status**: HEALTHY (Docker: mangwale-orchestrator)
**Uptime**: 27 hours
**Purpose**: Coordinate TTS/ASR/Voice flow

**Endpoint**: `POST http://localhost:7000/api/process`

---

### 5. **Exotel Service** ✅ RUNNING (Port 3100)
**Status**: HEALTHY (Docker: escotel-stack-exotel-service-1)
**Uptime**: 35 hours
**Purpose**: Original Exotel integration service
**Version**: v2.3.0

**Features**:
- IVR management
- Campaign management
- Communications management
- Voice ordering

**Note**: This is separate from Nerve System but uses same Exotel account

---

### 6. **Exotel UI** ✅ RUNNING (Port 3101)
**Status**: UP (Docker: escotel-stack-exotel-ui-1)
**Uptime**: 2 days
**Purpose**: Dashboard for Exotel service management

**Access**: http://192.168.0.151:3101

---

### 7. **Simple Exotel Caller** ✅ RUNNING (Port 3151)
**Status**: RUNNING (systemd: exotel-caller.service)
**Process**: PID 954512 (uvicorn)
**Purpose**: FastAPI service for simple Exotel calls
**Location**: `/home/ubuntu/mangwale-voice/simple-exotel-caller/`

**Endpoints**:
- `POST /api/call/vendor-order` - Vendor calls
- `POST /api/call/rider-notify` - Rider notifications
- `POST /webhook/exotel/status` - Status callbacks
- `GET /exoml/vendor-greeting` - ExoML responses

**Note**: Alternative to Nerve, simpler implementation

---

### 8. **Exotel Webhook Handler** ✅ RUNNING
**Status**: RUNNING (systemd: exotel-webhook.service)
**Process**: PID 936236
**Purpose**: Handle Exotel recording webhooks
**Location**: `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/`

**File**: exotel_webhook_handler.py

---

### 9. **Voice Streaming Service** ✅ RUNNING
**Status**: RUNNING
**Process**: PID 851204 (voice_streaming_service.py)
**Purpose**: Real-time voice streaming (likely for WebRTC/WebSocket)

---

### 10. **Backend Services** (Docker - escotel-stack)
- ✅ **Postgres** (Port 5432) - Database
- ✅ **Redis** (Port 6379) - Cache
- ✅ **RabbitMQ** (Multiple ports) - Message queue
- ✅ **Backend** (Port 4000) - NestJS backend
- ✅ **Admin Frontend** (Port 80) - Admin UI

---

## 📁 Directory Structure

```
/home/ubuntu/mangwale-voice/
├── escotel-stack/           # Main Exotel integration
│   ├── exotel-service/      # Nerve System + Exotel service
│   │   ├── nerve_system.py  # Main orchestrator
│   │   ├── .env             # Config (IVR_APP_ID, etc.)
│   │   └── venv/
│   ├── exotel-ui/           # Dashboard
│   ├── backend/             # NestJS backend
│   ├── admin-frontend/      # Admin UI
│   └── docker-compose.yml
│
├── simple-exotel-caller/    # Alternative simple service
│   ├── main.py
│   ├── .env
│   └── venv/
│
├── faster-whisper-asr/      # ASR (Docker)
├── indic-parler-tts/        # TTS (Docker)
├── orpheus-tts/             # Alternative TTS
├── voice-agent/             # Voice agent v1
├── voice-agent-v2/          # Voice agent v2
├── voice-gateway/           # Gateway service
├── streaming-asr/           # Real-time ASR
└── models/                  # ML models
```

---

## 🌐 Public Access (via Traefik on Jupiter)

**Domain**: exotel.mangwale.ai
**Routes** (configured in Jupiter Traefik):
- `https://exotel.mangwale.ai/api/nerve/*` → Mercury:7100 (Nerve)
- `https://exotel.mangwale.ai/` → Mercury:3100 (Exotel Service)
- `https://exotel.mangwale.ai/*` → Mercury:3101 (Exotel UI)
- `https://exotel.mangwale.ai/api/call/*` → Mercury:3151 (Simple Caller)

---

## 🔧 Exotel Configuration

### Account Details
- **Account SID**: sarvinsuppliesllp1
- **Virtual Number**: 02048556923
- **API Endpoint**: https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/

### IVR Apps
- **App ID 1145356**: Passthru applet (currently configured)
  - URL: https://exotel.mangwale.ai/api/nerve/callback
  - Purpose: Dynamic voice flows with ExoML

- **App ID 1145886**: Previous app (may still exist)

### Call Flow Type
**Currently using**: Passthru applet with ExoML

```
[Call Start] → [Passthru Applet 1145356]
                    ↓
        GET https://exotel.mangwale.ai/api/nerve/callback
                    ↓
        Returns ExoML XML with <Gather> tags
                    ↓
        Exotel plays audio, collects DTMF
                    ↓
        Calls back with digits parameter
                    ↓
        Loop continues...
```

---

## 🎤 Voice Technologies

### TTS (Text-to-Speech)
1. **Kokoro** - Fast, multilingual (primary)
2. **Indic Parler** - Indian languages (Hindi, Marathi)
3. **Orpheus** - Alternative TTS
4. **ElevenLabs** - Cloud API (backup)
5. **Deepgram** - Cloud API (backup)

### ASR (Speech-to-Text)
1. **Faster Whisper** - Primary ASR
2. **Streaming ASR** - Real-time transcription

### Voice Orchestration
1. **Nerve System** - Main (ExoML + Exotel)
2. **Voice Agent v1** - Alternative
3. **Voice Agent v2** - Newer version
4. **Orchestrator** - Docker service

---

## 📊 Current Status Summary

| Component | Status | Port | Purpose |
|-----------|--------|------|---------|
| Nerve System | ✅ RUNNING | 7100 | Main voice orchestrator |
| TTS Service | ✅ RUNNING | 7002 | Text-to-speech |
| ASR Service | ✅ RUNNING | 7001 | Speech-to-text |
| Orchestrator | ✅ RUNNING | 7000 | Coordination |
| Exotel Service | ✅ RUNNING | 3100 | Exotel integration |
| Exotel UI | ✅ RUNNING | 3101 | Dashboard |
| Simple Caller | ✅ RUNNING | 3151 | Alternative caller |
| Webhook Handler | ✅ RUNNING | - | Recording webhooks |
| Voice Streaming | ✅ RUNNING | - | Real-time streaming |

**Overall System Health**: ✅ HEALTHY

**Active Calls**: 0
**TTS Cache**: 32 phrases loaded
**GPU Usage**: 8GB / 12GB used

---

## 🔍 Key Endpoints for Testing

### Health Checks
```bash
# Nerve System
curl http://localhost:7100/health

# TTS
curl http://localhost:7002/health

# ASR  
curl http://localhost:7001/health

# Public (via Traefik)
curl https://exotel.mangwale.ai/api/nerve/callback?CallSid=test
```

### Make Test Call
```bash
curl -X POST "http://192.168.0.151:7100/api/nerve/vendor-order-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_phone": "919923383838",
    "vendor_name": "Test",
    "vendor_id": "V001",
    "order_id": 12345,
    "order_amount": 999,
    "order_details": {"items": "Test"}
  }'
```

---

## 🚨 Known Issues

1. **Storage (storage.mangwale.ai)**: Returns 502 Bad Gateway
   - TTS audio file URLs fail to load
   - Temporary fix: Using Exotel's `<Say>` TTS instead of `<Play>`

2. **Multiple Services**: Several overlapping services running
   - Nerve System (primary)
   - Simple Exotel Caller (alternative)
   - Exotel Service (Docker)
   - May need consolidation

3. **IVR App Configuration**: Just switched from 1145886 to 1145356
   - Need to verify dashboard Passthru applet is correctly configured

---

## 🎯 Next Steps

1. **Test Call with App 1145356**
   - Verify Passthru applet receives callbacks
   - Check if Hindi audio plays
   - Verify DTMF collection works

2. **Fix Storage URL**
   - Debug storage.mangwale.ai (502 error)
   - MinIO configuration issue
   - Or continue using Exotel `<Say>` TTS

3. **Consolidate Services**
   - Decide: Nerve vs Simple Caller vs Exotel Service
   - Currently all three running (redundant)

4. **Monitor Logs**
   ```bash
   tail -f /tmp/nerve-1145356.log
   ```

---

## 📞 For Support

**Nerve System Logs**: `/tmp/nerve-1145356.log`
**TTS Service**: Docker logs `docker logs mangwale-tts`
**ASR Service**: Docker logs `docker logs mangwale-asr`

**Configuration Files**:
- Nerve: `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/.env`
- Simple Caller: `/home/ubuntu/mangwale-voice/simple-exotel-caller/.env`
- Traefik: Jupiter `/home/ubuntu/Devs/Search/traefik-config/dynamic/exotel.mangwale.ai.yml`
