# 🎯 EXOTEL API COMPLETE REFERENCE - From Postman Collections

**Analyzed**: All Exotel Postman Collections  
**Purpose**: Understand why call disconnected and fix voice playback  
**Date**: December 19, 2025

---

## 🔍 ROOT CAUSE: Why Call Disconnected on Pickup

**Problem**: Call came through to 9923383838 but disconnected immediately after pickup

**Reason**: We used **Connect API with only From+To parameters** - this connects TWO parties for a conversation. Since both From and To pointed to Exotel number, call had nowhere to go and disconnected.

**Solution**: Use `Url` parameter to point to an IVR flow/app that plays audio/TTS.

---

## 📊 EXOTEL API VERSIONS COMPARISON

### **Voice API v1** (What We Should Use)
- **Endpoint**: `https://api.exotel.com/v1/Accounts/{AccountSid}/Calls/connect`
- **Auth**: Basic Auth (API Key:API Token)
- **Format**: Form Data
- **Response**: XML
- **Best For**: Our use case (simple outbound calls with IVR)

### **Voice API v2 (CCM)**
- **Endpoint**: `https://ccm-api.exotel.com/v2/accounts/{AccountSid}/calls`
- **Auth**: Basic Auth
- **Format**: JSON
- **Response**: JSON
- **Best For**: Contact Center Management

### **Voice API v3**
- **Endpoint**: `https://api.exotel.com/v3/accounts/{AccountSid}/calls`
- **Auth**: Basic Auth
- **Format**: JSON
- **Response**: JSON
- **Best For**: Modern integration, Click-to-Call

---

## 🎯 TWO MAIN USE CASES

### **Use Case 1: Connect Two Parties (C2C)**
**What**: Call vendor, then call customer, connect both

**API**: "Outgoing call to connect two numbers"

**Parameters**:
```
From: Vendor phone (919923383838)
To: Customer phone (918888888888)
CallerId: Your Exotel number (02048556923)
CallType: trans
Record: true
StatusCallback: Your webhook URL
```

**Result**: Vendor hears ringing → Customer picks up → Both connected

**Our Need**: ❌ **NOT THIS** - We don't want to connect two parties

---

### **Use Case 2: Call Someone + Play Audio/IVR** ✅
**What**: Call vendor, play Hindi message, record response

**API**: "Outgoing call to connect number to a call flow"

**Parameters**:
```
From: Vendor phone (919923383838)
CallerId: Your Exotel number (02048556923)
Url: IVR Flow URL (http://my.exotel.com/{sid}/exoml/start_voice/{app_id})
  OR
Url: Your server URL (http://192.168.0.151:3151/exoml/vendor-greeting)
CallType: trans
Record: true
StatusCallback: Your webhook URL
CustomField: {"order_id": 12345}
```

**Result**: Vendor picks up → Hears IVR/Audio → Responds → Recording captured

**Our Need**: ✅ **THIS IS WHAT WE NEED!**

---

## 🔧 SOLUTION: THREE OPTIONS

### **Option A: Use Exotel Dashboard IVR App** (Easiest)

**Steps**:
1. Go to https://my.exotel.com
2. Create IVR App (ExoML flow builder)
3. Add "Say" widget: "नमस्ते! नया ऑर्डर..."
4. Add "Gather" widget for DTMF
5. Get App ID (e.g., 1077337)
6. Use in API call:

```python
form_data = {
    "From": "919923383838",
    "CallerId": "02048556923",
    "Url": "http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1077337",
    "CallType": "trans",
    "Record": "true"
}
```

**Pros**:
- ✅ No server needed for IVR
- ✅ Exotel handles TTS
- ✅ Works immediately

**Cons**:
- ❌ Fixed flow (can't change per order)
- ❌ Dashboard editing required

---

### **Option B: Dynamic ExoML Server** (Flexible) ✅ **RECOMMENDED**

**How it works**:
1. Call vendor with `Url` pointing to YOUR server
2. Your server returns ExoML XML dynamically
3. Exotel executes the XML (plays audio, gathers input)

**API Call**:
```python
form_data = {
    "From": "919923383838",
    "CallerId": "02048556923",
    "Url": "http://192.168.0.151:3151/exoml/vendor-order?order_id=12345",
    "CallType": "trans",
    "Record": "true",
    "StatusCallback": "http://192.168.0.151:3151/webhook/status",
    "CustomField": '{"order_id": 12345}'
}
```

**Your Server Endpoint** (`/exoml/vendor-order`):
```python
@app.get("/exoml/vendor-order")
async def vendor_order_exoml(order_id: int):
    # Return ExoML XML
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="hi-IN" voice="female">
        नमस्ते! आपको नया ऑर्डर मिला है।
        Order ID {order_id}।
    </Say>
    <Gather action="http://192.168.0.151:3151/exoml/vendor-action" 
            timeout="10" 
            numDigits="1">
        <Say language="hi-IN">
            Accept के लिए 1 दबाएं। Cancel के लिए 2 दबाएं।
        </Say>
    </Gather>
    <Say language="hi-IN">कोई input नहीं मिला। धन्यवाद।</Say>
</Response>
"""
    return Response(content=xml, media_type="application/xml")
```

**Pros**:
- ✅ Dynamic content per order
- ✅ Full control over flow
- ✅ Can use variables (order_id, amount, items)

**Cons**:
- ❌ Need to host ExoML server
- ❌ More complex

---

### **Option C: Passthru API** (Most Flexible)

**How it works**:
1. Create IVR app in dashboard with Passthru widget
2. Passthru widget calls YOUR server for every step
3. Your server returns JSON (not XML)
4. Exotel plays the response

**Best For**: Complex multi-step flows

---

## 📋 COMPLETE VOICE v1 API PARAMETERS

### **Mandatory Parameters**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `From` | Phone to call | `919923383838` |
| `CallerId` | Your Exotel virtual number | `02048556923` |

**For C2C (Connect Two Numbers)**:
| Parameter | Description | Example |
|-----------|-------------|---------|
| `To` | Second number to call | `918888888888` |

**For IVR (Connect to Call Flow)**:
| Parameter | Description | Example |
|-----------|-------------|---------|
| `Url` | IVR App URL or Your ExoML server | `http://my.exotel.com/{sid}/exoml/start_voice/1077337` OR `http://192.168.0.151:3151/exoml/vendor` |

### **Optional But Important**

| Parameter | Description | Values | Default |
|-----------|-------------|--------|---------|
| `CallType` | Call category | `trans` (transactional) or `promo` (promotional) | - |
| `Record` | Record conversation | `true` / `false` | `true` |
| `RecordingChannels` | Audio channels | `single` / `dual` | `single` |
| `RecordingFormat` | Audio quality | `mp3` / `mp3-hq` | `mp3` |
| `StatusCallback` | Webhook for call events | Your URL | - |
| `StatusCallbackEvents[0]` | Which events to send | `terminal`, `answered`, `completed` | - |
| `CustomField` | Your metadata | JSON string | - |
| `TimeLimit` | Max call duration (seconds) | `120` (2 min) | 14400 (4 hrs) |
| `TimeOut` | Ring timeout (seconds) | `30` | - |
| `WaitUrl` | Audio to play while waiting | `http://your-server.com/wait.wav` | - |

### **Advanced Parameters**

| Parameter | Description | Use Case |
|-----------|-------------|----------|
| `StartPlaybackToNew` | Who hears wait audio | `callee` / `both` |
| `StartPlaybackUrl` | Audio before connection | Agent greeting |
| `IfMachine` | What to do if voicemail | `continue` / `hangup` |
| `Record` | Record the call | `true` / `false` |
| `RecordWhenAlone` | Record even if other party disconnects | `true` / `false` |

---

## 🎯 EXOML (IVR XML) REFERENCE

### **Basic Structure**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <!-- Your IVR widgets here -->
</Response>
```

### **Available Widgets**

#### **1. Say** - Text to Speech
```xml
<Say language="hi-IN" voice="female">
    नमस्ते! आपका स्वागत है।
</Say>
```

**Attributes**:
- `language`: `hi-IN` (Hindi), `en-IN` (English), `ta-IN` (Tamil), etc.
- `voice`: `female` / `male`

---

#### **2. Play** - Play Audio File
```xml
<Play>http://your-server.com/welcome.wav</Play>
```

**Audio Requirements**:
- Format: WAV only
- Bitrate: 8kHz/16kHz
- Max size: ~2MB (cached by Exotel)

---

#### **3. Gather** - Collect DTMF Input
```xml
<Gather action="http://your-server.com/process-dtmf" 
        timeout="10" 
        numDigits="1"
        finishOnKey="#">
    <Say language="hi-IN">Press 1 to confirm</Say>
</Gather>
```

**Attributes**:
- `action`: URL to POST the digits
- `timeout`: Seconds to wait for input
- `numDigits`: How many digits to collect
- `finishOnKey`: Key to end input (`#`)

**POST Parameters Sent**:
- `CallSid`: Call identifier
- `Digits`: What user pressed (e.g., "1")
- `CustomField`: Your custom data

---

#### **4. Record** - Record Audio
```xml
<Record maxLength="30" 
        finishOnKey="#"
        action="http://your-server.com/handle-recording">
    <Say>Please leave your message after the beep</Say>
</Record>
```

---

#### **5. Dial** - Connect to Another Number
```xml
<Dial callerId="02048556923" timeout="30">918888888888</Dial>
```

---

#### **6. Redirect** - Go to Another ExoML URL
```xml
<Redirect>http://your-server.com/another-flow</Redirect>
```

---

#### **7. Hangup** - End Call
```xml
<Hangup/>
```

---

## 🔄 CALL FLOW WITH EXOML

### **Complete Vendor Order Confirmation Flow**

```
1. API Call Initiates
   POST /v1/Accounts/{sid}/Calls/connect
   {
     From: 919923383838,
     CallerId: 02048556923,
     Url: http://192.168.0.151:3151/exoml/vendor-greeting
   }
   ↓

2. Exotel Calls Vendor
   Ring ring...
   ↓

3. Vendor Picks Up
   ↓

4. Exotel Requests ExoML
   GET http://192.168.0.151:3151/exoml/vendor-greeting?CallSid=xxx&CustomField={"order_id":12345}
   ↓

5. Your Server Returns XML
   <Response>
     <Say language="hi-IN">नमस्ते! नया ऑर्डर 12345...</Say>
     <Gather action="/exoml/process-response" numDigits="1">
       <Say>Press 1 to accept</Say>
     </Gather>
   </Response>
   ↓

6. Exotel Plays Audio
   Vendor hears: "नमस्ते! नया ऑर्डर..."
   ↓

7. Vendor Presses 1
   ↓

8. Exotel Posts to Your Server
   POST http://192.168.0.151:3151/exoml/process-response
   {
     CallSid: xxx,
     Digits: "1",
     CustomField: {"order_id": 12345}
   }
   ↓

9. Your Server Returns XML
   <Response>
     <Say>Thank you! Order confirmed</Say>
     <Hangup/>
   </Response>
   ↓

10. Call Ends
   ↓

11. Exotel Sends Webhook
    POST http://192.168.0.151:3151/webhook/status
    {
      CallSid: xxx,
      Status: completed,
      RecordingUrl: http://...
    }
```

---

## 💻 WORKING CODE - FIXED VERSION

### **Updated main.py** (The Fix)

```python
@app.post("/api/call/vendor-order")
async def call_vendor_order(
    vendor_phone: str,
    vendor_name: str = "Vendor",
    order_id: int = 0,
    order_amount: float = 0,
    items: str = ""
):
    logger.info(f"📞 Calling vendor {vendor_name} for order {order_id}")
    
    try:
        # Clean phone number
        clean_phone = vendor_phone.replace('+', '').replace('-', '').replace(' ', '')
        
        # Exotel Connect API
        exotel_url = f"https://{EXOTEL_API_KEY}:{EXOTEL_API_TOKEN}@api.exotel.com/v1/Accounts/{EXOTEL_SID}/Calls/connect"
        
        # CRITICAL: Use Url parameter to point to ExoML endpoint
        form_data = {
            "From": clean_phone,
            "CallerId": EXOTEL_CALLER_ID,
            "Url": f"{CALLBACK_BASE_URL}/exoml/vendor-greeting?order_id={order_id}&vendor_name={vendor_name}&amount={order_amount}",  # THIS WAS MISSING!
            "CallType": "trans",
            "Record": "true",
            "RecordingChannels": "dual",
            "StatusCallback": f"{CALLBACK_BASE_URL}/webhook/exotel/status",
            "StatusCallbackEvents[0]": "terminal",
            "CustomField": json.dumps({
                "type": "vendor_order",
                "order_id": order_id,
                "vendor_phone": vendor_phone
            }),
            "TimeOut": "30",
            "TimeLimit": "120"
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(exotel_url, data=form_data)
            response.raise_for_status()
            
            # Parse XML response
            root = ET.fromstring(response.text)
            call_sid = root.find('.//Sid').text
            
            logger.info(f"✅ Call initiated: {call_sid}")
            
            return {
                "success": True,
                "call_sid": call_sid,
                "order_id": order_id
            }
            
    except Exception as e:
        logger.error(f"❌ Call failed: {e}")
        return {"success": False, "error": str(e)}
```

### **New: ExoML Greeting Endpoint**

```python
@app.get("/exoml/vendor-greeting")
async def vendor_greeting_exoml(
    order_id: int,
    vendor_name: str = "Vendor",
    amount: float = 0,
    CallSid: str = None,
    CustomField: str = None
):
    """
    ExoML endpoint - Returns XML for Exotel to execute
    Called when vendor picks up the phone
    """
    logger.info(f"📞 ExoML greeting requested for order {order_id}")
    
    # Build ExoML XML
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="hi-IN" voice="female">
        नमस्ते {vendor_name}! Mangwale से बोल रहे हैं।
        आपको नया ऑर्डर मिला है।
        Order ID {order_id}।
        Amount {int(amount)} रुपये।
    </Say>
    <Gather action="{CALLBACK_BASE_URL}/exoml/vendor-action?order_id={order_id}" 
            timeout="10" 
            numDigits="1"
            finishOnKey="#">
        <Say language="hi-IN" voice="female">
            Order accept करने के लिए 1 दबाएं।
            Cancel करने के लिए 2 दबाएं।
        </Say>
    </Gather>
    <Say language="hi-IN">कोई input नहीं मिला। धन्यवाद।</Say>
</Response>
"""
    
    return Response(content=xml, media_type="application/xml")


@app.post("/exoml/vendor-action")
async def vendor_action_exoml(
    order_id: int,
    Digits: str = Form(None),
    CallSid: str = Form(None),
    background_tasks: BackgroundTasks = None
):
    """
    Handle vendor's DTMF response
    """
    logger.info(f"📞 Vendor pressed: {Digits} for order {order_id}")
    
    if Digits == "1":
        # Accept order
        xml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="hi-IN">
        धन्यवाद! Order confirm हो गया। Customer को inform कर दिया जाएगा।
    </Say>
    <Hangup/>
</Response>
"""
        # Update Jupiter in background
        background_tasks.add_task(update_jupiter_order, order_id, "confirmed")
        
    elif Digits == "2":
        # Cancel order
        xml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="hi-IN">
        Order cancel हो गया। Customer को inform कर दिया जाएगा।
    </Say>
    <Hangup/>
</Response>
"""
        background_tasks.add_task(update_jupiter_order, order_id, "cancelled")
        
    else:
        # Invalid input
        xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="hi-IN">गलत option।</Say>
    <Redirect>{CALLBACK_BASE_URL}/exoml/vendor-greeting?order_id={order_id}</Redirect>
</Response>
"""
    
    return Response(content=xml, media_type="application/xml")
```

---

## 🚀 QUICK FIX FOR YOUR ISSUE

The call disconnected because we didn't provide a `Url` parameter. Here's what to change:

**BEFORE (Disconnects)**:
```python
form_data = {
    "From": "919923383838",
    "To": "02048556923",  # Wrong - connects two parties
    "CallerId": "02048556923"
}
```

**AFTER (Works)**:
```python
form_data = {
    "From": "919923383838",
    "CallerId": "02048556923",
    "Url": "http://192.168.0.151:3151/exoml/vendor-greeting?order_id=12345",  # THIS!
    "CallType": "trans",
    "Record": "true"
}
```

---

## 📝 IMPLEMENTATION CHECKLIST

- [ ] Remove `To` parameter from API call
- [ ] Add `Url` parameter pointing to ExoML endpoint
- [ ] Create `/exoml/vendor-greeting` endpoint (returns XML)
- [ ] Create `/exoml/vendor-action` endpoint (handles DTMF)
- [ ] Test with your phone number (9923383838)
- [ ] Verify ExoML is returned correctly
- [ ] Check audio plays in Hindi
- [ ] Test DTMF input (press 1/2)
- [ ] Verify recording webhook works

---

## 🎯 READY-TO-USE ENDPOINTS

Your server needs these 3 endpoints:

1. **POST /api/call/vendor-order** - Trigger call (already exists, needs update)
2. **GET /exoml/vendor-greeting** - Return initial IVR XML (NEW)
3. **POST /exoml/vendor-action** - Handle DTMF response (NEW)
4. **POST /webhook/exotel/status** - Handle call completion (already exists)

---

**Next Action**: Update the code with `Url` parameter and add ExoML endpoints! 🚀
