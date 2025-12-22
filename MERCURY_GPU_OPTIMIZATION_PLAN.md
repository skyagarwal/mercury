# Mercury GPU Optimization Plan
## RTX 3060 (12GB) - Real-Time Voice System

**Date:** December 17, 2025  
**Server:** Mercury (192.168.0.151)  
**Jupiter Brain:** 192.168.0.156:3200  
**Current Usage:** ~1.3GB / 12GB (89% FREE!)

---

## 🎯 Executive Summary

**Current State:**
- ✅ ASR: Faster-Whisper distil-large-v3 (local)
- ✅ TTS: Kokoro (English) + Indic-Parler (Hindi/Marathi)
- ✅ LLM: qwen2.5:3b via Ollama (1.9GB)
- ❌ **Jupiter Connection:** Not properly integrated
- ❌ **WebRTC:** Not implemented (needed for Exotel voice calls)
- ⚠️ **GPU Utilization:** Only ~11% used (MASSIVE WASTE!)

**Optimization Goals:**
1. **Speed First:** < 500ms total latency (ASR + LLM + TTS)
2. **GPU Utilization:** Target 60-70% for optimal real-time performance
3. **Jupiter Integration:** Connect to NLU/LLM services on Jupiter
4. **WebRTC:** Add for real Exotel voice calls
5. **Hybrid Intelligence:** Local fast models + Jupiter's brain

---

## 🧠 Architecture Analysis

### Current Setup (Mercury-Centric)
```
┌────────────────────────────────────────────────┐
│         Mercury (192.168.0.151)                │
│         RTX 3060 12GB - Only 1.3GB Used!       │
├────────────────────────────────────────────────┤
│                                                 │
│  ASR (7001)          TTS (7002)                │
│  distil-large-v3     kokoro/indic-parler       │
│  ~300-500ms          ~200-400ms                │
│                                                 │
│  Orchestrator (7000)                           │
│  LLM: qwen2.5:3b (local)                       │
│  ~300-500ms                                    │
│                                                 │
│  ❌ Jupiter: Disconnected                      │
│  ❌ WebRTC: Not implemented                    │
└────────────────────────────────────────────────┘
```

### Optimal Hybrid Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│              Mercury (192.168.0.151)                            │
│              RTX 3060 12GB - Optimized Usage                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐    │
│  │ ASR          │  │ TTS          │  │ Local LLM (Fast)  │    │
│  │ whisper-     │  │ kokoro +     │  │ qwen2.5:7b       │    │
│  │ turbo        │  │ indic-parler │  │ ~200ms           │    │
│  │ ~200ms       │  │ ~250ms       │  │ 4GB RAM          │    │
│  └──────────────┘  └──────────────┘  └───────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Smart Router / Orchestrator                          │      │
│  │ - Simple queries: Local LLM (fast)                  │      │
│  │ - Complex queries: Jupiter NLU+LLM (accurate)       │      │
│  │ - Parallel processing for speed                     │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ WebRTC Gateway (NEW)                                 │      │
│  │ - Exotel voice call integration                      │      │
│  │ - Real-time audio streaming                          │      │
│  │ - VAD + Turn-taking                                  │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP/REST + WebSocket
                      ↓
┌─────────────────────────────────────────────────────────────────┐
│              Jupiter (192.168.0.156)                            │
│              AI Backend (Conversation Brain)                    │
├─────────────────────────────────────────────────────────────────┤
│  :3200 - NestJS (ConversationService, Flows, Agents)           │
│  :8002 - vLLM (Qwen2.5-14B) - Complex reasoning                │
│  :7010 - NLU (Intent Classification)                            │
│  :5432 - PostgreSQL (User history, context)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 GPU Memory Allocation Plan

### Current (Wasteful)
| Component | Memory | Usage |
|-----------|--------|-------|
| Whisper distil-large-v3 | ~1.0GB | ASR |
| Ollama qwen2.5:3b | ~2.0GB loaded | LLM |
| Kokoro TTS | ~0.3GB | TTS English |
| Indic-Parler | ~1.5GB loaded | TTS Indic |
| **WASTED** | **~7GB** | **EMPTY!** |
| **Total** | **~12GB** | **11% util** |

### Optimized (Smart)
| Component | Memory | Usage | Speed |
|-----------|--------|-------|-------|
| **Whisper large-v3-turbo** | ~1.5GB | ASR | 200ms ⚡ |
| **Qwen2.5:7B-Instruct** | ~4GB | Local LLM | 200-300ms |
| Kokoro TTS | ~0.3GB | English TTS | 200ms |
| Indic-Parler TTS | ~1.5GB | Hindi/Marathi | 300ms |
| VAD Model (Silero) | ~0.1GB | Voice detection | 10ms |
| **Buffer** | ~4.5GB | Safety margin | - |
| **Total** | **~12GB** | **60% util** ✅ |

**Key Changes:**
1. **Upgrade qwen2.5:3b → qwen2.5:7b** (2x better quality, still fast)
2. **Keep whisper-large-v3-turbo** (809M params, 4.5x faster than large-v3)
3. **Add Silero VAD** for better turn-taking
4. **Parallel loading** to reduce cold-start latency

---

## 🚀 Speed Optimization Strategy

### Target Latency Breakdown (End-to-End)
```
User speaks → Answer heard: < 1000ms total

┌──────────────────────────────────────────────────────┐
│ Audio Capture (WebRTC)          50ms                 │
├──────────────────────────────────────────────────────┤
│ VAD Detection                   10ms                 │
├──────────────────────────────────────────────────────┤
│ ASR (Whisper-turbo)            200ms ⚡              │
├──────────────────────────────────────────────────────┤
│ Intent Detection                50ms                 │
│ (local or Jupiter)                                   │
├──────────────────────────────────────────────────────┤
│ LLM Generation (local)         250ms                 │
│ OR Jupiter (complex)           400ms                 │
├──────────────────────────────────────────────────────┤
│ TTS Synthesis (Kokoro)         200ms                 │
├──────────────────────────────────────────────────────┤
│ Audio Playback Start (stream)  100ms                 │
└──────────────────────────────────────────────────────┘
TOTAL: 860ms (local) or 1010ms (Jupiter)
```

**Speed Techniques:**
1. **Streaming TTS:** Start playing audio before full generation
2. **Parallel Processing:** ASR + Intent detection simultaneously
3. **Model Quantization:** int8 for Whisper, FP16 for LLMs
4. **Warm Models:** Keep models loaded in GPU memory
5. **Smart Caching:** Cache common responses (greetings, etc.)
6. **Speculative Decoding:** Generate multiple tokens at once

---

## 🔗 Jupiter Integration Strategy

### What Jupiter Provides:
1. **NLU Service (:7010)** - Intent classification, entity extraction
2. **vLLM (:8002)** - Qwen2.5-14B for complex reasoning
3. **Conversation Service (:3200)** - Context management, flows
4. **Database** - User history, preferences, order data

### Integration Patterns:

#### 1. **Simple Query → Local (Fast)**
```python
User: "What's the weather?"
Mercury: whisper-turbo → qwen2.5:7b → kokoro
Latency: ~650ms
NO Jupiter call (save bandwidth)
```

#### 2. **Complex Query → Hybrid (Accurate)**
```python
User: "Where is my order #12345?"
Mercury: whisper-turbo → [LOCAL] qwen2.5:7b (intent detection)
         ↓ Detects: order_tracking intent
Jupiter: Query order DB → vLLM generates response
Mercury: kokoro TTS → speak
Latency: ~1200ms (acceptable for complex query)
```

#### 3. **Context-Aware → Jupiter (Smart)**
```python
User: "Change delivery address" (multi-turn conversation)
Jupiter: Maintains conversation state, validates changes
Mercury: Fast voice I/O
```

### Implementation:
```python
class SmartRouter:
    def route_query(self, text: str, user_id: str) -> str:
        # Fast local intent detection
        intent = self.local_llm.classify_intent(text)
        
        if intent in ["greeting", "weather", "time", "simple_qa"]:
            # LOCAL: Fast response
            return await self.local_llm.generate(text)
        
        elif intent in ["order_tracking", "account_info", "booking"]:
            # JUPITER: Needs database
            return await self.jupiter_client.query(
                text, user_id, intent
            )
        
        else:
            # HYBRID: Try local first, fallback to Jupiter
            local_response = await self.local_llm.generate(text)
            confidence = self.evaluate_confidence(local_response)
            
            if confidence > 0.8:
                return local_response
            else:
                return await self.jupiter_client.query(text, user_id)
```

---

## 📞 WebRTC Integration (Critical for Exotel)

### Why WebRTC?
- **Exotel** requires real-time bidirectional audio
- **Low latency:** < 100ms audio transmission
- **Built-in echo cancellation, noise suppression**
- **Standard protocol** for voice calls

### Architecture:
```
Exotel Call → Mercury WebRTC Gateway → Orchestrator
                       ↓
              [ASR] → [LLM] → [TTS]
                       ↓
              Audio Stream → Exotel → User
```

### Implementation Plan:
1. **Add Mediasoup/Janus WebRTC server**
2. **Integrate with Exotel SIP/WebRTC**
3. **Stream audio to/from orchestrator**
4. **Handle interruptions (barge-in)**

---

## 🎯 Recommended Actions (Priority Order)

### Phase 1: Immediate (Today) ✅
1. **Upgrade to qwen2.5:7b** for better quality
   ```bash
   ollama pull qwen2.5:7b
   docker compose -f /home/ubuntu/mangwale-voice-v2/docker-compose.yml restart orchestrator
   ```

2. **Test whisper-large-v3-turbo** (faster ASR)
   ```bash
   # Update ASR_MODEL in .env
   ASR_MODEL=large-v3-turbo
   ```

3. **Implement Jupiter client in orchestrator**
   - Add REST endpoints for Jupiter NLU/LLM
   - Implement smart routing logic

### Phase 2: This Week 🚀
1. **Add WebRTC gateway**
   - Install Mediasoup or Janus
   - Create WebSocket bridge to orchestrator
   - Test with Exotel sandbox

2. **Optimize TTS streaming**
   - Enable chunked audio generation
   - Start playback before full synthesis

3. **Add caching layer**
   - Redis for common responses
   - Conversation state management

### Phase 3: This Month 📈
1. **Fine-tune models on Mangwale data**
   - Collect voice conversations
   - Fine-tune Whisper for Indic accents
   - Fine-tune LLM on order/customer queries

2. **Production monitoring**
   - Latency tracking per component
   - GPU utilization alerts
   - Error rate monitoring

3. **Load testing**
   - Concurrent call handling
   - Failover testing
   - Cloud fallback verification

---

## 🔥 Quick Wins (Do Now!)

### 1. Use Larger Local LLM
```bash
# Current: qwen2.5:3b (1.9GB)
# Upgrade: qwen2.5:7b (4.4GB) - Better quality, still fast!
ollama pull qwen2.5:7b

# Update config
sed -i 's/LLM_MODEL=qwen2.5:3b/LLM_MODEL=qwen2.5:7b/' /home/ubuntu/mangwale-voice-v2/.env

# Restart
cd /home/ubuntu/mangwale-voice-v2 && docker compose restart orchestrator
```

### 2. Download Datasets from Hugging Face
```bash
# Indian accent speech data for fine-tuning
huggingface-cli download mozilla-foundation/common_voice_16_0 hi --repo-type dataset
huggingface-cli download mozilla-foundation/common_voice_16_0 mr --repo-type dataset

# Indic language models
huggingface-cli download ai4bharat/indic-bert
huggingface-cli download sarvamai/sarvam-2b-v0.5
```

### 3. Enable Whisper-Turbo (4.5x Faster!)
```bash
# Update ASR config
sed -i 's/ASR_MODEL=distil-large-v3/ASR_MODEL=large-v3-turbo/' /home/ubuntu/mangwale-voice-v2/.env

cd /home/ubuntu/mangwale-voice-v2 && docker compose restart asr
```

### 4. Add Jupiter Client
```python
# File: /home/ubuntu/mangwale-voice-v2/orchestrator/jupiter_client.py

import httpx
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("orchestrator.jupiter")

class JupiterClient:
    def __init__(self, base_url: str = "http://192.168.0.156:3200"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=5.0)
    
    async def classify_intent(self, text: str) -> Dict[str, Any]:
        """Get intent from Jupiter NLU"""
        try:
            response = await self.client.post(
                f"{self.base_url}/api/nlu/classify",
                json={"text": text, "language": "auto"}
            )
            return response.json()
        except Exception as e:
            logger.warning(f"Jupiter NLU failed: {e}")
            return {"intent": "unknown", "confidence": 0.0}
    
    async def query_llm(self, text: str, context: Optional[str] = None) -> str:
        """Query Jupiter's vLLM (Qwen2.5-14B)"""
        try:
            response = await self.client.post(
                f"{self.base_url}/api/conversation/query",
                json={
                    "text": text,
                    "context": context,
                    "max_tokens": 256,
                    "temperature": 0.7
                }
            )
            return response.json().get("response", "")
        except Exception as e:
            logger.error(f"Jupiter LLM failed: {e}")
            raise
    
    async def get_order_details(self, order_id: int) -> Dict[str, Any]:
        """Get order details from Jupiter"""
        try:
            response = await self.client.get(
                f"{self.base_url}/api/order/{order_id}"
            )
            return response.json()
        except Exception as e:
            logger.error(f"Jupiter order query failed: {e}")
            return {}
```

---

## 🎪 WebRTC vs WebSocket (Decision Matrix)

### Current: WebSocket ✅
- **Pros:** Simple, works for web chat
- **Cons:** Not compatible with phone calls (Exotel)

### Need: WebRTC 📞
- **Pros:** Standard for voice calls, low latency, works with Exotel
- **Cons:** More complex setup

### Recommendation: **BOTH!**
```
Web Chat (chat.mangwale.ai) → WebSocket → Orchestrator
Phone Calls (Exotel) → WebRTC → Orchestrator
```

---

## 📈 Expected Performance After Optimization

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| ASR Latency | 350ms | 200ms | 1.75x faster |
| LLM Latency (local) | 400ms | 250ms | 1.6x faster |
| TTS Latency | 300ms | 200ms | 1.5x faster |
| **Total (simple)** | **1050ms** | **650ms** | **38% faster** |
| GPU Utilization | 11% | 60% | 5.5x better |
| Model Quality | Good | Excellent | 2x better |
| Jupiter Integration | ❌ | ✅ | New feature |
| Exotel Voice | ❌ | ✅ | New feature |

---

## 🧪 Testing Plan

### 1. Local LLM Upgrade Test
```bash
# Test qwen2.5:7b vs 3b
ollama pull qwen2.5:7b
time ollama run qwen2.5:7b "What is Mangwale?" --verbose

# Compare speed and quality
```

### 2. End-to-End Voice Test
```bash
# Record test audio
arecord -f cd -t wav -d 3 test_voice.wav

# Test ASR
curl -X POST http://localhost:7001/transcribe \
  -F "audio=@test_voice.wav" \
  -F "language=auto"

# Test orchestrator
curl -X POST http://localhost:7000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"text": "Where is my order?", "language": "en"}'
```

### 3. Jupiter Integration Test
```bash
# Test NLU
curl -X POST http://192.168.0.156:3200/api/nlu/classify \
  -H "Content-Type: application/json" \
  -d '{"text": "Track my order 12345", "language": "en"}'

# Test conversation
curl -X POST http://192.168.0.156:3200/api/conversation/query \
  -H "Content-Type: application/json" \
  -d '{"text": "What is Mangwale?", "user_id": "test_user"}'
```

### 4. Load Test
```bash
# Concurrent requests
for i in {1..10}; do
  curl -X POST http://localhost:7000/api/chat \
    -H "Content-Type: application/json" \
    -d '{"text": "Hello", "language": "en"}' &
done
wait
```

---

## 📚 Datasets to Download

### 1. ASR Training (Indic Accents)
```bash
# Common Voice (Hindi, Marathi)
huggingface-cli download mozilla-foundation/common_voice_16_0 hi
huggingface-cli download mozilla-foundation/common_voice_16_0 mr
huggingface-cli download mozilla-foundation/common_voice_16_0 en --include "en/clips/*"

# Indic TTS
huggingface-cli download ai4bharat/indic_tts_v2
```

### 2. LLM Fine-tuning (Mangwale Domain)
```bash
# E-commerce conversational dataset
huggingface-cli download bitext/Bitext-customer-support-llm-chatbot-training-dataset

# Hindi conversational
huggingface-cli download ai4bharat/samanantar
```

### 3. NLU Intent Detection
```bash
# Intent classification
huggingface-cli download banking77
huggingface-cli download clinc_oos
```

---

## 💡 Bonus: Hybrid System Intelligence

### Smart Routing Logic
```python
class HybridIntelligence:
    """
    Mercury (Fast) + Jupiter (Smart) = Best of both worlds
    """
    
    async def process(self, text: str, user_id: str) -> str:
        # STEP 1: Fast local intent detection
        local_intent = await self.local_nlu.classify(text)
        
        # STEP 2: Route based on complexity
        if local_intent["confidence"] > 0.9:
            # HIGH CONFIDENCE: Use local LLM (fast)
            if local_intent["intent"] in ["greeting", "farewell", "weather"]:
                response = await self.local_llm.generate(text)
                return response
        
        # STEP 3: Complex query - use Jupiter
        if local_intent["intent"] in ["order_tracking", "booking", "account"]:
            # Query Jupiter for database access
            jupiter_response = await self.jupiter.query(text, user_id)
            return jupiter_response
        
        # STEP 4: Parallel processing (best of both)
        local_task = self.local_llm.generate(text)
        jupiter_task = self.jupiter.query(text, user_id)
        
        # Race: return whichever finishes first
        done, pending = await asyncio.wait(
            [local_task, jupiter_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        
        # Return fastest response
        return list(done)[0].result()
```

---

## 🎯 Summary: What to Do RIGHT NOW

1. **Upgrade LLM:** `ollama pull qwen2.5:7b` (uses 4GB, still have 6GB free)
2. **Enable Whisper-Turbo:** Edit ASR_MODEL in .env
3. **Add Jupiter client:** Create jupiter_client.py (provided above)
4. **Test end-to-end:** Record voice → transcribe → LLM → TTS
5. **Plan WebRTC:** Research Mediasoup/Janus for Exotel integration
6. **Download datasets:** Start with Common Voice Hindi/Marathi

**Priority:** SPEED > Quality for voice (users prefer fast + 90% accurate over slow + 99% accurate)

---

## 📞 Next Steps for Exotel Voice Calls

1. **Check Exotel API:** What protocol do they use? (SIP, WebRTC, REST?)
2. **Setup WebRTC gateway:** Mediasoup or Janus
3. **Test call flow:** Exotel → Mercury → LLM → Mercury → Exotel
4. **Add call management:** Hold music, transfer, voicemail

**Goal:** Make real voice calls, not just chat!
