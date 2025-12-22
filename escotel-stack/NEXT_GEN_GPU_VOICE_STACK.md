# 🚀 Next-Gen GPU-Optimized AI Voice Stack

## Master Enhancement Plan - December 2025

> **Goal**: Build the world's most advanced open-source voice AI stack for Indian languages, 
> running entirely on RTX 3060 12GB with <500ms latency

---

## 📊 Current State Analysis

### GPU Status
- **Hardware**: RTX 3060 12GB VRAM
- **Current Usage**: ~5GB / 12GB (58% FREE - room for enhancement!)
- **Running Services**: ASR + TTS + Orchestrator

### Active Stack
| Service | Model | VRAM | Status |
|---------|-------|------|--------|
| ASR | Faster-Whisper large-v3 | ~3GB | ✅ Running |
| TTS | Indic-Parler-TTS | ~2GB | ✅ Running |
| Orchestrator | - | ~200MB | ✅ Running |
| **Available** | - | **~6.8GB** | 🎯 Enhancement opportunity |

---

## 🎯 Enhancement Roadmap

### Phase 1: Core TTS Enhancement (Week 1)

#### 1.1 Add Chatterbox-Turbo TTS (🔥 NEW - Dec 2025)
```
Model: ResembleAI/chatterbox-turbo
Size: 350M params (~1.5GB VRAM)
Latency: <200ms
Features:
  - Paralinguistic tags: [laugh], [cough], [chuckle], [sigh]
  - Zero-shot voice cloning (10s reference)
  - Built for real-time voice agents
  - Supports Hindi via Multilingual variant
```

**Why Chatterbox?**
- State-of-the-art quality (beats commercial TTS)
- Native paralinguistic support (emotions in voice)
- Production-ready for voice agents
- MIT licensed

#### 1.2 Add VibeVoice Realtime (Microsoft - Dec 2025)
```
Model: microsoft/VibeVoice-Realtime-0.5B
Size: 0.5B params (~2GB VRAM)
Latency: ~300ms first audible
Features:
  - Streaming text input
  - Long-form speech (up to 10 min)
  - Built on Qwen2.5-0.5B backbone
```

#### 1.3 Add CosyVoice3 (Alibaba FunAudioLLM - Dec 2025)
```
Model: FunAudioLLM/Fun-CosyVoice3-0.5B-2512
Size: 0.5B params (~2GB VRAM)
Latency: 150ms streaming
Features:
  - 9 languages + 18 Chinese dialects
  - Emotion/speed/volume control via instruct
  - Pronunciation inpainting
  - RL-optimized for naturalness
```

### Phase 2: ASR Enhancement (Week 1-2)

#### 2.1 Whisper Large-v3-Turbo Optimization
```
Model: openai/whisper-large-v3-turbo
Size: 809M params (~2GB VRAM with int8)
Speed: 4.5x faster than large-v3
Features:
  - Same accuracy as large-v3
  - Better for real-time streaming
  - Native Hindi/99 languages
```

#### 2.2 Add AI4Bharat Indic ASR (Specialized)
```
Model: ai4bharat/indic-conformer-600m-multilingual
Size: 600M params
Languages: 22 Indian languages
Features:
  - Trained on Indian accents
  - Better rural voice recognition
  - Code-switching support (Hi-En)
```

### Phase 3: Real-Time Voice Pipeline (Week 2)

#### 3.1 Silero VAD Integration
```python
# Voice Activity Detection - Critical for turn-taking
Features:
  - 10ms detection latency
  - Works on CPU (saves GPU for models)
  - Accurate speech/silence boundary
  - Essential for interruption handling
```

#### 3.2 WebRTC Voice Gateway
```
Transport: WebRTC (native browser support)
Features:
  - <50ms audio latency
  - Opus codec at 48kHz
  - Automatic echo cancellation
  - Works with mobile browsers
```

#### 3.3 Turn-Taking Engine
```python
# Smart conversation flow
Features:
  - Detects when user finished speaking
  - Handles interruptions (barge-in)
  - Manages conversation state machine
  - Prevents voice overlap
```

### Phase 4: Exotel Integration (Week 2-3)

#### 4.1 SIP Bridge for Phone Calls
```
Protocol: SIP/RTP over UDP
Features:
  - Connect to Exotel via SIP trunk
  - Real-time audio streaming
  - DTMF detection
  - Call recording
```

#### 4.2 IVR Flow Engine
```
Features:
  - Dynamic TTS prompts in Hindi/Marathi
  - DTMF menu navigation
  - Speech intent detection
  - Vendor confirmation flows
```

### Phase 5: Advanced Features (Week 3-4)

#### 5.1 Voice Cloning Service
```
Features:
  - 10-second reference audio cloning
  - Chatterbox/XTTS-v2 backends
  - Store vendor voice profiles
  - Personalized vendor notifications
```

#### 5.2 Emotion & Paralinguistic Tags
```python
# Add expressiveness to AI voice
tags = {
  "[laugh]": "Laughing sound",
  "[chuckle]": "Light chuckle",
  "[sigh]": "Sighing sound",
  "[cough]": "Coughing sound",
  "[breath]": "Breathing pause"
}

# Usage in TTS
text = "Thank you for your order [chuckle], it will be ready in 15 minutes!"
```

#### 5.3 Streaming LLM Response
```
Features:
  - Token streaming from Jupiter vLLM
  - Sentence-level TTS generation
  - Audio playback starts before LLM finishes
  - Reduces perceived latency by 50%
```

---

## 🏗️ Enhanced Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐    │
│  │   Web UI      │  │   Mobile App  │  │   Exotel SIP  │  │   WhatsApp    │    │
│  │   (WebRTC)    │  │   (WebRTC)    │  │   (Phone)     │  │   (Future)    │    │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘    │
│          │                  │                  │                  │             │
└──────────┼──────────────────┼──────────────────┼──────────────────┼─────────────┘
           │                  │                  │                  │
           └──────────────────┴──────────────────┴──────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      🎯 VOICE GATEWAY (Port 8080)                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  WebRTC Transport │ SIP Bridge │ WebSocket │ Session Manager            │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │  Silero VAD │ Turn Detection │ Interruption Handler │ Audio Buffer      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────────┐
│   🎤 ASR SERVICE    │   │   🧠 LLM SERVICE    │   │   🔊 TTS SERVICE        │
│      (Port 7001)    │   │   (Jupiter:3200)    │   │      (Port 7002)        │
├─────────────────────┤   ├─────────────────────┤   ├─────────────────────────┤
│ PRIMARY:            │   │ PRIMARY:            │   │ ENGLISH:                │
│ Whisper-large-v3-   │   │ vLLM (Qwen2.5-7B)   │   │ • Chatterbox-Turbo      │
│ turbo (int8)        │   │                     │   │   350M, <200ms          │
│ ~2GB VRAM           │   │ FEATURES:           │   │ • Kokoro-82M (backup)   │
│                     │   │ • Function calling  │   │   82M, <50ms            │
│ INDIC SPECIALIST:   │   │ • RAG context       │   │                         │
│ AI4Bharat Conformer │   │ • Order processing  │   │ HINDI/MARATHI:          │
│ 600M, 22 languages  │   │ • Vendor management │   │ • Indic-Parler-TTS      │
│                     │   │                     │   │   900M, ~300ms          │
│ FALLBACK:           │   │ FALLBACK:           │   │ • CosyVoice3-0.5B       │
│ Deepgram Nova-2     │   │ Groq Llama-3.1-70B  │   │   500M, ~150ms stream   │
│ (cloud)             │   │ (cloud)             │   │                         │
└─────────────────────┘   └─────────────────────┘   │ MULTILINGUAL:           │
                                                    │ • Chatterbox-Multi      │
                                                    │   500M, 23 languages    │
                                                    │                         │
                                                    │ FALLBACK:               │
                                                    │ ElevenLabs (cloud)      │
                                                    └─────────────────────────┘
```

---

## 📦 GPU Memory Budget (12GB RTX 3060)

### Option A: Maximum Features
| Component | VRAM | Notes |
|-----------|------|-------|
| Whisper-large-v3-turbo (int8) | ~2.0GB | ASR |
| Chatterbox-Turbo | ~1.5GB | English TTS + emotions |
| Indic-Parler-TTS | ~2.0GB | Hindi/Marathi TTS |
| CosyVoice3-0.5B | ~1.5GB | Streaming multilingual |
| CUDA Overhead | ~1.0GB | Context/buffers |
| **Total** | **~8.0GB** | ✅ 4GB headroom |

### Option B: Ultra-Low Latency
| Component | VRAM | Notes |
|-----------|------|-------|
| Whisper-large-v3-turbo (int8) | ~2.0GB | ASR |
| Chatterbox-Turbo | ~1.5GB | Primary TTS |
| Kokoro-82M | ~0.5GB | Ultra-fast English backup |
| VibeVoice-0.5B | ~2.0GB | Streaming TTS |
| CUDA Overhead | ~1.0GB | Context/buffers |
| **Total** | **~7.0GB** | ✅ 5GB headroom for LLM |

### Option C: Include Local LLM (Recommended)
| Component | VRAM | Notes |
|-----------|------|-------|
| Whisper-large-v3-turbo (int8) | ~2.0GB | ASR |
| Chatterbox-Turbo | ~1.5GB | Primary English TTS |
| Indic-Parler-TTS | ~2.0GB | Hindi/Marathi TTS |
| Qwen2.5-3B-Instruct (int4) | ~2.0GB | Fast local LLM |
| CUDA Overhead | ~1.0GB | Context/buffers |
| **Total** | **~8.5GB** | ✅ 3.5GB headroom |

---

## 🗄️ Datasets for Training/Fine-tuning

### ASR Datasets (Hindi/Marathi)

| Dataset | Size | Languages | Use Case |
|---------|------|-----------|----------|
| [ai4bharat/Rasa](https://huggingface.co/datasets/ai4bharat/Rasa) | 995K samples | 9 Indic | TTS/ASR training |
| [ai4bharat/Rural_Women_ASR_v2](https://huggingface.co/datasets/ai4bharat/Rural_Women_ASR_v2) | 64K samples | Hindi/Bhojpuri | Rural accent ASR |
| [ARTPARK-IISc/Vaani](https://huggingface.co/datasets/ARTPARK-IISc/Vaani) | Large | Hindi | Real-world ASR |
| [ai4b-hf/GLOBE-annotated](https://huggingface.co/datasets/ai4b-hf/GLOBE-annotated) | 582K | 18 Indic | TTS with descriptions |
| [google/svq](https://huggingface.co/datasets/google/svq) | 676K | Hindi | Speech question answering |

### TTS Datasets

| Dataset | Size | Languages | Use Case |
|---------|------|-----------|----------|
| [ai4bharat/Rasa](https://huggingface.co/datasets/ai4bharat/Rasa) | 995K | 9 Indic | High-quality TTS |
| [IndicTTS (AI4Bharat)](https://ai4bharat.iitm.ac.in/) | 382hrs | 12 Indic | Studio quality TTS |
| [LIMMITS](https://ai4bharat.iitm.ac.in/) | 568hrs | 7 Indic | Natural conversation |

---

## 🔧 Implementation Details

### Docker Services to Build

```yaml
# docker-compose-enhanced.yml
services:
  # 1. Voice Gateway (NEW)
  voice-gateway:
    ports: ["8080:8080"]
    features:
      - WebRTC server
      - SIP bridge
      - Session management
      - VAD processing
    
  # 2. Enhanced ASR
  asr:
    ports: ["7001:7001"]
    models:
      - whisper-large-v3-turbo
      - indic-conformer-600m (optional)
    features:
      - Streaming transcription
      - Language detection
      - Speaker diarization (future)
    
  # 3. Multi-TTS Service
  tts:
    ports: ["7002:7002"]
    models:
      - chatterbox-turbo (English + emotions)
      - indic-parler-tts (Hindi/Marathi)
      - cosyvoice3 (multilingual streaming)
      - kokoro-82m (ultra-fast backup)
    features:
      - Language-aware routing
      - Streaming audio
      - Voice cloning
      - Emotion tags
    
  # 4. Admin Dashboard (NEW)
  admin:
    ports: ["8000:8000"]
    features:
      - Call monitoring
      - Voice testing
      - Model switching
      - Performance metrics
```

### API Endpoints

```python
# Voice Gateway Endpoints
POST /api/voice/call/initiate      # Start outbound call
POST /api/voice/call/answer        # Handle incoming call
POST /api/voice/stream/start       # Start WebRTC session
WS   /ws/voice/{session_id}        # Real-time voice stream

# ASR Endpoints
POST /v1/audio/transcriptions       # Standard OpenAI-compatible
WS   /ws/stream                     # Real-time streaming ASR
POST /v1/audio/detect-language      # Detect spoken language

# TTS Endpoints
POST /v1/audio/speech               # Generate speech
POST /v1/audio/speech/stream        # Streaming audio generation
POST /v1/audio/clone                # Voice cloning
GET  /v1/voices                     # List available voices
POST /v1/audio/speech/with-emotion  # With paralinguistic tags

# Admin Endpoints
GET  /admin/calls/active            # List active calls
GET  /admin/metrics                 # Performance metrics
POST /admin/models/switch           # Hot-swap models
GET  /admin/gpu/status              # GPU memory usage
```

---

## 🎮 Use Cases

### 1. Vendor Order Confirmation (Primary)
```
Flow: Jupiter → Mercury → Exotel → Vendor Phone
Features needed:
  ✅ Hindi/Marathi TTS (Indic-Parler)
  ✅ DTMF detection
  ✅ Speech-to-text for rejection reason
  ✅ Dynamic prompts with order details
```

### 2. Customer Support Voice Bot
```
Flow: Customer Call → IVR → AI Agent → Human Handoff
Features needed:
  ✅ Real-time ASR (Whisper-turbo)
  ✅ Intent detection (Jupiter NLU)
  ✅ Natural TTS responses (Chatterbox)
  ✅ Emotion-aware responses
```

### 3. Rider Assignment
```
Flow: Jupiter → Mercury → Rider Phone
Features needed:
  ✅ Quick TTS responses (Kokoro/Chatterbox)
  ✅ Location-based routing
  ✅ Accept/Reject via DTMF
```

### 4. Voice-Enabled Admin Dashboard
```
Flow: Admin Web → WebRTC → Voice Commands
Features needed:
  ✅ WebRTC voice chat
  ✅ Voice commands ("Show today's orders")
  ✅ TTS for status updates
```

---

## 📈 Performance Targets

| Metric | Current | Target | How |
|--------|---------|--------|-----|
| ASR Latency | ~500ms | <250ms | Whisper-turbo + streaming |
| TTS Latency (EN) | N/A | <200ms | Chatterbox-Turbo |
| TTS Latency (HI) | ~300ms | <200ms | Indic-Parler optimization |
| End-to-End | ~2s | <800ms | Parallel processing |
| Concurrent Calls | 1 | 4-6 | GPU memory optimization |
| Voice Quality | Good | Excellent | Chatterbox + emotions |

---

## 🛠️ Implementation Timeline

### Week 1: Core TTS Enhancement
- [ ] Day 1-2: Setup Chatterbox-Turbo service
- [ ] Day 3-4: Integrate VibeVoice Realtime
- [ ] Day 5: Add CosyVoice3 for multilingual
- [ ] Day 6-7: TTS routing logic & testing

### Week 2: ASR & Voice Pipeline
- [ ] Day 1-2: Optimize Whisper-turbo
- [ ] Day 3-4: Add Silero VAD
- [ ] Day 5-6: Build WebRTC gateway
- [ ] Day 7: Turn-taking engine

### Week 3: Exotel Integration
- [ ] Day 1-3: SIP bridge for phone calls
- [ ] Day 4-5: IVR flow engine
- [ ] Day 6-7: Integration testing

### Week 4: Advanced Features
- [ ] Day 1-2: Voice cloning service
- [ ] Day 3-4: Emotion/paralinguistic tags
- [ ] Day 5-6: Admin dashboard
- [ ] Day 7: Performance optimization

---

## 🔍 Research Notes

### Latest TTS Models (Dec 2025)

1. **Chatterbox-Turbo** (ResembleAI) - ⭐ Best for voice agents
   - 350M params, <200ms latency
   - Native paralinguistic tags
   - Zero-shot voice cloning
   - MIT licensed

2. **VibeVoice-Realtime** (Microsoft) - ⭐ Best for streaming
   - 0.5B params, ~300ms first audio
   - Streaming text input
   - Built on Qwen2.5-0.5B
   - MIT licensed

3. **CosyVoice3** (Alibaba FunAudioLLM) - ⭐ Best multilingual
   - 0.5B params, 150ms streaming
   - 9 languages + Chinese dialects
   - RL-optimized emotions
   - Apache 2.0 licensed

4. **Indic-Parler-TTS** (AI4Bharat) - ⭐ Best for Indian languages
   - 900M params, ~300ms
   - 21 Indian languages
   - 69 speaker voices
   - Apache 2.0 licensed

5. **Kokoro-82M** (hexgrad) - ⭐ Ultra-fast English
   - 82M params, <50ms
   - Multiple languages
   - Apache 2.0 licensed

6. **GLM-TTS** (Z.ai) - Emotion-focused
   - 1.5B params
   - RL-enhanced emotions
   - Chinese/English focus
   - MIT licensed

### Key Insights

1. **Paralinguistic Tags are Game-Changers**
   - Chatterbox and CosyVoice3 support `[laugh]`, `[sigh]`, `[breath]`
   - Makes AI voice feel more human
   - Critical for customer support scenarios

2. **Streaming is Essential for Voice Agents**
   - VibeVoice and CosyVoice3 support text-in streaming
   - Audio starts before text generation finishes
   - Reduces perceived latency significantly

3. **Voice Cloning Works with 10s Audio**
   - Chatterbox and XTTS-v2 enable zero-shot cloning
   - Could clone vendor voices for personalization
   - Requires consent and responsible use

4. **RL Training Improves Naturalness**
   - GLM-TTS and CosyVoice3 use GRPO for training
   - Reduces CER while maintaining expressiveness
   - Future: Could fine-tune on Mangwale data

---

## 📋 Quick Start Commands

```bash
# Clone and setup
cd /home/ubuntu/mangwale-voice/escotel-stack

# Build enhanced stack
docker-compose -f docker-compose-enhanced.yml build

# Start services
docker-compose -f docker-compose-enhanced.yml up -d

# Check GPU usage
nvidia-smi

# Test TTS
curl -X POST http://localhost:7002/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello [chuckle], how can I help you?", "voice": "chatterbox-turbo"}'

# Test ASR
curl -X POST http://localhost:7001/v1/audio/transcriptions \
  -F "file=@test.wav" \
  -F "language=hi"
```

---

## 🔗 References

- [Chatterbox GitHub](https://github.com/resemble-ai/chatterbox)
- [VibeVoice Project](https://microsoft.github.io/VibeVoice)
- [CosyVoice3 Demo](https://funaudiollm.github.io/cosyvoice3/)
- [Indic-Parler-TTS](https://huggingface.co/ai4bharat/indic-parler-tts)
- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
- [AI4Bharat Datasets](https://huggingface.co/ai4bharat)
- [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper)

---

*Created: December 18, 2025*
*Author: Mangwale Voice Team*
*Version: 2.0*
