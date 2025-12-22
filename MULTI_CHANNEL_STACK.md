# Mangwale Multi-Channel Communication Stack

## Overview

The Mangwale AI platform supports multiple communication channels for customer engagement:

| Channel | Platform | Status | Port | Server |
|---------|----------|--------|------|--------|
| WhatsApp Business | whatsapp | ✅ Active | 3200 | Jupiter |
| Exotel Voice | voice | ✅ Active | 3100 | Mercury |
| Voice AI Agent | voice-ai | ✅ Active | 8091 | Mercury |
| Web Chat | web | ✅ Active | 3005/3200 | Jupiter |
| Telegram Bot | telegram | ❌ Inactive | - | - |

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │         JUPITER (192.168.0.156)         │
                    │                                          │
                    │  ┌──────────────┐  ┌──────────────────┐ │
                    │  │  Dashboard    │  │   API Gateway    │ │
                    │  │  :3005        │  │   :3200          │ │
                    │  └──────────────┘  └──────────────────┘ │
                    │          │                   │           │
                    │  ┌──────────────┐  ┌──────────────────┐ │
                    │  │  AI Service   │  │   vLLM           │ │
                    │  │  (NestJS)     │  │   :8002          │ │
                    │  └──────────────┘  └──────────────────┘ │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────┴─────────────────────────┐
                    │         MERCURY (192.168.0.151)         │
                    │                                          │
                    │  ┌──────────────┐  ┌──────────────────┐ │
                    │  │  Exotel Svc   │  │  Voice Agent V2  │ │
                    │  │  :3100        │  │  :8091           │ │
                    │  └──────────────┘  └──────────────────┘ │
                    │          │                   │           │
                    │  ┌──────────────┐  ┌──────────────────┐ │
                    │  │  ASR          │  │  TTS             │ │
                    │  │  :7000        │  │  :8010           │ │
                    │  │  Whisper v3   │  │  Orpheus 8 voices│ │
                    │  └──────────────┘  └──────────────────┘ │
                    │                                          │
                    │  ┌──────────────┐  ┌──────────────────┐ │
                    │  │  Voice GW     │  │  Exotel UI       │ │
                    │  │  :7100-7101   │  │  :3101           │ │
                    │  └──────────────┘  └──────────────────┘ │
                    └─────────────────────────────────────────┘
```

## Channel Details

### 1. WhatsApp Business
- **Phone Number ID**: 908689285655004
- **WABA ID**: 1538156784195596
- **Business Phone**: +91 97301 99571
- **API Version**: v22.0
- **Webhook**: https://api.mangwale.ai/api/webhook/whatsapp
- **Capabilities**:
  - Text Messages
  - Interactive Buttons (3 max)
  - Interactive Lists (10 sections)
  - CTA URL Buttons
  - Location Sharing/Request
  - Media Messages (Image, Video, Audio, Document)
  - Contact Cards
  - Templates
  - Reactions
  - Read Receipts
  - WhatsApp Flows

### 2. Exotel Voice (IVR & Telephony)
- **Service URL**: http://192.168.0.151:3100
- **Version**: 2.3.0
- **Jupiter Connected**: ✅ Yes (3ms latency)
- **PHP Backend Connected**: ✅ Yes (~929ms latency)
- **Features**:
  - IVR Voice Flows
  - Click-to-Call
  - Number Masking (ExoBridge)
  - Voice Streaming (AgentStream)
  - Verified Calls (Truecaller)
  - SMS Messaging
  - WhatsApp Business API
  - Auto Dialer (PACE)
  - Call Recording
  - Conversation Quality Analysis (CQA)
  - Voice Ordering

### 3. Voice AI Agent (Real-time AI Voice)
- **Service URL**: http://192.168.0.151:8091
- **Version**: 2.1.0
- **Jupiter Connected**: ✅ Yes
- **Features**:
  - ASR (Whisper large-v3 on CUDA)
  - TTS (Orpheus with 8 voices)
  - Real-time WebSocket Streaming
  - Voice Enhancement (Fillers, Emotion, Prosody)
  - Multi-language Support
  - Session Management
  - Jupiter AI Integration

### 4. Web Chat
- **Widget URL**: https://chat.mangwale.ai
- **WebSocket**: wss://api.mangwale.ai/socket
- **Capabilities**:
  - Text Messages
  - Interactive Buttons
  - Product Cards
  - Image Upload
  - Location Sharing
  - Voice Messages
  - Real-time Updates

## Health Check Endpoints

```bash
# Dashboard Channels API
curl http://jupiter:3005/api/channels

# Exotel Service Health
curl http://mercury:3100/health

# Voice Agent V2 Health
curl http://mercury:8091/health

# ASR Health
curl http://mercury:7000/health

# TTS Health
curl http://mercury:8010/health

# Jupiter Backend Health
curl http://jupiter:3200/health
```

## Admin Dashboards

- **Main Admin**: https://admin.mangwale.ai
- **Exotel UI**: http://192.168.0.151:3101
- **Voice AI**: https://admin.mangwale.ai/admin/voice
- **Channels**: https://admin.mangwale.ai/admin/channels

## Integration Flow

### Voice Call → AI Response → TTS
1. Customer calls Exotel number
2. Exotel IVR captures speech
3. Voice Agent V2 receives audio
4. ASR (Whisper) transcribes to text
5. Jupiter AI generates response
6. Voice Enhancement adds emotion/prosody
7. TTS (Orpheus) synthesizes speech
8. Audio played back to customer

### WhatsApp → AI Response
1. Customer sends WhatsApp message
2. Webhook received by API Gateway
3. AI Service processes intent
4. Jupiter generates response
5. Response sent via WhatsApp API

## Environment Variables

```env
# Exotel Service
EXOTEL_SERVICE_URL=http://192.168.0.151:3100
JUPITER_URL=http://192.168.0.156:3200
PHP_BACKEND_URL=https://www.mangwale.com

# Voice Agent
VOICE_AGENT_URL=http://192.168.0.151:8091
ASR_URL=http://192.168.0.151:7000
TTS_URL=http://192.168.0.151:8010
```

## Last Updated
December 16, 2025
