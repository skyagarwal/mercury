# Mangwale Voice + Escotel Unified Stack

## Mercury (192.168.0.151) - Complete Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MERCURY (192.168.0.151)                      │
│                    RTX 3060 Voice Processing Server                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐     │
│   │  ASR        │    │  TTS        │    │  Voice Gateway      │     │
│   │  (Whisper)  │    │  (XTTS)     │    │  (WebSocket)        │     │
│   │  :7000      │    │  :8010      │    │  :7100-7101         │     │
│   └──────┬──────┘    └──────┬──────┘    └──────────┬──────────┘     │
│          │                   │                      │                │
│          └───────────┬───────┴───────────┬──────────┘                │
│                      │                   │                           │
│              ┌───────▼───────────────────▼───────┐                   │
│              │        VOICE AGENT                │                   │
│              │        :8090                      │                   │
│              │  - Voice Enhancement              │                   │
│              │  - Turn-taking                    │                   │
│              │  - Jupiter Integration            │                   │
│              │  - Exotel Escalation             │                   │
│              └───────────────┬───────────────────┘                   │
│                              │                                       │
│   ┌──────────────────────────┼──────────────────────────┐           │
│   │          ESCOTEL STACK   │                          │           │
│   │   ┌──────────────────┐   │   ┌──────────────────┐   │           │
│   │   │ Exotel Service   │   │   │ RabbitMQ        │   │           │
│   │   │ :3100            │◄──┼───│ :5672/15672      │   │           │
│   │   │ - Call Connect   │   │   │ - Message Queue  │   │           │
│   │   │ - SMS Send       │   │   └──────────────────┘   │           │
│   │   │ - IVR Flows      │   │                          │           │
│   │   └──────────────────┘   │   ┌──────────────────┐   │           │
│   │                          │   │ Exotel UI        │   │           │
│   │                          │   │ :3101            │   │           │
│   │                          │   │ - Dashboard      │   │           │
│   │                          │   └──────────────────┘   │           │
│   └──────────────────────────┼──────────────────────────┘           │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               │ HTTP/REST
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      JUPITER (192.168.0.156)                         │
│                   AI Backend (Conversation Brain)                    │
├─────────────────────────────────────────────────────────────────────┤
│   :3200 - NestJS Backend (ConversationService, Flows, Agents)       │
│   :8002 - vLLM (Qwen2.5-14B)                                        │
│   :7010 - NLU (Intent Classification)                               │
└─────────────────────────────────────────────────────────────────────┘
```

### Running Services

| Container | Port | Function |
|-----------|------|----------|
| mangwale_asr | 7000 | Whisper ASR (Faster-Whisper) |
| mangwale_tts | 8010 | XTTS Text-to-Speech |
| mangwale_voice_gateway | 7100-7101 | WebSocket Voice Gateway |
| mangwale-voice-agent | 8090 | Jupiter-connected Voice Agent |
| mangwale-exotel-service | 3100 | Exotel API Proxy |
| mangwale-exotel-ui | 3101 | Exotel Dashboard |
| mangwale-rabbitmq | 5672/15672 | Message Queue |

### Quick Commands

```bash
# Start everything
cd /home/ubuntu/mangwale-voice
docker compose up -d                                    # Core voice stack
docker compose -f docker-compose-escotel.yml up -d     # Escotel stack
docker compose -f docker-compose-voice-agent.yml up -d # Voice agent

# Stop everything
docker compose down
docker compose -f docker-compose-escotel.yml down
docker compose -f docker-compose-voice-agent.yml down

# View logs
docker logs mangwale-voice-agent --tail 50
docker logs mangwale-exotel-service --tail 50

# Check status
docker ps | grep mangwale
```

### API Endpoints

#### Voice Agent (8090)

```bash
# Health check
curl http://localhost:8090/health

# Process voice message (text input)
curl -X POST http://localhost:8090/api/voice/process \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test-123", "text": "hello", "language": "en"}'

# Process with audio (base64)
curl -X POST http://localhost:8090/api/voice/process-with-audio \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test-123", "audio_base64": "...", "format": "wav"}'

# Synthesize text to speech
curl -X POST http://localhost:8090/api/voice/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, how are you?", "language": "en"}'

# Reset session
curl -X POST http://localhost:8090/api/voice/reset \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test-123"}'

# Exotel status
curl http://localhost:8090/api/exotel/status
```

#### Exotel Service (3100)

```bash
# Health check
curl http://localhost:3100/health

# Check auth
curl http://localhost:3100/exotel/auth/check

# Make call (via voice agent)
curl -X POST http://localhost:8090/api/escalate/call \
  -H "Content-Type: application/json" \
  -d '{"from_number": "customer", "to_number": "agent", "caller_id": "exotel_id"}'

# Send SMS (via voice agent)
curl -X POST http://localhost:8090/api/escalate/sms \
  -H "Content-Type: application/json" \
  -d '{"to_number": "9876543210", "message": "Order confirmed!"}'
```

### Integration Flow

1. **User speaks** → Voice Gateway captures audio
2. **ASR** → Transcribes speech to text
3. **Voice Agent** → Enhances and forwards to Jupiter
4. **Jupiter** → Processes intent, runs flows, generates response
5. **Voice Agent** → Enhances response (fillers, emotion)
6. **TTS** → Converts text to speech
7. **Voice Gateway** → Streams audio back to user

### Escalation Flow

1. Voice agent detects escalation intent (human handover request)
2. Calls Exotel service to connect customer to human agent
3. Call is bridged through Exotel's IVR

### Configuration

Environment variables in docker-compose-voice-agent.yml:
- `JUPITER_HOST` - Jupiter server IP
- `JUPITER_BACKEND_URL` - Jupiter backend API
- `TTS_XTTS_URL` - XTTS endpoint
- `ASR_URL` - ASR endpoint
- `EXOTEL_SERVICE_URL` - Exotel proxy service
- `ENABLE_FILLERS` - Add natural fillers (hmm, acha)
- `ENABLE_EMOTION` - Detect and convey emotions

### Troubleshooting

```bash
# Check container health
docker ps | grep mangwale

# Check voice agent logs
docker logs mangwale-voice-agent --tail 100

# Test Jupiter connection
curl http://192.168.0.156:3200/health

# Test voice processing
curl -X POST http://localhost:8090/api/voice/process \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test", "text": "hi", "language": "en"}'
```

### Session ID Format

Voice sessions use `web-voice-{session_id}` format internally to integrate with Jupiter's web platform handler. This allows Jupiter to store responses in Redis for retrieval rather than requiring a messaging provider.

---

*Last updated: December 15, 2025*
