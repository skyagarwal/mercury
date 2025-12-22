# 🚀 Enhanced Voice AI Stack for RTX 3060 12GB

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MANGWALE VOICE AI PLATFORM v2                         │
│                         Mercury Server (192.168.0.151)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│   ASR Layer   │           │   TTS Layer   │           │  Agent Layer  │
│   Port 7000   │           │   Port 8010   │           │   Port 8091   │
├───────────────┤           ├───────────────┤           ├───────────────┤
│ Faster-Whisper│           │   XTTS v2     │           │ Voice Agent v2│
│  Large-v3    │           │  (Current)    │           │  Orchestrator │
│  + Silero VAD │           │               │           │               │
│               │           │ Orpheus TTS   │           │ - Sessions    │
│ Features:     │           │  (Optional)   │           │ - Multi-turn  │
│ - Streaming   │           │  Port 8020    │           │ - Tool calling│
│ - Hindi/En/Mr │           │               │           │ - Function use│
│ - ~1-3s latency│           │ Features:     │           │               │
│               │           │ - 8 voices    │           │ Agent Types:  │
└───────┬───────┘           │ - Emotions    │           │ - Food        │
        │                   │ - ~200ms      │           │ - Parcel      │
        │                   └───────┬───────┘           │ - Ecom        │
        │                           │                   │ - Support     │
        └───────────────────────────┼───────────────────┴───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │       Voice Gateway           │
                    │    Ports 7100/7101            │
                    ├───────────────────────────────┤
                    │ - WebSocket streaming         │
                    │ - REST API                    │
                    │ - Multi-provider fallback     │
                    │ - Session management          │
                    │ - Rate limiting               │
                    │                               │
                    │ Cloud Fallbacks:              │
                    │ - Deepgram Nova-2 (ASR)       │
                    │ - ElevenLabs (TTS)            │
                    │ - Google Cloud (backup)       │
                    │ - Azure Speech (backup)       │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐
        │  Exotel Service   │           │   Jupiter Server  │
        │    Port 3100      │           │  192.168.0.156    │
        ├───────────────────┤           ├───────────────────┤
        │ - IVR             │           │ - MangwaleAI API  │
        │ - Click-to-Call   │           │ - vLLM (Qwen)     │
        │ - Number Masking  │           │ - NLU Service     │
        │ - Voice Streaming │           │ - PostgreSQL      │
        │ - Verified Calls  │           │ - Redis           │
        │ - Auto Dialer     │           │ - Admin Dashboard │
        │ - CQA Analytics   │           │                   │
        └───────────────────┘           └───────────────────┘
```

## New Components Created

### 1. Orpheus TTS Service (`orpheus-tts/`)
**State-of-the-art LLM-based TTS**

| Feature | Description |
|---------|-------------|
| **Model** | canopylabs/orpheus-tts-0.1-finetune-prod (Llama-3B) |
| **Latency** | ~200ms streaming (100ms with input streaming) |
| **Voices** | tara, leah, jess, leo, dan, mia, zac, zoe |
| **Emotions** | laugh, chuckle, sigh, gasp, whisper, shout, etc. |
| **Quality** | Superior to closed-source models |
| **VRAM** | ~6GB |

```python
# Usage
response = requests.post("http://localhost:8020/synthesize", json={
    "text": "Hello! <laugh> That's funny!",
    "voice": "tara",
    "emotion": "laugh"
})
```

### 2. Voice Agent v2 (`voice-agent-v2/`)
**Advanced multi-turn conversation orchestrator**

| Feature | Description |
|---------|-------------|
| **Sessions** | Redis-backed persistent sessions |
| **Agents** | Food, Parcel, Ecom, Support, General |
| **Tools** | search_restaurants, place_order, track_order, book_parcel |
| **LLM** | vLLM with function calling |
| **Transport** | REST API + WebSocket |

```python
# Create session
session = requests.post("http://localhost:8091/sessions", params={
    "agent_type": "food",
    "language": "hi",
    "voice": "tara"
})

# Chat
response = requests.post("http://localhost:8091/chat", json={
    "text": "Mujhe pizza order karna hai",
    "session_id": session["session_id"]
})
```

### 3. Streaming ASR with VAD (`streaming-asr/`)
**Real-time speech recognition with voice activity detection**

| Feature | Description |
|---------|-------------|
| **VAD** | Silero VAD for accurate speech detection |
| **Streaming** | WebSocket real-time transcription |
| **Endpoint Detection** | Automatic silence-based speech end |
| **Languages** | Hindi, English, Marathi |

## GPU Memory Planning (RTX 3060 12GB)

| Configuration | ASR | TTS | Agent | Total | Free |
|---------------|-----|-----|-------|-------|------|
| **Current (XTTS)** | ~3GB | ~3.5GB | ~0.5GB | ~7GB | ~5GB |
| **With Orpheus** | ~3GB | ~6GB | ~0.5GB | ~9.5GB | ~2.5GB |
| **Minimal** | ~2GB (medium) | ~3.5GB | ~0.5GB | ~6GB | ~6GB |

## Docker Services

```yaml
# Start current stack (XTTS)
docker compose up -d asr tts voice-gateway voice-agent-v2

# Start with Orpheus (uncomment in docker-compose.yml)
docker compose up -d asr orpheus-tts voice-gateway voice-agent-v2
```

## API Endpoints

### Voice Agent v2 (Port 8091)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sessions` | POST | Create new session |
| `/sessions/{id}` | GET | Get session details |
| `/chat` | POST | Text chat |
| `/transcribe` | POST | Transcribe audio |
| `/speak` | POST | Synthesize speech |
| `/ws/{session_id}` | WS | Real-time voice |
| `/agents` | GET | List agent types |
| `/tools` | GET | List available tools |

### Orpheus TTS (Port 8020)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/status` | GET | Detailed status |
| `/voices` | GET | List voices & emotions |
| `/synthesize` | POST | Generate speech |
| `/ws/stream` | WS | Streaming synthesis |

## Quick Start

```bash
# 1. Build new services
cd ~/mangwale-voice
docker compose build voice-agent-v2

# 2. Start the stack
docker compose up -d asr tts voice-gateway voice-agent-v2

# 3. Test Voice Agent
curl http://localhost:8091/health

# 4. Create a session
curl -X POST "http://localhost:8091/sessions?agent_type=food&language=hi"

# 5. Chat
curl -X POST http://localhost:8091/chat \
  -H "Content-Type: application/json" \
  -d '{"text": "Kya pizza milega?", "session_id": "YOUR_SESSION_ID"}'
```

## Future Enhancements

1. **LiveKit WebRTC** - Ultra-low latency (<100ms)
2. **Hindi Orpheus** - Fine-tune Orpheus for Hindi
3. **Turn Detection** - Advanced interruption handling
4. **Emotion Detection** - Detect caller emotions from voice
5. **Multi-party** - Conference call support

## Cost Comparison

| Stack | Monthly Cost (1000 mins) |
|-------|-------------------------|
| Current (Local only) | **$0** |
| Hybrid (Local + Cloud fallback) | ~$20 |
| Cloud only (Deepgram + ElevenLabs) | ~$50 |

---
*Built for Mangwale AI - Mercury Voice Stack v2.0*
