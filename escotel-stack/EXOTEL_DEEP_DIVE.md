# Exotel Deep Dive - Complete API Analysis & Integration Strategy

## Executive Summary

After extensive research into Exotel's APIs, I've identified **THREE VIABLE APPROACHES** for the Mangwale AI Voice IVR system. Our current implementation is fundamentally broken because we're using the wrong API approach.

---

## 🔍 Current Problem Analysis

### What's Happening Now:
1. We're using the **"Outgoing call to connect number to a call flow"** API
2. We set `Url` parameter to point to IVR App ID: `http://my.exotel.com/exoml/start_voice/1077337`
3. The IVR App (IVR-DTMF-TEST) has its own **static audio greetings** hard-coded
4. When user presses 1, Exotel's IVR is supposed to do "passthru" to our URL
5. **But**: The IVR App is playing its own "order confirmed" message - NOT calling our endpoint!

### Root Cause:
The IVR App was built with static audio flows in Exotel's flow builder. The "passthru" URL we configured may be:
- Not configured correctly in the IVR App
- Being overridden by the IVR App's internal logic
- The IVR App finishes the call before calling passthru

---

## 📚 Exotel API Capabilities (Complete Analysis)

### 1. Voice API v1 - Make a Call

#### Option A: Connect Two Numbers
```
POST /v1/Accounts/{sid}/Calls/connect
```
- Connects `From` number to `To` number
- Both parties talk to each other
- ❌ **Not suitable** - We need IVR, not call bridging

#### Option B: Connect to Call Flow (Our Current Approach)
```
POST /v1/Accounts/{sid}/Calls/connect
Parameters:
- From: Phone to call
- CallerId: Virtual number
- Url: http://my.exotel.com/{sid}/exoml/start_voice/{app_id}
- CustomField: JSON data
```
- Calls `From` number, then connects to IVR flow
- **Problem**: Flow is pre-built in Exotel dashboard with static audio
- ⚠️ **Current approach** - Works but IVR is static

### 2. Voice API v3 (Beta) - More Modern

```
POST /v3/accounts/{sid}/calls
Parameters:
- from.contact_uri: Phone to call  
- to.contact_uri: Number to connect (for C2C)
- virtual_number: ExoPhone
- status_callback: Webhook for events
```
- Still focused on Click-to-Call
- ❌ **No dynamic ExoML support** mentioned

### 3. Applets (Flow Builder)

Exotel uses a drag-and-drop flow builder with these applets:
- **Greeting**: Static audio playback
- **Gather**: Collect DTMF (can be dynamic via URL!)
- **Passthru**: Send call data to webhook, control flow based on response
- **Connect**: Bridge to another number
- **Voicebot**: **🔥 BIDIRECTIONAL WEBSOCKET STREAMING!**

### 4. 🔥 Programmable Gather (Key Discovery!)

The **Programmable Gather** applet allows dynamic configuration via URL:

```json
// Request FROM Exotel (GET to your URL):
?CallSid=xxx&CallFrom=xxx&CallTo=xxx&digits=xxx&CustomField=xxx

// Response TO Exotel:
{
  "gather_prompt": {
    "text": "Namaste! Aapke paas naya order hai..."
  },
  "max_input_digits": 2,
  "finish_on_key": "#",
  "input_timeout": 10
}
```

This is exactly what we need! We can:
1. Build a simple flow in Exotel: `Programmable Gather → Passthru → ...`
2. Our URL returns the **dynamic Hindi TTS text**
3. Exotel converts text to speech and plays it
4. DTMF comes back to Passthru for processing

### 5. 🔥🔥 Voicebot Applet (Most Powerful!)

**Bidirectional WebSocket Streaming** - This is the ULTIMATE solution:

```
Flow: Voicebot Applet (wss://your-server/voicebot)
```

Exotel sends real-time audio over WebSocket:
```json
{
  "event": "media",
  "stream_sid": "xxx",
  "media": {
    "payload": "base64_audio_PCM_16bit_8khz"
  }
}
```

Your server responds with audio to play:
```json
{
  "event": "media",
  "stream_sid": "xxx", 
  "media": {
    "payload": "base64_audio_response"
  }
}
```

Features:
- Real-time ASR on caller's speech
- Stream TTS responses back
- Handle interruptions (barge-in)
- Full AI conversation flow
- DTMF events also supported

---

## 🏗️ Recommended Architecture Options

### Option 1: Programmable Gather + Passthru (Simplest Fix)

**Create NEW flow in Exotel Dashboard:**
```
[START] → [Programmable Gather (URL: our-server)] → [Passthru] → [Programmable Gather] → [Passthru] → [Hangup]
```

**Our Server Implementation:**
```python
@app.get("/api/voice/gather")
async def dynamic_gather(CallSid: str, digits: str = None, CustomField: str = None):
    """Dynamic Gather - return prompt text for Exotel TTS"""
    
    if not digits:
        # First call - return greeting
        return {
            "gather_prompt": {
                "text": "नमस्ते! आपके पास नया ऑर्डर है। स्वीकार करने के लिए 1 दबाएं, अस्वीकार के लिए 0 दबाएं।"
            },
            "max_input_digits": 1,
            "input_timeout": 15
        }
    
    if digits == "1":
        return {
            "gather_prompt": {
                "text": "ऑर्डर स्वीकार! तैयारी का समय बताएं - 15 के लिए 1, 30 के लिए 2, 45 के लिए 3 दबाएं।"
            },
            "max_input_digits": 1,
            "input_timeout": 15
        }
    # etc.
```

**Pros:**
- Quick to implement
- Uses Exotel's built-in TTS (Google voices)
- Minimal infrastructure changes

**Cons:**
- Limited to Exotel's TTS quality
- No custom voice/speed control
- Flow still needs manual setup in dashboard

---

### Option 2: Voicebot WebSocket (Full AI Power) ⭐ RECOMMENDED

**Create NEW flow in Exotel:**
```
[START] → [Voicebot Applet (wss://exotel.mangwale.ai/voicebot)]
```

**Our Server Implementation:**
```python
from fastapi import WebSocket

@app.websocket("/voicebot")
async def voicebot_handler(websocket: WebSocket):
    await websocket.accept()
    
    call_state = {}
    
    async for message in websocket.iter_json():
        event = message.get("event")
        
        if event == "start":
            # Call started - send greeting audio
            call_info = message.get("start", {})
            call_sid = call_info.get("call_sid")
            custom_params = call_info.get("custom_parameters", {})
            
            # Generate greeting TTS
            greeting_audio = await generate_tts("नमस्ते! आपके पास नया ऑर्डर है...")
            
            # Send audio to caller
            await websocket.send_json({
                "event": "media",
                "stream_sid": message.get("stream_sid"),
                "media": {
                    "payload": base64.b64encode(greeting_audio).decode()
                }
            })
            
        elif event == "dtmf":
            # User pressed a key
            digit = message.get("dtmf", {}).get("digit")
            # Process DTMF, send response audio
            
        elif event == "media":
            # Real-time audio from caller - can do ASR!
            audio_data = base64.b64decode(message["media"]["payload"])
            # Process with Whisper ASR for voice commands
            
        elif event == "stop":
            # Call ended
            break
```

**Pros:**
- Full control over TTS/ASR
- Use our own AI4Bharat/IndicParler TTS (natural Hindi)
- Real-time conversation capability
- Can handle voice commands (not just DTMF)
- Most flexible for future AI features

**Cons:**
- More complex implementation
- Need to handle WebSocket connection management
- Audio format conversion (PCM 8kHz ↔ our TTS format)

---

### Option 3: Hybrid - Passthru with Audio URLs

**Flow in Exotel:**
```
[START] → [Greeting (Audio URL)] → [Gather] → [Passthru] → [Switch] → ...
```

**Our Server:**
1. Pre-generate TTS audio files
2. Host them publicly (S3 or our server)
3. Greeting applet uses audio URL from our server
4. Passthru for DTMF processing

```python
@app.get("/api/voice/audio/greeting/{order_id}.wav")
async def get_greeting_audio(order_id: int):
    """Return pre-generated greeting audio"""
    audio_path = await generate_and_cache_audio(order_id)
    return FileResponse(audio_path, media_type="audio/wav")
```

**Pros:**
- Our own TTS quality
- Simpler than WebSocket

**Cons:**
- Audio must be pre-generated
- Latency from HTTP fetch
- Requires audio hosting

---

## 🎯 Recommended Implementation Plan

### Phase 1: Quick Fix (1-2 hours)
1. Create NEW Exotel flow with **Programmable Gather + Passthru**
2. Configure our endpoint as the dynamic URL
3. Return JSON with TTS text for Exotel to speak
4. Test end-to-end

### Phase 2: Full Voicebot (1-2 days)
1. Enable Voicebot applet for our account (contact Exotel if needed)
2. Implement WebSocket handler
3. Integrate our TTS service (generate PCM audio)
4. Add ASR for voice commands (optional)

---

## 📋 Action Items

### Immediate (Today):
1. [ ] Log into Exotel Dashboard
2. [ ] Create NEW flow: "Mangwale-Vendor-IVR-v2"
3. [ ] Add Programmable Gather applet with URL: `https://exotel.mangwale.ai/api/nerve/gather`
4. [ ] Add Passthru applet for DTMF processing
5. [ ] Get the new App ID
6. [ ] Update `initiate_call` to use new App ID
7. [ ] Implement `/api/nerve/gather` endpoint
8. [ ] Test!

### This Week:
1. [ ] Contact Exotel to enable Voicebot applet
2. [ ] Implement WebSocket voicebot handler
3. [ ] Integrate our TTS pipeline
4. [ ] Full AI voice conversation

---

## 📞 Exotel Dashboard URLs

- Flows/Apps: https://my.exotel.com/sarvinsuppliesllp1/apps
- ExoPhones: https://my.exotel.com/sarvinsuppliesllp1/exophones
- API Settings: https://my.exotel.com/apisettings/site

---

## 🔗 Key Documentation

- Applets: https://developer.exotel.com/applet
- Programmable Gather: https://support.exotel.com/support/solutions/articles/3000084635
- Passthru: https://support.exotel.com/support/solutions/articles/48283
- Voicebot/Stream: https://support.exotel.com/support/solutions/articles/3000108630
- Make a Call API: https://developer.exotel.com/api/make-a-call-api

---

## Contact

Exotel Support: hello@exotel.com
Exotel Chat: Dashboard widget
WhatsApp: 08088919888
