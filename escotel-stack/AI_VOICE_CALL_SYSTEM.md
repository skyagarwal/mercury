# AI Voice Call System - Human-Free Operations

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              JUPITER (Brain)                                 │
│                           192.168.0.156:3200                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │ Order Service   │  │ Vendor Service   │  │  vLLM (Qwen2.5-7B-AWQ)  │   │
│  │ - New order     │  │ - Store details  │  │  - AI conversation      │   │
│  │ - Confirmation  │  │ - Language pref  │  │  - Intent detection     │   │
│  │ - Status update │  │ - Phone numbers  │  │  :8002                  │   │
│  └────────┬────────┘  └────────┬─────────┘  └─────────────┬────────────┘   │
│           │                    │                          │                 │
│           └────────────────────┴────────────┬─────────────┘                 │
│                                             │                               │
│  ┌──────────────────────────────────────────┴──────────────────────────┐   │
│  │                  VendorNotificationService                          │   │
│  │  - triggerVoiceNotification(orderId, vendorId)                      │   │
│  │  - Calls Mercury: POST /api/voice/outbound-call                     │   │
│  └──────────────────────────────────────────┬──────────────────────────┘   │
└─────────────────────────────────────────────┼───────────────────────────────┘
                                              │
                                              │ HTTP: POST /api/voice/outbound-call
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             MERCURY (Voice)                                  │
│                           192.168.0.151:3100                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    AI Voice Call Service                            │   │
│  │  - initiateAICall()     - Trigger Exotel call                       │   │
│  │  - handleAICallback()   - Process DTMF/Speech                       │   │
│  │  - reportToJupiter()    - Send results back                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│          ┌───────────────────┼───────────────────┐                          │
│          ▼                   ▼                   ▼                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Exotel     │    │     ASR      │    │     TTS      │                  │
│  │ Outbound API │    │   :7001      │    │   :7002      │                  │
│  │ (via public) │    │ Hindi/Marathi│    │ Hindi voice  │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              │ Exotel calls phone
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXOTEL CLOUD                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  1. Mercury calls Exotel API                                        │   │
│  │  2. Exotel calls vendor/rider phone                                 │   │
│  │  3. Exotel sends callback to https://exotel.mangwale.ai             │   │
│  │  4. Mercury handles DTMF (1=accept, 2=reject) & speech              │   │
│  │  5. Mercury reports result to Jupiter                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Mercury (Voice Service) - Port 3100

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voice/outbound-call` | POST | Trigger AI-powered outbound call |
| `/api/voice/ai-callback` | POST | Exotel callback when call connects |
| `/api/voice/ai-callback/:callSid/dtmf` | POST | DTMF input callback |
| `/api/voice/ai-callback/:callSid/speech` | POST | Speech input callback |
| `/api/voice/ai-callback/status` | POST | Call status updates |
| `/api/voice/active-calls` | GET | List active AI calls |
| `/api/voice/call/:callSid` | GET | Get specific call details |
| `/api/voice/call-types` | GET | List available call types |
| `/api/voice/test-call` | POST | Test call for development |

### Call Types Supported

| Type | Purpose | DTMF Actions |
|------|---------|--------------|
| `vendor_order_confirmation` | Confirm new order with vendor | 1=Accept, 2=Reject |
| `vendor_order_ready` | Notify vendor order is ready | - |
| `rider_assignment` | Assign delivery to rider | 1=Accept |
| `rider_pickup_reminder` | Remind rider to pick up | - |
| `customer_support` | Automated support callback | AI conversation |
| `payment_reminder` | Payment reminder calls | - |
| `feedback_request` | Post-delivery feedback | DTMF rating |

## Call Flow: Vendor Order Confirmation

```
1. New order created in Jupiter
   │
2. Jupiter triggers call: POST /api/voice/outbound-call
   │  {
   │    "phone": "+919876543210",
   │    "callType": "vendor_order_confirmation",
   │    "language": "hi",
   │    "data": {
   │      "orderId": "ORD-12345",
   │      "storeName": "Sharma Store",
   │      "itemsCount": 3,
   │      "orderAmount": 450,
   │      "paymentMethod": "COD"
   │    }
   │  }
   │
3. Mercury initiates Exotel call
   │  - CallerId: 02048556923
   │  - Callback: https://exotel.mangwale.ai/api/voice/ai-callback
   │
4. Vendor answers, hears:
   │  "नमस्ते, यह मंगवाले से कॉल है। Sharma Store के लिए एक नया ऑर्डर आया है।
   │   ऑर्डर नंबर ORD-12345, 3 आइटम, कुल 450 रुपये। Cash on Delivery।
   │   स्वीकार करने के लिए 1 दबाएं, अस्वीकार करने के लिए 2 दबाएं।"
   │
5a. Vendor presses 1 (Accept)
    │  → "धन्यवाद! ऑर्डर कितने मिनट में तैयार होगा?
    │     15 मिनट के लिए 1, 30 मिनट के लिए 2, 45 मिनट के लिए 3 दबाएं।"
    │
    │  Vendor presses 2 (30 minutes)
    │  → "धन्यवाद! ऑर्डर 30 मिनट में तैयार होगा। शुभ दिन!"
    │
    │  Mercury reports to Jupiter:
    │  POST /api/orders/vendor-confirmed
    │  { orderId: "ORD-12345", accepted: true, prepTimeMinutes: 30 }

5b. Vendor presses 2 (Reject)
    │  → "कृपया ऑर्डर अस्वीकार करने का कारण बताएं।"
    │  (Records audio, transcribes using ASR)
    │
    │  Mercury reports to Jupiter:
    │  POST /api/orders/vendor-rejected
    │  { orderId: "ORD-12345", accepted: false, rejectionReason: "Item out of stock" }
```

## Languages Supported

- **Hindi (hi)** - Primary, voice: Polly.Aditi
- **English (en)** - Secondary, voice: Polly.Raveena
- **Marathi (mr)** - Regional, voice: Polly.Aditi

## Configuration

### Environment Variables (Mercury)

```bash
# Jupiter Brain
JUPITER_URL=http://192.168.0.156:3200
JUPITER_LLM_URL=http://192.168.0.156:8002

# Mercury Voice
ASR_HTTP_URL=http://192.168.0.151:7001
TTS_URL=http://192.168.0.151:7002

# Exotel
EXOTEL_API_KEY=<key>
EXOTEL_API_TOKEN=<token>
EXOTEL_SID=sarvinsuppliesllp1
EXOTEL_CALLER_ID=02048556923
EXOTEL_CALLBACK_URL=https://exotel.mangwale.ai
```

## Testing

```bash
# Test vendor order confirmation call
curl -X POST http://192.168.0.151:3100/api/voice/test-call \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919923383838",
    "language": "hi"
  }'

# Check active calls
curl http://192.168.0.151:3100/api/voice/active-calls

# Get call types
curl http://192.168.0.151:3100/api/voice/call-types
```

## Files Created

### Mercury (Voice)
- `/escotel-stack/exotel-service/src/services/ai-voice-call.service.js` - Main AI call handler
- `/escotel-stack/exotel-service/src/routes/ai-voice.routes.js` - API routes
- `/escotel-stack/exotel-service/src/services/twiml-generator.service.js` - TwiML generation
- `/escotel-stack/exotel-service/src/services/jupiter-voice.service.js` - Jupiter integration

### Jupiter (Brain) - To be added
- `ai-voice-call-result.controller.ts` - Receives call results
- Endpoints: `/api/voice/call-result`, `/api/orders/vendor-confirmed`, etc.

## Next Steps

1. **Rider Communication System** - Similar flow for rider assignment
2. **Customer Support Callbacks** - AI-powered support calls
3. **Payment Reminders** - Automated payment collection calls
4. **Review System** - Post-delivery feedback calls
5. **Database-driven Scripts** - Move conversation scripts to Jupiter database
