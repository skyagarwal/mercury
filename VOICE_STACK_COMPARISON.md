# Voice AI Stack Comparison for Mangwale

## Current Stack Analysis

### What You Have Now
| Component | Technology | Latency | Cost | Quality |
|-----------|------------|---------|------|---------|
| ASR | Whisper Large-v3 (local GPU) | ~1-3s | Free (GPU) | Excellent |
| TTS | XTTS v2 (local GPU) | ~2-5s | Free (GPU) | Good |
| Gateway | Custom WebSocket | ~50ms | Free | Basic |

### Current Stack Pros
- ✅ **Zero API costs** - runs entirely on your RTX 3060
- ✅ **Privacy** - audio never leaves your network
- ✅ **Hindi/Marathi** - Whisper excellent for Indian languages
- ✅ **Voice cloning** - XTTS can clone custom voices

### Current Stack Cons
- ❌ **High latency** - 3-8 seconds total round-trip
- ❌ **No interruption handling** - can't "barge in" during TTS
- ❌ **Basic VAD** - simple amplitude detection
- ❌ **Sequential processing** - wait for full utterance
- ❌ **GPU contention** - Mercury GPU shared by ASR+TTS

---

## Better Alternatives (2024-2025)

### Option 1: Hybrid Local + Cloud (Recommended)
Keep local for privacy, add cloud for speed when needed.

```
Priority Chain:
1. Local (Whisper/XTTS) - Primary, free
2. Deepgram/ElevenLabs - Fast fallback (~200ms)
3. Google/Azure - Reliable fallback
```

**Implementation:** Already done in the enhanced voice gateway!

---

### Option 2: Deepgram Nova-3 + ElevenLabs Flash
Best-in-class cloud providers for real-time.

| Provider | Latency | Hindi Support | Cost |
|----------|---------|---------------|------|
| Deepgram Nova-3 | ~150ms | ✅ Excellent | $0.0043/min |
| ElevenLabs Flash | ~75ms | ✅ Good | $0.30/1K chars |

**Total latency:** ~300ms (vs 5s+ current)

```javascript
// Deepgram real-time streaming
const deepgram = new Deepgram(API_KEY);
const connection = deepgram.listen.live({
  model: 'nova-3',
  language: 'hi',
  smart_format: true,
  interim_results: true,
  endpointing: 200, // Auto-detect speech end
});
```

---

### Option 3: Pipecat Framework
Open-source framework that orchestrates everything.

**GitHub:** https://github.com/pipecat-ai/pipecat (9.3K stars)

**Features:**
- ✅ All providers supported (Deepgram, ElevenLabs, OpenAI, local)
- ✅ Built-in VAD and turn detection
- ✅ Interruption handling out of the box
- ✅ WebSocket and WebRTC transport
- ✅ Python-based, easy to extend

**Architecture:**
```
User Audio → Pipecat Pipeline → ASR → LLM → TTS → User Speaker
                    ↓
            [VAD, Turn Detection, Interruption]
```

**Example:**
```python
from pipecat.pipeline import Pipeline
from pipecat.services.deepgram import DeepgramSTTService, DeepgramTTSService
from pipecat.services.openai import OpenAILLMService

pipeline = Pipeline([
    DeepgramSTTService(api_key="..."),
    OpenAILLMService(model="gpt-4o-mini"),
    DeepgramTTSService(voice="aura-asteria-en"),
])
```

---

### Option 4: LiveKit + OpenAI Realtime
Most sophisticated option for production.

**LiveKit:** WebRTC infrastructure (open-source)
**OpenAI Realtime API:** Full duplex voice conversation

| Feature | Supported |
|---------|-----------|
| Sub-100ms latency | ✅ |
| Turn detection | ✅ |
| Interruption | ✅ |
| Emotion detection | ✅ |
| Multi-party calls | ✅ |

**Cost:** OpenAI Realtime = $0.06/min (audio) + tokens

```python
from livekit import agents
from livekit.plugins import openai

class VoiceAgent(agents.Agent):
    async def on_session_start(self):
        self.session = openai.realtime.RealtimeSession(
            model="gpt-4o-realtime-preview",
            voice="alloy",
        )
```

---

## Recommendation Matrix

| Use Case | Recommended Stack | Why |
|----------|-------------------|-----|
| Development/Testing | Current (Whisper+XTTS) | Free, good enough |
| Production (Budget) | Hybrid (Local + Deepgram) | Best of both |
| Production (Quality) | Pipecat + Cloud | Modern features |
| Enterprise | LiveKit + OpenAI | Maximum capability |

---

## Implementation Roadmap

### Phase 1: Enhance Current (Done ✅)
- [x] Multi-provider fallback in gateway
- [x] Basic VAD for silence detection
- [x] REST + WebSocket APIs

### Phase 2: Add Cloud Providers (Next)
1. Sign up for Deepgram (get free $200 credit)
2. Sign up for ElevenLabs (get 10K free characters)
3. Add API keys to `.env`
4. Test fallback chain

### Phase 3: Real-time Features (Week 2)
1. Integrate Silero VAD for better detection
2. Add interim/partial ASR results
3. Implement interruption handling
4. Add streaming TTS (chunk-by-chunk)

### Phase 4: Pipecat Migration (Week 3-4)
1. Set up Pipecat alongside current system
2. Migrate voice logic to pipeline
3. Add WebRTC transport for lower latency
4. Deploy and A/B test

---

## Quick Wins to Improve Now

### 1. Get Cloud API Keys
```bash
# Add to /home/ubuntu/mangwale-voice/.env
DEEPGRAM_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
```

### 2. Test Cloud Fallback
```bash
# Force ElevenLabs
curl -X POST http://192.168.0.151:7101/api/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "नमस्ते, मैं मंगवाले हूं", "language": "hi", "provider": "elevenlabs"}'
```

### 3. Monitor Provider Health
```bash
curl http://192.168.0.151:7101/api/providers/health
```

---

## Cost Comparison (1000 minutes/month)

| Stack | ASR Cost | TTS Cost | Total |
|-------|----------|----------|-------|
| Current (Local) | $0 | $0 | **$0** |
| Deepgram + ElevenLabs | $4.30 | ~$15 | ~$20 |
| OpenAI Realtime | - | - | ~$60 |

---

## Bottom Line

**For Mangwale AI's current stage:**

1. **Keep** Whisper + XTTS as primary (free, private)
2. **Add** Deepgram + ElevenLabs as fast fallbacks
3. **Plan** migration to Pipecat for true real-time experience

The enhanced voice gateway I created already supports this hybrid approach!
