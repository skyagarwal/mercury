# Phase 0: Mercury ↔ Jupiter Integration (CRITICAL)

**Date:** December 19, 2025
**Priority:** URGENT - Do This Week
**Effort:** 2-3 days
**Impact:** Unlocks entire AI stack for voice calls

---

## 🎯 The Problem

**Current State:**
```
Mercury (Voice Processing)          Jupiter (AI Brain)
├─ ASR (Faster Whisper)             ├─ Flow Engine (YAML)
├─ TTS (Indic Parler)               ├─ NLU (IndicBERT)
├─ Nerve System (static scripts)    ├─ LLM (Qwen2.5-7B)
├─ GPU (0% utilization)             ├─ Search (OpenSearch)
└─ Exotel Integration               └─ Database (PostgreSQL)

❌ NOT CONNECTED ❌
```

**Issues:**
1. Exotel calls → Mercury Nerve → **Static hardcoded scripts** (no AI)
2. WhatsApp voice → Jupiter → **Not handled** (audio type missing)
3. GPU at 0% utilization (doing nothing)
4. Jupiter's AI/NLU/LLM/Flow Engine **not used for voice**

---

## 🎨 Target Architecture

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│   Exotel    │────────▶│ Mercury      │────────▶│ Jupiter AI   │
│   Calls     │         │  ASR/TTS     │ HTTP    │  Backend     │
└─────────────┘         └──────────────┘         └───────┬──────┘
                                                           │
┌─────────────┐         ┌──────────────┐                 │
│  WhatsApp   │────────▶│ Jupiter AI   │─────────────────┤
│  Voice Msg  │ Media   │   Webhook    │                 │
└─────────────┘         └──────────────┘                 │
                                                          │
                                                  ┌───────▼────────┐
                                                  │  Flow Engine   │
                                                  │  NLU/LLM       │
                                                  │  AI Services   │
                                                  └────────────────┘
```

**Data Flow:**
1. **Voice Input** (Exotel or WhatsApp) → Mercury ASR
2. **Transcription** → Jupiter AI Backend
3. **AI Processing** → Flow Engine + NLU + LLM
4. **Response Text** → Mercury TTS
5. **Audio Output** → Exotel or WhatsApp

---

## 📋 Implementation Tasks

### Task 1: Fix WhatsApp Voice Support (Jupiter)

**Files to modify:**

#### 1.1 Update WhatsApp Interface
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/whatsapp/interfaces/whatsapp.interface.ts`

```typescript
// BEFORE:
export interface WhatsAppMessage {
  type: 'text' | 'interactive' | 'location' | 'button' | 'image' | 'document';
  // ...
}

// AFTER:
export interface WhatsAppMessage {
  type: 'text' | 'interactive' | 'location' | 'button' | 'image' | 'document' | 'audio' | 'voice';
  audio?: {
    id: string;           // WhatsApp media ID
    mime_type: string;    // 'audio/ogg; codecs=opus'
  };
  // ...
}
```

#### 1.2 Add Media Download Function
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/whatsapp/controllers/webhook.controller.ts`

```typescript
private async downloadWhatsAppMedia(mediaId: string): Promise<string> {
  try {
    // 1. Get media URL from WhatsApp
    const mediaUrlResponse = await axios.get(
      `https://graph.facebook.com/${this.whatsappApiVersion}/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${this.whatsappAccessToken}`,
        },
      }
    );
    const mediaUrl = mediaUrlResponse.data.url;

    // 2. Download media file
    const mediaResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${this.whatsappAccessToken}`,
      },
      responseType: 'arraybuffer',
    });

    // 3. Save to temp file
    const tempPath = `/tmp/whatsapp-audio-${Date.now()}.ogg`;
    await fs.promises.writeFile(tempPath, mediaResponse.data);

    return tempPath;
  } catch (error) {
    this.logger.error(`Media download failed: ${error.message}`);
    throw error;
  }
}
```

#### 1.3 Handle Audio Messages in Webhook
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/whatsapp/controllers/webhook.controller.ts`

```typescript
// In handleWebhook() method, add before text processing:

if (type === 'audio' || type === 'voice') {
  this.logger.log(`🎤 Voice message from ${from}`);
  
  try {
    // Download audio from WhatsApp
    const audioPath = await this.downloadWhatsAppMedia(message.audio.id);
    
    // Send to Mercury ASR for transcription
    const asrService = this.moduleRef.get(AsrService, { strict: false });
    const transcription = await asrService.transcribe({
      audioPath,
      language: 'auto', // Auto-detect Hindi/English
    });
    
    this.logger.log(`📝 Transcribed: "${transcription.text}"`);
    
    // Use transcribed text as messageText
    messageText = transcription.text;
    
    // Clean up temp file
    await fs.promises.unlink(audioPath);
    
    // Store that user prefers voice
    await this.sessionService.setData(from, 'preferVoice', true);
  } catch (error) {
    this.logger.error(`Voice processing failed: ${error.message}`);
    messageText = ''; // Fallback to empty (will trigger error handling)
  }
}
```

#### 1.4 Send Voice Responses (Optional)
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/whatsapp/services/message.service.ts`

```typescript
async sendAudioMessage(to: string, audioBuffer: Buffer): Promise<void> {
  try {
    // 1. Upload audio to WhatsApp
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'response.ogg',
      contentType: 'audio/ogg',
    });
    formData.append('messaging_product', 'whatsapp');

    const uploadResponse = await axios.post(
      `https://graph.facebook.com/${this.whatsappApiVersion}/${this.phoneNumberId}/media`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );
    const mediaId = uploadResponse.data.id;

    // 2. Send audio message
    await this.sendMessage(to, {
      type: 'audio',
      audio: {
        id: mediaId,
      },
    });
  } catch (error) {
    this.logger.error(`Send audio failed: ${error.message}`);
    throw error;
  }
}
```

#### 1.5 Integrate Voice Response in Flow
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/agents/services/agent-orchestrator.service.ts`

```typescript
// After getting response from FlowEngine:
const response = await this.flowEngine.processUserInput(...);

// Check if user prefers voice
const preferVoice = await this.sessionService.getData(phone, 'preferVoice');

if (preferVoice && platform === 'whatsapp') {
  // Generate TTS audio
  const ttsService = this.moduleRef.get(TtsService, { strict: false });
  const audioBuffer = await ttsService.synthesize({
    text: response.text,
    language: response.language || 'hi-IN',
    provider: 'kokoro',
  });
  
  // Send as voice message
  await this.whatsappService.sendAudioMessage(phone, audioBuffer);
} else {
  // Send as text
  await this.whatsappService.sendTextMessage(phone, response.text);
}
```

---

### Task 2: Connect Mercury Nerve to Jupiter AI

**Files to modify:**

#### 2.1 Add Jupiter Integration to Nerve System
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/nerve_system.py`

```python
import httpx
import os
from typing import Dict, Any

# Configuration
JUPITER_AI_URL = os.getenv("JUPITER_AI_URL", "http://192.168.0.156:3200")
JUPITER_API_TIMEOUT = 30.0

async def call_jupiter_ai(
    phone: str,
    message: str,
    session_id: str,
    context: Dict[str, Any]
) -> Dict[str, Any]:
    """Call Jupiter AI Backend for intelligent response"""
    try:
        async with httpx.AsyncClient(timeout=JUPITER_API_TIMEOUT) as client:
            response = await client.post(
                f"{JUPITER_AI_URL}/api/agents/process",
                json={
                    "phone": phone,
                    "message": message,
                    "platform": "voice",
                    "sessionId": session_id,
                    "context": context,
                },
                headers={
                    "Content-Type": "application/json",
                }
            )
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logger.error(f"Jupiter AI call failed: {str(e)}")
        # Fallback to static script
        return {
            "text": "Sorry, I couldn't process your request. Please try again.",
            "status": "error"
        }

# Replace existing callback handler
@app.api_route("/api/nerve/callback", methods=["GET", "HEAD"])
async def exotel_passthru_callback(
    CallSid: str = Query(None),
    digits: str = Query(None),
    Digits: str = Query(None),
    CustomField: str = Query(None),
    # ... other parameters
):
    """Exotel Passthru callback - now with Jupiter AI integration"""
    
    # Parse DTMF input
    dtmf = digits or Digits
    
    # Parse call context
    call_context = json.loads(CustomField) if CustomField else {}
    vendor_phone = call_context.get('vendor_phone')
    order_id = call_context.get('order_id')
    
    # Get or create call state
    call_state = active_calls.get(CallSid)
    
    if not call_state:
        # First call - initialize
        call_state = {
            'CallSid': CallSid,
            'vendor_phone': vendor_phone,
            'order_id': order_id,
            'step': 'greeting',
            'context': call_context,
        }
        active_calls[CallSid] = call_state
    
    # Convert DTMF to text
    user_input = digits_to_text(dtmf) if dtmf else "start"
    
    # Call Jupiter AI for response
    logger.info(f"Calling Jupiter AI: phone={vendor_phone}, input={user_input}")
    ai_response = await call_jupiter_ai(
        phone=vendor_phone,
        message=user_input,
        session_id=CallSid,
        context=call_state['context']
    )
    
    response_text = ai_response.get('text', '')
    language = ai_response.get('language', 'hi-IN')
    should_continue = ai_response.get('continue', True)
    
    # Generate TTS audio (optional, if not using Exotel <Say>)
    audio_url = None
    if USE_AUDIO_FILES:
        audio_url = await generate_tts(response_text, language)
    
    # Build ExoML response
    callback_url = f"{CALLBACK_BASE_URL}/api/nerve/callback"
    exoml = build_exoml_response(
        text=response_text,
        audio_url=audio_url,
        gather_action=callback_url if should_continue else None,
        language=language,
    )
    
    return Response(content=exoml, media_type="application/xml")

def digits_to_text(digits: str) -> str:
    """Convert DTMF digits to text"""
    mapping = {
        '1': 'accept',
        '2': 'reject',
        '0': 'help',
        '*': 'repeat',
        '#': 'confirm',
    }
    return mapping.get(digits, digits)
```

#### 2.2 Add Environment Variable
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/.env`

```bash
# Jupiter AI Integration
JUPITER_AI_URL=http://192.168.0.156:3200
JUPITER_API_TIMEOUT=30
```

#### 2.3 Add Voice Platform Handler in Jupiter
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/agents/controllers/agent.controller.ts`

```typescript
@Post('process')
async processMessage(
  @Body() dto: {
    phone: string;
    message: string;
    platform: 'whatsapp' | 'telegram' | 'sms' | 'voice';
    sessionId: string;
    context?: any;
  }
) {
  this.logger.log(`📞 ${dto.platform} message from ${dto.phone}: "${dto.message}"`);
  
  // Route to AgentOrchestrator (handles all platforms)
  const response = await this.agentOrchestratorService.processMessage(
    dto.phone,
    dto.message,
    dto.platform,
    dto.sessionId,
    dto.context,
  );
  
  return {
    text: response.text,
    language: response.language || 'hi-IN',
    continue: response.continue !== false,
    context: response.context,
  };
}
```

---

### Task 3: Test End-to-End

#### 3.1 Test WhatsApp Voice
```bash
# 1. SSH to Jupiter
ssh jupiter

# 2. Check logs
docker logs -f mangwale_ai_service | grep -E "voice|audio|transcribe"

# 3. Send WhatsApp voice message from your phone
# WhatsApp → +91 (your WhatsApp number)
# Send a voice message saying "मुझे चावल चाहिए" (I want rice)

# 4. Verify:
# - Audio downloaded: /tmp/whatsapp-audio-*.ogg
# - ASR called: Mercury port 7001
# - Transcription logged
# - Flow Engine processed
# - Response sent (text or voice)
```

#### 3.2 Test Exotel → Jupiter AI
```bash
# 1. Make test call
curl -X POST "http://192.168.0.151:7100/api/nerve/vendor-order-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_phone": "919923383838",
    "vendor_name": "Test Vendor",
    "vendor_id": "V001",
    "order_id": 12345,
    "order_amount": 999,
    "order_details": {"items": "Test"}
  }'

# 2. Monitor Nerve logs (Mercury)
tail -f /tmp/nerve-*.log | grep -E "Jupiter|AI|response"

# 3. Monitor Jupiter logs
ssh jupiter "docker logs -f mangwale_ai_service | grep -E 'voice|process'"

# 4. Answer phone call, press 1 (accept)
# Verify:
# - Nerve calls Jupiter API
# - Jupiter Flow Engine processes
# - Response returned to Nerve
# - ExoML generated with AI response
```

#### 3.3 Check GPU Utilization
```bash
# Should go from 0% to 20-30% during calls
watch -n 1 nvidia-smi
```

---

## 📊 Success Criteria

**WhatsApp Voice:**
- ✅ Voice message received and downloaded
- ✅ ASR transcribes correctly (Hindi/English)
- ✅ Jupiter Flow Engine processes transcription
- ✅ Response sent (text or voice)
- ✅ GPU utilization increases (ASR: 10-20%)

**Exotel → Jupiter:**
- ✅ Nerve calls Jupiter API successfully
- ✅ Jupiter Flow Engine handles "voice" platform
- ✅ AI-generated response returned to Nerve
- ✅ ExoML contains dynamic AI response (not static script)
- ✅ Call flow works end-to-end

**GPU:**
- ✅ Utilization goes from 0% to 20-40% during calls
- ✅ ASR processing visible in nvidia-smi
- ✅ TTS processing visible in nvidia-smi

---

## 🎯 Benefits After Phase 0

1. **Unified AI for All Channels:**
   - WhatsApp text ✅
   - WhatsApp voice ✅ (NEW)
   - Telegram ✅
   - SMS ✅
   - Voice calls ✅ (NEW)
   - All use same Flow Engine, NLU, LLM

2. **GPU Actually Working:**
   - ASR: Real-time transcription
   - TTS: Voice synthesis
   - Utilization: 20-40% (from 0%)

3. **No More Static Scripts:**
   - Exotel calls use Jupiter's AI
   - Dynamic responses based on context
   - Can modify flows via YAML (no code changes)

4. **Foundation for Phase 2:**
   - FreeSWITCH can now integrate via same Jupiter API
   - WebRTC calls will use same AI brain
   - Voice Gateway → Jupiter → Flow Engine

---

## 📝 Rollout Plan

**Day 1 (Monday):**
- Morning: Update WhatsApp interface + media download
- Afternoon: Test WhatsApp voice message handling
- Evening: Deploy to production, monitor

**Day 2 (Tuesday):**
- Morning: Add Jupiter integration to Nerve System
- Afternoon: Test Exotel → Jupiter AI flow
- Evening: Deploy Nerve updates, monitor GPU

**Day 3 (Wednesday):**
- Morning: End-to-end testing (WhatsApp + Exotel)
- Afternoon: Monitor 50 real calls
- Evening: Document issues, optimize

**Day 4-5 (Thu-Fri):**
- Bug fixes and optimization
- Performance monitoring
- GPU utilization tuning

---

## 🚨 Rollback Plan

**If Phase 0 breaks production:**

**WhatsApp:**
```bash
# Revert to text-only
git checkout HEAD~1 src/whatsapp/interfaces/whatsapp.interface.ts
git checkout HEAD~1 src/whatsapp/controllers/webhook.controller.ts
docker restart mangwale_ai_service
```

**Nerve System:**
```bash
# Revert to static scripts
git checkout HEAD~1 nerve_system.py
pkill -9 -f nerve_system.py
nohup .venv/bin/python nerve_system.py > /tmp/nerve.log 2>&1 &
```

---

## 📌 Next Steps After Phase 0

Once Phase 0 is stable (1-2 weeks):
1. **Phase 1:** Stabilize and optimize (fix bugs, tune performance)
2. **Phase 2:** Add FreeSWITCH + WebRTC (in-app voice calls)
3. **Phase 3:** AI voice agents (GPU-powered real-time streaming)

**Don't start Phase 2 until Phase 0 is rock solid.**

---

*Created: December 19, 2025*
*Priority: URGENT - Start Monday*
*Owner: Engineering Team*
*Review: Friday EOD*
