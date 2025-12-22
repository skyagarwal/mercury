# Phase 0 Implementation Guide - Step by Step

**Status:** Implementation files created in `/home/ubuntu/mangwale-voice/phase0-changes/`
**Next:** Apply changes to Jupiter and Mercury servers

---

## 📂 Implementation Files Created

### Jupiter Changes (in `/phase0-changes/jupiter/`)
1. ✅ `whatsapp.interface.ts` - Updated interface with audio/voice support

### Mercury Changes (in `/phase0-changes/mercury/`)
Coming next...

---

## 🚀 Quick Start

### Option 1: Apply All Changes at Once (Fast Track)
```bash
# On Mercury, run this script:
cd /home/ubuntu/mangwale-voice
bash phase0-apply-all.sh
```

### Option 2: Apply Changes Step-by-Step (Careful)
Follow the steps below one by one, testing after each change.

---

## 📝 Step-by-Step Implementation

### PART A: Jupiter Backend Modifications

#### Step 1: Update WhatsApp Interface ✅ DONE
```bash
ssh jupiter
cd /home/ubuntu/Devs/MangwaleAI/backend

# Backup original
cp src/whatsapp/interfaces/whatsapp.interface.ts src/whatsapp/interfaces/whatsapp.interface.ts.backup

# Apply change (manual edit or scp from Mercury)
# File location on Mercury: /home/ubuntu/mangwale-voice/phase0-changes/jupiter/whatsapp.interface.ts
```

**Changes:**
- Added `'audio' | 'voice'` to message type union
- Added `audio?: { id: string; mime_type: string; }` field

#### Step 2: Add Media Download to Webhook Controller
**File:** `src/whatsapp/controllers/webhook.controller.ts`

Add this method to the `WebhookController` class:

```typescript
private async downloadWhatsAppMedia(mediaId: string): Promise<string> {
  try {
    const axios = require('axios');
    const fs = require('fs').promises;
    
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
    await fs.writeFile(tempPath, mediaResponse.data);

    return tempPath;
  } catch (error) {
    this.logger.error(`Media download failed: ${error.message}`);
    throw error;
  }
}
```

#### Step 3: Handle Audio Messages in Webhook
**File:** `src/whatsapp/controllers/webhook.controller.ts`

In the `handleWebhook()` or message routing method, add BEFORE extracting text:

```typescript
// Add after: const type = message.type;

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
    const fs = require('fs').promises;
    await fs.unlink(audioPath);
    
    // Store that user prefers voice
    await this.sessionService.setData(from, 'preferVoice', true);
  } catch (error) {
    this.logger.error(`Voice processing failed: ${error.message}`);
    messageText = ''; // Fallback to empty
  }
}
```

#### Step 4: Add sendAudioMessage Method
**File:** `src/whatsapp/services/message.service.ts`

Add this method to the `MessageService` class:

```typescript
async sendAudioMessage(to: string, audioBuffer: Buffer): Promise<void> {
  try {
    const FormData = require('form-data');
    const axios = require('axios');
    
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
    
    this.logger.log(`✅ Audio message sent to ${to}`);
  } catch (error) {
    this.logger.error(`Send audio failed: ${error.message}`);
    throw error;
  }
}
```

#### Step 5: Add Voice Response Logic
**File:** `src/agents/services/agent-orchestrator.service.ts`

Add after getting response from FlowEngine:

```typescript
// After: const response = await this.flowEngine.processUserInput(...);

// Check if user prefers voice (if they sent a voice message)
const preferVoice = await this.sessionService.getData(phone, 'preferVoice');

if (preferVoice && platform === 'whatsapp') {
  try {
    // Generate TTS audio
    const ttsService = this.moduleRef.get(TtsService, { strict: false });
    const audioBuffer = await ttsService.synthesize({
      text: response.text,
      language: response.language || 'hi-IN',
      provider: 'kokoro',
    });
    
    // Send as voice message
    await this.whatsappService.sendAudioMessage(phone, audioBuffer);
    return; // Don't send text
  } catch (error) {
    this.logger.error(`Voice response failed, sending text: ${error.message}`);
    // Fall through to text response
  }
}

// Send text response (default)
await this.whatsappService.sendTextMessage(phone, response.text);
```

#### Step 6: Add Voice Platform Handler
**File:** `src/agents/controllers/agent.controller.ts`

Add this new endpoint:

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

### PART B: Mercury Backend Modifications

#### Step 7: Add Jupiter AI Integration to Nerve System
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/nerve_system.py`

Add at the top (after imports):

```python
import httpx
import os
from typing import Dict, Any

# Jupiter AI Configuration
JUPITER_AI_URL = os.getenv("JUPITER_AI_URL", "http://192.168.0.156:3200")
JUPITER_API_TIMEOUT = float(os.getenv("JUPITER_API_TIMEOUT", "30.0"))

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
            "text": "क्षमा करें, मैं आपका अनुरोध संसाधित नहीं कर सका। कृपया पुनः प्रयास करें।",
            "language": "hi-IN",
            "status": "error"
        }

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

#### Step 8: Update Callback Handler
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/nerve_system.py`

Replace the `exotel_passthru_callback` function:

```python
@app.api_route("/api/nerve/callback", methods=["GET", "HEAD"])
async def exotel_passthru_callback(
    CallSid: str = Query(None),
    digits: str = Query(None),
    Digits: str = Query(None),
    CustomField: str = Query(None),
    From: str = Query(None),
    To: str = Query(None),
    CallStatus: str = Query(None),
):
    """Exotel Passthru callback - now with Jupiter AI integration"""
    
    logger.info(f"📞 Passthru callback: CallSid={CallSid}, digits={digits or Digits}")
    
    # Parse DTMF input
    dtmf = digits or Digits
    
    # Parse call context
    try:
        call_context = json.loads(CustomField) if CustomField else {}
    except:
        call_context = {}
    
    vendor_phone = call_context.get('vendor_phone') or From
    order_id = call_context.get('order_id', 'unknown')
    
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
        user_input = "start"
    else:
        # Convert DTMF to text
        user_input = digits_to_text(dtmf) if dtmf else "continue"
    
    # Call Jupiter AI for response
    logger.info(f"🤖 Calling Jupiter AI: phone={vendor_phone}, input={user_input}")
    ai_response = await call_jupiter_ai(
        phone=vendor_phone,
        message=user_input,
        session_id=CallSid,
        context=call_state['context']
    )
    
    response_text = ai_response.get('text', '')
    language = ai_response.get('language', 'hi-IN')
    should_continue = ai_response.get('continue', True)
    
    logger.info(f"✅ Jupiter AI response: {response_text[:50]}...")
    
    # Build ExoML response
    callback_url = f"{CALLBACK_BASE_URL}/api/nerve/callback"
    exoml = build_exoml_response(
        text=response_text,
        audio_url=None,  # Using Exotel <Say> for now
        gather_action=callback_url if should_continue else None,
        language=language,
    )
    
    return Response(content=exoml, media_type="application/xml")
```

#### Step 9: Update Environment Configuration
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/.env`

Add these lines at the end:

```bash
# Jupiter AI Integration (Phase 0)
JUPITER_AI_URL=http://192.168.0.156:3200
JUPITER_API_TIMEOUT=30
```

---

## 🚀 Deployment Steps

### 1. Apply Jupiter Changes
```bash
ssh jupiter
cd /home/ubuntu/Devs/MangwaleAI/backend

# Make backups
cp src/whatsapp/interfaces/whatsapp.interface.ts src/whatsapp/interfaces/whatsapp.interface.ts.backup
cp src/whatsapp/controllers/webhook.controller.ts src/whatsapp/controllers/webhook.controller.ts.backup
cp src/whatsapp/services/message.service.ts src/whatsapp/services/message.service.ts.backup
cp src/agents/controllers/agent.controller.ts src/agents/controllers/agent.controller.ts.backup
cp src/agents/services/agent-orchestrator.service.ts src/agents/services/agent-orchestrator.service.ts.backup

# Apply changes (manual edits based on guide above)
# ... edit files ...

# Rebuild and restart
docker restart mangwale_ai_service
```

### 2. Apply Mercury Changes
```bash
cd /home/ubuntu/mangwale-voice/escotel-stack/exotel-service

# Make backups
cp nerve_system.py nerve_system.py.backup
cp .env .env.backup

# Apply changes (manual edits based on guide above)
# ... edit files ...

# Restart Nerve System
pkill -9 -f nerve_system.py
nohup .venv/bin/python nerve_system.py > /tmp/nerve-phase0.log 2>&1 &
```

---

## 🧪 Testing

### Test 1: Health Checks
```bash
# Mercury
curl http://localhost:7100/health | jq

# Jupiter  
ssh jupiter "curl http://localhost:3200/health"
```

### Test 2: WhatsApp Voice
1. Send voice message to your WhatsApp number
2. Check Jupiter logs: `docker logs -f mangwale_ai_service | grep voice`
3. Verify transcription appears
4. Verify response sent

### Test 3: Exotel → Jupiter AI
```bash
# Make test call
curl -X POST "http://192.168.0.151:7100/api/nerve/vendor-order-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_phone": "919923383838",
    "vendor_name": "Test",
    "vendor_id": "V001",
    "order_id": 12345,
    "order_amount": 999
  }'

# Monitor logs
tail -f /tmp/nerve-phase0.log | grep "Jupiter"
```

### Test 4: GPU Utilization
```bash
watch -n 1 nvidia-smi
```

---

## 📊 Success Checklist

- [ ] WhatsApp interface updated with audio/voice types
- [ ] Media download function working
- [ ] Audio messages transcribed correctly
- [ ] Voice responses sent (optional)
- [ ] Jupiter API endpoint for voice platform added
- [ ] Nerve System calls Jupiter AI successfully
- [ ] AI responses returned (not static scripts)
- [ ] GPU utilization increases during calls
- [ ] All health checks pass
- [ ] No errors in logs

---

**Next:** Would you like me to create an automated script to apply all these changes, or would you prefer to apply them manually step-by-step?
