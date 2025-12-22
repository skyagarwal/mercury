# Exotel Voice Call Flows - Implementation Options

## 🎯 Business Use Cases

Based on your requirements and existing infrastructure analysis:

### 1. **Vendor Order Confirmation** ⭐ Priority
- **Trigger**: New order placed by customer
- **Action**: Auto-call vendor to confirm/cancel order
- **Input Required**: Processing time (15/20/30 minutes)
- **Integration**: PHP orchestrator in Jupiter `/home/ubuntu/Devs/MangwaleAI`

### 2. **Rider Delivery Assignment** ⭐ Priority
- **Trigger**: Order ready for pickup
- **Action**: Auto-call rider with pickup/delivery instructions
- **Input Required**: Accept/Reject delivery
- **Integration**: Existing rider assignment system

### 3. **Customer Order Status** (Future)
- **Trigger**: Customer calls Exotel number
- **Action**: IVR to check order status
- **Input Required**: Order ID (DTMF)

---

## 📊 Implementation Approaches

### **Option A: Simple Connect API (Fastest - Recommended for MVP)** ⚡

**Best for**: Quick deployment, basic voice calls with recordings
**Complexity**: ⭐ Low
**Timeline**: 1-2 days

#### How It Works:
1. Jupiter triggers Exotel Call Connect API
2. Exotel calls vendor/rider
3. Plays pre-recorded/TTS message
4. Records full conversation
5. Webhook sends recording + call status to your server
6. Your system transcribes with ASR and updates database

#### Pros:
- ✅ Simplest to implement
- ✅ No ExoML flow required
- ✅ Your existing ASR/NLU handles understanding
- ✅ Works with current Label Studio setup
- ✅ Flexible - can change logic without Exotel

#### Cons:
- ❌ No DTMF input during call
- ❌ Must process recordings async
- ❌ No real-time decision making

**Use Case Fit**:
- ✅ Vendor notifications (just info)
- ⚠️ Rider assignments (if OK to process after call)
- ❌ Real-time confirmations

---

### **Option B: ExoML IVR Flows (Full Featured)** 🚀

**Best for**: Interactive DTMF menus, instant feedback
**Complexity**: ⭐⭐⭐ Medium
**Timeline**: 3-5 days

#### How It Works:
1. Jupiter triggers call with Exotel Passthru API
2. Exotel requests ExoML flow from your endpoint
3. Your server returns ExoML (XML) with:
   - Say/Play: Audio messages
   - Gather: Collect DTMF input
   - Dial: Connect calls
   - Record: Record conversation
4. Exotel executes flow and sends user inputs back
5. Your server responds with next ExoML step
6. Loop continues until call ends

#### ExoML Example - Vendor Confirmation:
```xml
<Response>
  <Say>
    नमस्ते, आपको नया ऑर्डर मिला है। Order ID 12345. Amount 350 rupees.
  </Say>
  <Gather action="https://your-server.com/exoml/vendor-confirm" 
          timeout="10" numDigits="1" finishOnKey="#">
    <Say>
      ऑर्डर accept करने के लिए 1 दबाएं।
      Cancel करने के लिए 2 दबाएं।
      Processing time बताने के लिए 3 दबाएं।
    </Say>
  </Gather>
  <Say>कोई input नहीं मिला। कॉल disconnect हो रही है।</Say>
</Response>
```

#### Pros:
- ✅ Real-time DTMF collection
- ✅ Instant decisions (accept/reject)
- ✅ Multi-step flows (confirm → enter time)
- ✅ Professional IVR experience
- ✅ Recording + transcription

#### Cons:
- ❌ More complex to build
- ❌ Need ExoML endpoint infrastructure
- ❌ Flow logic in code (not UI)

**Use Case Fit**:
- ✅✅ Vendor order confirmation (perfect)
- ✅✅ Rider delivery assignment (ideal)
- ✅✅ Any interactive menu

---

### **Option C: Hybrid Approach (Recommended)** 💡

**Best for**: Balance of simplicity and features
**Complexity**: ⭐⭐ Low-Medium
**Timeline**: 2-3 days

#### Strategy:
1. **Use Connect API** for simple notifications (no input needed)
2. **Use ExoML** for interactive confirmations (DTMF required)
3. **Use existing ASR/Label Studio** for complex conversations

#### Implementation:
```python
# Vendor Order Confirmation - ExoML (needs DTMF)
POST /api/exotel/call/vendor-confirm
→ Uses ExoML flow with Gather

# Rider Delivery Alert - Connect API (simple notification)
POST /api/exotel/call/rider-notify
→ Plays TTS message + records

# Complex Queries - ASR Processing
POST /webhook/exotel/recording
→ Existing Label Studio pipeline
```

---

## 🏗️ Recommended Architecture

### **Phase 1: MVP (Week 1)** - Option C Hybrid

```
Jupiter Backend
    ↓
    ├─→ Vendor Order: ExoML IVR
    │   ├─ Exotel Passthru API
    │   ├─ Your ExoML Endpoint (Mercury)
    │   ├─ DTMF: 1=Accept, 2=Cancel, 3=SetTime
    │   └─ Webhook → Update Order Status
    │
    └─→ Rider Alert: Connect API
        ├─ Play TTS: "Pickup from X, deliver to Y"
        ├─ Record conversation
        └─ Webhook → Label Studio (if needed)
```

### Files to Create:

#### 1. `/home/ubuntu/mangwale-voice/exotel-ivr/vendor_flow.py`
```python
from fastapi import FastAPI, Form, Request
from fastapi.responses import Response
import httpx

app = FastAPI()

@app.post("/exoml/vendor-order-confirm")
async def vendor_confirm_ivr(
    CallSid: str = Form(...),
    Digits: str = Form(None),
    CustomField: str = Form(None)
):
    """ExoML endpoint for vendor order confirmation"""
    
    # Parse custom field (order_id, vendor_id, etc.)
    import json
    data = json.loads(CustomField)
    order_id = data['order_id']
    
    # First call (no digits yet)
    if not Digits:
        exoml = f"""
        <Response>
          <Say language="hi-IN">
            नमस्ते, आपको नया ऑर्डर मिला है। Order ID {order_id}
          </Say>
          <Gather action="https://mercury.your-domain.com/exoml/vendor-action" 
                  timeout="10" numDigits="1">
            <Say language="hi-IN">
              Accept के लिए 1, Cancel के लिए 2, 
              Processing time के लिए 3 दबाएं।
            </Say>
          </Gather>
          <Say language="hi-IN">कोई input नहीं मिला।</Say>
        </Response>
        """
        return Response(content=exoml, media_type="application/xml")
    
    # Handle DTMF input
    if Digits == "1":
        # Accept order - call Jupiter API
        await update_order_status(order_id, "confirmed")
        exoml = """
        <Response>
          <Say language="hi-IN">
            Order confirm हो गया। धन्यवाद!
          </Say>
          <Record/>
        </Response>
        """
    elif Digits == "2":
        # Cancel order
        await update_order_status(order_id, "cancelled")
        exoml = """
        <Response>
          <Say language="hi-IN">Order cancel हो गया।</Say>
        </Response>
        """
    elif Digits == "3":
        # Ask for processing time
        exoml = """
        <Response>
          <Gather action="https://mercury.your-domain.com/exoml/vendor-time"
                  timeout="10" numDigits="1">
            <Say language="hi-IN">
              15 minute के लिए 1, 20 minute के लिए 2, 
              30 minute के लिए 3 दबाएं।
            </Say>
          </Gather>
        </Response>
        """
    else:
        exoml = """
        <Response>
          <Say language="hi-IN">गलत option।</Say>
        </Response>
        """
    
    return Response(content=exoml, media_type="application/xml")

async def update_order_status(order_id, status):
    """Call Jupiter backend to update order"""
    async with httpx.AsyncClient() as client:
        await client.post(
            "http://192.168.0.156:3000/api/orders/update-status",
            json={"order_id": order_id, "status": status}
        )
```

#### 2. `/home/ubuntu/mangwale-voice/exotel-ivr/rider_connect.py`
```python
import httpx
from pydantic import BaseModel

class RiderCall(BaseModel):
    rider_phone: str
    pickup_address: str
    delivery_address: str
    order_id: int

async def call_rider_simple(rider_data: RiderCall):
    """Use Connect API for simple rider notification"""
    
    # Generate TTS message
    message = f"""
    नमस्ते, आपको नया delivery मिला है। 
    Order ID {rider_data.order_id}
    Pickup: {rider_data.pickup_address}
    Delivery: {rider_data.delivery_address}
    Accept करने के लिए back call करें।
    """
    
    # Upload TTS audio to your server
    audio_url = await generate_and_upload_tts(message)
    
    # Call Exotel Connect API
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://{EXOTEL_API_KEY}:{EXOTEL_API_TOKEN}@{EXOTEL_SUBDOMAIN}/v1/Accounts/{EXOTEL_SID}/Calls/connect",
            data={
                "From": rider_data.rider_phone,
                "To": rider_data.rider_phone,  # Connect to self
                "CallerId": EXOTEL_VIRTUAL_NUMBER,
                "CallType": "trans",
                "WaitUrl": audio_url,
                "Record": "true",
                "StatusCallback": "https://mercury.your-domain.com/webhook/exotel/status",
                "CustomField": f'{{"order_id": {rider_data.order_id}, "type": "rider"}}'
            }
        )
    
    return response.json()
```

---

## 🔧 Integration with Jupiter

### Add to `/home/ubuntu/Devs/MangwaleAI/backend/src/php-integration/services/vendor-notification.service.ts`

```typescript
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';

@Injectable()
export class VendorNotificationService {
  constructor(private httpService: HttpService) {}

  async sendVoiceOrderConfirmation(orderData: any) {
    try {
      // Call Mercury Exotel service
      const response = await this.httpService.post(
        'http://192.168.0.151:3150/api/exotel/call/vendor-confirm',
        {
          vendor_phone: orderData.vendor_phone,
          vendor_name: orderData.vendor_name,
          order_id: orderData.id,
          order_amount: orderData.total_amount,
          order_items: orderData.items,
          language: orderData.language || 'hi-IN'
        }
      ).toPromise();

      console.log('✅ Voice call initiated:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Voice call failed:', error);
      // Fallback to SMS
      await this.sendSmsNotification(orderData);
    }
  }

  async sendRiderDeliveryAlert(deliveryData: any) {
    try {
      const response = await this.httpService.post(
        'http://192.168.0.151:3150/api/exotel/call/rider-notify',
        {
          rider_phone: deliveryData.rider_phone,
          order_id: deliveryData.order_id,
          pickup_address: deliveryData.pickup_address,
          delivery_address: deliveryData.delivery_address,
          language: 'hi-IN'
        }
      ).toPromise();

      console.log('✅ Rider alert sent:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Rider alert failed:', error);
    }
  }
}
```

---

## 📋 Implementation Checklist

### Phase 1: MVP Setup (2-3 days)

- [ ] **Day 1: ExoML Server Setup**
  - [ ] Create FastAPI app for ExoML endpoints
  - [ ] Deploy on Mercury (port 3151)
  - [ ] Setup systemd service
  - [ ] Configure Exotel Passthru webhook URL

- [ ] **Day 2: Vendor Flow**
  - [ ] Implement vendor order confirmation ExoML
  - [ ] Add DTMF handlers (Accept/Cancel/Time)
  - [ ] Integrate with Jupiter order update API
  - [ ] Test with real vendor phone numbers

- [ ] **Day 3: Rider Flow + Testing**
  - [ ] Implement rider delivery alert (Connect API)
  - [ ] Setup TTS generation pipeline
  - [ ] End-to-end testing
  - [ ] Monitor logs and recordings

### Phase 2: Enhancement (Week 2)

- [ ] **Hindi TTS Integration**
  - [ ] Use your Indic Parler TTS
  - [ ] Pre-generate common phrases
  - [ ] Cache audio files in MinIO

- [ ] **Recording Analysis**
  - [ ] Send recordings to Label Studio
  - [ ] Transcribe with ASR
  - [ ] Extract insights (acceptance rate, issues)

- [ ] **Multi-language Support**
  - [ ] Detect vendor/rider preferred language
  - [ ] Dynamic TTS generation
  - [ ] Language-specific prompts

---

## 🎯 Final Recommendation

### **Start with Option C (Hybrid)**:

1. **Vendor Order Confirmation**: Use **ExoML IVR**
   - Needs DTMF for instant accept/cancel
   - Critical for business (order SLA)
   - Justifies the ExoML complexity

2. **Rider Delivery Alert**: Use **Connect API**
   - Simple notification
   - Record conversation for compliance
   - Process with ASR if rider has questions

3. **Future Use Cases**: Build on ExoML infrastructure
   - Customer order status IVR
   - Vendor reminders
   - Address confirmation calls

### Next Steps:

1. **Review Exotel Developer Docs**:
   - Passthru API: https://developer.exotel.com/api/passthru
   - ExoML Reference: https://developer.exotel.com/api/exoml
   - Connect API: https://developer.exotel.com/api/call-connect

2. **Create ExoML Server** (I can help build this)

3. **Test with One Vendor** (pilot)

4. **Scale to All Vendors**

---

**Want me to build the complete ExoML server and Jupiter integration now?** 🚀
