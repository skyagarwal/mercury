# 🧠 Mangwale Voice Nerve System

## The Fastest Voice Response Architecture for Exotel IVR

---

## 🎯 Why Python + FastAPI?

After evaluating **NestJS/TypeScript** vs **Python/FastAPI** for the voice "nerve system", here's why we chose **Python**:

### Latency Comparison

| Metric | NestJS/TypeScript | Python/FastAPI | Winner |
|--------|-------------------|----------------|--------|
| ASR Integration | HTTP relay to Python service | Native httpx async call | Python ⚡ |
| TTS Integration | HTTP relay to Python service | Native httpx async call | Python ⚡ |
| ML Model Loading | N/A (separate service) | Can run in-process | Python ⚡ |
| Audio Processing | npm libraries (limited) | numpy/librosa/soundfile | Python ⚡ |
| Cold Start | ~500ms | ~200ms | Python ⚡ |
| WebSocket Streaming | Good (ws library) | Excellent (native) | Python ⚡ |

### Key Insight

> **The voice layer (Mercury) is 90% ML/Audio processing. Python removes the JS→Python bridge.**

```
❌ BEFORE (JS layer):
   Exotel → JS Handler → HTTP → Python ASR → Response
                      ↓
                200-300ms overhead per call

✅ AFTER (Python Nerve):
   Exotel → Python Nerve → Direct Python ASR → Response
                      ↓
                50-100ms overhead per call
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            JUPITER (Brain)                               │
│                          192.168.0.156:3200                              │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    NestJS Backend                                 │  │
│   │  ┌─────────────┐  ┌────────────────┐  ┌──────────────────┐       │  │
│   │  │ Orders API  │  │ Voice Calls    │  │ Database         │       │  │
│   │  │ /api/orders │  │ /api/voice-calls│  │ PostgreSQL       │       │  │
│   │  └──────┬──────┘  └───────┬────────┘  └────────┬─────────┘       │  │
│   │         │                 │                     │                 │  │
│   │         └────────────────►│◄────────────────────┘                 │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                ▲                                         │
│                                │ HTTP (Prisma ORM)                       │
└────────────────────────────────┼─────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │     NETWORK (LAN)       │
                    └────────────┬────────────┘
                                 │
┌────────────────────────────────┼─────────────────────────────────────────┐
│                                ▼                                          │
│                         MERCURY (Voice)                                   │
│                          192.168.0.151                                    │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                  NERVE SYSTEM (Port 7100)                        │    │
│   │                  Python/FastAPI + httpx                          │    │
│   │                                                                   │    │
│   │   ┌─────────────────────────────────────────────────────────┐   │    │
│   │   │              Exotel Webhook Handler                      │   │    │
│   │   │   /api/nerve/callback (GET - Passthru)                   │   │    │
│   │   │   /api/nerve/status (POST - Completion)                  │   │    │
│   │   └─────────────────────────────────────────────────────────┘   │    │
│   │                           ▲                                      │    │
│   │                           │ DTMF + CustomField                   │    │
│   │   ┌─────────────────────────────────────────────────────────┐   │    │
│   │   │              Call State Machine                          │   │    │
│   │   │   greeting → confirmation → prep_time → goodbye          │   │    │
│   │   │   greeting → confirmation → rejection → goodbye          │   │    │
│   │   └─────────────────────────────────────────────────────────┘   │    │
│   │                           │                                      │    │
│   │   ┌─────────────────────────────────────────────────────────┐   │    │
│   │   │              TTS Cache (In-Memory)                       │   │    │
│   │   │   Pre-generated Hindi/English phrases                    │   │    │
│   │   │   Order-specific scripts cached on call init             │   │    │
│   │   └─────────────────────────────────────────────────────────┘   │    │
│   │                           │                                      │    │
│   │   ┌───────────┬───────────┴───────────┬──────────────────┐      │    │
│   │   ▼           ▼                       ▼                  ▼      │    │
│   │  ASR       TTS         Exotel API      Jupiter          │    │    │
│   │  7001      7002        (initiate)      Reporter         │    │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│   ┌────────────────────┐  ┌────────────────────┐                         │
│   │   ASR Service      │  │   TTS Service      │                         │
│   │   Faster-Whisper   │  │   Indic-Parler     │                         │
│   │   Port 7001        │  │   Port 7002        │                         │
│   │   GPU: RTX 3060    │  │   GPU: RTX 3060    │                         │
│   └────────────────────┘  └────────────────────┘                         │
│                                                                           │
│   ┌────────────────────────────────────────────────────────────────┐     │
│   │                      RTX 3060 12GB VRAM                         │     │
│   │   Whisper Large-V3: ~4GB | Indic-Parler: ~3GB | Free: ~5GB     │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 📞 Call Flow

### Vendor Order Confirmation

```
1. NEW ORDER (Jupiter)
   ─────────────────────────────────────────────────────────►
   Jupiter creates order → triggers vendor confirmation

2. INITIATE CALL (Jupiter → Nerve)
   ─────────────────────────────────────────────────────────►
   POST /api/nerve/vendor-order-confirmation
   {
     "order_id": 12345,
     "vendor_id": 100,
     "vendor_phone": "+919876543210",
     "vendor_name": "Sharma Ji Restaurant",
     "order_items": [{"name": "Vada Pav", "quantity": 2}],
     "order_amount": 150,
     "language": "hi"
   }

3. PRE-GENERATE TTS (Nerve - Background)
   ─────────────────────────────────────────────────────────►
   Generate greeting, acceptance, rejection scripts BEFORE call connects

4. EXOTEL CONNECT (Nerve → Exotel)
   ─────────────────────────────────────────────────────────►
   POST /v1/Accounts/{sid}/Calls/connect.json
   - Uses IVR App with Passthru

5. VENDOR ANSWERS (Exotel → IVR)
   ─────────────────────────────────────────────────────────►
   IVR plays pre-recorded greeting with order details
   "नमस्ते शर्मा जी, मंगवाले से कॉल। ऑर्डर 12345: वड़ा पाव (2 पीस)।
    स्वीकार: 1, रद्द: 0"

6. VENDOR PRESSES DTMF (IVR → Passthru → Nerve)
   ─────────────────────────────────────────────────────────►
   GET /api/nerve/callback?digits=1&CallSid=xxx&CustomField={"order_id":12345}

7. PROCESS DTMF (Nerve)
   ─────────────────────────────────────────────────────────►
   If digits=1 (Accept): Ask prep time
   If digits=0 (Reject): Ask reason

8. REPORT TO JUPITER (Nerve → Jupiter)
   ─────────────────────────────────────────────────────────►
   POST /api/voice-calls/result
   {
     "call_sid": "xxx",
     "status": "ACCEPTED",
     "order_id": 12345,
     "prep_time_minutes": 30
   }

9. UPDATE ORDER (Jupiter)
   ─────────────────────────────────────────────────────────►
   Order status → CONFIRMED
   Trigger rider assignment
```

---

## ⏱️ Latency Optimizations

### 1. TTS Pre-Caching

```python
# On startup: Pre-load common phrases
HINDI_PHRASES = {
    "greeting_prefix": "नमस्ते",
    "new_order": "आपके लिए एक नया ऑर्डर आया है",
    ...
}

# On call init: Pre-generate order-specific scripts
async def pregenerate_call_tts(call_state):
    greeting = generate_vendor_greeting_script(call_state)
    call_state.tts_cache["greeting"] = await tts_cache.synthesize(greeting)
```

**Result**: TTS ready BEFORE vendor answers (~200ms saved)

### 2. Connection Pooling

```python
# Single httpx client reused across requests
self._http_client = httpx.AsyncClient(timeout=30.0)
```

**Result**: No TCP handshake per request (~50ms saved)

### 3. In-Memory State

```python
# No database round-trips for active calls
active_calls: Dict[str, CallState] = {}
```

**Result**: State access in microseconds

### 4. Async Everything

```python
# All I/O is async
async def process_utterance(...):
    asr_result, tts_audio = await asyncio.gather(
        asr_service.transcribe(audio),
        tts_cache.get_cached("thank_you")
    )
```

**Result**: Parallel processing where possible

---

## 🚀 Deployment

### Quick Start

```bash
cd /home/ubuntu/mangwale-voice/escotel-stack

# Create .env file
cat > .env << EOF
EXOTEL_SID=sarvinsuppliesllp1
EXOTEL_API_KEY=your_key
EXOTEL_API_TOKEN=your_token
EXOTEL_CALLER_ID=02048556923
EOF

# Start services
./start-nerve.sh

# Check health
./start-nerve.sh --status

# Test call
./start-nerve.sh --test
```

### Docker Services

| Service | Port | Description |
|---------|------|-------------|
| nerve-system | 7100 | Python/FastAPI IVR orchestrator |
| asr | 7001 | Faster-Whisper ASR |
| tts | 7002 | Indic-Parler TTS |
| exotel-js | 3100 | Legacy JS service (optional) |

### Traefik Routing (Jupiter)

```yaml
# Add to Jupiter's Traefik config
- "traefik.http.routers.nerve.rule=Host(`exotel.mangwale.ai`) && PathPrefix(`/api/nerve`)"
- "traefik.http.routers.nerve.entrypoints=websecure"
- "traefik.http.routers.nerve.tls.certresolver=letsencrypt"
- "traefik.http.services.nerve.loadbalancer.server.port=7100"
```

---

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:7100/health

{
  "status": "healthy",
  "service": "nerve-system",
  "active_calls": 3,
  "tts_cache_size": 45,
  "components": {
    "tts_cache": true,
    "exotel_client": true,
    "jupiter_reporter": true
  }
}
```

### Active Calls

```bash
curl http://localhost:7100/api/nerve/active-calls

{
  "count": 2,
  "calls": [
    {
      "call_sid": "abc123",
      "call_type": "vendor_order_confirmation",
      "order_id": 12345,
      "status": "ANSWERED",
      "current_state": "prep_time",
      "duration": 15.5
    }
  ]
}
```

### TTS Cache Stats

```bash
curl http://localhost:7100/api/nerve/tts-cache

{
  "size": 45,
  "keys": ["greeting_prefix:hi:hindi_female", ...]
}
```

---

## 🔧 API Reference

### Jupiter → Nerve (Call Initiation)

#### POST `/api/nerve/vendor-order-confirmation`

Initiate vendor order confirmation call.

```json
{
  "order_id": 12345,
  "vendor_id": 100,
  "vendor_phone": "+919876543210",
  "vendor_name": "Restaurant Name",
  "customer_name": "Customer Name",
  "order_items": [
    {"name": "Item 1", "quantity": 2, "price": 100}
  ],
  "order_amount": 250,
  "payment_method": "Cash on Delivery",
  "language": "hi"
}
```

#### POST `/api/nerve/rider-assignment`

Initiate rider assignment call.

```json
{
  "order_id": 12345,
  "rider_id": 50,
  "rider_phone": "+919876543210",
  "rider_name": "Rider Name",
  "restaurant_name": "Restaurant Name",
  "restaurant_address": "Restaurant Address",
  "pickup_time_minutes": 30,
  "language": "hi"
}
```

### Exotel → Nerve (Callbacks)

#### GET `/api/nerve/callback`

Passthru callback endpoint. Receives DTMF and call context.

Query Parameters:
- `CallSid`: Exotel call ID
- `digits`: DTMF digits pressed
- `CustomField`: JSON with order_id, vendor_id, etc.
- `CallStatus`: Call status

#### POST `/api/nerve/status`

Call completion callback.

Form Data:
- `CallSid`: Call ID
- `Status`: completed/no-answer/busy/failed
- `Duration`: Call duration in seconds
- `RecordingUrl`: Recording URL (if enabled)

### Nerve → Jupiter (Results)

#### POST `/api/voice-calls/result`

Report call result to Jupiter.

```json
{
  "call_sid": "abc123",
  "call_type": "vendor_order_confirmation",
  "status": "ACCEPTED",
  "order_id": 12345,
  "vendor_id": 100,
  "digits": "1",
  "prep_time_minutes": 30,
  "answered_at": "2024-01-15T10:30:00Z"
}
```

---

## 🎯 Next Steps

1. **Configure Exotel IVR App**
   - Set callback URL to `https://exotel.mangwale.ai/api/nerve/callback`
   - Enable recording for quality assurance

2. **Update Jupiter's voice-calls module**
   - Point to Nerve System instead of Mercury JS service
   - Update webhook URL in database

3. **Test end-to-end**
   - Create test order in Jupiter
   - Verify call to vendor
   - Confirm DTMF handling
   - Check database updates

4. **Monitor in production**
   - Set up Prometheus metrics
   - Configure alerts for failed calls
   - Track latency metrics
