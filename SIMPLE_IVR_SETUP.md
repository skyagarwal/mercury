# Simple IVR Setup Guide for Exotel

## Overview

This guide explains how to create simple, static IVR flows in Exotel Dashboard that work without external callbacks. We use Exotel's built-in Gather applet with static audio/TTS.

---

## VENDOR ORDER CONFIRMATION FLOW

### Flow Diagram

```
[Start]
    ↓
[Greeting - Gather #1]
"नमस्ते, आपके लिए एक नया ऑर्डर आया है।
 कन्फर्म के लिए 1, ऐप चेक के लिए 2, 
 कैंसल के लिए 3, दोबारा सुनने के लिए 0 दबाएं।"
    ↓
┌─────────────────────────────────────────────────────┐
│                                                     │
│  [1] CONFIRM → [Gather #2 - Prep Time]              │
│       "धन्यवाद! खाना कितने मिनट में तैयार होगा?       │
│        15 मिनट के लिए 1, 30 मिनट के लिए 2,          │
│        45 मिनट के लिए 3 दबाएं।"                      │
│           ↓                                         │
│       [1] → "धन्यवाद! राइडर 15 मिनट में आएगा।" → END │
│       [2] → "धन्यवाद! राइडर 30 मिनट में आएगा।" → END │
│       [3] → "धन्यवाद! राइडर 45 मिनट में आएगा।" → END │
│                                                     │
│  [2] CHECK APP                                      │
│       "ठीक है, ऐप चेक करें। 2 मिनट में              │
│        दोबारा कॉल आएगी।" → END                       │
│                                                     │
│  [3] CANCEL                                         │
│       "ऑर्डर कैंसल हो गया। धन्यवाद!" → END           │
│                                                     │
│  [0] REPEAT → Loop back to Greeting                 │
│                                                     │
│  [Timeout/Invalid] → END with message               │
└─────────────────────────────────────────────────────┘
```

### Exotel Dashboard Setup

#### Step 1: Create New App
1. Login to Exotel Dashboard
2. Go to **App Bazaar** → **Create New Flow**
3. Name: `Mangwale-Vendor-v1`

#### Step 2: Build the Flow

**Option A: Using Gather Applet with TTS**

1. Drag **Gather** applet
2. Configure:
   - **Prompt Type**: TTS
   - **TTS Text**: `नमस्ते, आपके लिए एक नया ऑर्डर आया है। कन्फर्म के लिए 1 दबाएं। ऐप चेक के लिए 2 दबाएं। कैंसल के लिए 3 दबाएं। दोबारा सुनने के लिए 0 दबाएं।`
   - **TTS Language**: Hindi
   - **Max Digits**: 1
   - **Timeout**: 15 seconds

3. Add branches for each key:
   - **Key 1**: Connect to another Gather for prep time
   - **Key 2**: Connect to Play + Hangup
   - **Key 3**: Connect to Play + Hangup  
   - **Key 0**: Loop back to same Gather
   - **Timeout**: Connect to Play + Hangup

**Option B: Using Passthru (for dynamic responses)**

1. Drag **Passthru** applet
2. URL: `https://exotel.mangwale.ai/api/nerve/callback`
3. Method: POST
4. This returns ExoML for dynamic IVR

---

## DRIVER ASSIGNMENT FLOW

### Flow Diagram

```
[Start]
    ↓
[Greeting - Gather]
"नमस्ते, आपके लिए एक डिलीवरी है।
 एक्सेप्ट के लिए 1, रिजेक्ट के लिए 2,
 दोबारा सुनने के लिए 0 दबाएं।"
    ↓
┌─────────────────────────────────────────────────────┐
│                                                     │
│  [1] ACCEPT                                         │
│       "धन्यवाद! पिकअप एड्रेस ऐप में है।             │
│        जल्दी पहुंचें!" → END                         │
│                                                     │
│  [2] REJECT                                         │
│       "ठीक है, दूसरे राइडर को असाइन करेंगे।         │
│        धन्यवाद!" → END                               │
│                                                     │
│  [0] REPEAT → Loop back to Greeting                 │
│                                                     │
│  [Timeout] → END with message                       │
└─────────────────────────────────────────────────────┘
```

---

## TTS Prompts (Hindi)

### Vendor Prompts

| ID | Prompt | Hindi Text |
|----|--------|------------|
| V1 | Greeting | नमस्ते, आपके लिए एक नया ऑर्डर आया है। कन्फर्म के लिए 1 दबाएं। ऐप चेक के लिए 2 दबाएं। कैंसल के लिए 3 दबाएं। दोबारा सुनने के लिए 0 दबाएं। |
| V2 | Prep Time | धन्यवाद! खाना कितने मिनट में तैयार होगा? 15 मिनट के लिए 1 दबाएं। 30 मिनट के लिए 2 दबाएं। 45 मिनट के लिए 3 दबाएं। |
| V3 | Confirm 15 | धन्यवाद! ऑर्डर कन्फर्म हो गया। राइडर 15 मिनट में पहुंचेगा। शुभ दिन! |
| V4 | Confirm 30 | धन्यवाद! ऑर्डर कन्फर्म हो गया। राइडर 30 मिनट में पहुंचेगा। शुभ दिन! |
| V5 | Confirm 45 | धन्यवाद! ऑर्डर कन्फर्म हो गया। राइडर 45 मिनट में पहुंचेगा। शुभ दिन! |
| V6 | Check App | ठीक है, कृपया ऐप चेक करें। आपको 2 मिनट में दोबारा कॉल आएगी। |
| V7 | Cancel | ऑर्डर कैंसल हो गया। हम किसी और को यह ऑर्डर देंगे। धन्यवाद! |
| V8 | No Input | कोई इनपुट नहीं मिला। ऑर्डर कैंसल हो रहा है। धन्यवाद! |

### Driver Prompts

| ID | Prompt | Hindi Text |
|----|--------|------------|
| D1 | Greeting | नमस्ते, आपके लिए एक डिलीवरी है। एक्सेप्ट के लिए 1 दबाएं। रिजेक्ट के लिए 2 दबाएं। दोबारा सुनने के लिए 0 दबाएं। |
| D2 | Accept | धन्यवाद! पिकअप एड्रेस ऐप में है। जल्दी पहुंचें! शुभ दिन! |
| D3 | Reject | ठीक है, दूसरे राइडर को असाइन करेंगे। धन्यवाद! |
| D4 | No Input | कोई इनपुट नहीं मिला। दूसरे राइडर को असाइन करेंगे। |

---

## How to Capture DTMF Response

Exotel sends DTMF input to **StatusCallback** URL with these parameters:
- `CallSid`: Unique call ID
- `digits`: What user pressed
- `Status`: Call status

### Update StatusCallback Handler

Our `/api/nerve/status` endpoint already receives:
```json
{
  "CallSid": "abc123",
  "Status": "completed",
  "digits": "1"  // What was pressed
}
```

We can use `digits` to determine outcome:
- Vendor: `1` = confirmed, `2` = retry needed, `3` = cancelled
- Driver: `1` = accepted, `2` = rejected

---

## Quick Start

### Option 1: Pure Exotel (No Callback Needed)

1. Create IVR flow in Exotel Dashboard
2. Use Exotel's built-in Gather + TTS
3. Get App ID (e.g., `1234567`)
4. Update `.env`: `IVR_APP_ID=1234567`
5. Make call - flow runs entirely in Exotel

### Option 2: Hybrid (Status Callback Only)

1. Create simple IVR in Exotel
2. Set StatusCallback to `https://exotel.mangwale.ai/api/nerve/status`
3. Parse `digits` in status callback to know outcome
4. No Programmable Gather needed!

---

## Testing

```bash
# Initiate vendor call
curl -X POST "http://localhost:7100/api/nerve/vendor-order-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_name": "Test Restaurant",
    "vendor_phone": "919923383838",
    "order_id": 12345,
    "order_amount": 250
  }'
```

Watch logs:
```bash
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | grep -E "Status|digits"
```

---

## Next Steps

1. ✅ Create Vendor IVR App in Exotel
2. ✅ Create Driver IVR App in Exotel  
3. ✅ Update `.env` with App IDs
4. ✅ Test calls
5. Later: Add dynamic features via Programmable Gather
