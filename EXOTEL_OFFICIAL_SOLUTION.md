# 🎯 EXOTEL CONFIGURATION - OFFICIAL SOLUTION

**Date:** December 24, 2025  
**Based On:** Official Exotel Support Documentation  
**Issue:** Call disconnects after pickup - no audio plays

---

## 🔍 ROOT CAUSE ANALYSIS

### What's Happening:

1. ✅ API call works (From=919923383838, CallerId=02048556923)
2. ✅ Phone rings and you answer
3. ✅ Exotel tries to execute App 1148615
4. ❌ **App 1148615 is likely empty or misconfigured**
5. ❌ Call disconnects after 8 seconds

### The Problem:

According to official Exotel documentation, there is **NO "Programmable Gather" applet** in the standard offering. Instead, you need to use **ONE OF THESE** approaches:

---

## ✅ SOLUTION OPTIONS (Official Exotel Methods)

### Option 1: Gather Applet + Passthru (RECOMMENDED) ⭐

This is the standard Exotel approach for dynamic IVR.

**Dashboard Configuration:**

```
┌──────────────────────────────────────────────────────────┐
│  App ID: 1148615                                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│      START                                               │
│        ↓                                                 │
│      PLAY (Dynamic URL)                                  │
│        │  URL: https://exotel.mangwale.ai/api/nerve/greeting
│        │  Method: GET                                    │
│        │  Returns: Plain text for TTS                    │
│        ↓                                                 │
│      GATHER                                              │
│        │  Max Digits: 1                                  │
│        │  Timeout: 15s                                   │
│        ↓                                                 │
│      PASSTHRU                                            │
│        │  URL: https://exotel.mangwale.ai/api/nerve/callback
│        │  Method: GET                                    │
│        │  Receives: digits parameter                     │
│        ↓                                                 │
│      PLAY (Dynamic URL - based on digits)                │
│        │  URL: https://exotel.mangwale.ai/api/nerve/response
│        ↓                                                 │
│      HANGUP                                              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Endpoint Requirements:**

1. **`/api/nerve/greeting`** (GET)
   - Returns: `text/plain` (NOT JSON!)
   - Content: "नमस्ते Test Vendor, यह मंगवाले से कॉल..."
   - Exotel's TTS will speak this text

2. **`/api/nerve/callback`** (GET) - Passthru
   - Receives: `digits` parameter
   - Returns: HTTP 200 OK (or 302 for redirect)
   - Purpose: Log the DTMF selection

3. **`/api/nerve/response`** (GET)
   - Returns: `text/plain` (NOT JSON!)
   - Content depends on digits received
   - Exotel's TTS will speak this text

---

### Option 2: ExoML with Dynamic URL

**Dashboard Configuration:**

```
┌──────────────────────────────────────────────────────────┐
│  App ID: 1148615                                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│      START                                               │
│        ↓                                                 │
│      PASSTHRU (Dynamic ExoML)                            │
│        │  URL: https://exotel.mangwale.ai/api/nerve/exoml
│        │  Method: GET                                    │
│        │  Returns: XML (ExoML)                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Endpoint Requirements:**

**`/api/nerve/exoml`** (GET)
- Returns: `application/xml`
- Content: ExoML XML with Say/Gather/Hangup

Example ExoML:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="hi-IN">नमस्ते Test Vendor</Say>
    <Gather action="https://exotel.mangwale.ai/api/nerve/exoml?step=2" 
            timeout="15" 
            numDigits="1">
        <Say voice="hi-IN">स्वीकार के लिए 1 दबाएं</Say>
    </Gather>
    <Say voice="hi-IN">कोई input नहीं</Say>
</Response>
```

---

## 🛠️ REQUIRED CODE CHANGES

### Current Issue:

Our `/api/nerve/gather` endpoint returns **JSON** format:
```json
{
  "gather_prompt": {"text": "..."},
  "max_input_digits": 1
}
```

**This format is NOT supported by standard Exotel applets!**

### Fix Option 1: Use Text/Plain Format

Modify endpoint to return `text/plain`:

```python
@app.get("/api/nerve/greeting")
async def dynamic_greeting_handler(CustomField: str = Query(None)):
    # Parse custom field
    context = json.loads(CustomField) if CustomField else {}
    vendor_name = context.get("vendor_name", "")
    order_id = context.get("order_id", 0)
    
    # Generate text
    greeting = f"नमस्ते {vendor_name}, ऑर्डर {order_id} आया है। 1 दबाएं स्वीकार, 0 रद्द।"
    
    # MUST return text/plain (NO charset!)
    return Response(
        content=greeting,
        media_type="text/plain"
    )
```

### Fix Option 2: Use ExoML Format

Modify endpoint to return XML:

```python
@app.get("/api/nerve/exoml")
async def exoml_handler(
    CallSid: str = Query(None),
    digits: str = Query(None),
    CustomField: str = Query(None)
):
    context = json.loads(CustomField) if CustomField else {}
    
    if not digits:
        # Initial greeting
        exoml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="https://exotel.mangwale.ai/api/nerve/exoml" 
            timeout="15" 
            numDigits="1">
        <Say voice="hi-IN">नमस्ते {context.get("vendor_name", "")}, 
        ऑर्डर स्वीकार के लिए 1 दबाएं।</Say>
    </Gather>
</Response>'''
    
    elif digits == "1":
        # Accepted - ask prep time
        exoml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="https://exotel.mangwale.ai/api/nerve/exoml" 
            timeout="15" 
            numDigits="1">
        <Say voice="hi-IN">15 मिनट के लिए 1, 30 के लिए 2 दबाएं।</Say>
    </Gather>
</Response>'''
    
    elif digits in ["2", "3"]:
        # Prep time selected - goodbye
        prep_time = 30 if digits == "2" else 45
        exoml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="hi-IN">धन्यवाद! राइडर {prep_time} मिनट में आएगा।</Say>
    <Hangup/>
</Response>'''
    
    else:
        # Invalid or rejected
        exoml = '''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="hi-IN">धन्यवाद! शुभ दिन।</Say>
    <Hangup/>
</Response>'''
    
    return Response(content=exoml, media_type="application/xml")
```

---

## 📋 DASHBOARD CONFIGURATION STEPS

### Step 1: Login to Exotel

Go to: https://my.exotel.com/sarvinsuppliesllp1

### Step 2: Navigate to IVR Apps

Dashboard → IVR → Apps → Find App 1148615

### Step 3: Clear Existing Configuration

Delete ALL existing applets from the canvas.

### Step 4: Option A - Play + Gather + Passthru

1. **Add PLAY applet**
   - Type: Dynamic URL
   - URL: `https://exotel.mangwale.ai/api/nerve/greeting`
   - Method: GET
   - Connect START → PLAY

2. **Add GATHER applet** (below PLAY)
   - Max Digits: 1
   - Timeout: 15 seconds
   - Finish on Key: # (optional)
   - Connect PLAY → GATHER

3. **Add PASSTHRU applet** (below GATHER)
   - URL: `https://exotel.mangwale.ai/api/nerve/callback`
   - Method: GET
   - Make Async: NO (uncheck)
   - Connect GATHER → PASSTHRU

4. **Add PLAY applet** (for response)
   - Type: Dynamic URL
   - URL: `https://exotel.mangwale.ai/api/nerve/response`
   - Method: GET
   - Connect PASSTHRU → PLAY

5. **Add HANGUP applet**
   - Connect PLAY → HANGUP

### Step 5: Option B - Passthru with ExoML (Simpler)

1. **Add PASSTHRU applet**
   - URL: `https://exotel.mangwale.ai/api/nerve/exoml`
   - Method: GET
   - Make Async: NO (uncheck)
   - Connect START → PASSTHRU

2. **Set Transitions:**
   - Success → (loop back to PASSTHRU or end)
   - Failure → HANGUP

**Note:** With ExoML, the Passthru endpoint handles EVERYTHING.

### Step 6: Save & Publish

Click **Save** then **Publish**.

---

## 🧪 TESTING

### Test Command (Unchanged):

```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect.json" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  --data-urlencode "From=919923383838" \
  --data-urlencode "CallerId=02048556923" \
  --data-urlencode "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615" \
  --data-urlencode 'CustomField={"order_id":12345,"vendor_name":"Test Vendor","language":"en"}'
```

### Expected Flow:

1. Phone rings (919923383838)
2. You answer
3. You hear: "Hello Test Vendor..." (TTS)
4. Press 1
5. You hear: "How many minutes..."
6. Press 2
7. You hear: "Thank you! Rider will arrive..."
8. Call ends

---

## 📊 COMPARISON: JSON vs ExoML

| Method | Format | Exotel Support | Complexity | Flexibility |
|--------|--------|----------------|------------|-------------|
| **JSON** (our current) | `{"gather_prompt":{"text":"..."}}` | ❌ NOT standard | Low | High |
| **Text/Plain** | Plain text string | ✅ Supported | Low | Low |
| **ExoML** (XML) | `<Say>...</Say><Gather>...` | ✅ Official | Medium | High |

---

## ✅ RECOMMENDATION

**Use ExoML approach (Option 2):**

1. Simpler dashboard (just 1 Passthru applet)
2. Full control over flow
3. Official Exotel method
4. Already partially implemented in our code

**Required Changes:**

1. Make `/api/nerve/exoml` the primary endpoint
2. Ensure it returns proper XML (not JSON)
3. Configure App 1148615 with single Passthru applet pointing to this endpoint

---

## 🚨 CURRENT BLOCKER

**Cannot proceed without dashboard access.**

You MUST configure App 1148615 in the Exotel web dashboard. Our code is ready, but Exotel needs the dashboard configuration to know what to execute when App 1148615 is called.

---

**Status:** Waiting for dashboard configuration  
**Priority:** HIGH - Blocking production  
**Next Step:** Configure Exotel Dashboard App 1148615
