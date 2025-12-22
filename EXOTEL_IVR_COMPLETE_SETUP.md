# Exotel IVR Setup - Complete Guide

## Audio Files Ready

All audio files have been generated and are available at:
- **Mercury**: `http://192.168.0.151:8888/vendor-8k/` and `http://192.168.0.151:8888/driver-8k/`
- **Path**: `/home/ubuntu/mangwale-voice/ivr-audio/`

---

## VENDOR IVR AUDIO FILES (9 files)

| File | Purpose | Hindi Text |
|------|---------|------------|
| V01_greeting.wav | Main menu | नमस्ते, आपके लिए नया ऑर्डर है। कन्फर्म के लिए 1। ऐप चेक के लिए 2। कैंसल के लिए 3। दोबारा सुनने के लिए 0 दबाएं। |
| V02_prep_time.wav | Ask prep time | धन्यवाद! खाना कितने मिनट में तैयार होगा? 15 मिनट के लिए 1। 30 मिनट के लिए 2। 45 मिनट के लिए 3 दबाएं। |
| V03_confirm_15.wav | 15 min confirm | धन्यवाद! राइडर 15 मिनट में आएगा। शुभ दिन! |
| V04_confirm_30.wav | 30 min confirm | धन्यवाद! राइडर 30 मिनट में आएगा। शुभ दिन! |
| V05_confirm_45.wav | 45 min confirm | धन्यवाद! राइडर 45 मिनट में आएगा। शुभ दिन! |
| V06_check_app.wav | Check app later | ठीक है, ऐप चेक करें। 2 मिनट में दोबारा कॉल आएगी। |
| V07_cancel.wav | Order cancelled | ऑर्डर कैंसल हो गया। धन्यवाद! |
| V08_no_input.wav | Timeout message | कोई इनपुट नहीं मिला। कृपया दोबारा कोशिश करें। |
| V09_invalid.wav | Invalid input | गलत इनपुट। कृपया 1, 2, या 3 दबाएं। |

---

## DRIVER IVR AUDIO FILES (4 files)

| File | Purpose | Hindi Text |
|------|---------|------------|
| D01_greeting.wav | Main menu | नमस्ते, आपके लिए डिलीवरी है। एक्सेप्ट के लिए 1। रिजेक्ट के लिए 2। दोबारा सुनने के लिए 0 दबाएं। |
| D02_accept.wav | Accepted | धन्यवाद! पिकअप एड्रेस ऐप में है। जल्दी पहुंचें! शुभ दिन! |
| D03_reject.wav | Rejected | ठीक है, दूसरे राइडर को देंगे। धन्यवाद! |
| D04_no_input.wav | Timeout | कोई इनपुट नहीं मिला। दूसरे राइडर को देंगे। |

---

## EXOTEL DASHBOARD SETUP

### Step 1: Upload Audio Files to Exotel

1. Login to Exotel Dashboard
2. Go to **Resources** → **Audio Library** (or similar)
3. Upload all 13 .wav files from the 8k folders
4. Name them exactly as the filenames (V01_greeting, etc.)

### Step 2: Create Vendor IVR App

1. Go to **App Bazaar** → **Create New Flow**
2. Name: `Mangwale-Vendor-v1`
3. Build this flow:

```
                    ┌─────────────────────────────────────┐
                    │              START                  │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     GATHER #1: Main Menu            │
                    │     Audio: V01_greeting.wav         │
                    │     Max Digits: 1                   │
                    │     Timeout: 15s                    │
                    └──┬───────┬───────┬───────┬─────────┘
                       │       │       │       │
            ┌──────────┘       │       │       └─────────────────┐
            │                  │       │                         │
     [Key 1]│           [Key 2]│       │[Key 3]           [Key 0]│
            │                  │       │                         │
            ▼                  ▼       ▼                         │
┌───────────────────┐  ┌────────────┐  ┌────────────┐            │
│ GATHER #2:        │  │ PLAY:      │  │ PLAY:      │            │
│ Prep Time         │  │ V06_check  │  │ V07_cancel │            │
│ V02_prep_time.wav │  │ → HANGUP   │  │ → HANGUP   │            │
│ Max Digits: 1     │  └────────────┘  └────────────┘            │
└─┬─────┬─────┬─────┘                                            │
  │     │     │                                                  │
  │[1]  │[2]  │[3]                                               │
  ▼     ▼     ▼                                                  │
┌────┐┌────┐┌────┐                                               │
│V03 ││V04 ││V05 │                                               │
│15m ││30m ││45m │                                               │
│END ││END ││END │                                               │
└────┘└────┘└────┘                          ┌────────────────────┘
                                            │
                                            ▼
                                    (Loop to GATHER #1)

[Timeout/No Input] → PLAY: V08_no_input → HANGUP
[Invalid Input]    → PLAY: V09_invalid → Loop to same GATHER
```

### Exotel Flow Details:

**GATHER #1 (Main Menu)**
- Prompt: Upload V01_greeting.wav
- Max digits: 1
- Timeout: 15 seconds
- Key mapping:
  - 1 → Go to GATHER #2 (Prep Time)
  - 2 → Play V06_check_app → Hangup
  - 3 → Play V07_cancel → Hangup
  - 0 → Loop back to GATHER #1
  - Timeout → Play V08_no_input → Hangup

**GATHER #2 (Prep Time) - after Key 1**
- Prompt: Upload V02_prep_time.wav
- Max digits: 1
- Timeout: 10 seconds
- Key mapping:
  - 1 → Play V03_confirm_15 → Hangup
  - 2 → Play V04_confirm_30 → Hangup
  - 3 → Play V05_confirm_45 → Hangup
  - Timeout → Play V08_no_input → Hangup

### Step 3: Create Driver IVR App

1. Go to **App Bazaar** → **Create New Flow**
2. Name: `Mangwale-Driver-v1`
3. Build this flow:

```
                    ┌─────────────────────────────────────┐
                    │              START                  │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     GATHER: Main Menu               │
                    │     Audio: D01_greeting.wav         │
                    │     Max Digits: 1                   │
                    │     Timeout: 15s                    │
                    └──┬───────┬───────────┬──────────────┘
                       │       │           │
            ┌──────────┘       │           └──────────────┐
            │                  │                          │
     [Key 1]│           [Key 2]│                   [Key 0]│
            │                  │                          │
            ▼                  ▼                          │
    ┌────────────┐     ┌────────────┐                     │
    │ PLAY:      │     │ PLAY:      │                     │
    │ D02_accept │     │ D03_reject │                     │
    │ → HANGUP   │     │ → HANGUP   │                     │
    └────────────┘     └────────────┘                     │
                                          ┌───────────────┘
                                          │
                                          ▼
                                  (Loop to GATHER)

[Timeout] → PLAY: D04_no_input → HANGUP
```

### Step 4: Get App IDs and Update Config

After saving both apps:
1. Note the **Vendor App ID** (e.g., `1234567`)
2. Note the **Driver App ID** (e.g., `1234568`)

Update `/home/ubuntu/mangwale-voice/escotel-stack/exotel-service/.env`:
```
IVR_APP_ID=1234567          # Vendor App ID
DRIVER_IVR_APP_ID=1234568   # Driver App ID
```

---

## HOW IT WORKS

### Call Flow (System → Vendor)

1. **Jupiter** sends order to Nerve System
2. **Nerve** initiates call via Exotel API with:
   - `From`: Vendor's phone
   - `Url`: `http://my.exotel.com/{sid}/exoml/start_voice/{app_id}`
   - `StatusCallback`: `https://exotel.mangwale.ai/api/nerve/status`
3. **Exotel** calls vendor, runs IVR app
4. **Vendor** hears greeting, presses keys
5. **Exotel** handles flow internally
6. When call ends, **StatusCallback** reports result

### Capturing User Input

The tricky part: **How do we know what the vendor chose?**

**Option A: Passthru at End (Recommended)**
- After each terminal action (confirm/cancel), add a **Passthru** applet
- URL: `https://exotel.mangwale.ai/api/nerve/outcome?action=confirmed_15` (etc.)
- This calls our endpoint with the outcome

**Option B: Parse Recording**
- Enable call recording
- Process recording to determine outcome
- Slower, but works without modifying flow

**Option C: Different Apps**
- Create separate apps for each outcome
- Use Passthru to call different endpoints
- Complex but clean tracking

---

## QUICK TEST

Once app is created:

```bash
# Test vendor call
curl -X POST "http://localhost:7100/api/nerve/vendor-order-confirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_name": "Test Vendor",
    "vendor_phone": "919923383838",
    "order_id": 12345,
    "order_amount": 250
  }'
```

---

## NEXT STEPS

1. ✅ Audio files generated (13 files)
2. ⬜ Upload audio to Exotel
3. ⬜ Create Vendor IVR app
4. ⬜ Create Driver IVR app
5. ⬜ Update .env with App IDs
6. ⬜ Add Passthru for outcome tracking
7. ⬜ Test end-to-end flow
