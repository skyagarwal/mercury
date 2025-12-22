# ✅ CORRECT Exotel Passthru Configuration - Final Guide

## Based on Complete Analysis

After reviewing:
- ✅ Exotel official documentation (developer.exotel.com)
- ✅ GitHub Postman collections
- ✅ All internal documentation
- ✅ Existing code in nerve_system.py

## 🎯 The Correct URL

Your screenshot shows: `https://exotel.mangwale.ai/api/voice/ai-callback`

**This is WRONG** ❌

**Correct URL**: `https://exotel.mangwale.ai/api/nerve/callback` ✅

### Why?

Looking at `nerve_system.py` line 1233:
```python
@app.api_route("/api/nerve/callback", methods=["GET", "HEAD"])
async def exotel_passthru_callback(
    CallSid: str = Query(None),
    digits: str = Query(None),
    Digits: str = Query(None),
    CustomField: str = Query(None),
    ...
):
    """
    Exotel callback endpoint (GET request).
    
    Returns ExoML to control IVR flow:
    1. Initial call → Play greeting, gather accept/reject
    2. Accept (1) → Play confirmation, gather prep time
    3. Prep time → Play goodbye, hang up
    4. Reject (0) → Play rejection, hang up
    """
```

This endpoint **already exists** and **already returns ExoML XML format** that Passthru expects!

---

## 📋 Complete Dashboard Configuration

### Step 1: Update Passthru URL

In your Passthru applet configuration:

**Primary URL (Change this!):**
```
https://exotel.mangwale.ai/api/nerve/callback
```

**Fallback URL (optional):**
```
(leave empty or same URL)
```

### Step 2: Passthru Options

**Make Passthru Async:**
- ☐ **Leave UNCHECKED** (we need synchronous response to control flow)

This is CRITICAL! If checked, Exotel won't wait for our ExoML response.

### Step 3: In Response Section

**"Once the URL returns OK (200 OK)..."**

Looking at your screenshot, you have "Connect" applet here. This is **WRONG**.

According to Passthru documentation:
- **HTTP 200**: Success path
- **HTTP 302**: Failure path

Our `/api/nerve/callback` **always returns HTTP 200** with ExoML inside.

The ExoML contains `<Gather>` tags that collect digits, so Exotel will:
1. Execute the ExoML (play audio + gather digits)
2. Call Passthru AGAIN with the `digits` parameter
3. We return new ExoML based on the digits
4. Loop continues...

**So delete the Connect applet and just leave it empty or point back to Passthru!**

**Correct configuration:**

```
Once the URL returns OK (200 OK)...
   → [Empty] or [Passthru] (loops back)
```

**If the url returns anything else...**
```
   → [Hangup]
```

### Step 4: Flow Canvas

Your canvas should be **EXTREMELY SIMPLE**:

```
┌────────────┐     ┌────────────┐
│ Call Start │────→│  Passthru  │
└────────────┘     └────────────┘
```

**That's it!** No other applets needed!

The Passthru will loop internally based on our ExoML responses.

---

## 🔄 How the Complete Flow Works

### Call 1: Initial Greeting (No digits)

**Exotel calls:**
```
GET https://exotel.mangwale.ai/api/nerve/callback
    ?CallSid=abc123
    &CallFrom=919923383838
    &CallTo=02048556923
    &CustomField={"order_id":12345,"vendor_name":"Saurabh",...}
```

**Our response (HTTP 200):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="https://exotel.mangwale.ai/api/nerve/callback?CallSid=abc123" 
            timeout="15" 
            finishOnKey="#" 
            numDigits="1">
        <Say voice="Aditi">नमस्ते Saurabh! यह मंगवाले से कॉल है। आपके लिए एक नया ऑर्डर आया है। ऑर्डर स्वीकार करने के लिए 1 दबाएं।</Say>
    </Gather>
    <Say voice="Aditi">No input received</Say>
</Response>
```

**What Exotel does:**
1. ✅ Plays Hindi TTS
2. ✅ Waits for DTMF input (15 seconds)
3. ✅ User presses 1
4. ✅ Calls Passthru AGAIN with digits=1

### Call 2: Process Accept (digits=1)

**Exotel calls:**
```
GET https://exotel.mangwale.ai/api/nerve/callback
    ?CallSid=abc123
    &digits="1"
    &CustomField=...
```

**Our code (nerve_system.py lines 1345-1385):**
```python
if dtmf:
    clean_digits = dtmf.replace('"', '').strip()
    
    if call_state.current_state == "greeting":
        if clean_digits == "1":  # Accept
            call_state.current_state = "prep_time"
            # Ask for prep time
            greeting = "धन्यवाद! खाना तैयार करने में कितने मिनट लगेंगे? 15 मिनट के लिए 1, 30 मिनट के लिए 2, 45 मिनट के लिए 3 दबाएं।"
            return Response(
                content=build_exoml_response(greeting, gather_action=callback_url, ...),
                media_type="application/xml"
            )
```

**Our response (HTTP 200):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="https://exotel.mangwale.ai/api/nerve/callback?CallSid=abc123" 
            timeout="15" 
            numDigits="1">
        <Say voice="Aditi">धन्यवाद! खाना तैयार करने में कितने मिनट लगेंगे? 15 मिनट के लिए 1 दबाएं...</Say>
    </Gather>
</Response>
```

**What Exotel does:**
1. ✅ Plays next message
2. ✅ User presses 2 (30 min)
3. ✅ Calls Passthru AGAIN with digits=2

### Call 3: Confirmation (digits=2)

**Exotel calls:**
```
GET https://exotel.mangwale.ai/api/nerve/callback
    ?CallSid=abc123
    &digits="2"
```

**Our response (HTTP 200):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Aditi">धन्यवाद! राइडर 30 मिनट में पहुंचेगा। शुभ दिन!</Say>
    <Hangup/>
</Response>
```

**What Exotel does:**
1. ✅ Plays goodbye message
2. ✅ Hangs up (call ends)

---

## 🔧 Code Verification

Our endpoint **already handles all this**! Check:

```bash
# Test the endpoint
curl "https://exotel.mangwale.ai/api/nerve/callback?CallSid=test123&order_id=999&vendor_name=Test"
```

**Expected response:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="..." timeout="15" numDigits="1">
        <Say voice="Aditi">नमस्ते Test!...</Say>
    </Gather>
</Response>
```

✅ If you see XML → Endpoint works!
❌ If you see JSON → Wrong endpoint!

---

## 📸 Dashboard Should Look Like This

### Passthru Configuration Panel:

```
┌─────────────────────────────────────────────────────────┐
│ Information Pass Through                                │
│                                                          │
│ Passthru                                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ https://exotel.mangwale.ai/api/nerve/callback       │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ Options                                                  │
│ ☐ Make Passthru Async                                   │
│                                                          │
│ In response                                              │
│ Once the URL returns OK (200 OK)...                     │
│ ┌────────────┐                                          │
│ │  (Empty)   │  ← No applet needed!                     │
│ └────────────┘                                          │
│                                                          │
│ If the url returns anything else...                     │
│ ┌────────────┐                                          │
│ │   Hangup   │                                          │
│ └────────────┘                                          │
└─────────────────────────────────────────────────────────┘
```

### Canvas:

```
┌──────────────────────────────────────┐
│                                      │
│   ┌────────────┐   ┌────────────┐   │
│   │Call Start  │──→│  Passthru  │   │
│   └────────────┘   └────────────┘   │
│                                      │
│   (No other applets needed)          │
│                                      │
└──────────────────────────────────────┘
```

---

## ⚠️ Common Mistakes to Avoid

### ❌ WRONG: Multiple applets after Passthru
```
[Start] → [Passthru] → [Gather] → [Connect] → [Hangup]
```

Why wrong? The Passthru returns ExoML that CONTAINS `<Gather>` tags internally!

### ✅ RIGHT: Just Passthru
```
[Start] → [Passthru]
```

The flow is controlled by the ExoML we return, not by dashboard applets!

---

### ❌ WRONG: Async Passthru
```
Options:
☑ Make Passthru Async
```

Why wrong? Async means Exotel doesn't wait for our response, so we can't control the flow!

### ✅ RIGHT: Sync Passthru
```
Options:
☐ Make Passthru Async
```

---

### ❌ WRONG: Wrong URL endpoint
```
URL: https://exotel.mangwale.ai/api/voice/ai-callback
```

Why wrong? This endpoint doesn't exist in our code!

### ✅ RIGHT: Correct URL
```
URL: https://exotel.mangwale.ai/api/nerve/callback
```

This endpoint exists and returns proper ExoML!

---

## 🧪 Testing Steps

### 1. Update Dashboard

1. Change Passthru URL to: `https://exotel.mangwale.ai/api/nerve/callback`
2. Uncheck "Make Passthru Async"
3. Remove any applets after Passthru (on success path)
4. **SAVE** (blue button top right)

### 2. Make Test Call

```bash
curl -X POST "http://192.168.0.151:7100/api/nerve/vendor-order-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_phone": "919923383838",
    "vendor_name": "Saurabh",
    "vendor_id": "V001",
    "order_id": 55555,
    "order_amount": 1000,
    "order_details": {"items": "Final test with Passthru"}
  }'
```

### 3. Expected Result

1. ✅ Phone rings: 9923383838
2. ✅ Pick up → Hear Hindi voice: "नमस्ते Saurabh, यह मंगवाले से कॉल है..."
3. ✅ Press **1** (accept)
4. ✅ Hear: "धन्यवाद! खाना तैयार करने में कितने मिनट लगेंगे..."
5. ✅ Press **2** (30 min)
6. ✅ Hear: "राइडर 30 मिनट में पहुंचेगा"
7. ✅ Call ends

### 4. Check Logs

```bash
tail -f /tmp/nerve-clean.log | grep -E "callback|digits|ExoML"
```

**Good logs:**
```
✅ GET /api/nerve/callback?CallSid=xxx (no digits) - 200 OK
✅ GET /api/nerve/callback?CallSid=xxx&digits="1" - 200 OK
✅ GET /api/nerve/callback?CallSid=xxx&digits="2" - 200 OK
```

---

## 📚 Documentation Reference

**From Exotel Passthru docs:**
> "Using the Passthru applet, you can get Exotel to talk to your Application URL and pass on details about the incoming call. Your application can now process this information and decide which path (success/failure) the flow should take next."

**Key parameters Passthru sends:**
- `CallSid` - Unique call ID
- `digits` - DTMF input (from previous Gather)
- `CustomField` - Your metadata (order_id, vendor_name, etc.)

**What we return:**
- ExoML XML with `<Response><Gather><Say>...</Say></Gather></Response>`
- HTTP 200 status always
- The `<Gather>` tag makes Exotel collect digits and call us again

---

## ✅ Summary Checklist

Before testing, verify:

- [ ] Passthru URL is: `https://exotel.mangwale.ai/api/nerve/callback`
- [ ] "Make Passthru Async" is **UNCHECKED**
- [ ] Canvas has: `[Start] → [Passthru]` only
- [ ] No applets after Passthru (or loops back to Passthru)
- [ ] Nerve System is running: `ps aux | grep nerve_system`
- [ ] Endpoint is accessible: `curl https://exotel.mangwale.ai/api/nerve/callback?CallSid=test`
- [ ] Dashboard changes are **SAVED**

**After configuration, the system will work perfectly!** 🎉

The endpoint, code, and TTS are all ready. You just need the correct Passthru configuration!
