# Mangwale Voice Stack Status Report
**Date:** December 16, 2025  
**Version:** 2.0.0

## 🟢 Service Status

| Service | Port | Status | Notes |
|---------|------|--------|-------|
| ASR (Faster-Whisper) | 7000 | ✅ Healthy | Hindi/English transcription |
| TTS (XTTS) | 8010 | ✅ Working | Reference wav required |
| Voice Gateway | 7100/7101 | ✅ Healthy | WebSocket real-time voice |
| Voice Agent v1 | 8090 | ✅ Healthy | Basic agent |
| **Voice Agent v2** | 8091 | ✅ Healthy | Multi-agent with tools |
| Exotel Service | 3100 | ✅ Running | Telephony integration |

## 🤖 Voice Agent v2 Features

### Agent Types
| Type | Description |
|------|-------------|
| `food` | Food ordering from local restaurants |
| `parcel` | Local parcel delivery booking |
| `ecom` | E-commerce shopping |
| `support` | Customer support & issues |
| `general` | General queries |

### Available Tools
- `search_restaurants` - Find nearby restaurants
- `place_order` - Place food orders
- `track_order` - Track order status
- `book_parcel` - Book parcel delivery
- `get_user_profile` - Get customer profile

### API Endpoints
```
GET  /health              - Health check
GET  /agents              - List agent types
GET  /tools               - List available tools
POST /sessions            - Create conversation session
GET  /sessions/{id}       - Get session state
POST /chat                - Text-based chat
POST /transcribe          - Audio transcription
POST /speak               - Text-to-speech (TTS issue)
WS   /ws/{session_id}     - Real-time voice WebSocket
```

## 💬 Chat Example

```bash
# Create session
SESSION=$(curl -s -X POST "http://localhost:8091/sessions?agent_type=food&language=hi" | jq -r '.session_id')

# Chat
curl -X POST http://localhost:8091/chat \
  -H "Content-Type: application/json" \
  -d '{"text": "Namaste, mujhe pizza chahiye", "session_id": "'$SESSION'"}'

# Response:
# {
#   "text": "Namaste! Kya apko spesial flavor ya size ki pizza chahiye?",
#   "session_id": "...",
#   "state": "speaking"
# }
```

## 🔧 LLM Backend

- **Model:** Qwen/Qwen2.5-7B-Instruct-AWQ
- **Server:** vLLM on Jupiter (192.168.0.156:8002)
- **GPU:** RTX 3060 12GB

## ⚠️ Notes

### TTS Reference Files
The XTTS service requires reference wav files for voice cloning:
- `/app/models/ref_hi.wav` - Hindi reference voice
- `/app/models/ref_en.wav` - English reference voice

These are mounted from `./models/xtts/` on the host.

## 🚀 Quick Start

```bash
# Start all services
cd /home/ubuntu/mangwale-voice
docker compose up -d

# Check status
docker compose ps

# Test Voice Agent v2
curl http://localhost:8091/health

# Create session and chat
SESSION=$(curl -s -X POST "http://localhost:8091/sessions?agent_type=general&language=hi" | jq -r '.session_id')
curl -X POST http://localhost:8091/chat -H "Content-Type: application/json" \
  -d "{\"text\": \"Hello\", \"session_id\": \"$SESSION\"}"
```

## 📊 Resource Usage

```bash
# GPU Memory: ~5.8GB used / 12GB total
# Services running: 5 containers
# Network: mangwale_voice_network
```

## 🔗 Integration Points

- **MangwaleAI (Jupiter):** 192.168.0.156:3200
- **vLLM API:** 192.168.0.156:8002/v1
- **Redis (Sessions):** 192.168.0.156:6381
- **PostgreSQL:** 192.168.0.156:5432
