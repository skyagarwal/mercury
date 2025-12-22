# AI Voice Call Architecture - Mangwale

## Overview: Human-Free Voice Automation

This system automates vendor order confirmations and rider assignments via AI voice calls, eliminating the need for human call center agents.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         MANGWALE AI VOICE CALL SYSTEM                         │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐   │
│  │   JUPITER       │    │   MERCURY       │    │      EXOTEL CLOUD       │   │
│  │   (Brain)       │    │   (Voice)       │    │     (Telephony)         │   │
│  │                 │    │                 │    │                         │   │
│  │  192.168.0.156  │    │ 192.168.0.151   │    │  api.exotel.com         │   │
│  │  Public: 103.x  │    │ RTX 3060 12GB   │    │                         │   │
│  │                 │    │                 │    │                         │   │
│  │  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌─────────────────┐    │   │
│  │  │PostgreSQL │  │    │  │Exotel Svc │  │    │  │ IVR Flows       │    │   │
│  │  │  + Prisma │  │    │  │  :3100    │  │    │  │ - VENDOR-ORDER  │    │   │
│  │  └───────────┘  │    │  └─────┬─────┘  │    │  │ - RIDER-ASSIGN  │    │   │
│  │                 │    │        │        │    │  │ - INBOUND-IVR   │    │   │
│  │  ┌───────────┐  │    │  ┌─────┴─────┐  │    │  └─────────────────┘    │   │
│  │  │AI Voice   │◄─┼────┼──┤Passthru   │◄─┼────┼──         ▲             │   │
│  │  │Call Svc   │  │    │  │Callback   │  │    │           │             │   │
│  │  └───────────┘  │    │  └───────────┘  │    │           │             │   │
│  │                 │    │                 │    │  ┌────────┴────────┐    │   │
│  │  ┌───────────┐  │    │  ┌───────────┐  │    │  │ Passthru Applet │    │   │
│  │  │Order      │  │    │  │TTS        │  │    │  │ GET webhook URL │    │   │
│  │  │Service    │  │    │  │(XTTS/     │  │    │  └─────────────────┘    │   │
│  │  │(PHP API)  │  │    │  │ Kokoro)   │  │    │                         │   │
│  │  └───────────┘  │    │  └───────────┘  │    │                         │   │
│  │                 │    │                 │    │                         │   │
│  └─────────────────┘    └─────────────────┘    └─────────────────────────┘   │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Architecture Principles

### Separation of Concerns

| Server | Role | Responsibilities |
|--------|------|------------------|
| **Jupiter** (Brain) | Orchestration & Data | - PostgreSQL database<br>- Order management<br>- Vendor/Rider info<br>- Voice call tracking<br>- API to PHP backend |
| **Mercury** (Voice) | Telephony & Audio | - Exotel API integration<br>- TTS synthesis<br>- ASR transcription<br>- DTMF handling<br>- IVR flow logic |
| **Exotel Cloud** | Carrier | - Phone calls<br>- IVR execution<br>- Recording<br>- Passthru webhooks |

### Data Flow

```
1. ORDER PLACED (PHP Backend)
        │
        ▼
2. JUPITER receives order event
        │
        ▼
3. JUPITER looks up vendor phone from DB
        │
        ▼
4. JUPITER calls MERCURY's AI Voice Call API
   POST /api/ai-voice/vendor-order-confirmation
   { orderId, vendorPhone, vendorName, orderItems, orderAmount }
        │
        ▼
5. MERCURY synthesizes order details via TTS
        │
        ▼
6. MERCURY initiates Exotel call with IVR flow
   - Play order details
   - "Press 1 to accept, 2 to reject"
        │
        ▼
7. EXOTEL calls vendor, plays IVR
        │
        ▼
8. Vendor presses DTMF
        │
        ▼
9. Exotel PASSTHRU → GET to MERCURY
   /api/ai-voice/ai-callback?digits=X&CustomField=JSON
        │
        ▼
10. MERCURY processes DTMF, calls JUPITER
    POST jupiter:3200/api/voice-calls/result
    { callSid, status, digits, prepTime }
        │
        ▼
11. JUPITER updates database
    - VoiceCall record
    - Order status (accepted/rejected)
        │
        ▼
12. JUPITER triggers next action
    - If accepted: Assign rider
    - If rejected: Find alternate vendor
```

## Database Schema (Jupiter - Prisma)

```prisma
// Voice Call Tracking
model VoiceCall {
  id            String   @id @default(uuid())
  
  // Call identification
  exotelCallSid String   @unique
  
  // Call type
  callType      CallType
  
  // Phone numbers
  fromNumber    String   // Exotel caller ID
  toNumber      String   // Vendor/Rider phone
  
  // Associated entities
  orderId       Int?     // From PHP backend
  vendorId      Int?     // From PHP backend
  riderId       Int?     // From PHP backend
  
  // Call content
  orderDetails  Json?    // Cached order items for TTS
  
  // User response
  dtmfDigits    String?  // "1", "0", "25" (prep time)
  status        CallStatus
  prepTimeMinutes Int?   // For accepted orders
  rejectionReason String?
  
  // Timing
  callStartedAt DateTime @default(now())
  callAnsweredAt DateTime?
  callEndedAt   DateTime?
  duration      Int?     // seconds
  
  // Attempts
  attemptNumber Int      @default(1)
  maxAttempts   Int      @default(3)
  
  // Audit
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  @@index([exotelCallSid])
  @@index([orderId])
  @@index([vendorId])
  @@index([callType, status])
}

enum CallType {
  VENDOR_ORDER_CONFIRMATION
  VENDOR_PREP_TIME
  RIDER_ASSIGNMENT
  RIDER_PICKUP_READY
  CUSTOMER_DELIVERY_UPDATE
}

enum CallStatus {
  INITIATED      // Call started
  RINGING        // Phone ringing
  ANSWERED       // Call connected
  ACCEPTED       // User accepted (pressed 1)
  REJECTED       // User rejected (pressed 0)
  PREP_TIME_SET  // Prep time collected
  NO_RESPONSE    // No DTMF input
  FAILED         // Call failed
  BUSY           // Line busy
  CANCELLED      // Cancelled before answer
}
```

## API Contracts

### Mercury → Exotel (Outbound Call)
```typescript
// Connect API
POST https://api.exotel.com/v2/Accounts/{sid}/Calls/connect.json
{
  "From": "02048556923",      // Exotel caller ID
  "To": "+919876543210",      // Vendor phone
  "CallerId": "02048556923",
  "CallType": "trans",
  "Url": "http://my.exotel.com/exoml/start_voice/IVR-FLOW-ID"
}
```

### Mercury → Jupiter (Result Callback)
```typescript
// When vendor responds
POST http://jupiter:3200/api/voice-calls/result
Content-Type: application/json
{
  "callSid": "abc123",
  "callType": "vendor_order_confirmation",
  "status": "accepted",
  "orderId": 12345,
  "vendorId": 67,
  "digits": "1",
  "prepTimeMinutes": null,
  "answeredAt": "2025-01-17T10:30:00Z"
}
```

### Jupiter → Mercury (Initiate Call)
```typescript
// Request vendor confirmation
POST http://mercury:3100/api/ai-voice/vendor-order-confirmation
{
  "orderId": 12345,
  "vendorId": 67,
  "vendorPhone": "+919876543210",
  "vendorName": "Sharma Restaurant",
  "customerName": "Rahul",
  "orderItems": [
    { "name": "Butter Chicken", "quantity": 2, "price": 350 },
    { "name": "Naan", "quantity": 4, "price": 40 }
  ],
  "orderAmount": 860,
  "callbackUrl": "http://jupiter:3200/api/voice-calls/result"
}
```

### Exotel → Mercury (Passthru Callback)
```
GET /api/ai-voice/ai-callback
  ?CallSid=abc123
  &digits=1
  &From=09876543210
  &To=02048556923
  &CurrentTime=2025-01-17T10:30:00
  &CustomField={"callType":"vendor_order_confirmation","orderId":12345}
```

## IVR Flow Designs

### 1. Vendor Order Confirmation Flow

```
┌──────────────────────────────────────────────────────────┐
│           VENDOR-ORDER-CONFIRMATION FLOW                  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  START                                                    │
│    │                                                      │
│    ▼                                                      │
│  ┌─────────────────────────────────────────────┐         │
│  │ Play: "नमस्ते {vendor_name}, यह मंगवाले से है"│         │
│  │        "आपके लिए एक नया ऑर्डर है"            │         │
│  └──────────────────┬──────────────────────────┘         │
│                     │                                     │
│                     ▼                                     │
│  ┌─────────────────────────────────────────────┐         │
│  │ Play: "ऑर्डर में है:"                        │         │
│  │       "{item1} - {qty1}"                     │         │
│  │       "{item2} - {qty2}"                     │         │
│  │       "कुल राशि: {amount} रुपये"             │         │
│  └──────────────────┬──────────────────────────┘         │
│                     │                                     │
│                     ▼                                     │
│  ┌─────────────────────────────────────────────┐         │
│  │ Gather DTMF (1 digit)                        │         │
│  │ Play: "ऑर्डर स्वीकार करने के लिए 1 दबाएं"   │         │
│  │       "रद्द करने के लिए 0 दबाएं"            │         │
│  └──────────────────┬──────────────────────────┘         │
│                     │                                     │
│         ┌───────────┼───────────┐                        │
│         │           │           │                        │
│         ▼           ▼           ▼                        │
│       [1]         [0]       [timeout]                    │
│         │           │           │                        │
│         ▼           ▼           ▼                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐             │
│  │ Passthru │ │ Passthru │ │ Retry (x2)   │             │
│  │ digits=1 │ │ digits=0 │ │ then hangup  │             │
│  │ ACCEPTED │ │ REJECTED │ │ NO_RESPONSE  │             │
│  └──────────┘ └──────────┘ └──────────────┘             │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 2. Prep Time Collection Flow (After Acceptance)

```
┌──────────────────────────────────────────────────────────┐
│              PREP-TIME COLLECTION FLOW                    │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  (After vendor presses 1)                                 │
│    │                                                      │
│    ▼                                                      │
│  ┌─────────────────────────────────────────────┐         │
│  │ Play: "धन्यवाद! ऑर्डर स्वीकार हुआ"         │         │
│  └──────────────────┬──────────────────────────┘         │
│                     │                                     │
│                     ▼                                     │
│  ┌─────────────────────────────────────────────┐         │
│  │ Gather DTMF (2 digits, finishOnKey=#)       │         │
│  │ Play: "खाना तैयार करने में कितने मिनट लगेंगे?"│        │
│  │       "मिनट की संख्या दर्ज करें और # दबाएं"  │         │
│  │       "उदाहरण: 15 मिनट के लिए 1-5-#"       │         │
│  └──────────────────┬──────────────────────────┘         │
│                     │                                     │
│                     ▼                                     │
│         ┌───────────┴───────────┐                        │
│         │                       │                        │
│         ▼                       ▼                        │
│   [digits entered]        [timeout/no input]             │
│         │                       │                        │
│         ▼                       ▼                        │
│  ┌──────────────┐        ┌───────────────┐              │
│  │ Validate     │        │ Default: 30   │              │
│  │ (5-60 mins)  │        │ minutes       │              │
│  └──────┬───────┘        └───────┬───────┘              │
│         │                        │                       │
│         └────────────┬───────────┘                       │
│                      │                                    │
│                      ▼                                    │
│  ┌─────────────────────────────────────────────┐         │
│  │ Passthru: digits=25, status=prep_time_set  │         │
│  │ Play: "धन्यवाद! राइडर {prepTime} मिनट में   │         │
│  │       पहुंचेगा"                              │         │
│  └─────────────────────────────────────────────┘         │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 3. Rejection Flow

```
┌──────────────────────────────────────────────────────────┐
│                  REJECTION FLOW                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  (After vendor presses 0)                                 │
│    │                                                      │
│    ▼                                                      │
│  ┌─────────────────────────────────────────────┐         │
│  │ Gather DTMF (1 digit)                        │         │
│  │ Play: "कृपया रद्द करने का कारण बताएं:"      │         │
│  │       "1 - आइटम उपलब्ध नहीं है"             │         │
│  │       "2 - बहुत व्यस्त हैं"                  │         │
│  │       "3 - दुकान बंद है"                     │         │
│  │       "4 - अन्य कारण"                        │         │
│  └──────────────────┬──────────────────────────┘         │
│                     │                                     │
│         ┌───────────┴───────────┬───────────┐            │
│         ▼           ▼           ▼           ▼            │
│       [1]         [2]         [3]         [4]            │
│         │           │           │           │            │
│         ▼           ▼           ▼           ▼            │
│  ┌──────────────────────────────────────────────┐        │
│  │ Passthru: status=rejected                    │        │
│  │           rejectionReason={1|2|3|4}          │        │
│  │ Play: "धन्यवाद, हम किसी और को यह ऑर्डर देंगे" │        │
│  └──────────────────────────────────────────────┘        │
│                                                           │
│  Jupiter Action: Find next available vendor               │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## Industry Best Practices

### 1. Call Attempt Management
```typescript
const CALL_CONFIG = {
  maxAttempts: 3,              // Max retry attempts
  attemptInterval: 30000,       // 30 seconds between attempts
  busyRetryDelay: 60000,        // 1 min if line busy
  noAnswerTimeout: 25000,       // Ring for 25 seconds
  totalTimeLimit: 5 * 60 * 1000 // 5 min total window
};
```

### 2. DTMF Timeout Handling
```typescript
const DTMF_CONFIG = {
  mainMenu: {
    timeout: 10,        // seconds to wait for input
    numDigits: 1,       // expected digits
    retries: 2          // retry prompt twice before giving up
  },
  prepTime: {
    timeout: 15,
    finishOnKey: '#',   // user presses # to submit
    maxDigits: 2,       // max 99 minutes
    defaultValue: 30    // default if no input
  }
};
```

### 3. Recording & Analytics
- **All calls recorded** for quality assurance
- **CQA analysis** post-call for sentiment and compliance
- **Metrics tracked**: Answer rate, acceptance rate, avg prep time

### 4. Fallback Handling
```typescript
const handleCallFailure = async (orderId: number, failureReason: string) => {
  // 1. Log failure
  await logCallFailure(orderId, failureReason);
  
  // 2. Try WhatsApp notification as fallback
  await sendWhatsAppNotification(orderId);
  
  // 3. If critical, escalate to human agent
  if (isUrgentOrder(orderId)) {
    await escalateToHuman(orderId);
  }
  
  // 4. Auto-assign to another vendor if rejection
  if (failureReason === 'rejected') {
    await findAlternateVendor(orderId);
  }
};
```

## Implementation Files

### Mercury (Voice Server)
- `/escotel-stack/exotel-service/src/services/ai-voice-call.service.js` - Core voice call logic
- `/escotel-stack/exotel-service/src/routes/ai-voice.routes.js` - API endpoints
- `/escotel-stack/exotel-service/src/services/twiml-generator.service.js` - TwiML generation

### Jupiter (Brain Server)
- `/Devs/MangwaleAI/backend/src/voice-calls/` - New module (to create)
  - `voice-calls.module.ts`
  - `controllers/voice-calls.controller.ts`
  - `services/voice-calls.service.ts`
  - `dto/voice-call.dto.ts`
- `/Devs/MangwaleAI/backend/prisma/schema.prisma` - Add VoiceCall model

## Security Considerations

1. **Webhook Authentication**: Validate Exotel's signature on callbacks
2. **Rate Limiting**: Prevent abuse on callback endpoints
3. **Phone Number Validation**: Sanitize all phone inputs
4. **Sensitive Data**: Don't log full order details in production
5. **Timeout Protection**: Set max call durations

## Future Enhancements

1. **Multilingual Support**: Hindi, Marathi, English
2. **Voice Recognition**: Accept spoken responses instead of DTMF
3. **Smart Scheduling**: Learn vendor peak hours
4. **Predictive Prep Time**: ML model for estimated prep time
5. **Two-way Conversation**: Full AI voice chat for order modifications
