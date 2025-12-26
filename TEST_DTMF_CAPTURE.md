# ✅ PROGRESS: TTS is now playing!

## What's Working
- ✅ Gather applet calls your callback URL
- ✅ Service returns JSON response  
- ✅ TTS plays the greeting (call lasted 10 seconds vs 6 seconds before)
- ✅ Call answered by human

## CallSid: 19cf4baf080aa2f2e53954f1719b19cp

### Logs Show:
```
2025-12-24 18:35:43 - 📥 Exotel callback: CallSid=19cf4baf080aa2f2e53954f1719b19cp
2025-12-24 18:35:43 - 📋 Created new call_state for 19cf4baf080aa2f2e53954f1719b19cp
2025-12-24 18:35:43 - 📞 New call: 19cf4baf080aa2f2e53954f1719b19cp - Playing greeting
```

### Call Details:
```json
{
  "Sid": "19cf4baf080aa2f2e53954f1719b19cp",
  "Status": "completed",
  "Duration": 10,
  "AnsweredBy": "human",
  "StartTime": "2025-12-25 00:05:37",
  "EndTime": "2025-12-25 00:05:47"
}
```

### Response Sent to Exotel:
```json
{
  "gather_prompt": {
    "text": "नमस्ते , यह मंगवाले से कॉल है। आपके लिए एक नया ऑर्डर आया है..."
  },
  "max_input_digits": 1,
  "finish_on_key": "#",
  "input_timeout": 6,
  "repeat_menu": 1,
  "repeat_gather_prompt": {
    "text": "I didn't hear that. Please press 1 or 2."
  }
}
```

---

## What's NOT Working Yet

**DTMF Capture**: There was NO second callback with DTMF digits.

### Expected Flow:
1. ✅ Exotel calls callback → Get prompt → Play TTS
2. ❌ User presses 1 → Exotel should call callback again with `digits=1`
3. ❌ Service returns next prompt → Play TTS
4. ❌ Continue...

### Actual Flow:
1. ✅ Exotel calls callback → Get prompt → Play TTS
2. ❌ (TTS plays for ~10 seconds)
3. ❌ Call ends (no DTMF callback received)

---

## Root Cause: Applet Configuration Missing "On Digit Capture"

The Gather applet is configured to call your URL initially, but **NOT configured to call it again after capturing DTMF**.

### What You Need to Check in Exotel Dashboard

#### Go to: Gather Applet 1149178 → Edit

Look for these sections:

### Section 1: Initial Prompt (Already Working ✅)
```
☑ Use Dynamic URL
Primary URL: https://exotel.mangwale.ai/api/nerve/callback ✅
```

### Section 2: After Gathering Digits (NEEDS CONFIGURATION ❌)
```
After gathering digits, what should happen?

Option 1: Connect to another Applet
  → Select: Passthru Applet
  → Configure Passthru URL: https://exotel.mangwale.ai/api/nerve/callback
  → Method: GET
  → Pass DTMF digits as parameter ✅

OR

Option 2: Send digits to URL
  → URL: https://exotel.mangwale.ai/api/nerve/callback
  → Method: GET or POST
  → Include parameter: Digits={Digits}
```

---

## Exotel Dashboard: Exact Configuration Steps

### 1. Open Gather Applet 1149178
Dashboard → Applets → Gather Applet (ID: 1149178) → Edit

### 2. Verify Initial Prompt is Configured (Should Already Be Done)
```
☑ Use Dynamic URL
Primary URL: https://exotel.mangwale.ai/api/nerve/callback
```

### 3. Configure "After Gathering Digits" Action

Scroll down to find one of these sections:

**Option A: "Next Action" or "On Digit Capture"**
```
Next Action: [Dropdown]
  → Select: "Call URL" or "Passthru"
  
URL: https://exotel.mangwale.ai/api/nerve/callback
Method: GET
```

**Option B: "Connect to Applet"**
```
After gathering digits:
  → Connect to: [Passthru Applet]
  
Then configure the Passthru Applet:
  → URL: https://exotel.mangwale.ai/api/nerve/callback
  → Method: GET
```

**Option C: "Dynamic Response"**
```
☑ Get dynamic response after digit capture
Callback URL: https://exotel.mangwale.ai/api/nerve/callback
Method: GET
Include parameter: Digits={Digits}
```

### 4. Save Configuration

---

## Alternative: Use Passthru Applet Chain

If Gather applet doesn't have "call URL after digits" option:

### Step 1: Create/Edit Passthru Applet (ID: 1148538 or create new)
```
URL: https://exotel.mangwale.ai/api/nerve/callback
Method: GET
Forward all parameters: ✅
```

### Step 2: Link Gather → Passthru
In Gather Applet settings:
```
After gathering digits:
  → Connect to Applet: [Select Passthru 1148538]
```

---

## How to Test After Configuration

### Test 1: Make Call
```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  -d "From=09923383838" \
  -d "CallerId=02048556923" \
  -d "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1149178" \
  -d "CustomField={\"order_id\":123}"
```

### Test 2: Monitor Logs
```bash
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | grep -E "CallSid|DTMF|callback"
```

### Expected Log Output:
```
📥 Exotel callback: CallSid=abc123, digits=None (initial callback)
📞 New call: abc123 - Playing greeting
📥 Exotel callback: CallSid=abc123, digits=1 (DTMF callback - THIS IS MISSING!)
📱 DTMF: 1 | State: greeting
📞 State transition: greeting → accepted
```

### Test 3: Check Call Duration
After call completes:
```bash
curl -s "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/{CallSid}.json" \
  -u "..." | jq '.Call.Duration'
```

**Expected:** 15-25 seconds (multiple prompts played)  
**Current:** 10 seconds (only greeting played)

---

## Summary

**Working:**
- Gather applet configured ✅
- Callback URL called ✅
- JSON response sent ✅
- TTS plays ✅

**Missing:**
- After TTS plays and user presses digit, Exotel is NOT calling the callback again with the digits
- Need to configure "After Gathering Digits" → "Call URL" or "Connect to Passthru Applet"

**Action Required:**
Go to Exotel Dashboard → Edit Gather Applet 1149178 → Configure what happens after DTMF is captured → Save → Test again

Once this is configured, you'll see logs like:
```
📱 DTMF: 1 | State: greeting
📱 DTMF: 3 | State: prep_time_inquiry
📱 DTMF: 0 | State: prep_time_inquiry
```

And calls will last 15-25 seconds with multiple TTS prompts! 🎉
