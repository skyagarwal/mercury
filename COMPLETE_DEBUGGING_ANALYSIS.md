# 🔍 COMPLETE DEBUGGING ANALYSIS - Why Your IVR Isn't Working

## Current Situation

**What Happened:**
- ✅ API call succeeded (got CallSid: 6b46c47ea74434f43a22f20495e019co)
- ✅ Phone rang (09923383838)
- ❌ Call disconnected after 6 seconds
- ❌ No callback logs (your callback was NEVER called)

**Duration:** 6 seconds  
**Status:** Completed  
**AnsweredBy:** Human

---

## What We're Trying to Do

### End Goal
Build an **automated IVR system** that:
1. Calls a vendor automatically
2. Plays a greeting: "Press 1 to confirm order, Press 2 to cancel"
3. Captures DTMF input (digits)
4. Based on digit pressed, asks follow-up questions
5. Logs results back to Jupiter

### Architecture We're Using

```
┌──────────────────────────────────────────────────────────────┐
│                  YOUR APPLICATION (Jupiter)                   │
│  Initiates call via Exotel API                               │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     │ Step 1: POST /v1/Accounts/.../Calls/connect
                     │ Params: From, CallerId, Url (Gather App), CustomField
                     ▼
┌──────────────────────────────────────────────────────────────┐
│                      EXOTEL (Cloud)                          │
│  1. Dials vendor phone                                       │
│  2. When answered, loads Gather Applet (1149178)            │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     │ Step 2: Exotel executes Gather Applet
                     │ (This is where it's FAILING)
                     ▼
┌──────────────────────────────────────────────────────────────┐
│              GATHER APPLET (Exotel Dashboard)                │
│  Should call: https://exotel.mangwale.ai/api/nerve/callback │
│  To get prompt JSON                                          │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     │ Step 3: Your callback returns JSON
                     ▼
┌──────────────────────────────────────────────────────────────┐
│           YOUR CALLBACK (nerve-system.py)                    │
│  Returns: {"gather_prompt": {"text": "Press 1..."}}         │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     │ Step 4: Exotel plays TTS and waits for DTMF
                     ▼
                  Vendor hears audio and presses digit
```

---

## Documentation We Followed

### Primary Reference: Gather Applet
**Source:** https://support.exotel.com/support/solutions/articles/3000084635-working-with-gather-applet

**Key Points:**
1. Gather Applet can be configured **TWO ways:**
   - **Static:** Set prompt in dashboard, no dynamic URL
   - **Dynamic:** Use URL to get prompt from your server

2. **Dynamic URL Mode (What we need):**
   ```
   When "Use Dynamic URL" is enabled:
   - Exotel makes GET request to your URL
   - Your URL returns JSON with gather parameters
   - Exotel plays the prompt and waits for DTMF
   - When digit pressed, Exotel calls URL again with digits parameter
   ```

3. **Request Format:**
   ```
   GET /api/nerve/callback?
     CallSid=abc123
     &CallFrom=09923383838
     &CustomField={"order_id":123}
   ```

4. **Response Format (JSON):**
   ```json
   {
     "gather_prompt": {
       "text": "Press 1 to confirm order"
     },
     "max_input_digits": 1,
     "finish_on_key": "#",
     "input_timeout": 6
   }
   ```

### Secondary Reference: Outbound Call API
**Source:** Voice v1 Postman Collection

**Endpoint:**
```
POST https://api.exotel.com/v1/Accounts/{SID}/Calls/connect
```

**Required Parameters:**
- `From`: Vendor phone to dial
- `CallerId`: Your Exotel virtual number
- `Url`: Link to Gather Applet in format:
  ```
  http://my.exotel.com/{SID}/exoml/start_voice/{APP_ID}
  ```
- `CustomField`: JSON data to pass to callback

---

## What Our System Does

### 1. nerve_system.py (Port 7100)

**Endpoint:** `/api/nerve/callback`

**What it does:**
```python
@app.api_route("/api/nerve/callback", methods=["GET"])
async def exotel_passthru_callback(...):
    # 1. Parse query parameters (CallSid, digits, CustomField)
    # 2. Get or create call state from CustomField
    # 3. Based on current state and digit pressed:
    #    - greeting → digit 1 → ask for prep time
    #    - prep_time → digit 30 → say goodbye
    # 4. Return JSON response for Exotel
    
    return JSONResponse(content={
        "gather_prompt": {"text": "Press 1..."},
        "max_input_digits": 1,
        "finish_on_key": "#",
        "input_timeout": 6
    })
```

**Manual Test Results:**
```bash
# Test 1: Initial greeting
curl 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test&CustomField={"order_id":123}'
✅ Returns: {"gather_prompt": {"text": "Test call from Mangwale..."}}

# Test 2: Accept order
curl 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test&digits="1"'
✅ Returns: {"gather_prompt": {"text": "Order accepted. Enter prep time..."}}

# Test 3: Set prep time
curl 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test&digits="30"'
✅ Returns: {"gather_prompt": {"text": "Thank you! Rider arrives in 30 mins"}}
```

**Status:** ✅ Working perfectly

---

## What Exotel Should Do

### Step-by-Step Flow

1. **API Call Received:**
   ```
   POST /v1/Accounts/sarvinsuppliesllp1/Calls/connect
   From=09923383838
   Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1149178
   ```

2. **Exotel Dials Vendor:**
   - Rings phone 09923383838
   - Status: "in-progress"

3. **Vendor Answers:**
   - Status: "answered"
   - AnsweredBy: "human"

4. **Exotel Loads Gather Applet 1149178:**
   - Looks up applet configuration
   - **IF Dynamic URL enabled:**
     - Makes GET request to your callback URL
     - Receives JSON response
     - Plays TTS from `gather_prompt.text`
     - Waits for digit (with timeout from `input_timeout`)
   - **IF Dynamic URL NOT enabled:**
     - Plays static prompt (if configured)
     - OR disconnects (if no prompt configured) ← **THIS IS HAPPENING**

5. **User Presses Digit:**
   - Exotel calls callback URL again with `digits` parameter
   - Your callback returns next action
   - Loop continues until final message (no `max_input_digits`)

---

## THE PROBLEM: Configuration Gap

### What's Missing

Your Gather Applet **1149178** exists but is **NOT configured** to call your callback URL.

**Evidence:**
- ✅ Call connected (got CallSid)
- ✅ Phone rang and answered
- ❌ No logs in nerve-system.error.log for this CallSid
- ❌ Call duration: 6 seconds (timeout, no activity)

**This means:** Exotel loaded the applet but found no instructions, so it waited briefly then disconnected.

---

## How to Fix It

### Option A: Dynamic URL (Recommended for your use case)

Go to Exotel Dashboard → Applets → Edit Gather Applet **1149178**

1. ✅ **Enable "Use Dynamic URL"** checkbox
2. **Primary URL:** `https://exotel.mangwale.ai/api/nerve/callback`
3. **Fallback URL:** (leave empty or same)
4. **Save**

**How it works:**
```
Call connects → Applet loads
              ↓
GET https://exotel.mangwale.ai/api/nerve/callback?CallSid=...
              ↓
Your server returns: {"gather_prompt": {"text": "Press 1..."}}
              ↓
Exotel plays TTS: "Press 1 to confirm..."
              ↓
User presses 1
              ↓
GET https://exotel.mangwale.ai/api/nerve/callback?CallSid=...&digits="1"
              ↓
Your server returns: {"gather_prompt": {"text": "Enter prep time..."}}
              ↓
... (continues until final message)
```

---

### Option B: Static Prompt + Callback (Simpler but less flexible)

If you can't enable Dynamic URL:

1. **Prompt Text:** "Test call from Mangwale. Press 1 to confirm. Press 2 to cancel."
2. **Max Input Digits:** 1
3. **Finish on Key:** #
4. **Input Timeout:** 6
5. **Next Applet / Action After Input:**
   - Type: **Passthru**
   - URL: `https://exotel.mangwale.ai/api/nerve/callback`
   - Method: GET

**Limitation:** Initial prompt is fixed in dashboard, but subsequent prompts can be dynamic.

---

## Expected Behavior After Fix

### Test Call Flow

```bash
# Run this command:
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  -d "From=09923383838" \
  -d "CallerId=02048556923" \
  -d "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1149178" \
  -d "CustomField={\"order_id\":123}"
```

### Expected Timeline

| Time | Event | Log Entry |
|------|-------|-----------|
| T+0s | API call → Exotel dials | (Exotel side) |
| T+2s | Phone rings | (Phone rings) |
| T+4s | Vendor answers | (AnsweredBy: human) |
| T+4s | Applet calls callback | `📥 Exotel callback: CallSid=...` |
| T+5s | TTS plays "Press 1..." | (Vendor hears audio) |
| T+7s | Vendor presses 1 | `📱 DTMF: 1 | State: greeting` |
| T+7s | Applet calls callback again | `✅ Order 123 ACCEPTED` |
| T+8s | TTS plays prep time prompt | (Vendor hears Hindi) |
| T+10s | Vendor enters 30# | `⏱️ Prep time: 30 mins` |
| T+11s | Final goodbye message | `धन्यवाद!` |
| T+14s | Call ends | Status: completed |

**Expected Duration:** 14-20 seconds (not 6!)

---

## Verification Checklist

After configuring the applet, verify:

### 1. Gather Applet Config
- [ ] App ID 1149178 exists
- [ ] "Use Dynamic URL" is **enabled** OR static prompt is set
- [ ] Primary URL is `https://exotel.mangwale.ai/api/nerve/callback`
- [ ] URL is accessible (test with curl)

### 2. Test Callback Manually
```bash
curl -s 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test999&CustomField={"order_id":999}' | jq .
```
Expected: JSON response with `gather_prompt`

### 3. Make Test Call
```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect" \
  -u "API_KEY:API_TOKEN" \
  -d "From=YOUR_PHONE" \
  -d "CallerId=02048556923" \
  -d "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1149178" \
  -d "CustomField={\"order_id\":123}"
```

### 4. Monitor Logs
```bash
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | grep callback
```
Expected: Lines like `📥 Exotel callback: CallSid=...`

### 5. Check Call Duration
After call ends:
```bash
curl -s "https://api.exotel.com/v1/Accounts/.../Calls/{CallSid}.json" | jq .Call.Duration
```
Expected: > 10 seconds (not 5-6)

---

## Common Issues & Solutions

| Issue | Cause | Fix |
|-------|-------|-----|
| Call disconnects in 6s | Applet not configured | Enable Dynamic URL in dashboard |
| No callback logs | Callback URL not set | Set Primary URL in applet config |
| "404 Not Found" | Wrong App ID | Verify App ID 1149178 exists |
| Audio doesn't play | JSON invalid | Check callback returns valid JSON |
| DTMF not captured | max_input_digits = 0 | Set max_input_digits > 0 in JSON |

---

## Summary

### What Works ✅
- [x] Your callback returns valid JSON
- [x] nerve-system service is running
- [x] API call succeeds and dials phone
- [x] Vendor phone rings and answers

### What's Broken ❌
- [ ] Gather Applet 1149178 is not configured to call your callback
- [ ] No Dynamic URL enabled in dashboard
- [ ] No static prompt + action configured

### Next Step 🎯
**Go to Exotel Dashboard → Edit Gather Applet 1149178 → Enable "Use Dynamic URL" → Set Primary URL → Save**

Then run the same test call command. You'll see logs appear and the call will last longer!
