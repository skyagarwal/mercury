# ✅ CORRECT Dashboard Setup for Regular Gather Applet

## What You Have

You have a **"Gather"** applet (NOT "Programmable Gather") with dynamic URL configuration.

**Key Difference:**
- **Programmable Gather**: Expects JSON response with `gather_prompt` (You DON'T have this)
- **Regular Gather**: Expects ExoML XML response with `<Gather>` tags (You HAVE this) ✅

## ⚠️ IMPORTANT: Change Your URL

Your current URL in the screenshot:
```
https://exotel.mangwale.ai/api/nerve/gather
```

**This is WRONG** - it returns JSON format.

### ✅ CORRECT URL to Use:

```
https://exotel.mangwale.ai/api/nerve/callback
```

This returns **ExoML XML format** which your Gather applet expects!

---

## Step-by-Step Dashboard Configuration

### Step 1: Update the Primary URL

In the Exotel dashboard (the screen you showed):

1. **Primary URL field**: Change from
   ```
   https://exotel.mangwale.ai/api/nerve/gather
   ```
   
   To:
   ```
   https://exotel.mangwale.ai/api/nerve/callback
   ```

2. **Keep** "Configure parameters dynamically by providing a URL" selected ✅

3. **Fallback URL** (optional): Leave empty or use same URL

### Step 2: Configure "When the caller entered one or more input digits..."

Scroll down in the Gather configuration panel.

Look for the section: **"When the caller entered one or more input digits..."**

**Option 1: Redirect to below applet** (Not recommended)
- This would need another applet in the flow

**Option 2: Make a request to this URL** (✅ RECOMMENDED)
- Select this option
- Enter the **SAME URL**:
  ```
  https://exotel.mangwale.ai/api/nerve/callback
  ```

This allows Exotel to call us again with the DTMF digits.

### Step 3: HTTP Parameters (Important!)

Exotel will send these parameters to your URL:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `CallSid` | Unique call ID | `abc123...` |
| `CallFrom` | Caller phone | `919923383838` |
| `CallTo` | Called number | `02048556923` |
| `Digits` | DTMF input | `1` (accept), `0` (reject) |
| `CallStatus` | Call state | `in-progress` |
| `CurrentTime` | Timestamp | `2025-12-19 12:30:45` |

**CustomField** - This is passed from our initial API call!

### Step 4: Connect the Flow

In the canvas (left side):

```
[Call Start] ----→ [Gather] ----→ (End)
```

1. Make sure **"Call Start"** is connected to **"Gather"**
2. No need for additional applets after Gather
3. The Gather will loop based on our XML response

### Step 5: Save

Click the blue **"SAVE"** button (top right)

---

## What Happens After Configuration

### Call Flow:

1. **We initiate call**: 
   ```bash
   POST /api/nerve/vendor-order-confirmation
   ```

2. **Exotel calls**: 919923383838

3. **Vendor picks up**

4. **Exotel requests**: `GET https://exotel.mangwale.ai/api/nerve/callback?CallSid=xxx&CustomField=...`

5. **We return XML**:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <Response>
       <Gather action="https://exotel.mangwale.ai/api/nerve/callback?CallSid=xxx" 
               timeout="15" 
               finishOnKey="#" 
               numDigits="1">
           <Play>https://storage.mangwale.ai/voice-audio/ivr/hi/greeting.wav</Play>
       </Gather>
       <Say voice="Aditi">No input received.</Say>
   </Response>
   ```

6. **Exotel plays**: Hindi audio from our TTS (WAV file)

7. **Vendor presses 1**

8. **Exotel requests again**: `GET https://exotel.mangwale.ai/api/nerve/callback?CallSid=xxx&Digits=1`

9. **We return confirmation XML**:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <Response>
       <Play>https://storage.mangwale.ai/voice-audio/ivr/hi/thank_you.wav</Play>
       <Hangup/>
   </Response>
   ```

10. **Call completes** ✅

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
    "order_details": {"items": "Test order"}
  }'
```

### Expected Result:

1. ✅ Phone rings: 9923383838
2. ✅ Pick up → Hear Hindi audio (not wind sound!)
3. ✅ Audio says: "नमस्ते Saurabh, यह मंगवाले से कॉल है..."
4. ✅ Press 1 → Hear "धन्यवाद! खाना तैयार करने में..."
5. ✅ Press 2 → Hear "राइडर 30 मिनट में पहुंचेगा"
6. ✅ Call ends properly

### Watch Logs:

```bash
tail -f /tmp/nerve-debug.log | grep -E "callback|GET /api/nerve"
```

**Good signs:**
```
INFO: 103.xxx.xxx.xxx - "GET /api/nerve/callback?CallSid=abc123&CustomField=..." 200 OK
INFO: Returning ExoML response for vendor: Saurabh
INFO: 103.xxx.xxx.xxx - "GET /api/nerve/callback?CallSid=abc123&Digits=1" 200 OK
```

**Bad signs (if URL is wrong):**
```
ERROR: Unexpected response format
# Or no GET requests at all
```

---

## Verify Your Endpoint

Test manually that `/callback` returns XML (not JSON):

```bash
# Test initial greeting
curl "https://exotel.mangwale.ai/api/nerve/callback?CallSid=test&order_id=12345&vendor_name=Saurabh&vendor_id=V001"
```

**Expected output (XML)**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="..." timeout="15" finishOnKey="#" numDigits="1">
        <Play>https://storage.mangwale.ai/voice-audio/ivr/hi/xxxxx.wav</Play>
    </Gather>
    <Say voice="Aditi">No input received.</Say>
</Response>
```

**NOT this (JSON)** ❌:
```json
{"gather_prompt": {"text": "..."}}
```

---

## Compare: Wrong vs Right

### ❌ WRONG (What you had):
```
Primary URL: https://exotel.mangwale.ai/api/nerve/gather
Returns: JSON (Programmable Gather format)
Result: Dashboard applet doesn't understand JSON → Error/Disconnect
```

### ✅ RIGHT (What you need):
```
Primary URL: https://exotel.mangwale.ai/api/nerve/callback
Returns: ExoML XML (Regular Gather format)
Result: Dashboard applet processes XML → Hindi audio plays! 🎉
```

---

## Dashboard Screenshot Reference

Based on your screenshot, here's what to change:

**Section: "How do you want to control your gather params?"**
- ✅ Keep "Configure parameters dynamically by providing a URL" selected

**Primary URL field:**
- ❌ OLD: `https://exotel.mangwale.ai/api/nerve/gather`
- ✅ NEW: `https://exotel.mangwale.ai/api/nerve/callback`

**Fallback URL (optional):**
- Can leave empty

**Section: "When the caller entered one or more input digits..."**
- Select: "Make a request to this URL"
- URL: `https://exotel.mangwale.ai/api/nerve/callback` (same as Primary URL)

---

## Summary

**The ONLY change you need:**

Change the URL in the dashboard from:
```
/api/nerve/gather  →  /api/nerve/callback
```

That's it! Then **SAVE** and test.

The `/callback` endpoint already works and returns correct XML format for Hindi voice calls! 🚀

---

## After You Make the Change

1. Click **SAVE** (blue button top right)
2. Test call immediately
3. Report back:
   - Did phone ring? ✅
   - Did you hear Hindi audio? ✅ or ❌
   - Any errors in logs?

Let me know if you hear the Hindi audio after this change! 🎉
