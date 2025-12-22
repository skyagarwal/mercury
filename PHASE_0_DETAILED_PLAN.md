# Phase 0 Implementation Plan - Detailed Breakdown

**Date:** December 19, 2025
**Duration:** 2-3 days
**Goal:** Connect Mercury voice services to Jupiter AI brain

---

## 📋 Implementation Roadmap

### 🟦 Part A: Jupiter Backend (WhatsApp Voice Support)

#### Task 1: Update WhatsApp Interface ✅
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/whatsapp/interfaces/whatsapp.interface.ts`
**Action:** Add `audio` and `voice` types to WhatsAppMessage interface
**Time:** 5 minutes
**Dependencies:** None

#### Task 2: Add Media Download Function ✅
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/whatsapp/controllers/webhook.controller.ts`
**Action:** Create `downloadWhatsAppMedia()` method
**Time:** 15 minutes
**Dependencies:** Task 1

#### Task 3: Handle Audio Messages in Webhook ✅
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/whatsapp/controllers/webhook.controller.ts`
**Action:** Add audio message handling in `handleWebhook()` method
**Time:** 20 minutes
**Dependencies:** Task 2

#### Task 4: Add sendAudioMessage Method ✅
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/whatsapp/services/message.service.ts`
**Action:** Create `sendAudioMessage()` method
**Time:** 15 minutes
**Dependencies:** None

#### Task 5: Add Voice Response Logic ✅
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/agents/services/agent-orchestrator.service.ts`
**Action:** Add voice response generation after FlowEngine processing
**Time:** 20 minutes
**Dependencies:** Task 4

**Part A Total Time:** ~75 minutes

---

### 🟧 Part B: Jupiter Backend (Voice Platform Support)

#### Task 6: Add Voice Platform Handler ✅
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/agents/controllers/agent.controller.ts`
**Action:** Add `POST /api/agents/process` endpoint for voice platform
**Time:** 15 minutes
**Dependencies:** None

**Part B Total Time:** ~15 minutes

---

### 🟩 Part C: Mercury Backend (Nerve System Integration)

#### Task 7: Add Jupiter AI Integration Function ✅
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/nerve_system.py`
**Action:** Create `call_jupiter_ai()` function
**Time:** 20 minutes
**Dependencies:** None

#### Task 8: Update Callback Handler ✅
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/nerve_system.py`
**Action:** Modify `exotel_passthru_callback()` to use Jupiter AI
**Time:** 30 minutes
**Dependencies:** Task 7

#### Task 9: Add digits_to_text Helper ✅
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/nerve_system.py`
**Action:** Create DTMF to text conversion function
**Time:** 10 minutes
**Dependencies:** None

#### Task 10: Update Environment Configuration ✅
**File:** `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/.env`
**Action:** Add `JUPITER_AI_URL` and `JUPITER_API_TIMEOUT`
**Time:** 5 minutes
**Dependencies:** None

**Part C Total Time:** ~65 minutes

---

### 🟪 Part D: Deployment & Testing

#### Task 11: Restart Jupiter AI Service ✅
**Location:** Jupiter server
**Command:** `docker restart mangwale_ai_service`
**Time:** 2 minutes
**Dependencies:** Tasks 1-6

#### Task 12: Restart Nerve System ✅
**Location:** Mercury server
**Command:** Restart Nerve System process
**Time:** 2 minutes
**Dependencies:** Tasks 7-10

#### Task 13: Test WhatsApp Voice Message ✅
**Action:** Send voice message via WhatsApp, verify transcription
**Time:** 10 minutes
**Dependencies:** Tasks 11, 12

#### Task 14: Test Exotel → Jupiter AI ✅
**Action:** Make test call, verify AI response
**Time:** 10 minutes
**Dependencies:** Tasks 11, 12

#### Task 15: Monitor GPU Utilization ✅
**Action:** Check `nvidia-smi` during calls
**Time:** 5 minutes
**Dependencies:** Tasks 13, 14

**Part D Total Time:** ~30 minutes

---

## 🎯 Execution Order

### Session 1: Jupiter WhatsApp Support (90 min)
```
1. Update WhatsApp interface (5 min)
2. Add media download function (15 min)
3. Handle audio messages (20 min)
4. Add sendAudioMessage (15 min)
5. Add voice response logic (20 min)
6. Add voice platform handler (15 min)
7. Restart Jupiter service (2 min)
8. Test on staging (if available)
```

### Session 2: Mercury Nerve Integration (75 min)
```
1. Add Jupiter AI integration (20 min)
2. Update callback handler (30 min)
3. Add helper functions (10 min)
4. Update .env configuration (5 min)
5. Restart Nerve System (2 min)
6. Basic connectivity test (8 min)
```

### Session 3: End-to-End Testing (30 min)
```
1. Test WhatsApp voice message (10 min)
2. Test Exotel → Jupiter AI (10 min)
3. Monitor GPU utilization (5 min)
4. Check logs for errors (5 min)
```

---

## 📂 Files to Modify

### Jupiter Server (6 files)
```
/home/ubuntu/Devs/MangwaleAI/backend/src/
├── whatsapp/
│   ├── interfaces/whatsapp.interface.ts          [MODIFY]
│   ├── controllers/webhook.controller.ts         [MODIFY]
│   └── services/message.service.ts               [MODIFY]
└── agents/
    ├── controllers/agent.controller.ts           [MODIFY]
    └── services/agent-orchestrator.service.ts    [MODIFY]
```

### Mercury Server (2 files)
```
/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/
├── nerve_system.py                                [MODIFY]
└── .env                                           [MODIFY]
```

---

## 🔧 Required Dependencies

### Python (Mercury - Already Installed)
- ✅ `httpx` - For async HTTP requests to Jupiter
- ✅ `fastapi` - Already in use
- ✅ `uvicorn` - Already in use

### TypeScript (Jupiter - Already Installed)
- ✅ `axios` - For HTTP requests
- ✅ `form-data` - For file uploads to WhatsApp
- ✅ All NestJS modules - Already in use

---

## 🧪 Test Scenarios

### Test 1: WhatsApp Voice Message
**Input:** Send voice message "मुझे चावल चाहिए" (I want rice)
**Expected:**
1. Audio downloaded from WhatsApp
2. ASR transcribes to text
3. Jupiter Flow Engine processes
4. Response generated
5. (Optional) Voice response sent back

**Success Criteria:**
- ✅ Audio file downloaded to `/tmp/whatsapp-audio-*.ogg`
- ✅ Transcription logged in Jupiter logs
- ✅ Flow Engine processes intent correctly
- ✅ Response sent to user (text or voice)

### Test 2: Exotel → Jupiter AI
**Input:** Make call, press 1 (accept)
**Expected:**
1. Nerve calls Jupiter `/api/agents/process`
2. Jupiter Flow Engine returns response
3. Nerve generates ExoML with AI response
4. Call continues with dynamic flow

**Success Criteria:**
- ✅ Jupiter API called successfully (logs show request)
- ✅ AI response returned (not static script)
- ✅ ExoML generated with AI text
- ✅ Call flow works correctly

### Test 3: GPU Utilization
**Input:** Make multiple concurrent calls
**Expected:**
- GPU utilization increases from 0% to 20-40%
- ASR/TTS processes visible in nvidia-smi

**Success Criteria:**
- ✅ GPU utilization > 0%
- ✅ Multiple processes using GPU
- ✅ No GPU errors in logs

---

## 🚨 Rollback Procedures

### If Jupiter Changes Break WhatsApp
```bash
ssh jupiter
cd /home/ubuntu/Devs/MangwaleAI/backend

# Revert changes
git checkout HEAD~1 src/whatsapp/interfaces/whatsapp.interface.ts
git checkout HEAD~1 src/whatsapp/controllers/webhook.controller.ts
git checkout HEAD~1 src/whatsapp/services/message.service.ts

# Restart service
docker restart mangwale_ai_service
```

### If Nerve Changes Break Calls
```bash
cd /home/ubuntu/mangwale-voice/escotel-stack/exotel-service

# Revert nerve_system.py
git checkout HEAD~1 nerve_system.py

# Revert .env
git checkout HEAD~1 .env

# Restart Nerve
pkill -9 -f nerve_system.py
nohup .venv/bin/python nerve_system.py > /tmp/nerve.log 2>&1 &
```

---

## 📊 Success Metrics

**Phase 0 Complete When:**
1. ✅ WhatsApp voice messages transcribed and processed
2. ✅ Exotel calls use Jupiter AI (not static scripts)
3. ✅ GPU utilization increases during calls
4. ✅ All health checks pass
5. ✅ No errors in logs for 10+ test calls

**Ready for Phase 1 When:**
- Phase 0 stable for 3-5 days
- No critical bugs reported
- Performance metrics acceptable

---

## 🎯 Next: Let's Start Implementation!

I'll now create all the modified files for you. You can:
1. Review each change
2. Apply them one by one
3. Test as we go

**Ready to start with Task 1?** 🚀
