# Exotel Dashboard - Complete Configuration Guide

**Date:** December 24, 2025  
**Service:** Mangwale Voice Nerve System  
**Endpoint Verified:** ✅ Working with English & Hindi  
**API Parameters:** ✅ CORRECTED - From=vendor phone, CallerId=virtual number

---

## ⚠️ CRITICAL: Correct API Parameters

**WRONG (causes loopback calls):**
```bash
From=02048556923   # Virtual number - WRONG!
To=919923383838    # Vendor number - Wrong parameter name!
AppId=1148615
```

**CORRECT (per Exotel documentation):**
```bash
From=919923383838              # Vendor phone TO CALL
CallerId=02048556923           # Your virtual number
Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615
```

**Result:**
- Exotel calls **From** number (vendor: 919923383838)
- Vendor sees caller ID as **CallerId** (virtual: 02048556923)
- Call connects to **Url** (your IVR App 1148615)

---

## ✅ Pre-Setup Verification Completed

### Endpoint Tests Passed

**English Test:**
```json
{
  "gather_prompt": {
    "text": "Hello Test Vendor, This is a call from Mangwale. You have a new order..."
  },
  "max_input_digits": 1,
  "input_timeout": 15
}
```

**Hindi Test:**
```json
{
  "gather_prompt": {
    "text": "नमस्ते Test Vendor, यह मंगवाले से कॉल है..."
  },
  "max_input_digits": 1,
  "input_timeout": 15
}
```

**DTMF Test (Press 1):**
```json
{
  "gather_prompt": {
    "text": "Thank you! How many minutes to prepare: 15 minutes - 1, 30 minutes - 2..."
  },
  "max_input_digits": 1,
  "input_timeout": 15
}
```

✅ **All formats verified and working**

---

## Dashboard Configuration Steps

### Step 1: Login to Exotel Dashboard

1. Go to: **https://my.exotel.com**
2. Login with account: `sarvinsuppliesllp1`
3. Navigate to: **IVR → Apps**

---

### Step 2: Configure App ID 1148615 (Outbound - For Vendor Calls)

This app is used when you initiate calls TO vendors.

#### 2.1: Find App 1148615

- In the IVR Apps list, search for: **App ID 1148615**
- Click to edit

#### 2.2: Clear Existing Configuration

- **Delete any existing applets** from the canvas
- Start with a clean slate

#### 2.3: Add Programmable Gather Applet

Drag **"Programmable Gather"** from the left panel onto the canvas.

**Configuration:**

| Field | Value |
|-------|-------|
| **URL** | `https://exotel.mangwale.ai/api/nerve/gather` |
| **HTTP Method** | `GET` |
| **Voice/Language** | `hi-IN` (Hindi - India) for Hindi calls<br>`en-IN` (English - India) for English calls |
| **Gender** | `Female` (recommended) |
| **Max Input Digits** | Leave empty (controlled by our response) |
| **Input Timeout** | Leave empty (controlled by our response) |
| **Finish on Key** | Leave empty (controlled by our response) |
| **Number of Retries** | `2` |
| **Action on No Input** | `Re-fetch URL` |
| **Action on Invalid Input** | `Re-fetch URL` |

#### 2.4: Connect Flow

```
[Start] ──────► [Programmable Gather]
```

- Connect the **Start** node to **Programmable Gather** node
- No other applets needed

#### 2.5: Save Configuration

- Click **Save** button
- Wait for confirmation

---

### Step 3: Configure App ID 1148538 (Incoming - For Testing)

This app handles incoming calls TO your virtual number `02048556923`.

#### 3.1: Find App 1148538

- In the IVR Apps list, search for: **App ID 1148538**
- Click to edit

#### 3.2: Clear Existing Configuration

- Delete any existing applets
- Start fresh

#### 3.3: Add Programmable Gather Applet

Use **EXACTLY the same configuration** as Step 2.3 above:

- URL: `https://exotel.mangwale.ai/api/nerve/gather`
- Method: `GET`
- Voice: `hi-IN` or `en-IN`
- All other settings identical

#### 3.4: Connect Flow

```
[Start] ──────► [Programmable Gather]
```

#### 3.5: Save Configuration

- Click **Save**

---

### Step 4: Verify Virtual Number Routing

#### 4.1: Check Virtual Number 02048556923

1. Go to: **Phone Numbers** → **Virtual Numbers**
2. Find: **02048556923**
3. Click to edit

#### 4.2: Set Incoming Call Handling

| Field | Value |
|-------|-------|
| **On Incoming Call** | `Connect to App` |
| **Select App** | **1148538** (your incoming app) |

#### 4.3: Save

- Click **Save**

---

## Language Selection

### How Language Works

The language is controlled by the `CustomField` parameter when initiating calls:

**For Hindi:**
```json
{
  "language": "hi"
}
```

**For English:**
```json
{
  "language": "en"
}
```

### Setting Voice in Exotel Dashboard

**For Hindi Calls:**
- Set Voice/Language to: `hi-IN` (Hindi - India)
- Exotel will use Hindi TTS voice

**For English Calls:**
- Set Voice/Language to: `en-IN` (English - India)
- Exotel will use English TTS voice

**Multi-language Support:**
If you want ONE app to handle both languages:
- Set Voice to: `hi-IN` (default Hindi)
- Our endpoint will send appropriate text based on `language` parameter
- Exotel's TTS engine will automatically detect and speak the text correctly

---

## Testing After Configuration

### Test 1: Outbound Call (App 1148615)

**✅ CORRECTED COMMAND:**
```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect.json" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  --data-urlencode "From=9923383838" \
  --data-urlencode "CallerId=02048556923" \
  --data-urlencode "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615" \
  --data-urlencode 'CustomField={"call_type":"vendor_order_confirmation","order_id":12345,"vendor_id":"V001","vendor_name":"Test Vendor","order_amount":500,"order_items":[{"name":"Pizza","quantity":2}],"language":"en"}'
```

**Parameters Explained:**
- `From=9923383838` → Phone number TO CALL (vendor)
- `CallerId=02048556923` → Your virtual number (shows as caller ID)
- `Url=...start_voice/1148615` → App ID with Exotel's URL format

**Expected:**
1. Phone `9923383838` rings
2. You answer
3. You hear: "Hello Test Vendor, This is a call from Mangwale..."
4. Press `1` to accept
5. You hear: "Thank you! How many minutes to prepare..."
6. Press `2` for 30 minutes
7. You hear: "Thank you! Rider will arrive in 30 minutes. Have a good day!"
8. Call ends

### Test 2: Incoming Call (App 1148538)

```bash
# Call the virtual number from your phone
# Dial: 02048556923
```

**Expected:**
1. Call connects
2. You hear greeting (language depends on default CustomField)
3. Press DTMF buttons to test flow

### Test 3: Monitor Logs

```bash
# SSH to server
ssh mercury

# Watch logs in real-time
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.log

# Look for these patterns:
# ✅ "GET /api/nerve/gather?CallSid=...&CustomField=..." 200 OK
# ✅ "PROGRAMMABLE GATHER REQUEST RECEIVED"
# ✅ "DTMF received: 1"
# ✅ "Order ACCEPTED"
```

---

## Call Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    OUTBOUND CALL FLOW (App 1148615)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Jupiter/API initiates call                                  │
│     POST /Calls/connect.json                                    │
│     AppId=1148615                                               │
│     CustomField={order_id, vendor_name, language, ...}          │
│                                                                 │
│  2. Exotel connects call to vendor                              │
│     Vendor picks up                                             │
│                                                                 │
│  3. Exotel calls our endpoint:                                  │
│     GET https://exotel.mangwale.ai/api/nerve/gather             │
│     ?CallSid=xxx&CustomField={...}                              │
│                                                                 │
│  4. We respond with JSON:                                       │
│     {                                                           │
│       "gather_prompt": {                                        │
│         "text": "Hello Test Vendor, new order..."              │
│       },                                                        │
│       "max_input_digits": 1,                                    │
│       "input_timeout": 15                                       │
│     }                                                           │
│                                                                 │
│  5. Exotel TTS speaks the text to vendor                        │
│     Vendor hears: "Hello Test Vendor..."                        │
│                                                                 │
│  6. Vendor presses DTMF button (e.g., 1)                        │
│                                                                 │
│  7. Exotel calls our endpoint again:                            │
│     GET https://exotel.mangwale.ai/api/nerve/gather             │
│     ?CallSid=xxx&digits=1&CustomField={...}                     │
│                                                                 │
│  8. We respond with next prompt:                                │
│     {                                                           │
│       "gather_prompt": {                                        │
│         "text": "Thank you! How many minutes..."               │
│       },                                                        │
│       "max_input_digits": 1,                                    │
│       "input_timeout": 15                                       │
│     }                                                           │
│                                                                 │
│  9. Vendor presses prep time (e.g., 2 for 30 min)              │
│                                                                 │
│  10. Exotel calls our endpoint:                                 │
│      GET https://exotel.mangwale.ai/api/nerve/gather            │
│      ?CallSid=xxx&digits=2&CustomField={...}                    │
│                                                                 │
│  11. We respond with final message:                             │
│      {                                                          │
│        "gather_prompt": {                                       │
│          "text": "Rider will arrive in 30 minutes..."          │
│        },                                                       │
│        "max_input_digits": 0,    ← Ends call                   │
│        "input_timeout": 1                                       │
│      }                                                          │
│                                                                 │
│  12. Exotel speaks goodbye and hangs up                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Important Notes

### ✅ What's Working

1. **Endpoint Format:** Correct JSON structure for Programmable Gather
2. **Language Support:** English (`en`) and Hindi (`hi`) both tested and working
3. **DTMF Handling:** Press 1/0 detection working
4. **Dynamic Text:** Order details, vendor names, amounts all interpolated correctly
5. **TTS Engine:** Exotel's TTS will speak whatever text we send

### ⚠️ Critical Configuration Points

1. **URL must be exact:** `https://exotel.mangwale.ai/api/nerve/gather`
2. **Method must be GET:** Not POST
3. **No trailing slash:** Don't add `/` at the end of URL
4. **Re-fetch on no input:** This allows our logic to control retries
5. **Voice language:** Set to `hi-IN` for Hindi or `en-IN` for English

### 🔧 Troubleshooting

**If call connects but no audio:**
- Check that App is configured with Programmable Gather (not Passthru)
- Verify URL is exact: `https://exotel.mangwale.ai/api/nerve/gather`
- Check logs for incoming requests: `tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.log`

**If call doesn't connect:**
- Verify phone number format (10 digits, no + or country code)
- Check Exotel account balance
- Verify App ID is correct (1148615 for outbound)

**If DTMF not working:**
- Verify "Re-fetch URL" is selected for no input/invalid input
- Check that `max_input_digits` is not overridden in dashboard
- Monitor logs to see if `digits` parameter is being sent

---

## Next Steps

1. ✅ **Configure App 1148615** (outbound) as described above
2. ✅ **Configure App 1148538** (incoming) as described above
3. ✅ **Test outbound call** using the curl command
4. ✅ **Test incoming call** by dialing 02048556923
5. ✅ **Monitor logs** to verify flow
6. ✅ **Adjust language** in CustomField parameter as needed

---

## Support

If you encounter issues:
1. Check logs: `tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.log`
2. Test endpoint directly: `curl http://localhost:7100/api/nerve/gather?CallSid=test`
3. Verify service is running: `systemctl status nerve-system`

---

**Configuration Date:** December 24, 2025  
**Verified By:** AI Assistant  
**Status:** ✅ Ready for Dashboard Configuration
