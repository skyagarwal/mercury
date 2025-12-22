# Mangwale Voice Gateway - API Reference v2.0

## Overview

The Voice Gateway provides REST and WebSocket APIs for Speech-to-Text (ASR) and Text-to-Speech (TTS) with multi-provider support, emotion control, and real-time streaming.

**Base URLs:**
- HTTP REST API: `http://192.168.0.151:7101`
- WebSocket: `ws://192.168.0.151:7100`

---

## REST API Endpoints

### Health & Status

#### GET /health
Returns gateway health status with latency metrics.

```bash
curl http://192.168.0.151:7101/health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "activeSessions": 3,
  "uptime": 86400,
  "uptimeFormatted": "1d 0h",
  "services": {
    "asr": { "healthy": true, "latencyMs": 450 },
    "tts": { "healthy": true, "latencyMs": 280 }
  },
  "stats": {
    "totalRequests": 1250,
    "errors": 12
  }
}
```

---

### Configuration

#### GET /api/config
Get current runtime configuration.

```bash
curl http://192.168.0.151:7101/api/config
```

**Response:**
```json
{
  "asr": {
    "providerPriority": ["local", "deepgram", "google", "azure"],
    "supportedLanguages": ["hi", "en", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa"],
    "features": {
      "wordTimestamps": true,
      "confidenceScores": true,
      "vadFilter": true,
      "silenceThresholdMs": 700
    }
  },
  "tts": {
    "providerPriority": ["local", "elevenlabs", "deepgram", "google", "azure"],
    "emotions": ["neutral", "happy", "excited", "calm", "professional", "friendly", "empathetic", "urgent", "sad"],
    "features": {
      "streaming": true,
      "voiceCloning": true,
      "emotionControl": true,
      "speedRange": { "min": 0.5, "max": 2.0, "default": 1.0 },
      "pitchRange": { "min": 0.5, "max": 2.0, "default": 1.0 },
      "formats": ["mp3", "wav", "ogg"]
    }
  }
}
```

#### PUT /api/config
Update runtime configuration (admin only).

```bash
curl -X PUT http://192.168.0.151:7101/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "asr": { "providerPriority": ["deepgram", "local"] },
    "vad": { "silenceThresholdMs": 500 }
  }'
```

---

### Statistics

#### GET /api/stats
Get usage statistics for admin dashboard.

```bash
curl http://192.168.0.151:7101/api/stats
```

**Response:**
```json
{
  "uptime": { "ms": 86400000, "formatted": "1d 0h" },
  "asr": {
    "totalRequests": 850,
    "totalSeconds": 4250.5,
    "avgLatencyMs": 450
  },
  "tts": {
    "totalRequests": 400,
    "totalCharacters": 125000,
    "avgLatencyMs": 280
  },
  "providers": {
    "local": 1100,
    "elevenlabs": 150
  },
  "errors": 12,
  "activeSessions": 3
}
```

---

### Provider Health

#### GET /api/providers/health
Check health of all configured providers.

```bash
curl http://192.168.0.151:7101/api/providers/health
```

**Response:**
```json
{
  "asr": {
    "local": true,
    "deepgram": true,
    "google": false,
    "azure": false
  },
  "tts": {
    "local": true,
    "elevenlabs": true,
    "deepgram": true,
    "google": false,
    "azure": false
  }
}
```

---

### Voices

#### GET /api/voices
List available voices per provider.

```bash
# All voices
curl http://192.168.0.151:7101/api/voices

# Filter by provider
curl "http://192.168.0.151:7101/api/voices?provider=elevenlabs"

# Filter by language
curl "http://192.168.0.151:7101/api/voices?language=hi"
```

**Response:**
```json
{
  "local": {
    "xtts": [{ "id": "default", "name": "Default Voice", "languages": ["hi", "en", "mr"] }],
    "indicParler": [
      { "id": "Divya", "name": "Divya", "languages": ["hi"], "gender": "female", "recommended": true },
      { "id": "Rohit", "name": "Rohit", "languages": ["hi"], "gender": "male", "recommended": true }
    ]
  },
  "elevenlabs": [
    { "id": "pNInz6obpgDQGcFmaJgB", "name": "Adam", "languages": ["en", "hi"], "gender": "male" }
  ]
}
```

---

### Emotions

#### GET /api/emotions
List available emotion presets for TTS.

```bash
curl http://192.168.0.151:7101/api/emotions
```

**Response:**
```json
{
  "neutral": { "description": "speaks in a neutral, balanced tone", "stability": 0.5, "similarity": 0.75 },
  "happy": { "description": "speaks with a happy, cheerful tone", "stability": 0.4, "similarity": 0.8, "style": 0.6 },
  "excited": { "description": "speaks with an excited, energetic tone", "stability": 0.3, "similarity": 0.85, "style": 0.8 },
  "calm": { "description": "speaks with a calm, soothing tone", "stability": 0.7, "similarity": 0.7, "style": 0.3 },
  "professional": { "description": "speaks with a professional, formal tone", "stability": 0.6, "similarity": 0.75, "style": 0.4 },
  "friendly": { "description": "speaks with a warm, friendly tone", "stability": 0.45, "similarity": 0.8, "style": 0.5 },
  "empathetic": { "description": "speaks with an empathetic, understanding tone", "stability": 0.55, "similarity": 0.75, "style": 0.45 },
  "urgent": { "description": "speaks with an urgent, important tone", "stability": 0.35, "similarity": 0.85, "style": 0.7 },
  "sad": { "description": "speaks with a soft, melancholic tone", "stability": 0.65, "similarity": 0.7, "style": 0.25 }
}
```

---

### Models

#### GET /api/models
List available ASR and TTS models.

```bash
curl http://192.168.0.151:7101/api/models
```

---

### Capabilities

#### GET /api/capabilities
Get full system capabilities (for admin UI).

```bash
curl http://192.168.0.151:7101/api/capabilities
```

**Response:**
```json
{
  "version": "2.0.0",
  "features": {
    "asr": ["transcription", "word-timestamps", "confidence-scores", "language-detection", "streaming"],
    "tts": ["synthesis", "voice-cloning", "emotion-control", "speed-control", "pitch-control", "streaming"],
    "realtime": ["vad", "interruption-detection", "partial-results", "websocket-streaming"]
  },
  "providers": {
    "asr": { "local": { "available": true, "latencyMs": 45 } },
    "tts": { "local": { "available": true, "latencyMs": 12 } }
  },
  "languages": {
    "supported": ["hi", "en", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa"],
    "default": "hi",
    "indic": ["hi", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa"]
  },
  "emotions": ["neutral", "happy", "excited", "calm", "professional", "friendly", "empathetic", "urgent", "sad"],
  "voiceCount": 28
}
```

---

### Speech-to-Text (ASR)

#### POST /api/transcribe
Transcribe audio to text.

```bash
curl -X POST http://192.168.0.151:7101/api/transcribe \
  -H "Content-Type: application/json" \
  -d '{
    "audio": "<base64-encoded-audio>",
    "language": "hi",
    "provider": "local"
  }'
```

**Request Body:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| audio | string | Yes | - | Base64-encoded audio data |
| language | string | No | "hi" | Language code (hi, en, mr) |
| provider | string | No | auto | Specific provider to use |

**Response:**
```json
{
  "text": "नमस्ते, मैं मंगवाले हूं",
  "language": "hi",
  "confidence": 0.95,
  "provider": "local",
  "isFinal": true,
  "latencyMs": 450,
  "audioSize": 32000,
  "segments": [
    { "text": "नमस्ते,", "start": 0.0, "end": 0.8 },
    { "text": "मैं मंगवाले हूं", "start": 0.9, "end": 2.1 }
  ]
}
```

---

### Text-to-Speech (TTS)

#### POST /api/speak
Generate speech from text with emotion and voice control.

```bash
curl -X POST http://192.168.0.151:7101/api/speak \
  -H "Content-Type: application/json" \
  -d '{
    "text": "नमस्ते, मैं मंगवाले का AI सहायक हूं",
    "language": "hi",
    "emotion": "friendly",
    "speed": 1.0,
    "pitch": 1.0,
    "voice": "pNInz6obpgDQGcFmaJgB",
    "provider": "elevenlabs",
    "format": "mp3"
  }' \
  --output output.mp3
```

**Request Body:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| text | string | Yes | - | Text to synthesize |
| language | string | No | "hi" | Language code |
| emotion | string | No | "neutral" | Emotion preset |
| speed | number | No | 1.0 | Speed (0.5-2.0) |
| pitch | number | No | 1.0 | Pitch (0.5-2.0) |
| voice | string | No | auto | Voice ID |
| provider | string | No | auto | TTS provider |
| format | string | No | "mp3" | Output format (mp3, wav, ogg) |

**Response Headers:**
- `Content-Type`: audio/mpeg (or audio/wav, audio/ogg)
- `X-Provider`: Provider used
- `X-Latency-Ms`: Processing time
- `X-Audio-Size`: Audio bytes

---

### Live Testing (Admin)

#### POST /api/test/asr
Live ASR testing for admin UI.

```bash
curl -X POST http://192.168.0.151:7101/api/test/asr \
  -H "Content-Type: application/json" \
  -d '{
    "audio": "<base64-audio>",
    "language": "hi",
    "provider": "local",
    "features": { "wordTimestamps": true }
  }'
```

#### POST /api/test/tts
Live TTS testing for XTTS Studio.

```bash
curl -X POST http://192.168.0.151:7101/api/test/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "नमस्ते",
    "language": "hi",
    "emotion": "happy",
    "speed": 1.0,
    "pitch": 1.0,
    "format": "mp3"
  }'
```

**Response:**
```json
{
  "audio": "<base64-encoded-audio>",
  "provider": "local",
  "latencyMs": 280,
  "audioSize": 45000,
  "format": "mp3",
  "settings": { "speed": 1.0, "pitch": 1.0, "emotion": "happy" }
}
```

---

## WebSocket API

### Connection
```javascript
const ws = new WebSocket('ws://192.168.0.151:7100?language=hi&token=JWT_TOKEN');
```

### Client → Server Messages

| Type | Description | Payload |
|------|-------------|---------|
| `start_recording` | Start audio recording | - |
| `stop_recording` | Stop and transcribe | `{ provider?: string }` |
| `transcribe` | Immediate transcription | `{ audio: base64, provider?: string }` |
| `speak` | Generate speech | `{ text, language?, voice?, emotion?, speed?, pitch?, format? }` |
| `set_language` | Change language | `{ language: 'hi' }` |
| `set_emotion` | Set emotion preset | `{ emotion: 'happy' }` |
| `set_voice` | Set voice preference | `{ voice: 'Divya', provider: 'local' }` |
| `get_voices` | Get voice list | - |
| `set_providers` | Change providers | `{ asr?: string, tts?: string }` |
| `interrupt` | Stop current TTS | - |
| `ping` | Heartbeat | - |
| Binary | Audio chunk | Raw audio bytes |

### Server → Client Messages

| Type | Description |
|------|-------------|
| `connected` | Session established with capabilities |
| `recording_started` | Recording begun |
| `audio_received` | Audio chunk buffered |
| `vad_silence_detected` | Silence detected (auto-stop hint) |
| `asr_result` | Final transcription |
| `tts_start` | Speech generation started |
| `tts_complete` | Speech generation complete |
| `language_changed` | Language updated |
| `emotion_changed` | Emotion preset updated |
| `voice_changed` | Voice preference updated |
| `voices_list` | Available voices |
| `providers_changed` | Providers updated |
| `interrupted` | TTS interrupted |
| `pong` | Heartbeat response |
| `error` | Error occurred |
| Binary | Audio data |

---

## Integration with admin.mangwale.ai

### Voice AI Settings Page
- GET `/api/config` → Populate ASR/TTS settings
- GET `/api/providers/health` → Show provider status badges
- GET `/api/stats` → Display latency metrics
- PUT `/api/config` → Save configuration changes

### XTTS Studio Page
- GET `/api/voices` → Populate voice selector
- GET `/api/emotions` → Populate emotion buttons
- POST `/api/test/tts` → Generate speech preview
- GET `/api/capabilities` → Show feature badges

### Live Testing Tab
- WebSocket connection for real-time testing
- POST `/api/test/asr` → Test ASR with uploaded audio
- POST `/api/test/tts` → Test TTS with text input

---

## Error Codes

| Code | Description |
|------|-------------|
| `BUFFER_OVERFLOW` | Audio buffer exceeded limit |
| `ASR_ERROR` | Transcription failed |
| `TTS_ERROR` | Speech synthesis failed |
| `PROCESSING_ERROR` | General processing error |
| `UNKNOWN` | Unknown message type |

---

## Emotion Presets Reference

| Emotion | Use Case | Voice Settings |
|---------|----------|----------------|
| `neutral` | Default, balanced responses | Stability: 0.5, Similarity: 0.75 |
| `happy` | Positive confirmations, greetings | Stability: 0.4, Similarity: 0.8 |
| `excited` | Promotions, good news | Stability: 0.3, Similarity: 0.85 |
| `calm` | Support, reassurance | Stability: 0.7, Similarity: 0.7 |
| `professional` | Business, formal queries | Stability: 0.6, Similarity: 0.75 |
| `friendly` | Casual conversation | Stability: 0.45, Similarity: 0.8 |
| `empathetic` | Complaints, issues | Stability: 0.55, Similarity: 0.75 |
| `urgent` | Important alerts | Stability: 0.35, Similarity: 0.85 |
| `sad` | Apologies, bad news | Stability: 0.65, Similarity: 0.7 |
