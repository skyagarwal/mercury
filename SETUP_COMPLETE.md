# Mangwale AI Infrastructure - Voice Services Setup Complete

## Network Architecture

```
                              ┌─────────────────────────────────────┐
                              │         INTERNET                    │
                              │    ER605 Router (Gateway)           │
                              │         192.168.0.1                 │
                              └──────────────┬──────────────────────┘
                                             │
                 ┌───────────────────────────┼───────────────────────────┐
                 │                           │                           │
    ┌────────────▼────────────┐  ┌──────────▼───────────┐  ┌───────────▼──────────┐
    │      JUPITER            │  │      MERCURY         │  │    skylaptop         │
    │   192.168.0.156         │  │   192.168.0.151      │  │   192.168.0.146      │
    │   (Main AI Server)      │  │   (Voice Server)     │  │    (Dev Client)      │
    │                         │  │                      │  │                      │
    │ Tailscale: 100.121.40.69│  │ Tailscale: 100.117   │  │                      │
    └────────────┬────────────┘  └──────────┬───────────┘  └──────────────────────┘
                 │                          │
                 │    HTTP/WebSocket        │
                 │◄────────────────────────►│
                 │                          │
```

## Server Roles

### JUPITER (192.168.0.156) - Main AI Server
- **GPU**: RTX 3060 12GB (used by vLLM ~10.5GB)
- **RAM**: 32GB
- **Role**: Core application, LLM inference, NLU

| Service | Port | Description |
|---------|------|-------------|
| mangwale_ai_service | 3200, 3201 | Main NestJS API |
| mangwale_api_gateway | 4001 | Chat App API Gateway |
| vLLM (Qwen 2.5 7B) | 8002 | LLM Inference |
| NLU (IndicBERT) | 7010 | Intent Classification |
| PostgreSQL | 5432 | Database |
| Redis | 6379, 6381 | Cache/Sessions |
| Label Studio | 8080 | ML Annotation |
| OSRM | 5000 | Routing |
| Traefik | 80, 443 | Reverse Proxy |

### MERCURY (192.168.0.151) - Voice Server
- **GPU**: RTX 3060 12GB (used by Whisper ~3.2GB)
- **RAM**: 16GB
- **Role**: Voice processing (ASR/TTS), WebSocket streaming with multi-provider fallback

| Service | Port | Description |
|---------|------|-------------|
| mangwale_asr | 7000 | Whisper Large-v3 (ASR) |
| mangwale_tts | 8010 | XTTS v2 (TTS) |
| mangwale_voice_gateway | 7100 (WS), 7101 (HTTP) | Real-time Voice Streaming |

## Service Endpoints

### From Jupiter (Internal Network)
```bash
# Voice Services
ASR_SERVICE_URL=http://192.168.0.151:7000
TTS_SERVICE_URL=http://192.168.0.151:8010
VOICE_GATEWAY_URL=ws://192.168.0.151:7100
VOICE_GATEWAY_HTTP_URL=http://192.168.0.151:7101
```

### Via Tailscale (Remote Access)
```bash
# Voice Services
ASR_SERVICE_URL=http://100.117.131.56:7000
TTS_SERVICE_URL=http://100.117.131.56:8010
VOICE_GATEWAY_URL=ws://100.117.131.56:7100
VOICE_GATEWAY_HTTP_URL=http://100.117.131.56:7101
```

## Voice Gateway WebSocket Protocol

### Connection
```javascript
const ws = new WebSocket('ws://192.168.0.151:7100?language=hi&token=JWT_TOKEN');
```

### Message Types

**Client → Server:**
| Type | Description |
|------|-------------|
| `start_recording` | Start audio recording session |
| `stop_recording` | Stop and transcribe buffered audio |
| `transcribe` | Immediate transcription (base64 audio) |
| `speak` | Generate speech from text |
| `set_language` | Change language (hi, en, mr) |
| Binary | Audio chunk data |

**Server → Client:**
| Type | Description |
|------|-------------|
| `connected` | Session established |
| `asr_result` | Final transcription |
| `asr_partial` | Partial transcription (streaming) |
| `tts_start` | Speech generation started |
| `tts_complete` | Speech generation complete |
| Binary | Audio chunk data |
| `error` | Error message |

### Example: Text-to-Speech
```javascript
ws.send(JSON.stringify({
  type: 'speak',
  text: 'नमस्ते, मैं मंगवाले AI हूँ',
  language: 'hi',
  stream: true
}));
```

### Example: Speech-to-Text
```javascript
// Start recording
ws.send(JSON.stringify({ type: 'start_recording' }));

// Send audio chunks
ws.send(audioBuffer);  // Binary WebSocket message

// Stop and get transcription
ws.send(JSON.stringify({ type: 'stop_recording' }));
```

## Management Commands

### Mercury Voice Services
```bash
cd /home/ubuntu/mangwale-voice

# Start all services
./manage.sh start

# Stop all services
./manage.sh stop

# Check status
./manage.sh status

# View logs
./manage.sh logs -f

# Check health
./manage.sh health

# Check GPU
./manage.sh gpu
```

### Jupiter Main Services
```bash
cd /home/ubuntu/Devs/MangwaleAI/backend

# Restart with new config
docker compose restart mangwale-ai

# View logs
docker compose logs -f mangwale-ai
```

## GPU Memory Distribution

| Server | GPU | Service | Memory Used |
|--------|-----|---------|-------------|
| Jupiter | RTX 3060 | vLLM (Qwen 2.5 7B) | ~10.5GB |
| Mercury | RTX 3060 | Whisper Large-v3 | ~3.2GB |
| Mercury | RTX 3060 | XTTS v2 | ~4GB (on first use) |
| **Total** | | | Both GPUs optimally utilized |

## Testing

### Test ASR (Speech-to-Text)
```bash
curl -X POST http://192.168.0.151:7000/transcribe \
  -F "audio=@test.wav" \
  -F "language=hi"
```

### Test TTS (Text-to-Speech)
```bash
curl -X POST http://192.168.0.151:8010/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "नमस्ते", "language": "hi"}' \
  --output output.wav
```

### Test Voice Gateway Health
```bash
curl http://192.168.0.151:7101/health
curl http://192.168.0.151:7101/api/services/health
```

## Files Created on Mercury

```
/home/ubuntu/mangwale-voice/
├── docker-compose.yml          # Main compose file
├── .env                        # Environment variables
├── manage.sh                   # Management script
├── logs/                       # Service logs
│   ├── asr/
│   ├── tts/
│   └── gateway/
├── models/                     # Model storage
│   └── xtts/
└── voice-gateway/              # WebSocket gateway
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    └── src/
        └── server.ts           # Main gateway code
```

## Traefik Integration (Optional)

To expose voice services via Traefik on Jupiter, add labels to Mercury's services and connect them to Traefik network.

## Next Steps

1. **ER605 Router Configuration** (if external access needed):
   - Port forward 7100-7101 to Mercury for WebSocket access
   - Or use Tailscale for secure remote access

2. **Frontend Integration**:
   - Use the VoiceClient example in `/home/ubuntu/mangwale-voice/examples/`
   - Integrate with chat.mangwale.ai frontend

3. **Monitoring**:
   - Add Prometheus metrics to voice-gateway
   - Configure alerts for GPU memory/utilization

---
*Setup completed: December 15, 2025*
