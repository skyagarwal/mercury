# Exotel Gather Applet (Dynamic URL) Integration

## Status (Dec 2025)

We are using Exotel **Gather Applet (Dynamic URL + JSON)** with Exotel Flow/App **ID: 1149178**.

Key design decision:
- For reliability/latency, the webhook returns **text-only** (`gather_prompt.text`) so Exotel speaks it using **built-in Exotel TTS**.
- We do **not** generate WAV inside the webhook because server-side TTS generation can take long enough that the call ends before audio is ready.
- For Hindi, we use **Hinglish (Latin script)** in the JSON response because Exotel TTS can sound unclear/garbled with Devanagari depending on dashboard voice settings.

Backend handler:
- `escotel-stack/exotel-service/nerve_system.py` → endpoint `/api/nerve/gather`

## Overview

This document describes how to set up Exotel’s **Gather Applet** (the UI in your screenshot) using a **Primary URL** that returns JSON (`gather_prompt`, `max_input_digits`, etc.).

## Why Gather (Dynamic URL)?

The old IVR App (ID: 1077337) had **static English audio** baked in. The passthru URL wasn't being called correctly.

The Gather Applet solves this by:
1. Calling our URL to fetch gather parameters (prompt + DTMF settings)
2. Exotel plays the prompt using built-in TTS (when we send `gather_prompt.text`)
3. Exotel gathers keypad digits and then moves to the **next applet** as per the flow builder

Important nuance (based on Exotel’s Gather Applet behavior):
- You **must** configure flow transitions (“below applet”) regardless of using a Primary URL.
- For multi-step IVR, Exotel will not keep calling the *same* Gather widget forever; you need to **chain multiple Gather widgets**.

## Endpoint: `/api/nerve/gather`

**Production URL:**
```
https://exotel.mangwale.ai/api/nerve/gather
```

### Critical: Primary URL must be HTTPS (no redirects)

In Exotel’s Gather Applet, set **Primary URL** to the **HTTPS** URL above.

Do **not** set Primary URL to `http://exotel.mangwale.ai/api/nerve/gather`.
That endpoint returns an HTTP `301` redirect to HTTPS, and Exotel may not follow redirects reliably for webhook calls (which can look like “no webhook hits”).

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

## Exotel Dashboard Setup (matches your screenshot)

### Step 1: Open Flow/App 1149178

1. Login to **Exotel Dashboard**
2. Open your flow/app **1149178** in the flow builder

### Step 2: Build the correct applet chain

Use this exact canvas (this is the key missing piece):

`Call Start` → `Gather (Step 1)` → `Gather (Step 2)` → `Hangup`

Why: after the caller enters digits in Gather Step 1, Exotel will **redirect to the below applet**. The below applet must be another Gather (Step 2), so Exotel calls your Primary URL again and includes the previous digit in `digits`.

**Gather (Step 1) config**
- Choose: **Configure parameters dynamically by providing a URL**
- Primary URL: `https://exotel.mangwale.ai/api/nerve/gather`
- Fallback URL: optional (can be blank)
- “When the caller entered one or more input digits” → **Redirect to below applet** → select **Gather (Step 2)**

**Gather (Step 2) config**
- Choose: **Configure parameters dynamically by providing a URL**
- Primary URL: `https://exotel.mangwale.ai/api/nerve/gather`
- Fallback URL: optional (can be blank)
- “When the caller entered one or more input digits” → **Redirect to below applet** → select **Hangup**

### Critical: “When the caller entered digits … Redirect to below applet”

This is the most common cause of:
- “I pressed 1 and call disconnected”
- “I never got the prep-time question”

In your screenshot, Exotel’s Gather Applet explicitly says it will **redirect to the below applet** after digits.

That is correct — but it only works if the below applet is another **Gather** that also has the Primary URL set.

Expected behavior becomes:
1) Exotel calls our URL (Gather Step 1) with no digits → we return greeting JSON
2) User presses `1` or `0`
3) Exotel moves to Gather Step 2 and calls our URL again, now including `digits="1"` or `digits="0"`
4) We return the next prompt JSON (prep-time or goodbye)
5) If still gathering, user presses digit again → then Exotel redirects to Hangup

### Step 3: Save

Click **SAVE** in the top-right.

### Step 4: Confirm the outbound call points to 1149178

Our outbound API call should point to:

`Url=http://my.exotel.com/<account_sid>/exoml/start_voice/1149178`

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

## Alternative (if you want digit-specific branching)

If you need different next steps for different digits *within Exotel’s flow builder* (instead of server-side state), use an **IVR Menu** applet.

For our current approach (server-side state machine), chaining Gather Step 1 → Gather Step 2 → Hangup is the simplest.

## Debugging

### Check logs:
```bash
tail -f /tmp/nerve-system.log | grep -E "gather|DTMF"
```

In production on this server, logs are typically in:
```bash
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | grep -E "Programmable Gather|DTMF|CallSid"
```

### Test endpoint directly:
```bash
# Initial greeting
curl "http://localhost:7100/api/nerve/gather?CallSid=test&CustomField=%7B%22order_id%22%3A123%7D"

# Accept (digit=1)
curl "http://localhost:7100/api/nerve/gather?CallSid=test&digits=1"
```

## End-to-End Test Checklist (Recommended)

Goal: validate the complete flow is stable before any audio optimizations.

1) Place a call via Exotel `Calls/connect` to App `1149178`.
2) Answer the call.
3) Listen for greeting: “Accept ke liye 1… Cancel ke liye 0…”.
4) Press `1`.
5) You should hear prep-time prompt: “Khana kitne minute… 15=1, 30=2, 45=3…”.
6) Press `2`.
7) You should hear goodbye: “Rider 30 minute me aayega…”.

If step (4) works in logs but you do not hear step (5): this is almost always an Exotel IVR applet setting issue (see “After Digits Entered”).

## Troubleshooting Guide

### Symptom: Greeting plays, but call disconnects after pressing 1

What it means:
- Our server *did* receive `digits=1` and returned the prep-time prompt, but Exotel did not play it.

What to check in Exotel:
- Gather (Step 1) → “When the caller entered one or more input digits” must **Redirect to below applet**.
- The “below applet” must be **Gather (Step 2)** (not Hangup), and Gather (Step 2) must also have the **HTTPS Primary URL** set.
- Ensure you clicked **SAVE** in the top-right after wiring the chain.

### Symptom: No digits reach the backend

What to check:
- Exotel applet is actually **Gather (Dynamic URL / Programmable Gather)** (not classic Gather/Passthru).
- Primary URL points to `https://exotel.mangwale.ai/api/nerve/gather` (HTTPS, no redirects).
- Increase `input_timeout` if users take longer to press keys.

## Optional Next Step (Option B): Pre-generate Audio Before Dialing

If you want higher-quality, consistent audio (especially for Hindi), we can do this without slowing the webhook:

Approach:
1) Before calling Exotel `Calls/connect`, generate greeting audio using our TTS service.
2) Upload it (MinIO or our audio endpoint).
3) Pass the URL in `CustomField` (example key: `greeting_audio_url`).
4) In `/api/nerve/gather`, if `greeting_audio_url` exists and digits are empty, respond with:
  - `gather_prompt.audio_url` (instead of `gather_prompt.text`).

This keeps the webhook fast while improving audio quality.

Note:
- We previously observed Exotel may probe audio URLs with `HEAD` and may be sensitive to latency/headers; if we go this route, we must ensure the audio URL is immediately available and returns correct `Content-Type`/`Content-Length`.

## Notes

- `order_id` must be **integer**, not string
- State is tracked in-memory by `CallSid`
- Exotel uses same `CallSid` across all callbacks for a single call
- TTS language is controlled by Exotel's Programmable Gather applet settings
