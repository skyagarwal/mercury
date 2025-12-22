# Mangwale Exotel Integration - Voice-First Commerce Platform

## 🎯 Vision: "Call → Speak → Order → Delivered"

Exotel transforms Mangwale from an app-based platform to a **voice-first super app** where:
- Customers order by **phone call** (no app needed)
- Vendors get **IVR alerts** (no training required)
- Riders receive **voice assignments** (works without internet)
- All parties connect via **masked calls** (privacy protected)

---

## 📞 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CUSTOMER                                        │
│     📱 Missed Call → Callback │ 📞 Voice Order │ 🔔 Status Updates          │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXOTEL CLOUD                                       │
│   Virtual Numbers │ IVR Flows │ Call Recording │ SMS │ Call Bridge          │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ Webhooks
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MERCURY (192.168.0.151)                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ Exotel Service  │  │  Voice Agent    │  │     ASR/TTS Stack           │  │
│  │     :3100       │◄►│     :8090       │◄►│  Whisper:7000 │ XTTS:8010   │  │
│  │ - IVR Flows     │  │ - AI Processing │  │                             │  │
│  │ - Comms Orch    │  │ - Turn-taking   │  └─────────────────────────────┘  │
│  │ - Campaigns     │  │ - Jupiter Link  │                                    │
│  └─────────────────┘  └────────┬────────┘                                    │
└────────────────────────────────┼────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     JUPITER (192.168.0.156)                                  │
│    Backend :3200 │ vLLM :8002 │ NLU :7010 │ Order Service │ Vendor DB       │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┴────────────────────────┐
        ▼                                                  ▼
┌───────────────────────┐                      ┌───────────────────────┐
│       VENDOR          │                      │        RIDER          │
│  📞 IVR: Accept/Reject│                      │  📞 IVR: Accept/Reject│
│  📱 WhatsApp Buttons  │                      │  📱 WhatsApp + Map    │
│  🔔 Ring Reminders    │                      │  📍 Address Updates   │
└───────────────────────┘                      └───────────────────────┘
```

---

## 🔥 Use Cases

### 1. Voice Ordering (Customer)

**Flow:**
```
Customer calls Mangwale → IVR Welcome → Speaks order → AI processes →
Confirms items & price → Payment selection → Order created → Vendor notified
```

**API:**
```bash
# Incoming call webhook (from Exotel)
POST /exotel/ivr/incoming
{
  "CallSid": "EXO-123",
  "From": "+919876543210",
  "To": "+919999999999"
}

# Voice processing (internal)
POST /exotel/ivr/voice/process
{
  "call_sid": "EXO-123",
  "from_phone": "+919876543210",
  "recording_url": "https://...",
  "context": "customer_order"
}
```

### 2. Missed Call → Callback

**Flow:**
```
Customer missed-calls → System detects → Waits 30s → Auto-calls back →
IVR starts order flow
```

**API:**
```bash
POST /exotel/ivr/missed-call
{
  "From": "+919876543210",
  "To": "+919999999999",
  "CallType": "missed"
}
```

### 3. Vendor Notification (Escalation Ladder)

**Flow:**
```
Order created → App Push (0s) → WhatsApp (1min) → Ring (2min) → IVR (3min) → Admin (5min)
```

**API:**
```bash
# Start escalation
POST /comms/notify/vendor/order
{
  "order_id": "MW-2025-001234",
  "vendor_id": "V-42",
  "vendor_phone": "+919876543210",
  "vendor_name": "Krishna Kirana",
  "amount": 325,
  "items": "Poha x1, Milk 500ml",
  "payment_mode": "prepaid",
  "city": "Nashik",
  "language": "hi"
}

# Response
{
  "success": true,
  "escalationId": "vendor_order_MW-2025-001234"
}

# Stop escalation (when vendor responds)
POST /comms/stop
{
  "escalation_id": "vendor_order_MW-2025-001234",
  "action": "accept",
  "actor": "vendor:V-42"
}
```

### 4. Vendor IVR Actions

When vendor answers IVR call:
```
"Mangwale se naya order. Amount 325 rupees. Items: Poha x1, Milk 500ml.
 Accept ke liye 1, reject ke liye 2, prep time set ke liye 3 dabayein."
```

**DTMF Mapping:**
- `1` → Accept order
- `2` → Reject order  
- `3` → Set prep time (sub-menu: 1=15min, 2=20min, 3=30min)

**Webhook:**
```bash
POST /exotel/ivr/dtmf
{
  "CallSid": "EXO-456",
  "digits": "1",
  "context": "vendor_new_order",
  "order_id": "MW-2025-001234",
  "vendor_id": "V-42"
}
```

### 5. Rider Assignment

**Flow:**
```
Vendor ready → Rider notified → App Push → WhatsApp → Ring → IVR →
Rider accepts → Gets pickup location
```

**API:**
```bash
POST /comms/notify/rider/assign
{
  "order_id": "MW-2025-001234",
  "rider_id": "R-15",
  "rider_phone": "+919988776655",
  "rider_name": "Rahul",
  "pickup_name": "Krishna Kirana",
  "pickup_address": "Shop 12, College Road",
  "drop_address": "Flat 4B, Shivaji Nagar",
  "amount": 325
}
```

### 6. Address Update (Critical)

**Flow:**
```
Customer changes address → Rider immediately notified →
WhatsApp + Ring (30s) → IVR (90s) → Admin bridge if no confirm
```

**API:**
```bash
POST /comms/notify/rider/address-update
{
  "order_id": "MW-2025-001234",
  "rider_id": "R-15",
  "rider_phone": "+919988776655",
  "new_address": "Flat 7C, Mumbai Naka (changed from Shivaji Nagar)",
  "map_link": "https://maps.google.com/?q=..."
}
```

### 7. Masked/Bridge Calls

**Privacy-protected calls between parties:**

```bash
# Customer ↔ Rider (neither sees real number)
POST /exotel/ivr/bridge/masked
{
  "party_a_phone": "+919876543210",  # Customer
  "party_b_phone": "+919988776655",  # Rider
  "context": "customer_rider",
  "order_id": "MW-2025-001234",
  "time_limit": 300
}

# Connect to admin support
POST /exotel/ivr/bridge/admin
{
  "caller_phone": "+919876543210",
  "order_id": "MW-2025-001234",
  "context": "vendor"
}
```

### 8. Marketing Campaigns

**Types Available:**
- `area_launch` - "Mangwale is live in your area"
- `free_delivery` - "Free delivery till Sunday"
- `diwali` - Diwali special offers
- `rakhi` - Rakhi parcel reminders
- `inactive_user` - Re-engagement with discounts
- `vendor_invite` - Onboard new vendors

**API:**
```bash
# Create campaign
POST /campaigns/create
{
  "name": "Nashik Launch Wave 2",
  "type": "area_launch",
  "channel": "both",  # sms + voice
  "phone_numbers": ["+919876543210", "+919988776655"],
  "language": "hi"
}

# Start campaign
POST /campaigns/{campaignId}/start

# Check status
GET /campaigns/{campaignId}

# Single promotional SMS
POST /campaigns/send/sms
{
  "phone": "+919876543210",
  "type": "free_delivery",
  "language": "hi"
}
```

---

## 📊 Dedicated Phone Numbers (Habit Formation)

Configure these in `.env`:
```env
EXOTEL_DID_NEW_ORDER=+91XXXXXXXXXX    # 📦 New Order - Mangwale
EXOTEL_DID_REMINDER=+91YYYYYYYYYY     # ⏱ Order Reminder - Mangwale
EXOTEL_DID_ADDRESS=+91ZZZZZZZZZZ      # 📍 Address Update - Mangwale
EXOTEL_CALLER_ID=+91AAAAAAAAAA        # Default caller ID
```

**Why?** Vendors/Riders save these contacts and immediately know what the call is about!

---

## 📡 Webhook Configuration (Exotel Dashboard)

Configure these webhooks in Exotel:

| Event | URL | Method |
|-------|-----|--------|
| Incoming Call | `https://exotel.mangwale.ai/exotel/ivr/incoming` | POST |
| Missed Call | `https://exotel.mangwale.ai/exotel/ivr/missed-call` | POST |
| DTMF Input | `https://exotel.mangwale.ai/exotel/ivr/dtmf` | POST |
| Call Status | `https://exotel.mangwale.ai/exotel/webhooks/call-status` | POST |

---

## 🔧 API Reference

### Health & Status
```bash
GET /health
# Response: { status, version, features }

GET /exotel/auth/check
# Response: { ok: true, accountSid: "sarvinsuppliesllp1" }
```

### IVR Routes
```bash
POST /exotel/ivr/incoming          # Handle incoming calls
POST /exotel/ivr/missed-call       # Handle missed calls
POST /exotel/ivr/dtmf              # Handle DTMF input
POST /exotel/ivr/voice/process     # Process voice (ASR → AI → TTS)
POST /exotel/ivr/notify/vendor/order    # Vendor order IVR
POST /exotel/ivr/notify/vendor/reminder # Vendor reminder IVR
POST /exotel/ivr/notify/rider/assign    # Rider assignment IVR
POST /exotel/ivr/bridge/masked     # Privacy-protected call bridge
POST /exotel/ivr/bridge/admin      # Connect to admin support
GET  /exotel/ivr/analytics         # IVR statistics
```

### Communications Orchestrator
```bash
POST /comms/notify/vendor/order        # Start vendor escalation
POST /comms/notify/vendor/reminder     # Vendor prep reminder
POST /comms/notify/rider/assign        # Start rider escalation
POST /comms/notify/rider/address-update # Critical address change
POST /comms/notify/customer/status     # Customer status update
POST /comms/notify/customer/delay      # Delay notification
POST /comms/stop                       # Stop active escalation
POST /comms/bridge                     # Initiate bridge call
GET  /comms/timeline/:orderId          # Communication timeline
```

### Campaigns
```bash
GET  /campaigns/templates/list   # Available campaign types
POST /campaigns/create           # Create new campaign
POST /campaigns/:id/start        # Start campaign
POST /campaigns/:id/pause        # Pause campaign
GET  /campaigns/:id              # Campaign status
GET  /campaigns                  # List all campaigns
POST /campaigns/send/sms         # Single promotional SMS
POST /campaigns/send/voice       # Single promotional call
```

---

## 📈 Business Impact

| Metric | Before Exotel | After Exotel |
|--------|---------------|--------------|
| User Acquisition | App download required | Phone call = order |
| Vendor Adoption | Training needed | Zero learning curve |
| Rider Ops | App dependency | Works without internet |
| Support Cost | High (manual) | -60% (automated IVR) |
| Order Friction | High (app UI) | Low (voice command) |
| Coverage | Tech-savvy users only | Everyone with a phone |

---

## 🚀 Deployment

Services running on Mercury (192.168.0.151):

```bash
# Check all services
docker ps | grep mangwale

# Restart Exotel service
docker restart mangwale-exotel-service

# View logs
docker logs mangwale-exotel-service --tail 100 -f

# Test endpoints
curl http://localhost:3100/health
curl http://localhost:3100/exotel/auth/check
curl http://localhost:3100/campaigns/templates/list
curl http://localhost:3100/webhooks/jupiter/health
```

---

## 🔗 Jupiter Integration (v2.1.0)

**CRITICAL**: The Exotel service has **NO local database**. All data comes from Jupiter.

### Data Flow

```
Exotel Service → Jupiter Client → Jupiter Backend → PHP Backend → Database
                                       │
                                       ▼
                              Order/Vendor/Rider Data
```

### Jupiter Client Service

Location: `exotel-service/src/services/jupiter.service.js`

**Functions:**
- `getOrderDetails(orderId)` - Fetch order from Jupiter/PHP
- `getStoreDetails(storeId)` - Get vendor info
- `getStoreByPhone(phone)` - Identify vendor by phone
- `getDeliveryManDetails(riderId)` - Get rider info
- `getDeliveryManByPhone(phone)` - Identify rider by phone
- `getCustomerByPhone(phone)` - Get customer info
- `notifyJupiter(eventType, data)` - Send events to Jupiter
- `updateOrderStatus(orderId, status)` - Update order via Jupiter

### Jupiter Webhooks

Jupiter sends events to Exotel for real-time coordination:

**Endpoint**: `POST /webhooks/jupiter/*`

| Webhook | Description | Action |
|---------|-------------|--------|
| `/order/new` | New order placed | Start vendor escalation |
| `/order/accepted` | Vendor accepted | Stop vendor escalation |
| `/order/rejected` | Vendor rejected | Stop escalation, reassign |
| `/order/ready` | Order ready | Notify rider |
| `/rider/assigned` | Rider assigned | Start rider escalation |
| `/rider/accepted` | Rider accepted | Stop rider escalation |
| `/rider/rejected` | Rider rejected | Reassign rider |
| `/address/changed` | Address updated | Fast escalation to rider |
| `/order/picked-up` | Order picked up | Notify customer |
| `/order/delivered` | Order delivered | Stop all escalations |

**Example webhook payload from Jupiter:**
```json
POST /webhooks/jupiter/order/new
{
  "order_id": 12345,
  "store_id": 67,
  "customer_id": 890,
  "amount": 325,
  "payment_method": "cash_on_delivery",
  "items": [
    {"name": "Butter Chicken", "quantity": 1, "price": 280},
    {"name": "Naan", "quantity": 2, "price": 45}
  ]
}
```

### Environment Variables

```bash
JUPITER_URL=http://192.168.0.156:3200
PHP_BACKEND_URL=https://www.mangwale.com
JUPITER_API_KEY=exotel-service-key
JUPITER_WEBHOOK_SECRET=mangwale-exotel-webhook-secret
```

### Health Check

```bash
curl http://localhost:3100/health | jq .
# Shows Jupiter & PHP connection status
{
  "status": "ok",
  "version": "2.1.0",
  "connections": {
    "jupiter": { "connected": true, "latency": 45 },
    "php": { "connected": true, "latency": 1005 }
  }
}
```

---

## 🔮 Future Enhancements

1. **Exotel Applet Builder** - Visual IVR flow designer
2. **Voice Biometrics** - Identify returning customers by voice
3. **Multilingual IVR** - Auto-detect language from caller
4. **Smart Routing** - Route calls based on order history
5. **Call Analytics Dashboard** - Real-time monitoring
6. **ONDC Voice Bridge** - Voice ordering across ONDC network

---

*Last Updated: December 15, 2025 (v2.1.0 - Jupiter Integration)*
