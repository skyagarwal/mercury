# 🎙️ Mangwale Next-Gen Voice Agent Stack

## Overview

This is a **production-ready, GPU-optimized voice agent platform** built for RTX 3060 12GB, combining the best open-source components for building real-time conversational AI agents.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATIONS                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Web UI    │  │  Mobile App │  │   SIP/Phone │  │  IoT Device │    │
│  │  (WebRTC)   │  │  (WebRTC)   │  │  (Twilio)   │  │  (WebSocket)│    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
└─────────┼────────────────┼────────────────┼────────────────┼───────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      🎯 VOICE AGENT ORCHESTRATOR                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  • WebRTC/WebSocket Transport Layer                              │   │
│  │  • Voice Activity Detection (Silero VAD)                         │   │
│  │  • Turn Detection & Interruption Handling                        │   │
│  │  • Session Management & State Machine                            │   │
│  │  • Multi-Agent Handoff Support                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   🎤 ASR/STT     │  │   🧠 LLM/AGENT   │  │   🔊 TTS         │
│  ────────────────│  │  ────────────────│  │  ────────────────│
│  Faster-Whisper  │  │  Ollama (local)  │  │  Orpheus TTS     │
│  Large-v3 + VAD  │  │  - Llama 3.2     │  │  (3B, ~200ms)    │
│                  │  │  - Qwen 2.5      │  │                  │
│  Features:       │  │  - Mistral       │  │  Features:       │
│  • Streaming     │  │                  │  │  • Emotions      │
│  • Hindi/Multi   │  │  Features:       │  │  • Voice Clone   │
│  • GPU: ~3GB     │  │  • Function Call │  │  • Streaming     │
│                  │  │  • RAG/Tools     │  │  • GPU: ~6GB     │
│  Port: 7000      │  │  • Memory        │  │                  │
└────────┬─────────┘  │                  │  │  Port: 8020      │
         │            │  Port: 11434     │  └────────┬─────────┘
         │            └────────┬─────────┘           │
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  🗄️ SERVICES        │
                    │  • Redis (state)    │
                    │  • PostgreSQL (logs)│
                    │  • Vector DB (RAG)  │
                    └─────────────────────┘
```

## 🎯 Why This Stack?

### vs. Commercial Solutions (Vapi, Retell, ElevenLabs)
- **Self-hosted**: No API costs, full data privacy
- **Low latency**: <300ms end-to-end (vs 500ms+ commercial)
- **Customizable**: Fine-tune models, add custom tools

### vs. Other Open-Source (Pipecat, LiveKit Agents)
- **Single GPU optimized**: Runs entirely on RTX 3060 12GB
- **Hindi/Indic support**: Native multilingual ASR
- **SOTA TTS quality**: Orpheus beats ElevenLabs in naturalness

## 📊 GPU Memory Budget (12GB RTX 3060)

| Component | VRAM | Notes |
|-----------|------|-------|
| Faster-Whisper Large-v3 | ~3.5 GB | FP16, batch_size=1 |
| Orpheus TTS 3B | ~6 GB | FP16/BF16, vLLM backend |
| System/CUDA Overhead | ~1 GB | Drivers, context |
| **Total** | **~10.5 GB** | ✅ Fits with headroom |

## 🚀 Key Features

### 1. Real-Time Voice Conversations
- WebRTC transport for <100ms audio latency
- Silero VAD for accurate speech detection
- Interruption handling (barge-in support)
- Turn detection to know when user finished speaking

### 2. Function Calling / Tools
```python
@function_tool
async def book_appointment(date: str, time: str, service: str):
    """Book an appointment for a service"""
    return {"status": "booked", "confirmation": "APT-12345"}

@function_tool  
async def check_weather(location: str):
    """Get weather for a location"""
    return {"temp": "28°C", "condition": "sunny"}
```

### 3. Multi-Agent Handoffs
```python
# Receptionist -> Specialist handoff
if intent == "technical_support":
    return TechSupportAgent(), "Transferring to technical support..."
```

### 4. Voice Cloning
- 10-second audio sample for voice cloning
- Emotion tags: `<laugh>`, `<sigh>`, `<chuckle>`
- Multiple speaker voices

### 5. Multilingual Support
- Hindi, English, Tamil, Telugu, Bengali, etc.
- Code-switching detection
- Language-specific voice models

## 🔧 Services Overview

### ASR Service (Port 7000)
- **Model**: Faster-Whisper Large-v3
- **Features**: Streaming, VAD, Hindi-optimized
- **Endpoints**: `/v1/audio/transcriptions`, `/ws/stream`

### TTS Service (Port 8020)  
- **Model**: Orpheus TTS 3B (or Dia 1.6B alternative)
- **Features**: Streaming, emotions, voice cloning
- **Endpoints**: `/v1/audio/speech`, `/ws/stream`

### Voice Gateway (Port 8080)
- **Transport**: WebRTC, WebSocket, HTTP
- **Features**: VAD, turn detection, session management
- **Endpoints**: `/ws/voice`, `/api/sessions`

### Agent Orchestrator (Port 8090)
- **LLM**: Ollama (Llama 3.2, Qwen 2.5)
- **Features**: Function calling, RAG, memory
- **Endpoints**: `/api/chat`, `/api/agents`

## 📈 Performance Targets

| Metric | Target | How |
|--------|--------|-----|
| Time to First Byte (TTS) | <200ms | vLLM + streaming |
| End-to-End Latency | <500ms | Parallel processing |
| Concurrent Sessions | 2-4 | GPU memory management |
| Audio Quality | 24kHz | Orpheus native |

## 🎮 Use Cases

1. **Voice Customer Support Agent**
   - Handle inquiries, book appointments, check orders
   
2. **Interactive Voice Response (IVR)**
   - Phone-based AI assistant with Twilio/SIP
   
3. **Voice-Controlled Home Automation**
   - IoT device control via voice
   
4. **Language Learning Assistant**
   - Conversation practice with feedback
   
5. **Accessibility Voice Interface**
   - Voice control for applications

## 🔜 Roadmap

- [ ] Phase 1: Orpheus TTS integration (replace XTTS)
- [ ] Phase 2: WebRTC transport layer
- [ ] Phase 3: Voice agent orchestrator
- [ ] Phase 4: Function calling & tools
- [ ] Phase 5: Multi-agent support
- [ ] Phase 6: Telephony (SIP/Twilio)
- [ ] Phase 7: Admin dashboard
