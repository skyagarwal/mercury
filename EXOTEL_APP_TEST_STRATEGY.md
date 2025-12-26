# Exotel App Testing Strategy - Multiple Configurations

## CRITICAL INSIGHT FROM OFFICIAL EXOTEL DOCS

**You CANNOT return ExoML from a Passthru or Connect applet!**

- **Passthru Applet**: Returns only HTTP status codes (200, 302, etc.) — not ExoML
- **Gather Applet**: Returns JSON with prompt + DTMF config — not ExoML
- **Connect Applet**: Returns JSON with dial parameters — not ExoML
- **ExoML**: Only used in **Programmable IVR** flows (older/deprecated) or **Voicebot** applets

Your service returns ExoML, but Exotel is interpreting it as a plain response (no action), then disconnecting.

---

## Current Available URLs

All endpoints are hosted at: **https://exotel.mangwale.ai**

### Core Endpoints

| Endpoint | Purpose | Response Type | App Type |
|----------|---------|---------------|----------|
| `/api/nerve/callback` | Process DTMF & return next action | **JSON** | Gather / Connect Applet |
| `/api/nerve/greeting` | Initial TTS prompt | **JSON** | Gather Applet (Primary URL) |
| `/api/nerve/status` | Call status logging | JSON | Status callback |

### Base URL
```
https://exotel.mangwale.ai
```

### Key Parameters Accepted
- `CallSid` - Unique call identifier
- `CallFrom` / `From` - Caller phone
- `CallTo` / `To` - Called phone
- `Digits` / `digits` - DTMF digits pressed
- `CustomField` - JSON context (order_id, vendor_id, call_type, etc.)
- `ExotelCallStatus` / `CallStatus` - Call state

---

## Configuration Scenarios to Test

### ❌ Scenario 1: Passthru with ExoML Response (Current - DOESN'T WORK)
**App Type:** Passthru  
**App ID:** `1148615`  
**Why it fails:** Passthru only understands HTTP status codes (200/302) to decide flow, NOT ExoML

---

### ✅ Scenario 2: Gather Applet with Dynamic URL (CORRECT APPROACH)

**App Type:** Gather Applet (with dynamic URL configuration)  
**Response Type:** **JSON** (not ExoML)

**How it works:**
1. Exotel plays initial prompt (from dashboard or your URL)
2. User presses digit → Exotel calls your Gather URL with the digit
3. Your URL returns **JSON** with next action (prompt text, timeout, finish key)
4. Exotel executes the JSON response (play sound, gather again, or skip)

**Example Gather Response (CORRECT FORMAT):**
```json
{
  "gather_prompt": {
    "text": "You pressed 1. Press 1 to confirm order, or 2 to cancel."
  },
  "max_input_digits": 1,
  "finish_on_key": "#",
  "input_timeout": 6,
  "repeat_menu": 2,
  "repeat_gather_prompt": {
    "text": "Sorry, I didn't hear that. Please try again."
  }
}
```

**Dashboard Setup:**
- App Type: **Gather Applet**
- Primary URL: `https://exotel.mangwale.ai/api/nerve/callback`
- Fallback URL: (optional) `https://exotel.mangwale.ai/api/nerve/callback`
- Initial Prompt: "Test call from Mangwale. Press 1 to confirm. Press 2 to cancel."
- Max Input Digits: 1
- Finish on Key: # (or empty to disable)
- Input Timeout: 6 seconds
- Repeat Menu: 2

**Test Command:**
```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  -d "From=02048556923" \
  -d "To=09923383838" \
  -d "CallerId=02048556923" \
  -d "AppId=<GATHER_APP_ID>" \
  -d "CustomField={\"call_type\":\"vendor_order_confirmation\",\"order_id\":123,\"vendor_name\":\"TestVendor\"}"
```

---

### ✅ Scenario 3: Connect Applet with Dynamic URL (FOR MULTI-STEP FLOWS)

**App Type:** Connect Applet (with dynamic URL configuration)  
**Response Type:** **JSON** (not ExoML)

**How it works:**
1. Exotel gets destination number from your URL (JSON response)
2. Dials the vendor/agent
3. Handles call routing (parallel, sequential, etc.)
4. Returns to flow after call ends

**Example Connect Response:**
```json
{
  "destination": {
    "numbers": ["+919923383838"]
  },
  "outgoing_phone_number": "+91804568XXXX",
  "max_ringing_duration": 30,
  "max_conversation_duration": 3600,
  "record": true,
  "music_on_hold": {
    "type": "operator_tone"
  }
}
```

**Not for initial IVR** — only if you want to dial multiple agents/numbers.

---

### Scenario 4: Voicebot Applet (ADVANCED - AI-POWERED)

**App Type:** Voicebot Applet  
**Supports:** Voice AI, DTMF, transfer, etc.

**Not needed for simple order confirmation.**

---

## ExoML Response Examples

### ❌ Response 1: Gather with TTS Say (WRONG - DON'T USE)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="https://exotel.mangwale.ai/api/nerve/callback?CallSid=ABC123" 
            timeout="15" 
            finishOnKey="#" 
            numDigits="1">
        <Say voice="Aditi">Test call from Mangwale. Press 1 to confirm. Press 2 to set 30 minutes.</Say>
    </Gather>
    <Say voice="Aditi">No input received. Please call again.</Say>
</Response>
```

**Why it doesn't work:** ExoML is not supported in Passthru/Gather/Connect applets. Exotel ignores this and disconnects.

---

### ✅ Response 2: Gather JSON Response (CORRECT)
```json
{
  "gather_prompt": {
    "text": "Test call from Mangwale. Press 1 to confirm. Press 2 to set prep time."
  },
  "max_input_digits": 1,
  "finish_on_key": "#",
  "input_timeout": 6,
  "repeat_menu": 1,
  "repeat_gather_prompt": {
    "text": "I didn't catch that. Please press 1 or 2."
  }
}
```

**Why it works:** 
- Exotel receives JSON
- Parses gather_prompt (plays TTS)
- Waits for input
- On digit, calls your URL again with `digits` parameter
- You decide next action (play confirmation, hang up, etc.)

---

### ✅ Response 3: Final Confirmation (No More Gather)
```json
{
  "gather_prompt": {
    "text": "Thank you for confirming. Your order will be prepared. Goodbye."
  }
}
```

*(No max_input_digits, no finish_on_key → Exotel just plays this and hangs up)*

## Testing Checklist

For each app configuration, verify:

- [ ] **Call Initiates** - Vendor phone rings
- [ ] **Call Answers** - Exotel shows "answered"
- [ ] **Audio Plays** - Vendor hears greeting/prompt
- [ ] **DTMF Captures** - Pressing digit is registered
- [ ] **Callback Fires** - Check logs at `/api/nerve/callback`
- [ ] **Call Duration** - Should be > 15s (not 5-8s disconnect)
- [ ] **ExoML Executes** - Exotel processes our XML response

### Debug Commands

**Check call CDR:**
```bash
curl -s "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/{CallSid}.json" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" | jq '.Call | {Sid, Status, Duration, AnsweredBy}'
```

**Check service logs:**
```bash
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | grep -i callback
```

**Manual callback test:**
```bash
curl "https://exotel.mangwale.ai/api/nerve/callback?CallSid=test123" | head -20
```

---

## Recommended Testing Order

1. **✅ Start with Scenario 2 (Gather Applet with Dynamic URL)** — This is the ONLY way to do IVR in Exotel
2. **Update your callback to return JSON instead of ExoML** — Critical change
3. **Test the 3-step flow:** Greeting → User presses 1 → Confirmation message
4. **Add more complex flows** once basic flow works

---

## Required Code Changes

Your callback at `/api/nerve/callback` currently returns:
```python
return Response(
    content=build_exoml_response(greeting, gather_action=callback_url, timeout=15, num_digits=1, audio_url=None),
    media_type="application/xml"
)
```

**Change to return JSON:**
```python
response = {
    "gather_prompt": {
        "text": "Test call from Mangwale. Press 1 to confirm. Press 2 to set prep time."
    },
    "max_input_digits": 1,
    "finish_on_key": "#",
    "input_timeout": 6,
    "repeat_menu": 1,
    "repeat_gather_prompt": {
        "text": "I didn't catch that. Please try again."
    }
}
return JSONResponse(content=response)
```

---

## Applet Configuration Comparison

| Feature | Passthru | Gather | Connect |
|---------|----------|--------|---------|
| **Response Format** | HTTP status only | JSON | JSON |
| **Plays Audio** | No | Yes | No |
| **Captures DTMF** | No | Yes | No |
| **Use Case** | Logging only | IVR with user input | Call routing/dialing |
| **URL Timeout** | 30s | 5s | 5s |
| **Can return XML/ExoML** | No | No | No |

---

## Current Service Status

- **Service:** `nerve-system` (active)
- **Port:** 7100
- **Current Issue:** Returns ExoML (XML) from callbacks instead of JSON → Exotel ignores it
- **Next Step:** Modify `/api/nerve/callback` to return JSON for Gather applets

---

## Quick Copy-Paste: Gather Applet Configuration

For creating new app in Exotel Dashboard:

| Field | Value |
|-------|-------|
| App Name | `IVR-Gather-Test` |
| App Type | **Gather Applet** |
| Primary URL | `https://exotel.mangwale.ai/api/nerve/callback` |
| Fallback URL | (leave empty or same URL) |
| Initial Prompt | "Test call from Mangwale. Press 1 to confirm. Press 2 to set prep time." |
| Max Input Digits | 1 |
| Finish on Key | # (or leave empty) |
| Input Timeout | 6 seconds |
| Repeat Menu | 1 |

---
