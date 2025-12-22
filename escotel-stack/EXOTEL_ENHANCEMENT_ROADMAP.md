# Exotel Enhancement Roadmap for Mangwale Voice Commerce

**Version:** 1.0  
**Date:** July 2025  
**Status:** Research Complete → Phase 1 Implemented ✅

---

## Executive Summary

Based on comprehensive research of Exotel's global product offerings and how companies like **Swiggy, Urban Company, Meesho, Magicpin, and Truecaller** are using Exotel, this document outlines enhancements for Mangwale's voice-first commerce platform.

**Key Principle:** Mangwale's AI stays internal (our own ASR, TTS, Voice Agent on Mercury). We use Exotel ONLY for telephony infrastructure, while building intelligence on top.

---

## Current State (Exotel Service v2.2.0) ✅

### What We Have Now
| Feature | Status | File |
|---------|--------|------|
| Smart IVR | ✅ | `ivr.js` |
| DTMF Handler | ✅ | `ivr.js` |
| Voice Ordering Flow | ✅ | `ivr.js` |
| Vendor Notifications | ✅ | `ivr.js` |
| Rider Assignment | ✅ | `ivr.js` |
| Communications Orchestrator | ✅ | `comms.js` |
| Marketing Campaigns | ✅ | `campaigns.js` |
| Jupiter Integration | ✅ | `jupiter.service.js` |
| Webhooks | ✅ | `webhooks.js` |
| **Number Masking (NEW)** | ✅ | `masking.js`, `number-masking.service.js` |
| **Click-to-Call (NEW)** | ✅ | `click-to-call.js` |

### ❌ Missing High-Impact Features (Still to Implement)
1. ~~**Number Masking (ExoBridge)**~~ ✅ **DONE**
2. ~~**Click-to-Call**~~ ✅ **DONE**
3. **Voice Streaming** - Real-time AI integration
4. **Conversation Quality Analysis** - Call analytics
5. **Auto Dialer Enhancement** - Predictive/PACE dialer
6. **Verified Calls** - Truecaller integration
7. **Call Recording + Analysis** - Quality monitoring
8. **SMS OTP / ExoVerify** - Authentication
9. **WhatsApp Integration** - Multi-channel

---

## Phase 1: Number Masking (ExoBridge) - CRITICAL for Hyperlocal

### Why It Matters
- **Swiggy uses this** - Customers and riders communicate without knowing each other's numbers
- **Privacy protection** - Prevents off-platform transactions
- **Trust building** - Customers feel secure

### How It Works
```
Customer calls masked number → Exotel → Routes to Rider
Neither party sees the other's actual phone number
```

### Implementation Plan

**Create: `src/services/number-masking.service.js`**
```javascript
/**
 * Number Masking Service for Mangwale
 * 
 * Use Cases:
 * 1. Customer ↔ Rider communication
 * 2. Customer ↔ Vendor communication
 * 3. Rider ↔ Vendor coordination
 */

export async function createMaskedSession(orderID, customerPhone, riderPhone) {
  // Uses Exotel LeadAssist API to create masked pair
  // Returns virtual number that bridges both parties
}

export async function endMaskedSession(orderID) {
  // Terminates masking once order delivered
}
```

**Create: `src/src_routes/masking.js`**
```javascript
// POST /masking/create - Create masked session for order
// POST /masking/callback - Handle Exotel callbacks
// POST /masking/end - End session on delivery
```

### API Endpoints Needed
| Endpoint | Purpose |
|----------|---------|
| `POST /masking/create` | Create masked pair for order |
| `POST /masking/bridge` | Handle incoming masked calls |
| `POST /masking/end` | End masking on delivery |
| `GET /masking/status/:orderId` | Get masking status |

### Integration Points
- **Jupiter Webhook**: `order/rider-assigned` → Create masked session
- **Jupiter Webhook**: `order/delivered` → End masked session
- **Voice Agent**: Pass masked number for rider calls

---

## Phase 2: Voice Streaming (AgentStream) - AI Enhancement

### Why It Matters
- **Real-time AI** - Our ASR/TTS can process live audio
- **Live transcription** - Build call intelligence
- **Supervisor tools** - Whisper/barge-in capabilities

### How Exotel Voice Streaming Works
```
Call → Exotel → Real-time audio stream → Your AI System
         ↓
    Voice Streaming API sends live packets
         ↓
    Our ASR (Mercury:7000) transcribes
         ↓
    Our Voice Agent (Mercury:8090) responds
         ↓
    Our TTS (Mercury:8010) speaks back
```

### Implementation Plan

**Create: `src/services/voice-streaming.service.js`**
```javascript
/**
 * Voice Streaming Integration
 * Connects Exotel's audio stream to our AI stack
 */

import WebSocket from 'ws';

const ASR_URL = 'ws://192.168.0.151:7000/ws/transcribe';
const TTS_URL = 'http://192.168.0.151:8010/synthesize';
const AGENT_URL = 'ws://192.168.0.151:8090/ws/conversation';

export class VoiceStreamHandler {
  constructor(callSid) {
    this.callSid = callSid;
    this.asrSocket = null;
    this.agentSocket = null;
  }
  
  async connect(exotelStreamUrl) {
    // Connect to Exotel's stream
    // Pipe to our ASR
    // Process with Voice Agent
    // Respond with TTS
  }
}
```

### Benefits for Mangwale
- **Real-time ordering** - Live transcription while customer speaks
- **Multilingual** - Hindi/English/Marathi seamlessly
- **Context awareness** - Agent knows customer history mid-call

---

## Phase 3: Click-to-Call Integration

### Why It Matters
- **Swiggy/Urban Company** use this for in-app calling
- **User experience** - One tap to call from app
- **Tracking** - Know which call came from where

### Implementation Plan

**Create: `src/src_routes/click-to-call.js`**
```javascript
/**
 * Click-to-Call from Mangwale App
 * 
 * Customer taps "Call Vendor" → Backend initiates call → Connects both
 */

// POST /click-to-call/vendor
// Customer → Vendor (with masking)

// POST /click-to-call/rider
// Customer → Rider (with masking)

// POST /click-to-call/support
// Any user → Support team
```

### API Spec
```javascript
POST /click-to-call/vendor
{
  "customerId": "CUST123",
  "vendorId": "VEND456",
  "orderId": "ORD789",
  "context": "order_query"
}

Response:
{
  "callSid": "exotel_call_123",
  "maskedNumber": "+91-XXXX",
  "estimatedWait": "10s"
}
```

---

## Phase 4: Auto Dialer for Campaigns

### Why It Matters
- **40% efficiency gain** - Predictive dialing
- **Best time calling** - AI determines optimal call time
- **AMD** - Answer Machine Detection

### Campaign Types for Mangwale

| Campaign | Trigger | Target |
|----------|---------|--------|
| Order Confirmation | New order | Customer |
| Rider Reminder | 5min before pickup | Rider |
| Vendor Promotion | Daily/Weekly | Vendors |
| Re-engagement | Inactive 7 days | Customers |
| Feedback | Post-delivery | Customer |

### Implementation Plan

**Enhance: `src/src_routes/campaigns.js`**
```javascript
// Add Auto Dialer capabilities:

// POST /campaigns/auto-dialer/create
{
  "name": "Order Followup",
  "type": "progressive", // or "predictive", "preview"
  "leads": ["phone1", "phone2"],
  "callScript": "order_feedback",
  "schedule": {
    "timezone": "Asia/Kolkata",
    "windows": [
      { "start": "09:00", "end": "12:00" },
      { "start": "16:00", "end": "20:00" }
    ]
  },
  "pacing": {
    "callsPerAgent": 1,
    "retryAttempts": 3,
    "retryInterval": "30m"
  }
}

// GET /campaigns/auto-dialer/:id/status
// Real-time campaign metrics
```

---

## Phase 5: Verified Calls (Truecaller Integration)

### Why It Matters
- **40-60% higher pickup** rate with verified calls
- **Brand trust** - Customer sees "Mangwale" instead of unknown number
- **Spam prevention** - Truecaller verified badge

### Implementation Plan

**Create: `src/services/verified-calls.service.js`**
```javascript
/**
 * Verified Business Caller ID
 * Integrates with Truecaller via Exotel
 */

export async function makeVerifiedCall(to, callerId, callReason) {
  // Use Exotel's Truecaller integration
  // Shows branded caller ID on customer's phone
}

// Call reasons for Mangwale:
const CALL_REASONS = {
  ORDER_UPDATE: "Order Update from Mangwale",
  DELIVERY_ARRIVING: "Your Delivery is Arriving",
  PAYMENT_REMINDER: "Payment Reminder",
  FEEDBACK_REQUEST: "Share Your Experience"
};
```

---

## Phase 6: Conversation Quality Analysis (CQA)

### Why It Matters
- **100% call coverage** vs manual 10%
- **Multilingual analysis** - Hindi/English/Marathi
- **Compliance monitoring** - Ensure SOP adherence

### What We Analyze

| Metric | Why |
|--------|-----|
| Call Duration | Efficiency tracking |
| Sentiment | Customer satisfaction |
| Issue Resolution | First-call resolution rate |
| Agent Performance | Training insights |
| Compliance | Script adherence |

### Implementation Plan

**Create: `src/services/cqa.service.js`**
```javascript
/**
 * Conversation Quality Analysis
 * Uses our own AI for analysis (not Exotel's AI)
 */

export async function analyzeCall(callSid, recordingUrl) {
  // 1. Fetch recording from Exotel
  // 2. Transcribe with our ASR
  // 3. Analyze with our AI
  // 4. Store metrics in Jupiter
  
  return {
    sentiment: 'positive', // positive/neutral/negative
    issueResolved: true,
    complianceScore: 0.95,
    keyPhrases: ['order status', 'delivery time'],
    agentScore: 4.2,
    suggestions: ['Reduce hold time']
  };
}
```

### Dashboard Metrics
- Real-time sentiment heatmap
- Agent performance leaderboard
- Compliance alerts
- Issue categorization

---

## Phase 7: SMS + WhatsApp Integration

### Why It Matters
- **Multi-channel fallback** - If call fails, SMS/WhatsApp
- **Rich updates** - Order tracking links
- **OTP verification** - Secure authentication

### Channels for Mangwale

| Channel | Use Case |
|---------|----------|
| Voice | Primary ordering, support |
| SMS | OTP, short updates |
| WhatsApp | Rich updates, tracking, receipts |

### Implementation Plan

**Create: `src/src_routes/messaging.js`**
```javascript
/**
 * Multi-channel messaging
 */

// POST /messaging/sms
{
  "to": "+91XXXXXXXXXX",
  "template": "order_confirmation",
  "params": {
    "orderId": "ORD123",
    "amount": "₹325",
    "eta": "30 min"
  }
}

// POST /messaging/whatsapp
{
  "to": "+91XXXXXXXXXX",
  "template": "order_tracking",
  "params": {
    "orderId": "ORD123",
    "trackingUrl": "https://mangwale.com/track/ORD123"
  }
}

// POST /messaging/otp
{
  "to": "+91XXXXXXXXXX",
  "purpose": "login" // or "payment", "delivery_confirm"
}
```

---

## Phase 8: Call Recording + Voice Logger

### Why It Matters
- **Training** - Learn from successful calls
- **Disputes** - Evidence for resolution
- **Compliance** - Regulatory requirements

### Implementation Plan

**Create: `src/services/call-recording.service.js`**
```javascript
/**
 * Call Recording Management
 */

export async function enableRecording(callSid) {
  // Start recording via Exotel API
}

export async function fetchRecording(callSid) {
  // Get recording URL
  // Store in our system for analysis
}

export async function searchRecordings(filters) {
  // Search by date, phone, order, sentiment
}
```

### Storage Strategy
- Store recordings in local storage (Mercury)
- Link to Jupiter orders for searchability
- Auto-delete after retention period (90 days)

---

## Priority Matrix

| Phase | Feature | Impact | Effort | Priority |
|-------|---------|--------|--------|----------|
| 1 | Number Masking | 🔥🔥🔥 | Medium | **P0 - CRITICAL** |
| 2 | Voice Streaming | 🔥🔥🔥 | High | **P1** |
| 3 | Click-to-Call | 🔥🔥 | Low | **P1** |
| 4 | Auto Dialer | 🔥🔥 | Medium | **P2** |
| 5 | Verified Calls | 🔥🔥 | Low | **P2** |
| 6 | CQA | 🔥🔥 | High | **P3** |
| 7 | SMS/WhatsApp | 🔥🔥 | Medium | **P2** |
| 8 | Voice Logger | 🔥 | Low | **P3** |

---

## Industry Benchmarks (How Others Use Exotel)

### Swiggy (Food Delivery)
- ✅ Number masking for all customer-rider calls
- ✅ Automated IVR for order status
- ✅ Voice blaster for promotions
- ✅ Real-time call tracking

### Urban Company (Services)
- ✅ Click-to-call from app
- ✅ Masked calls between customer-professional
- ✅ Feedback collection via IVR

### Meesho (E-commerce)
- ✅ Seller onboarding calls
- ✅ Order confirmation automation
- ✅ WhatsApp integration

### Magicpin (Hyperlocal)
- ✅ Merchant verification calls
- ✅ Deal promotion campaigns

### Indeed (Recruitment)
- ✅ LeadAssist for interview scheduling
- ✅ Privacy-protected employer-candidate calls

---

## Technical Requirements

### Exotel Account Needs
```
Required APIs/Features:
├── Voice API (have)
├── IVR/Applets (have)
├── LeadAssist API (need for masking)
├── AgentStream (need for voice streaming)
├── Call Recording (basic)
├── SMS API (need)
├── WhatsApp Business API (need)
└── Truecaller Integration (optional)
```

### Mercury Infrastructure
```
Current:
├── ASR (port 7000) ✅
├── TTS (port 8010) ✅
├── Voice Gateway (port 7100) ✅
├── Voice Agent (port 8090) ✅
└── Exotel Service (port 3100) ✅

Need to add:
├── WebSocket handler for AgentStream
├── Recording storage
└── CQA processing pipeline
```

---

## Implementation Timeline

### Week 1-2: Number Masking (P0)
- [ ] Create masking service
- [ ] Add masking routes
- [ ] Integrate with Jupiter webhooks
- [ ] Test customer-rider masking

### Week 3-4: Click-to-Call + Verified Calls (P1/P2)
- [ ] Create click-to-call routes
- [ ] Integrate with app
- [ ] Setup Truecaller verification
- [ ] Test from Mangwale app

### Week 5-6: Auto Dialer Enhancement (P2)
- [ ] Upgrade campaign system
- [ ] Add PACE dialer
- [ ] Implement AMD
- [ ] Test campaigns

### Week 7-8: Voice Streaming (P1)
- [ ] Setup AgentStream integration
- [ ] Connect to our ASR
- [ ] Implement real-time flow
- [ ] Test end-to-end

### Week 9-10: SMS/WhatsApp + CQA (P2/P3)
- [ ] Add SMS integration
- [ ] Setup WhatsApp templates
- [ ] Build CQA pipeline
- [ ] Dashboard integration

---

## Cost Considerations

| Feature | Exotel Pricing Model |
|---------|---------------------|
| Voice Calls | Per minute |
| Number Masking | Per masked session |
| SMS | Per message |
| WhatsApp | Per template message |
| Call Recording | Storage-based |
| Truecaller | Per verified call |

### Optimization Tips
1. Use masking pools efficiently
2. Batch SMS sends
3. Cache recordings locally
4. Use progressive dialer (not predictive) for low volume

---

## Next Steps

1. **Review with Exotel account manager** - Confirm API access
2. **Prioritize Phase 1 (Number Masking)** - Start implementation
3. **Setup Truecaller** - Apply for verified business ID
4. **Test in staging** - Before production rollout

---

## Contact Points

- **Exotel Support**: https://support.exotel.com
- **Developer Portal**: https://developer.exotel.com
- **API Docs**: https://developer.exotel.com/api
- **Exotel MCP**: https://github.com/exotel/ExotelMCP (for future agentic AI integration)

---

*Document maintained by Mangwale Voice Team*
*Last updated: July 2025*
