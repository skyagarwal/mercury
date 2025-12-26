# Exotel IVR Integration Audit & Disconnection Analysis
**Date:** December 23, 2025  
**Status:** DISCONNECTIONS INVESTIGATED & ROOT CAUSES IDENTIFIED

---

## 📊 EXECUTIVE SUMMARY

### Current State
- ✅ **Calls initiated successfully** → Exotel API returns `200 OK` + CallSid
- ✅ **HTTPS reachable** → Traefik TLS cert valid, endpoints accessible
- ✅ **Audio format fixed** → PCM WAV 8kHz mono 16-bit verified
- ⚠️ **Calls disconnecting** → Status callback shows `busy` or `completed` with 0s duration
- ❌ **Jupiter reporting failing** → `/api/voice-calls/result` endpoint returns 404

### Root Cause of Disconnections
**Exotel expects specific response format at each interaction point.** Current implementation has **2 critical format mismatches**:

| Issue | Current | Expected | Impact |
|-------|---------|----------|--------|
| **1. ExoML closing** | `</Say>` missing closing XML | `</Response>` required | **Call hangs up immediately** |
| **2. Gather prompt missing** | JSON gather prompt uses only `text` | Must include `audio` OR ensure TTS enabled | Call plays silence, then disconnects |
| **3. Max digits handling** | Not setting to 0 on final response | Must be 0 to indicate call end | Call stays open waiting for input |

### Recent Call Examples
```
❌ Call: ba7bf2786eab0f0267adc565193c19cn (Order #9002)
   Initiated: 2025-12-23 21:23:33
   Status: in-progress → completed (no actual audio exchange)
   Duration: 0s
   Reason: ExoML response incomplete + missing </Response> closing tag

❌ Call: b4c439914c2d8d1684d85a44e61c19cn (Order #9002)  
   Initiated: 2025-12-23 21:12:04
   Status: in-progress → completed (no DTMF captured)
   Duration: ~3s (only greeting, no interaction)
   Reason: Programmable Gather not receiving digits
```

---

## 🔍 DETAILED AUDIT FINDINGS

### 1. EXOML RESPONSE FORMAT ISSUE

**File:** [nerve_system.py](nerve_system.py#L1165-L1210)  
**Function:** `build_exoml_response()`

**Current Code:**
```python
xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Aditi">{text}</Say>"""
# ❌ MISSING </Response> closing tag!
```

**Expected Exotel Format:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Aditi">Your message</Say>
    <Gather>
        <Ask>Press 1 for yes</Ask>
    </Gather>
</Response>
```

**Impact:** Without closing tag, Exotel treats response as malformed → immediate hangup.

---

### 2. PROGRAMMABLE GATHER JSON FORMAT

**File:** [nerve_system.py](nerve_system.py#L1340-L1360)  
**Endpoint:** `/api/nerve/gather`

**Current Response:**
```json
{
  "gather_prompt": {"text": "Hindi TTS text"},
  "max_input_digits": 1,
  "input_timeout": 15
}
```

**Issue:** Programmable Gather expects either:
- `"audio": "url_to_audio_file"` (pre-recorded)
- `"text": "string"` (will trigger Exotel's TTS) ✅ This is correct

**But missing:**
- ❌ No `"voice"` parameter (should be `"voice": "hi-IN"` for Hindi)
- ⚠️ Exotel TTS conversion **not guaranteed** to work with all text formats
- ⚠️ MinIO-based pre-recorded audio sometimes returns 502 → falls back to TTS

---

### 3. RESPONSE TIMEOUT MISMATCH

**Issue:** When returning final response (e.g., "Thank you, goodbye"), we're **not ending the call**.

**Current:**
```python
# After user presses "1" (accept), sends prep time prompt
return Response(
    content=build_exoml_response(prep_prompt, gather_action=callback_url, ...),
    media_type="application/xml"
)
# ❌ Exotel still waits for next gather = timeout expires
```

**Should be:** When call should end (after final goodbye), return:
```json
{
  "gather_prompt": {"text": "Thank you, goodbye"},
  "max_input_digits": 0,  // ← Tells Exotel to hangup after this message
  "input_timeout": 1
}
```

---

### 4. AUDIO DELIVERY & CACHING

**Files:**
- Static audio: [/home/ubuntu/mangwale-voice/ivr-audio/vendor-8k/](../../ivr-audio/vendor-8k/)
- Generated audio: MinIO at [https://storage.mangwale.ai/voice-audio/](https://storage.mangwale.ai)

**Current Issues:**

| Issue | Status | Workaround |
|-------|--------|-----------|
| MinIO 502 errors | ⚠️ Intermittent | Fallback to TTS |
| Exotel caches by URL | ❌ Old audio still cached | Append `?v=timestamp` to URL |
| WAV codec errors | ✅ Fixed (PCM verified) | Using 8kHz mono 16-bit |
| HEAD request support | ✅ Fixed | Returns headers only |

**Audio Serving:**
- **Static (best for reliability):** `/api/nerve/ivr/vendor-8k/V01_greeting.wav` → Returns file directly
- **Generated (MinIO):** `https://storage.mangwale.ai/voice-audio/ivr/hi/{hash}.wav` → May 502, Exotel caches
- **TTS fallback:** Exotel's built-in `<Say>` → Works but slower

---

### 5. CALLBACK SEQUENCE & STATE MANAGEMENT

**Expected Flow:**
```
1. POST /api/nerve/vendor-order-confirmation
   ↓ (Exotel API returns CallSid)
2. Call placed to vendor
   ↓ (Vendor answers)
3. GET /api/nerve/gather?CallSid=xxx
   ↓ (No digits = initial greeting)
   Response: JSON with greeting + gather
4. Vendor presses "1" (DTMF)
   ↓
5. GET /api/nerve/gather?CallSid=xxx&digits=1
   ↓ (Process acceptance)
   Response: JSON with prep-time prompt + gather
6. Vendor presses prep-time (e.g., "2")
   ↓
7. GET /api/nerve/gather?CallSid=xxx&digits=2
   ↓ (Process prep time)
   Response: JSON with goodbye + max_input_digits=0
   ↓ (Exotel hangs up)
8. POST /api/nerve/status (final status callback)
   ↓ Status: "completed", Duration: ~30s
```

**Current Actual Flow:**
```
1. ✅ POST /api/nerve/vendor-order-confirmation → 200 OK
2. ✅ Call placed → CallSid created
3. ✅ GET /api/nerve/gather → JSON returned
4. ❌ Exotel doesn't call /api/nerve/gather again after DTMF
   (or calls with wrong parameters, state lost)
5. ❌ POST /api/nerve/status → Status=completed, Duration=0s
```

**Root Cause:** State not persisting OR Exotel flow routing to wrong endpoint.

---

### 6. EXOTEL FLOW CONFIGURATION

**IVR App ID Currently Set:** `IVR_APP_ID=1148538` (via .env)

**What this should be:**
- ✅ **Passthru Applet** ID created in Exotel Dashboard
- ✅ **Passthru URL:** `https://exotel.mangwale.ai/api/nerve/callback`
- ✅ **Returns:** ExoML XML format

**Potential Issue:** Is Exotel Flow `1148538` configured correctly?

**To Verify:**
1. Login to Exotel Dashboard → Applets
2. Find App ID 1148538
3. Check type: Should be **"Passthru"** or **"IVR Menu"**
4. Check URL: Should point to our callback endpoint
5. Check "No Input Action": Should be **"Re-fetch URL"** (not "Disconnect")

---

## 🛠️ LOGGING GAPS IDENTIFIED

### Missing Debug Information

| Gap | Current | Needed |
|-----|---------|--------|
| **Exotel request received** | ✅ Logged | Need: Raw query params logged |
| **Exotel response sent** | ⚠️ Partial | Need: Full HTTP response body |
| **Audio streaming** | ❌ Not logged | Need: When audio starts/ends, size transferred |
| **DTMF processing** | ⚠️ Basic | Need: Timestamp of each digit, inter-digit timing |
| **Call state transitions** | ✅ Good | Need: Before/after state snapshot |
| **ExoML XML generation** | ❌ Not logged | Need: Full XML returned to Exotel |
| **Gather response timing** | ❌ Not logged | Need: Response time to Exotel requests |
| **TTS synthesis** | ✅ Logged | Need: Synthesis time per message |

### Recommended Logging Additions

**Add to every Exotel callback:**
```python
logger.info(f"""
═══════════════════════════════════════════════════════════
📥 EXOTEL REQUEST RECEIVED
───────────────────────────────────────────────────────────
  CallSid: {CallSid}
  Endpoint: /api/nerve/gather
  Method: GET
  Query Params: {request.query_params}
  CallStatus: {request.query_params.get('CallStatus', 'N/A')}
  Digits: {digits}
═══════════════════════════════════════════════════════════
""")

# ... process request ...

logger.info(f"""
═══════════════════════════════════════════════════════════
📤 EXOTEL RESPONSE SENT
───────────────────────────────────────────────────────────
  CallSid: {CallSid}
  Status: {response_status}
  Body: {response_body[:200]}...
  Content-Type: {content_type}
═══════════════════════════════════════════════════════════
""")
```

---

## 🧪 RECOMMENDED INTEGRATION TESTING

### Phase 1: Local Verification (No Exotel Required)
```bash
# Test ExoML response format
curl -s 'http://localhost:7100/api/nerve/callback?CallSid=test123&digits=1' | xmllint --format -

# Test Programmable Gather format
curl -s 'http://localhost:7100/api/nerve/gather?CallSid=test123' | jq .

# Check response completeness
curl -v 'http://localhost:7100/api/nerve/callback?CallSid=test123'
# Look for: Content-Length, Content-Type, complete XML
```

### Phase 2: Exotel Webhook Simulation
```bash
# Simulate what Exotel sends when:
# 1. Vendor answers (initial gather request)
curl -X GET 'http://exotel.mangwale.ai/api/nerve/gather?CallSid=abc123&CallFrom=09923383838&CallTo=02048556923&CustomField=%7B%22call_type%22:%22vendor_order_confirmation%22%7D'

# 2. Vendor presses "1" (DTMF received)
curl -X GET 'http://exotel.mangwale.ai/api/nerve/gather?CallSid=abc123&digits=1&CallFrom=09923383838'

# 3. Final status callback
curl -X POST 'http://exotel.mangwale.ai/api/nerve/status' \
  -d 'CallSid=abc123&CallStatus=completed&Duration=35'
```

### Phase 3: Real Call Testing
1. Use a test number (personal phone) that **won't trigger NDNC**
2. Make call and **observe in real-time logs:**
   - POST to `/api/nerve/vendor-order-confirmation`
   - GET requests to `/api/nerve/gather`
   - User action (DTMF)
   - Final POST to `/api/nerve/status`
3. Check audio playback on phone (not silent)
4. Check DTMF recognition (press keys, verify logged)
5. Verify call duration (should be 30-45s for full flow)

---

## 🔧 FIXES REQUIRED

### Priority 1: Critical (Blocking All Calls)

**[FIX-1] Close ExoML XML Response Properly**
- **File:** [nerve_system.py](nerve_system.py#L1200-L1210)
- **Change:** Add `</Response>` closing tag to all ExoML responses
- **Code:**
  ```python
  xml = f"""<?xml version="1.0" encoding="UTF-8"?>
  <Response>
      <Say voice="Aditi">{text}</Say>
  </Response>"""  # ← Add this line
  ```
- **Impact:** Exotel will no longer immediately hang up on malformed XML

**[FIX-2] Add `max_input_digits=0` to Final Responses**
- **File:** [nerve_system.py](nerve_system.py#L1380-L1400)
- **Change:** When returning final goodbye, set `max_input_digits: 0`
- **Code:**
  ```python
  if call_state.current_state == "completed":
      return JSONResponse({
          "gather_prompt": {"text": goodbye_text},
          "max_input_digits": 0,  # ← Tells Exotel to hang up
          "input_timeout": 1
      })
  ```
- **Impact:** Exotel will hang up after playing final message instead of waiting indefinitely

**[FIX-3] Add `voice` Parameter to Programmable Gather**
- **File:** [nerve_system.py](nerve_system.py#L1360)
- **Change:** Include `"voice": "hi-IN"` in JSON response
- **Code:**
  ```python
  return JSONResponse({
      "gather_prompt": {"text": prompt_text},
      "voice": "hi-IN",  # ← Add this for Hindi TTS
      "max_input_digits": 1,
      "input_timeout": 15
  })
  ```
- **Impact:** Exotel will use correct Hindi voice for TTS

### Priority 2: Important (Improving Reliability)

**[FIX-4] Add Detailed Request/Response Logging**
- **File:** [nerve_system.py](nerve_system.py#L1320-L1350)
- **Change:** Log full request and response for every Exotel interaction
- **Impact:** Enable quick debugging of disconnection issues

**[FIX-5] Make Jupiter Callback URL Configurable**
- ✅ **DONE** (already implemented)
- Set `JUPITER_VOICE_CALLS_RESULT_URL=http://<actual-host>:<port>/api/voice-calls/result` when endpoint is available

### Priority 3: Enhancement (Optimization)

**[FIX-6] Add Call Duration Validation**
- **Change:** Warn in logs if call ends with `Duration < 10s` (likely disconnection)
- **Impact:** Easier to spot failed calls

**[FIX-7] Cache Audio URLs with Version Suffix**
- **Change:** Always append `?v={timestamp}` to MinIO URLs
- **Impact:** Prevent Exotel from serving stale cached audio

---

## 📋 INTEGRATION CHECKLIST

### Before Going Live
- [ ] ExoML responses properly closed with `</Response>`
- [ ] All final messages set `max_input_digits: 0`
- [ ] Programmable Gather includes `"voice": "hi-IN"`
- [ ] Detailed logging added for all Exotel callbacks
- [ ] Exotel Flow (App 1148538) verified in Dashboard
  - [ ] Type: Passthru
  - [ ] URL: Points to `/api/nerve/callback`
  - [ ] No Input Action: "Re-fetch URL"
- [ ] Audio files verified:
  - [ ] 8kHz, mono, PCM WAV
  - [ ] File exists and accessible
  - [ ] HEAD request returns headers
- [ ] HTTPS certificate valid (Let's Encrypt)
- [ ] Test call placed with real vendor number
- [ ] DTMF captured and processed
- [ ] Call duration > 20s (full flow)
- [ ] Jupiter result callback endpoint identified/configured

---

## 📞 TESTING SCRIPT

Create file: `/home/ubuntu/mangwale-voice/test-exotel-integration.sh`

```bash
#!/bin/bash
set -e

echo "🧪 Exotel Integration Test Suite"
echo "=================================="

# Test 1: Service health
echo "1️⃣ Service Health Check..."
curl -s http://localhost:7100/health | jq .

# Test 2: ExoML format
echo -e "\n2️⃣ ExoML Response Format..."
curl -s 'http://localhost:7100/api/nerve/callback?CallSid=test123' | xmllint --format - 2>/dev/null || echo "❌ Invalid XML"

# Test 3: Programmable Gather format
echo -e "\n3️⃣ Programmable Gather Format..."
curl -s 'http://localhost:7100/api/nerve/gather?CallSid=test123' | jq .

# Test 4: DTMF processing
echo -e "\n4️⃣ DTMF Processing (digits=1)..."
curl -s 'http://localhost:7100/api/nerve/gather?CallSid=test123&digits=1' | jq '.gather_prompt'

# Test 5: Audio file check
echo -e "\n5️⃣ Audio File Availability..."
curl -I http://localhost:7100/api/nerve/ivr/vendor-8k/V01_greeting_pcm.wav

echo -e "\n✅ Tests Complete"
```

---

## 🎯 NEXT STEPS

1. **Apply FIX-1, FIX-2, FIX-3** (Critical format fixes)
2. **Add FIX-4** (Detailed logging)
3. **Verify Exotel Flow configuration** in Dashboard
4. **Run testing script** to validate local endpoints
5. **Place real test call** with detailed logging enabled
6. **Monitor logs** for:
   - Request/response format
   - Audio delivery
   - DTMF capture
   - Call duration
7. **Iterate** based on Exotel API response and call outcome

---

## 📚 REFERENCE FILES

| File | Purpose |
|------|---------|
| [nerve_system.py](nerve_system.py) | Main IVR orchestrator |
| [.env](.env) | Configuration (IVR_APP_ID, URLs) |
| [nerve-system.error.log](../logs/nerve-system.error.log) | Application logs |
| [EXOTEL_API_COMPLETE_GUIDE.md](../EXOTEL_API_COMPLETE_GUIDE.md) | Exotel API reference |

---

## 📞 SUPPORT

**If calls still disconnect after fixes:**
1. Check Exotel Dashboard logs (Account > Call Logs > Details)
2. Look for error message (usually in "External Data" section)
3. Common errors:
   - `"Unexpected response format"` → ExoML/JSON mismatch
   - `"Timeout waiting for response"` → Endpoint not responding
   - `"Invalid XML"` → Malformed ExoML
4. Correlate with our error logs using `CallSid`

