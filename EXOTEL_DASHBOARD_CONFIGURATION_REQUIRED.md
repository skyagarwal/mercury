# Exotel Dashboard Configuration Required ⚠️

## Current Status

✅ **Working Components:**
- Nerve System running on port 7100
- Public endpoints accessible via https://exotel.mangwale.ai
- ExoML callback endpoint: `/api/nerve/callback` (returns XML)
- Programmable Gather endpoint: `/api/nerve/gather` (returns JSON)
- Traefik routing configured correctly
- Exotel API credentials valid
- Calls initiate successfully and phone rings

❌ **Issue:**
- Calls disconnect immediately when answered
- **Root Cause**: IVR App 1145886 is NOT configured in Exotel dashboard
- Exotel never calls our callback/gather endpoints

## Why Calls Disconnect

When we initiate a call with:
```
Url: http://my.exotel.com/exoml/start_voice/1145886
```

Exotel tries to execute IVR App ID **1145886**, but this app either:
1. Doesn't exist in the dashboard
2. Exists but has no applets configured
3. Exists but points to wrong URLs

Without a properly configured IVR app, Exotel has no instructions on what to do when the call is answered → **disconnects immediately**.

## Solution: Configure Exotel Dashboard

### Option A: Programmable Gather (Recommended)

**Pros**: Uses Exotel's built-in Hindi TTS, more reliable
**Cons**: Requires dashboard access

**Steps**:
1. Login to https://my.exotel.com
2. Navigate to **IVR** → **Apps**
3. Find existing app **1145886** OR create new one
4. Add **Programmable Gather** applet:
   - **URL**: `https://exotel.mangwale.ai/api/nerve/gather`
   - **HTTP Method**: GET
   - **Voice**: `hi-IN` (Hindi India)
   - **Max Retries**: 2
5. Connect **Start** → **Programmable Gather**
6. Save and note the **App ID**
7. If new app created, update `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/.env`:
   ```
   IVR_APP_ID=<new_app_id>
   ```

### Option B: Passthru (Alternative)

**Pros**: More flexible, we return full ExoML control
**Cons**: May be less reliable if Exotel has issues fetching URLs

**Steps**:
1. Login to https://my.exotel.com
2. Navigate to **IVR** → **Apps**
3. Find/create app **1145886**
4. Add **Passthru** applet:
   - **URL**: `https://exotel.mangwale.ai/api/nerve/callback`
   - **HTTP Method**: GET
5. Connect **Start** → **Passthru**
6. Save

## Testing After Configuration

Once the dashboard is configured, test with:

```bash
curl -X POST "http://192.168.0.151:7100/api/nerve/vendor-order-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_phone": "919923383838",
    "vendor_name": "Saurabh",
    "vendor_id": "V001",
    "order_id": 12345,
    "order_amount": 999,
    "order_details": {"items": "Test order"}
  }'
```

**Expected Flow:**
1. Phone rings: 9923383838
2. Vendor picks up
3. **Exotel calls our endpoint** (gather or callback)
4. We return Hindi text/audio instructions
5. **Exotel plays TTS**: "नमस्ते Saurabh, यह मंगवाले से कॉल है..."
6. Vendor presses 1 (accept) or 0 (reject)
7. We respond with next step
8. Call completes successfully

## Current Configuration

**Environment Variables** (in `.env`):
```bash
EXOTEL_SID=sarvinsuppliesllp1
EXOTEL_API_KEY=45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf
EXOTEL_API_TOKEN=66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5
EXOTEL_CALLER_ID=02048556923
EXOTEL_CALLBACK_URL=https://exotel.mangwale.ai
USE_DIRECT_CALLBACK=false
IVR_APP_ID=1145886
```

**Code** (nerve_system.py lines 575-595):
```python
USE_DIRECT_CALLBACK = os.getenv("USE_DIRECT_CALLBACK", "true").lower() == "true"

if USE_DIRECT_CALLBACK:
    # This doesn't work - Exotel v1 API doesn't support custom Url
    exoml_url = callback_url
else:
    # This works - Uses dashboard IVR app
    IVR_APP_ID = ivr_app_id or "1145886"
    exoml_url = f"http://my.exotel.com/exoml/start_voice/{IVR_APP_ID}"
```

## Verification

**Test endpoints are publicly accessible:**

```bash
# Test Programmable Gather endpoint
curl "https://exotel.mangwale.ai/api/nerve/gather?CallSid=test&CustomField=%7B%22order_id%22%3A123%7D"

# Test Passthru callback endpoint
curl "https://exotel.mangwale.ai/api/nerve/callback?CallSid=test&order_id=123"
```

Both return correct responses (JSON for gather, XML for callback).

## Logs to Monitor

After dashboard configuration, watch logs:

```bash
# Nerve logs
tail -f /tmp/nerve-debug.log | grep -E "gather|callback|Exotel"

# Check for incoming requests from Exotel
tail -f /tmp/nerve-debug.log | grep "GET /api/nerve"
```

**What to look for:**
```
✅ GOOD: INFO: 103.184.155.61 - "GET /api/nerve/gather?CallSid=...&CustomField=..." 200 OK
❌ BAD:  No GET requests from Exotel (call disconnects)
```

## Who Needs Dashboard Access?

**Required**: Someone with admin access to Exotel account for `sarvinsuppliesllp1`

**Typical role**: Operations Manager, Tech Admin, or whoever set up the Exotel account initially

## Timeline

- **With dashboard access**: 15-30 minutes to configure and test
- **Without dashboard access**: Need to contact Exotel account admin first

## Contact for Help

If you don't have dashboard access, contact:
1. Exotel support: support@exotel.com
2. Check who in your organization has the Exotel login credentials
3. Or request dashboard access from the account owner

---

## Summary

🔴 **Problem**: IVR App 1145886 not configured → Calls disconnect
🟢 **Solution**: Configure Programmable Gather or Passthru applet in Exotel dashboard
⏱️ **Time**: 15-30 minutes with dashboard access
📞 **Test Number**: 9923383838 (Saurabh)

**All infrastructure is ready, just need dashboard configuration!**
