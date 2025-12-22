# 🎯 EXOTEL IMPLEMENTATION - SIMPLE VS COMPLEX

## Exotel Credentials ✅ (Already Configured)
```env
EXOTEL_SID=sarvinsuppliesllp1
EXOTEL_API_KEY=45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf
EXOTEL_API_TOKEN=66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5
EXOTEL_SUBDOMAIN=api
```

---

## 🤔 Your Question: Is ExoML the Right Way?

**Answer**: It depends on your priority - **Speed vs Features**

---

## 📊 THREE APPROACHES COMPARED

### **Option 1: Simple Connect API** ⭐ **RECOMMENDED FOR MVP**

**What it does:**
- Call vendor/rider
- Play pre-generated audio message (TTS)
- Record their response
- End call
- **Post-call analysis**: Use your ASR to check if they said "accept" or "cancel"

**Pros:**
✅ **Easiest** - 1 hour implementation  
✅ **No ExoML complexity** - Just REST API  
✅ **Works immediately** - No IVR flow building  
✅ **Leverage existing ASR/TTS** - Indic Parler TTS + Faster Whisper ASR  
✅ **Same result** - Vendor accepts/cancels, you get the status

**Cons:**
❌ No real-time DTMF (press 1/2)  
❌ Processing time needs voice recognition ("15 minutes" vs "1" button)  
❌ Slightly slower vendor experience (speak vs press button)

**Code Example:**
```python
# Simple Connect API call
def call_vendor_order_confirmation(vendor_phone, order_id):
    # 1. Generate TTS audio
    message = f"नमस्ते! Order ID {order_id}। Accept करें या cancel?"
    audio_url = generate_tts(message)
    
    # 2. Call Exotel Connect API
    response = requests.post(
        f"https://{API_KEY}:{API_TOKEN}@api.exotel.com/v1/Accounts/{SID}/Calls/connect.json",
        data={
            "From": vendor_phone,
            "To": vendor_phone,  # Call vendor
            "CallerId": "02048556923",  # Your Exotel number
            "CallType": "trans",
            "Url": audio_url,  # Play TTS message
            "Record": "true",
            "StatusCallback": "http://192.168.0.151:3151/webhook/exotel",
            "CustomField": json.dumps({"order_id": order_id})
        }
    )
    
    # 3. When call ends, webhook receives recording
    # 4. Run ASR on recording → detect "accept" or "cancel"
    # 5. Update Jupiter database
```

**Timeline**: 1-2 hours  
**Complexity**: ⭐ Very Simple

---

### **Option 2: ExoML with Gather** (What I built for you)

**What it does:**
- Call vendor
- Play dynamic IVR menu
- Vendor presses 1 (accept), 2 (cancel), 3 (time)
- **Real-time processing** - immediate feedback

**Pros:**
✅ **Professional IVR** - "Press 1 for..."  
✅ **Real-time DTMF** - Immediate response  
✅ **Processing time as digits** - 1=15min, 2=20min, 3=30min  
✅ **Familiar UX** - Like bank IVR  

**Cons:**
❌ More complex - Need ExoML server  
❌ Need to return XML responses  
❌ More debugging if issues  
❌ 2-3 days implementation

**Code Example** (Already built in EXOTEL_COMPLETE_SOLUTION.md):
```python
@app.post("/exoml/vendor-order-start")
async def vendor_order_start():
    exoml = """<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Say language="hi-IN">नमस्ते! नया ऑर्डर।</Say>
        <Gather action="/exoml/vendor-action" numDigits="1">
            <Say>Accept के लिए 1, Cancel के लिए 2 दबाएं।</Say>
        </Gather>
    </Response>
    """
    return Response(content=exoml, media_type="application/xml")
```

**Timeline**: 2-3 days  
**Complexity**: ⭐⭐⭐ Medium

---

### **Option 3: Programmable Gather** (Hybrid)

**What it does:**
- Use Exotel's Programmable Gather applet (dashboard config)
- Your endpoint returns JSON with dynamic TTS text
- Simpler than full ExoML but more features than Connect API

**Pros:**
✅ **Middle ground** - Some IVR features, less code  
✅ **Dynamic TTS** - Text returned via JSON  
✅ **DTMF support**  
✅ **Exotel handles XML** - You just return JSON

**Cons:**
❌ Need to configure Exotel dashboard  
❌ Still needs webhook server  
❌ Documentation less clear

**Code Example:**
```python
@app.get("/exotel/gather")
async def programmable_gather(CallSid: str, CustomField: str):
    order_data = json.loads(CustomField)
    return {
        "gather_prompt": {
            "text": f"नमस्ते! Order {order_data['order_id']}। 1 दबाएं accept के लिए।"
        },
        "max_input_digits": 1,
        "input_timeout": 10
    }
```

**Timeline**: 1-2 days  
**Complexity**: ⭐⭐ Low-Medium

---

## 🚦 MY RECOMMENDATION

### **For Immediate Launch (Next 2 Hours): Option 1 - Simple Connect API**

**Why?**
- You get **90% of the value** with **10% of the code**
- Vendor still gets called, hears the order, responds
- You analyze their response with existing ASR (already built!)
- **Production-ready in 1-2 hours**

**Implementation Steps:**
1. Create simple Python service (50 lines of code)
2. Integrate with Jupiter to trigger calls on order creation
3. Use existing Indic Parler TTS for Hindi messages
4. Use existing Faster Whisper ASR to analyze recordings
5. Update order status based on ASR analysis

### **For Better UX (Week 2): Add Option 2 - ExoML**

Once you validate the flow works with Option 1, upgrade to ExoML for:
- Professional IVR experience
- Instant DTMF feedback
- Better user experience

---

## 📝 SIMPLE CONNECT API - COMPLETE IMPLEMENTATION

### File: `/home/ubuntu/mangwale-voice/simple-exotel-caller/main.py`

```python
"""
Simple Exotel Voice Caller
No ExoML, just Connect API + TTS + ASR
"""

from fastapi import FastAPI, Form, Request, BackgroundTasks
import httpx
import json
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Simple Exotel Caller")

# Config
EXOTEL_SID = "sarvinsuppliesllp1"
EXOTEL_API_KEY = "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf"
EXOTEL_API_TOKEN = "66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5"
EXOTEL_CALLER_ID = "02048556923"  # Your virtual number
TTS_URL = "http://192.168.0.151:7002/generate"
ASR_URL = "http://192.168.0.151:7001/transcribe"
JUPITER_URL = "http://192.168.0.156:3000/api"

# ===================================
# VENDOR ORDER CONFIRMATION
# ===================================

@app.post("/api/call/vendor-order")
async def call_vendor_order(
    vendor_phone: str,
    vendor_name: str,
    order_id: int,
    order_amount: float,
    items: str,
    background_tasks: BackgroundTasks
):
    """
    Call vendor for order confirmation
    Simple approach: TTS message + Record response
    """
    logger.info(f"📞 Calling vendor {vendor_name} for order {order_id}")
    
    try:
        # 1. Generate TTS message
        message = f"""
        नमस्ते {vendor_name}! Mangwale से।
        आपको नया ऑर्डर मिला है।
        Order ID {order_id}।
        Amount {int(order_amount)} रुपये।
        Items: {items}।
        
        अगर आप order accept करते हैं तो बोलें "Accept" या "हाँ"।
        अगर cancel करना है तो बोलें "Cancel" या "नहीं"।
        
        Processing time बताएं - 15 minute, 20 minute, या 30 minute।
        
        Please respond now.
        """
        
        # 2. Generate audio file
        async with httpx.AsyncClient() as client:
            tts_response = await client.post(
                TTS_URL,
                json={"text": message, "language": "hi"},
                timeout=30.0
            )
            audio_url = tts_response.json()["audio_url"]
        
        # 3. Call Exotel Connect API
        exotel_url = f"https://{EXOTEL_API_KEY}:{EXOTEL_API_TOKEN}@api.exotel.com/v1/Accounts/{EXOTEL_SID}/Calls/connect.json"
        
        async with httpx.AsyncClient() as client:
            call_response = await client.post(
                exotel_url,
                data={
                    "From": vendor_phone,
                    "To": vendor_phone,  # Call vendor
                    "CallerId": EXOTEL_CALLER_ID,
                    "CallType": "trans",
                    "Url": audio_url,  # Play TTS
                    "Record": "true",
                    "RecordingChannels": "both",
                    "StatusCallback": "http://192.168.0.151:3151/webhook/exotel/status",
                    "StatusCallbackEvents[0]": "terminal",
                    "CustomField": json.dumps({
                        "type": "vendor_order",
                        "order_id": order_id,
                        "vendor_phone": vendor_phone
                    }),
                    "TimeOut": "30"
                }
            )
            
            call_data = call_response.json()
            call_sid = call_data["Call"]["Sid"]
            
            logger.info(f"✅ Call initiated: {call_sid}")
            
            return {
                "success": True,
                "call_sid": call_sid,
                "order_id": order_id,
                "message": "Call initiated, waiting for vendor response"
            }
            
    except Exception as e:
        logger.error(f"❌ Call failed: {e}")
        return {"success": False, "error": str(e)}


# ===================================
# WEBHOOK - CALL STATUS
# ===================================

@app.post("/webhook/exotel/status")
async def exotel_status_webhook(
    CallSid: str = Form(...),
    Status: str = Form(...),
    RecordingUrl: str = Form(None),
    CustomField: str = Form(None),
    background_tasks: BackgroundTasks = None
):
    """
    Called by Exotel when call ends
    Process recording with ASR → Update Jupiter
    """
    logger.info(f"📥 Call ended: {CallSid}, Status: {Status}")
    
    if Status == "completed" and RecordingUrl:
        # Parse custom field
        try:
            custom_data = json.loads(CustomField) if CustomField else {}
            order_id = custom_data.get("order_id")
            
            # Process recording in background
            background_tasks.add_task(
                process_vendor_response,
                recording_url=RecordingUrl,
                call_sid=CallSid,
                order_id=order_id
            )
            
            logger.info(f"✅ Processing recording for order {order_id}")
            
        except Exception as e:
            logger.error(f"❌ Error processing webhook: {e}")
    
    return {"success": True}


# ===================================
# ASR PROCESSING
# ===================================

async def process_vendor_response(recording_url: str, call_sid: str, order_id: int):
    """
    1. Download recording from Exotel
    2. Run ASR to transcribe
    3. Analyze text for accept/cancel + time
    4. Update Jupiter database
    """
    try:
        logger.info(f"🎙️ Processing recording for order {order_id}")
        
        # 1. Download recording
        async with httpx.AsyncClient() as client:
            recording_response = await client.get(recording_url)
            audio_data = recording_response.content
        
        # 2. Run ASR
        async with httpx.AsyncClient() as client:
            asr_response = await client.post(
                ASR_URL,
                files={"audio": audio_data},
                timeout=60.0
            )
            transcription = asr_response.json()["text"].lower()
        
        logger.info(f"📝 Transcription: {transcription}")
        
        # 3. Analyze response
        status = "pending"
        processing_time = 20  # Default
        
        # Check for acceptance
        if any(word in transcription for word in ["accept", "हाँ", "yes", "ठीक", "ok"]):
            status = "confirmed"
            
            # Extract processing time
            if "15" in transcription or "पंद्रह" in transcription:
                processing_time = 15
            elif "20" in transcription or "बीस" in transcription:
                processing_time = 20
            elif "30" in transcription or "तीस" in transcription:
                processing_time = 30
                
        elif any(word in transcription for word in ["cancel", "नहीं", "no", "reject"]):
            status = "cancelled"
        
        # 4. Update Jupiter
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{JUPITER_URL}/orders/{order_id}/update-status",
                json={
                    "status": status,
                    "processing_time": processing_time,
                    "vendor_response": transcription,
                    "call_sid": call_sid,
                    "source": "exotel_voice"
                },
                timeout=10.0
            )
        
        logger.info(f"✅ Order {order_id} updated: {status}, {processing_time}min")
        
    except Exception as e:
        logger.error(f"❌ ASR processing failed: {e}")


# ===================================
# RIDER DELIVERY ALERT
# ===================================

@app.post("/api/call/rider-delivery")
async def call_rider_delivery(
    rider_phone: str,
    order_id: int,
    pickup_address: str,
    delivery_address: str,
    customer_name: str
):
    """
    Simple rider notification
    Just plays message, records acknowledgment
    """
    logger.info(f"🚚 Calling rider for order {order_id}")
    
    try:
        # Generate message
        message = f"""
        नमस्ते! Mangwale delivery।
        Order ID {order_id}।
        Pickup location: {pickup_address}।
        Delivery location: {delivery_address}।
        Customer name: {customer_name}।
        
        Please confirm by saying OK or ठीक है।
        """
        
        # Generate TTS
        async with httpx.AsyncClient() as client:
            tts_response = await client.post(
                TTS_URL,
                json={"text": message, "language": "hi"},
                timeout=30.0
            )
            audio_url = tts_response.json()["audio_url"]
        
        # Call rider
        exotel_url = f"https://{EXOTEL_API_KEY}:{EXOTEL_API_TOKEN}@api.exotel.com/v1/Accounts/{EXOTEL_SID}/Calls/connect.json"
        
        async with httpx.AsyncClient() as client:
            await client.post(
                exotel_url,
                data={
                    "From": rider_phone,
                    "To": rider_phone,
                    "CallerId": EXOTEL_CALLER_ID,
                    "CallType": "trans",
                    "Url": audio_url,
                    "Record": "true",
                    "CustomField": json.dumps({"type": "rider_delivery", "order_id": order_id})
                }
            )
        
        logger.info(f"✅ Rider call initiated")
        return {"success": True, "order_id": order_id}
        
    except Exception as e:
        logger.error(f"❌ Rider call failed: {e}")
        return {"success": False, "error": str(e)}


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "simple-exotel-caller"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3151)
```

---

## 🚀 DEPLOYMENT (Simple Approach)

### 1. Deploy on Mercury

```bash
# Create directory
mkdir -p /home/ubuntu/mangwale-voice/simple-exotel-caller
cd /home/ubuntu/mangwale-voice/simple-exotel-caller

# Create venv
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn httpx

# Copy main.py (from above)
nano main.py

# Test
python main.py
```

### 2. Test with Curl

```bash
# Test vendor call
curl -X POST http://192.168.0.151:3151/api/call/vendor-order \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_phone": "+919999999999",
    "vendor_name": "Test Vendor",
    "order_id": 12345,
    "order_amount": 350,
    "items": "2 kg Onion, 1 kg Tomato"
  }'
```

### 3. Integrate with Jupiter

In `vendor-notification.service.ts`:
```typescript
async sendVoiceNotification(orderData: any) {
  await this.httpService.post(
    'http://192.168.0.151:3151/api/call/vendor-order',
    {
      vendor_phone: orderData.vendor_phone,
      vendor_name: orderData.vendor_name,
      order_id: orderData.id,
      order_amount: orderData.total_amount,
      items: orderData.items.map(i => i.name).join(', ')
    }
  ).toPromise();
}
```

---

## 🎯 FINAL RECOMMENDATION

**Start with Simple Connect API** (Option 1):
- ✅ 1-2 hours deployment
- ✅ Uses your existing ASR/TTS
- ✅ Gets you to production TODAY
- ✅ Same business outcome

**Upgrade to ExoML later** if needed:
- When vendor feedback says "we want press button not speak"
- When you have more development time
- When you want more professional IVR

---

## ⚡ WHAT DO YOU WANT?

**Option A**: Deploy Simple Connect API now (1-2 hours) ← **RECOMMENDED**  
**Option B**: Build full ExoML IVR (2-3 days)  
**Option C**: Show me both, I'll decide

Tell me which one and I'll deploy it immediately! 🚀
