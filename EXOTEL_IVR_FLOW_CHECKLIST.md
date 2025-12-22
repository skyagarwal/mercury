# ✅ Complete IVR Flow Configuration Checklist

## Issue Identified

In your screenshot, the section **"When the caller entered one or more input digits..."** is set to:
- ❌ **"Redirect the caller to below applet"** (pointing to Gather)

This causes the flow to loop back to the same Gather applet instead of sending the DTMF digits to our server!

## ✅ CORRECT Configuration

### Section 1: "How do you want to control your gather params?"

✅ Select: **"Configure parameters dynamically by providing a URL"**

**Primary URL:**
```
https://exotel.mangwale.ai/api/nerve/callback
```

**Fallback URL (optional):**
```
(Leave empty or same URL)
```

### Section 2: "When the caller entered one or more input digits..." ⚠️ IMPORTANT!

This is the section causing the issue!

❌ **DON'T select**: "Redirect the caller to below applet"

✅ **DO select**: **"Make a request to this URL"**

**URL to use:**
```
https://exotel.mangwale.ai/api/nerve/callback
```

**What this does:**
- When user presses 1/0, Exotel calls our URL with `?Digits=1` parameter
- We can then respond with next step in the flow

### Section 3: "When there is no input or invalid input..."

✅ Select: **"Make a request to this URL"** (same URL)

OR

✅ Select: **"Replay the current applet"** (to repeat the prompt)

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Call Starts                                              │
│    Exotel → GET https://exotel.mangwale.ai/api/nerve/callback│
│    (No Digits parameter)                                     │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. We Return ExoML:                                         │
│    <Response>                                               │
│      <Gather action="...callback" numDigits="1">            │
│        <Say voice="Aditi">नमस्ते! Press 1 to accept...</Say> │
│      </Gather>                                              │
│    </Response>                                              │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Exotel Plays TTS (Hindi voice)                          │
│    User hears: "नमस्ते Saurabh..."                          │
│    User presses: 1 (accept) or 0 (reject)                  │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Exotel Calls Again (WITH Digits)                        │
│    Exotel → GET https://exotel.mangwale.ai/api/nerve/callback│
│    ?CallSid=xxx&Digits=1                                    │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. We Check Digits and Respond:                            │
│    If Digits=1 (Accept):                                    │
│      <Response>                                             │
│        <Gather action="...callback" numDigits="1">          │
│          <Say>15 min के लिए 1, 30 min के लिए 2...</Say>      │
│        </Gather>                                            │
│      </Response>                                            │
│                                                             │
│    If Digits=0 (Reject):                                    │
│      <Response>                                             │
│        <Say>धन्यवाद! हम किसी और को ऑर्डर देंगे</Say>        │
│        <Hangup/>                                            │
│      </Response>                                            │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
           (Continue flow based on input)
```

---

## Step-by-Step Dashboard Changes

### Step 1: Open the Gather Applet Settings

In your dashboard, click on the **Gather** applet to open its configuration panel.

### Step 2: Scroll to "When the caller entered one or more input digits..."

You should see this section near the bottom of the configuration panel.

**Current (WRONG):**
```
○ Redirect the caller to below applet
  [Gather]  ← This is wrong!
```

**Change to (CORRECT):**
```
● Make a request to this URL
  [https://exotel.mangwale.ai/api/nerve/callback]
```

### Step 3: Additional Settings (Optional but Recommended)

**"When there is no input..."**
```
● Make a request to this URL
  [https://exotel.mangwale.ai/api/nerve/callback]
```
OR
```
● Replay the current applet  (to repeat the greeting)
```

**"When invalid input is received..."**
```
● Make a request to this URL
  [https://exotel.mangwale.ai/api/nerve/callback]
```

### Step 4: Canvas/Flow

Make sure your canvas looks like this:

```
[Call Start] ────→ [Gather] ────→ (End)
```

**NOT like this** ❌:
```
[Call Start] ────→ [Gather] ────→ [Gather] ────→ [Gather]
                       ↓              ↓
                   (loops back)    (loops back)
```

If you have multiple Gather applets chained, **DELETE the extra ones**. You only need ONE Gather applet!

### Step 5: Save

Click the blue **"SAVE"** button at the top right.

---

## Testing After Configuration

### Test Call:

```bash
curl -X POST "http://192.168.0.151:7100/api/nerve/vendor-order-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_phone": "919923383838",
    "vendor_name": "Saurabh",
    "vendor_id": "V001",
    "order_id": 12345,
    "order_amount": 999,
    "order_details": {"items": "Complete flow test"}
  }'
```

### Expected Behavior:

1. ✅ Phone rings
2. ✅ Pick up
3. ✅ Hear: "Namaste Saurabh, yeh Mangwale se call hai..."
4. ✅ Press **1**
5. ✅ Hear: "Dhanyavaad! Khaana taiyaar karne mein..."
6. ✅ Press **2** (30 minutes)
7. ✅ Hear: "Rider 30 minute mein pahuchega"
8. ✅ Call ends

### Watch Logs:

```bash
tail -f /tmp/nerve-clean.log | grep -E "callback|Digits="
```

**Good logs:**
```
✅ GET /api/nerve/callback?CallSid=xxx (no digits)
✅ GET /api/nerve/callback?CallSid=xxx&Digits=1
✅ GET /api/nerve/callback?CallSid=xxx&Digits=2
```

**Bad logs (if flow is wrong):**
```
❌ GET /api/nerve/callback?CallSid=xxx (only once)
❌ No subsequent calls with Digits parameter
```

---

## Why This Configuration Matters

### ❌ Wrong Configuration (Redirect to applet):
```
User presses 1 → Exotel redirects to Gather applet → Plays greeting again
                  (No Digits sent to our server!)
```

### ✅ Correct Configuration (Make request to URL):
```
User presses 1 → Exotel calls our URL with Digits=1 → We return next step
                  (We control the flow!)
```

---

## Verification Screenshot Reference

After you make the changes, your Gather applet configuration should show:

**Section: "When the caller entered one or more input digits..."**
```
● Make a request to this URL
  ┌────────────────────────────────────────────────────────┐
  │ https://exotel.mangwale.ai/api/nerve/callback          │
  └────────────────────────────────────────────────────────┘
```

**NOT:**
```
● Redirect the caller to below applet
  ┌────────┐
  │ Gather │  ← Delete this!
  └────────┘
```

---

## Summary

**The problem:** Your Gather applet is redirecting to itself instead of calling our URL with Digits.

**The fix:** Change "Redirect to applet" → "Make a request to this URL" with the callback URL.

**Result:** Exotel will send DTMF digits to our server, and we can control the entire conversation flow!

---

## After You Make These Changes

1. Click **SAVE**
2. Test call immediately
3. **Pick up the phone**
4. **Listen for Hindi voice**
5. **Press 1**
6. **Tell me**: Did you hear the second message asking for prep time?

This should fix the issue! 🚀
