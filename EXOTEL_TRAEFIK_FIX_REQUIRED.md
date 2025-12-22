# Exotel Traefik Routing Fix Required

**Date:** December 20, 2025  
**Status:** ⚠️ PARTIAL - Health endpoint works, callback endpoints 404  
**Issue:** Traefik `strip-nerve-prefix` middleware is removing `/api/nerve` from paths  
**Impact:** Exotel callbacks reach Mercury but get 404 Not Found

---

## 🔴 Current Problem

```
Exotel calls: https://exotel.mangwale.ai/api/nerve/callback
       ↓
Jupiter (103.184.155.61) Traefik
       ↓
   Strips /api/nerve prefix (strip-nerve-prefix middleware)
       ↓
Mercury receives: http://192.168.0.151:7100/callback ❌
       ↓
   404 Not Found (Nerve expects /api/nerve/callback)
```

**Test Results:**
- ✅ `/health` works: `curl https://exotel.mangwale.ai/api/nerve/health` → 200 OK  
- ❌ `/callback` fails: `curl https://exotel.mangwale.ai/api/nerve/callback` → 404 Not Found
- ✅ Direct access works: `curl http://192.168.0.151:7100/api/nerve/callback` → 200 OK ExoML

**Root Cause:** Traefik middleware `strip-nerve-prefix` removes `/api/nerve` before forwarding to Mercury, but Nerve endpoints are defined as `/api/nerve/*`

**Nerve Log Evidence:**
```
INFO: 192.168.0.156:60888 - "GET /callback?CallSid=test123..." 404 Not Found
                                  ^^^^^^^^^ Missing /api/nerve prefix!
```

---

## 🛠️ Fix Required on Jupiter

### Location
**File:** `/home/ubuntu/Devs/Search/traefik-config/dynamic/exotel.mangwale.ai.yml`  
**Server:** Jupiter (192.168.0.156, Public: 103.184.155.61)

### The Problem

Current config has a middleware that strips `/api/nerve`:

```yaml
http:
  middlewares:
    strip-nerve-prefix:
      stripPrefix:
        prefixes:
          - "/api/nerve"  # ← THIS IS THE PROBLEM
```

This causes:
- `https://exotel.mangwale.ai/api/nerve/callback` → forwarded as → `/callback`
- But Nerve expects: `/api/nerve/callback`

### Correct Configuration (WITHOUT prefix stripping)

```yaml
http:
  routers:
    exotel-nerve:
      rule: "Host(`exotel.mangwale.ai`)"
      service: nerve-service
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      # NO MIDDLEWARE - forward full path as-is

  services:
    nerve-service:
      loadBalancer:
        servers:
          - url: "http://192.168.0.151:7100"
```

**Key Change:** Remove the `middlewares` line from the router OR remove the `stripPrefix` middleware entirely.

### Verification Steps

1. **SSH to Jupiter:**
   ```bash
   ssh ubuntu@192.168.0.156
   ```

2. **Check Traefik config:**
   ```bash
   cat /home/ubuntu/Devs/Search/traefik-config/dynamic/exotel.mangwale.ai.yml
   ```

3. **Verify Mercury is reachable from Jupiter:**
   ```bash
   curl -s http://192.168.0.151:7100/health | jq .
   ```
   Expected: `{"status":"healthy",...}`

4. **Check Traefik container:**
   ```bash
   docker ps | grep traefik
   docker logs traefik --tail 50
   ```

5. **Test the public URL after fix:**
   ```bash
   curl -s https://exotel.mangwale.ai/health | jq .
   ```

---

## 📋 What Exotel Needs

When Exotel makes a call, it will:

1. **Initial callback** (when call is answered):
   ```
   GET https://exotel.mangwale.ai/api/nerve/callback
       ?CallSid=xxx
       &CallFrom=919923383838
       &CustomField={"order_id":123,...}
   ```
   
   Nerve responds with ExoML:
   ```xml
   <Response>
     <Gather action="https://exotel.mangwale.ai/api/nerve/callback" numDigits="1">
       <Play>https://storage.mangwale.ai/voice-audio/ivr/hi/greeting.wav</Play>
     </Gather>
   </Response>
   ```

2. **DTMF callback** (when user presses a key):
   ```
   GET https://exotel.mangwale.ai/api/nerve/callback
       ?CallSid=xxx
       &digits=1
       &CustomField={"order_id":123,...}
   ```
   
   Nerve processes the input and returns next ExoML step.

3. **Status callback** (when call ends):
   ```
   POST https://exotel.mangwale.ai/api/nerve/status
   {
     "CallSid": "xxx",
     "Status": "completed",
     "RecordingUrl": "...",
     "DateUpdated": "..."
   }
   ```

---

## 🧪 Test Commands (After Fix)

```bash
# 1. Test health endpoint
curl -s https://exotel.mangwale.ai/health | jq .

# 2. Test callback with sample parameters
curl -s "https://exotel.mangwale.ai/api/nerve/callback?CallSid=test123&CustomField=%7B%22order_id%22%3A12345%7D"

# Expected: ExoML XML response like:
# <?xml version="1.0" encoding="UTF-8"?>
# <Response>
#   <Gather...>
#     <Play>https://storage.mangwale.ai/...</Play>
#   </Gather>
# </Response>

# 3. Make a test Exotel call (from Mercury)
curl -X POST http://localhost:7100/api/nerve/vendor-order-confirmation \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": 99999,
    "vendor_id": "test001",
    "vendor_phone": "919923383838",
    "vendor_name": "Test Vendor",
    "order_amount": 350
  }'
```

---

## 📊 Current Mercury Status

| Service | Port | Status | Purpose |
|---------|------|--------|---------|
| Nerve System | 7100 | ✅ RUNNING | Exotel IVR orchestration |
| TTS Service | 7002 | ✅ RUNNING | Hindi/English speech synthesis |
| ASR Service | 7001 | ✅ RUNNING | Speech-to-text transcription |
| Orchestrator | 7000 | ✅ RUNNING | Voice flow coordination |

**Nerve Configuration:**
- ✅ `USE_DIRECT_CALLBACK=true` (using our callback, not IVR App)
- ✅ `EXOTEL_CALLBACK_URL=https://exotel.mangwale.ai`
- ✅ `EXOTEL_SID=sarvinsuppliesllp1`
- ✅ `EXOTEL_CALLER_ID=02048556923`

---

## 🎯 Summary

**Problem:** Traefik on Jupiter cannot route `exotel.mangwale.ai` to Mercury:7100  
**Solution:** Fix Traefik config at `/home/ubuntu/Devs/Search/traefik-config/dynamic/exotel.mangwale.ai.yml`  
**Test:** `curl https://exotel.mangwale.ai/health` should return 200 OK

Once fixed, Exotel will be able to:
1. ✅ Call vendors via our IVR
2. ✅ Play Hindi TTS audio
3. ✅ Collect DTMF responses (1=accept, 2=delay, 0=reject)
4. ✅ Report results back to Jupiter

---

*Need help? Check Traefik logs: `docker logs traefik --tail 100`*
