# Exotel Programmable Gather Integration

## Overview

This document describes how to set up **Programmable Gather** applet in Exotel to enable dynamic Hindi TTS for vendor order confirmation calls.

## Why Programmable Gather?

The old IVR App (ID: 1077337) had **static English audio** baked in. The passthru URL wasn't being called correctly.

**Programmable Gather** solves this by:
1. Calling our URL on every interaction
2. We return JSON with the text to speak
3. Exotel's built-in TTS speaks our text in Hindi
4. We control the entire conversation flow dynamically

## Endpoint: `/api/nerve/gather`

**Production URL:**
```
https://exotel.mangwale.ai/api/nerve/gather
```

### Request Parameters (from Exotel)

| Parameter | Description |
|-----------|-------------|
| `CallSid` | Unique call identifier |
| `CallFrom` | Caller's phone number |
| `CallTo` | Called phone number |
| `digits` | DTMF input from user |
| `CustomField` | JSON encoded context (order_id, vendor_name, etc.) |
| `CurrentTime` | Timestamp from Exotel |

### Response Format

```json
{
  "gather_prompt": {
    "text": "Hindi text to speak via TTS"
  },
  "max_input_digits": 1,
  "finish_on_key": "",
  "input_timeout": 15,
  "repeat_menu": 2,
  "repeat_gather_prompt": {
    "text": "Repeat prompt if no input"
  }
}
```

To end the call (no more gathering):
```json
{
  "gather_prompt": {"text": "Goodbye message"},
  "max_input_digits": 0,
  "input_timeout": 1
}
```

## Call Flow

```
1. GREETING (no digits)
   → Returns: "नमस्ते [Vendor], ऑर्डर [ID] आया है। स्वीकार करें: 1, रद्द: 0"
   
2. USER PRESSES 1 (accept)
   → Returns: "धन्यवाद! समय: 15min=1, 30min=2, 45min=3"
   
3. USER PRESSES 2 (30 min)
   → Returns: "राइडर 30 मिनट में आएगा। शुभ दिन!"
   → max_input_digits=0 (call ends)

OR

2. USER PRESSES 0 (reject)
   → Returns: "किसी और को ऑर्डर देंगे। धन्यवाद!"
   → max_input_digits=0 (call ends)
```

## Exotel Dashboard Setup

### Step 1: Create New IVR App

1. Login to **Exotel Dashboard**
2. Go to **IVR** → **Create New App**
3. Name it: `Mangwale-Programmable-Gather`

### Step 2: Add Programmable Gather Applet

1. Drag **Programmable Gather** applet onto canvas
2. Configure:
   - **URL**: `https://exotel.mangwale.ai/api/nerve/gather`
   - **HTTP Method**: GET
   - **Voice (for TTS)**: `hi-IN` or `hi-IN-Standard-A`
   - **Max Retries**: 2
   - **No Input Action**: Re-fetch URL
   - **Invalid Input Action**: Re-fetch URL

### Step 3: Add Start Applet

1. Connect **Start** to **Programmable Gather**
2. No other configuration needed

### Step 4: Get App ID

1. After saving, note the **App ID** (e.g., `1234567`)
2. Update `nerve_system.py`:
   ```python
   IVR_APP_ID = ivr_app_id or "NEW_APP_ID"  # Replace with actual ID
   ```

### Step 5: Test

```bash
# Initiate test call
curl -X POST "http://localhost:7100/api/nerve/initiate-call" \
  -H "Content-Type: application/json" \
  -d '{
    "to_phone": "9923383838",
    "custom_field": {
      "order_id": 12345,
      "vendor_name": "Test Vendor",
      "total": 250,
      "language": "hi"
    }
  }'
```

## Tested Flows (2025-12-18)

✅ **Accept Flow:**
```
Step 1: Greeting → "नमस्ते Test Vendor, यह मंगवाले से कॉल है..."
Step 2: Press 1 → "धन्यवाद! खाना तैयार करने में कितने मिनट..."
Step 3: Press 2 → "धन्यवाद! राइडर 30 मिनट में पहुंचेगा। शुभ दिन!"
```

✅ **Reject Flow:**
```
Step 1: Greeting → "नमस्ते Reject Vendor, यह मंगवाले से कॉल है..."
Step 2: Press 0 → "हम किसी और को यह ऑर्डर देंगे। धन्यवाद! शुभ दिन।"
```

## Alternative: Using Passthru

If Programmable Gather isn't available, use **Passthru** applet:

1. Create flow: Start → Passthru
2. Passthru URL: `https://exotel.mangwale.ai/api/nerve/callback`
3. This returns ExoML XML instead of JSON

## Debugging

### Check logs:
```bash
tail -f /tmp/nerve-system.log | grep -E "gather|DTMF"
```

### Test endpoint directly:
```bash
# Initial greeting
curl "http://localhost:7100/api/nerve/gather?CallSid=test&CustomField=%7B%22order_id%22%3A123%7D"

# Accept (digit=1)
curl "http://localhost:7100/api/nerve/gather?CallSid=test&digits=1"
```

## Notes

- `order_id` must be **integer**, not string
- State is tracked in-memory by `CallSid`
- Exotel uses same `CallSid` across all callbacks for a single call
- TTS language is controlled by Exotel's Programmable Gather applet settings
