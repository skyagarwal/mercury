# Jupiter Pending Changes - Phase 0 Implementation

**Date:** December 20, 2025  
**Purpose:** Document changes needed on Jupiter (192.168.0.156) for Phase 0 voice integration  
**Reference:** PHASE_0_IMPLEMENTATION_GUIDE.md, STRATEGIC_VOICE_ARCHITECTURE.md

---

## 📋 PHASE 0 CHECKLIST

### Jupiter Tasks (Requires SSH to Jupiter)

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Create Voice Webhook Controller | `backend/src/webhook/voice-webhook.controller.ts` | ❌ TODO |
| 2 | Register in WebhookModule | `backend/src/webhook/webhook.module.ts` | ❌ TODO |
| 3 | Update WhatsApp Interface (audio type) | `backend/src/whatsapp/interfaces/whatsapp.interface.ts` | ❌ TODO |
| 4 | Add Media Download Function | `backend/src/whatsapp/controllers/webhook.controller.ts` | ❌ TODO |
| 5 | Handle Audio Messages in Webhook | `backend/src/whatsapp/controllers/webhook.controller.ts` | ❌ TODO |
| 6 | Add sendAudioMessage Method | `backend/src/whatsapp/services/message.service.ts` | ❌ TODO |
| 7 | Add Voice Response Logic | `backend/src/agents/services/agent-orchestrator.service.ts` | ❌ TODO |
| 8 | Restart Backend | `npm run start:dev` | ❌ TODO |

### Mercury Tasks (Can do from here) ✅

| # | Task | Status |
|---|------|--------|
| 1 | Nerve JupiterAIClient implemented | ✅ DONE |
| 2 | USE_JUPITER_AI=true in .env | ✅ DONE |
| 3 | JUPITER_AI_URL configured | ✅ DONE |
| 4 | TTS cache pre-loaded (35 phrases) | ✅ DONE |
| 5 | Exotel call initiation working | ✅ DONE |
| 6 | ASR service healthy | ✅ DONE |
| 7 | TTS service healthy | ✅ DONE |

---

## 🚨 CRITICAL: Voice Webhook for Nerve System

**Status:** ❌ NOT IMPLEMENTED - Nerve calls fail with 404  
**Mercury Ready:** ✅ Nerve has JupiterAIClient, USE_JUPITER_AI=true  
**Blocking:** All Exotel AI-powered calls

The Nerve system (Mercury) calls this endpoint but it doesn't exist:
\`\`\`
POST http://192.168.0.156:3200/webhook/voice/nerve-process
\`\`\`

### Implementation Required

**File:** \`backend/src/webhook/voice-webhook.controller.ts\` (NEW FILE)

\`\`\`typescript
import { Controller, Post, Body, Logger } from '@nestjs/common';
import { AgentOrchestratorService } from '../agents/services/agent-orchestrator.service';

@Controller('webhook/voice')
export class VoiceWebhookController {
  private readonly logger = new Logger(VoiceWebhookController.name);
  
  constructor(
    private readonly orchestrator: AgentOrchestratorService,
  ) {}

  @Post('nerve-process')
  async processNerveMessage(@Body() body: {
    phone: string;
    message: string;
    sessionId: string;
    platform: string;
    context?: Record<string, any>;
  }) {
    this.logger.log(\`🎤 Voice call from \${body.phone}: "\${body.message}"\`);
    
    try {
      // Process through AgentOrchestrator (same as WhatsApp/Telegram)
      const result = await this.orchestrator.processMessage({
        phone: body.phone,
        message: body.message,
        platform: 'voice',
        sessionId: body.sessionId,
        context: body.context || {},
      });
      
      return {
        success: true,
        text: result.response || result.text || 'जी बोलिए',
        language: result.language || 'hi',
        continue: result.continue !== false,
        action: result.action,
      };
    } catch (error) {
      this.logger.error(\`Voice processing failed: \${error.message}\`);
      return {
        success: false,
        text: 'माफ़ कीजिए, कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।',
        language: 'hi',
        continue: false,
      };
    }
  }
}
\`\`\`

**Register in Module:** \`backend/src/webhook/webhook.module.ts\`

\`\`\`typescript
import { VoiceWebhookController } from './voice-webhook.controller';

@Module({
  imports: [AgentsModule],
  controllers: [WebhookController, VoiceWebhookController],
})
export class WebhookModule {}
\`\`\`

---

## 🔴 PRIORITY 2: WhatsApp Voice Message Support

### Step 1: Update WhatsApp Interface
**File:** \`backend/src/whatsapp/interfaces/whatsapp.interface.ts\`

\`\`\`typescript
export interface WhatsAppMessage {
  type: 'text' | 'interactive' | 'audio' | 'voice';  // ADD audio | voice
  // ... other fields
  audio?: {
    id: string;
    mime_type: string;
  };
}
\`\`\`

### Step 2: Add Media Download Function
**File:** \`backend/src/whatsapp/controllers/webhook.controller.ts\`

\`\`\`typescript
private async downloadWhatsAppMedia(mediaId: string): Promise<string> {
  const axios = require('axios');
  const fs = require('fs').promises;
  
  // Get media URL from WhatsApp
  const mediaUrlResponse = await axios.get(
    \`https://graph.facebook.com/v18.0/\${mediaId}\`,
    { headers: { Authorization: \`Bearer \${process.env.WHATSAPP_ACCESS_TOKEN}\` } }
  );
  const mediaUrl = mediaUrlResponse.data.url;

  // Download media file
  const mediaResponse = await axios.get(mediaUrl, {
    headers: { Authorization: \`Bearer \${process.env.WHATSAPP_ACCESS_TOKEN}\` },
    responseType: 'arraybuffer',
  });

  // Save to temp file
  const tempPath = \`/tmp/whatsapp-audio-\${Date.now()}.ogg\`;
  await fs.writeFile(tempPath, mediaResponse.data);
  return tempPath;
}
\`\`\`

### Step 3: Handle Audio Messages
**File:** \`backend/src/whatsapp/controllers/webhook.controller.ts\`

\`\`\`typescript
if (type === 'audio' || type === 'voice') {
  this.logger.log(\`🎤 Voice message from \${from}\`);
  
  // Download audio from WhatsApp
  const audioPath = await this.downloadWhatsAppMedia(message.audio.id);
  
  // Send to Mercury ASR for transcription
  const transcription = await this.httpService.post(
    'http://192.168.0.151:7001/transcribe',
    { audioPath, language: 'auto' }
  ).toPromise();
  
  // Use transcribed text
  messageText = transcription.data.text;
  
  // Store preference for voice responses
  await this.sessionService.setData(from, 'preferVoice', true);
  
  // Clean up temp file
  const fs = require('fs').promises;
  await fs.unlink(audioPath);
}
\`\`\`

### Step 4: Add sendAudioMessage Method
**File:** \`backend/src/whatsapp/services/message.service.ts\`

\`\`\`typescript
async sendAudioMessage(phone: string, audioBuffer: Buffer): Promise<void> {
  // Upload audio to WhatsApp
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: 'response.ogg', contentType: 'audio/ogg' });
  formData.append('messaging_product', 'whatsapp');
  
  const uploadResponse = await this.httpService.post(
    'https://graph.facebook.com/v18.0/PHONE_NUMBER_ID/media',
    formData,
    { headers: { Authorization: \`Bearer \${process.env.WHATSAPP_ACCESS_TOKEN}\` } }
  ).toPromise();
  
  // Send audio message
  await this.httpService.post(
    \`https://graph.facebook.com/v18.0/PHONE_NUMBER_ID/messages\`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'audio',
      audio: { id: uploadResponse.data.id }
    },
    { headers: { Authorization: \`Bearer \${process.env.WHATSAPP_ACCESS_TOKEN}\` } }
  ).toPromise();
}
\`\`\`

---

## ✅ Already Applied (Committed)

These changes have been committed to the Jupiter repo:

### Backend Commits
1. **Voice Characters Service** - \`generateSystemPromptForCharacter()\` method added
2. **Agent Orchestrator** - Persona injection into system prompt at line ~1204
3. **Settings Controller** - Added \`key/:key\` GET/PUT endpoints
4. **Agents Module** - Imported \`VoiceCharactersModule\`

### Frontend Commits  
1. **Voice Characters Page** - Added persona selector with mascot image
2. **API Routes** - Created \`/api/settings/active-chatbot-persona\` proxy
3. **Voice Characters API** - Created all CRUD proxy routes

---

## 🧪 Test Commands (Run from Mercury after Jupiter changes)

\`\`\`bash
# 1. Test Voice Webhook (CRITICAL - test after implementing)
curl -X POST "http://192.168.0.156:3200/webhook/voice/nerve-process" \\
  -H "Content-Type: application/json" \\
  -d '{"phone":"9923383838","message":"accept","sessionId":"test","platform":"voice"}'

# Expected response:
# {"success":true,"text":"...","language":"hi","continue":true}

# 2. Make Real Exotel Call
curl -X POST "http://localhost:7100/api/nerve/vendor-order-confirmation" \\
  -H "Content-Type: application/json" \\
  -d '{"order_id":99999,"vendor_id":"v001","vendor_phone":"919923383838","vendor_name":"Test","order_amount":350}'

# 3. Check GPU Utilization
nvidia-smi

# 4. Monitor Nerve Logs for Jupiter calls
tail -f /tmp/nerve*.log | grep -i jupiter
\`\`\`

---

## 📁 File Locations Reference

| Component | Jupiter Path |
|-----------|--------------|
| Voice Webhook (NEW) | \`backend/src/webhook/voice-webhook.controller.ts\` |
| Webhook Module | \`backend/src/webhook/webhook.module.ts\` |
| WhatsApp Interface | \`backend/src/whatsapp/interfaces/whatsapp.interface.ts\` |
| WhatsApp Webhook | \`backend/src/whatsapp/controllers/webhook.controller.ts\` |
| Message Service | \`backend/src/whatsapp/services/message.service.ts\` |
| Agent Orchestrator | \`backend/src/agents/services/agent-orchestrator.service.ts\` |

| Component | Mercury Path |
|-----------|--------------|
| Nerve System | \`/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/nerve_system.py\` |
| Jupiter Client | Lines 720-780 in nerve_system.py |
| Nerve .env | \`/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/.env\` |

---

*Last Updated: $(date '+%Y-%m-%d %H:%M')*
