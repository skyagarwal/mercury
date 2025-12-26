# 🎯 EXOTEL DASHBOARD: Exact Steps to Fix Gather Applet

## Problem Right Now
Your Gather Applet (ID: **1149178**) exists but has **NO configuration** telling it:
- What prompt to play
- Where to send DTMF digits
- What your callback URL is

Result: Call connects → Applet loads → No instructions → Disconnects after 6s

---

## Solution: Configure the Applet

### Step 1: Log in to Exotel Dashboard
```
URL: https://my.exotel.com/sarvinsuppliesllp1
```

### Step 2: Navigate to Applets
1. Click **"Call Flow"** in left sidebar
2. OR Click **"Applets"** menu
3. Find Gather Applet with ID **1149178**
4. Click **"Edit"** or the applet name

---

## Configuration Option A: Dynamic URL (RECOMMENDED)

### What You'll See in the Edit Screen

Look for these settings:

```
┌────────────────────────────────────────────────────────┐
│  Gather Applet Configuration                           │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ☐ Use Dynamic URL                                     │
│     ↑ CHECK THIS BOX!                                  │
│                                                         │
│  Primary URL: [_____________________________]          │
│               ↑ Enter: https://exotel.mangwale.ai/     │
│                        api/nerve/callback              │
│                                                         │
│  Fallback URL: [_____________________________]         │
│                (optional - leave empty)                │
│                                                         │
│  Request Timeout: [5] seconds                          │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### Fill In:
1. ✅ **Check** the "Use Dynamic URL" checkbox
2. **Primary URL:** `https://exotel.mangwale.ai/api/nerve/callback`
3. **Fallback URL:** (leave empty)
4. **Request Timeout:** 5 seconds (default is fine)

### Click **"Save"** or **"Update"**

---

## Configuration Option B: Static Prompt (FALLBACK)

If you can't find "Use Dynamic URL" option, use this:

```
┌────────────────────────────────────────────────────────┐
│  Gather Applet Configuration                           │
├────────────────────────────────────────────────────────┤
│                                                         │
│  Prompt Type: ⦿ Text (TTS)                            │
│                                                         │
│  Prompt Text:                                          │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Test call from Mangwale. Press 1 to confirm.     │ │
│  │ Press 2 to cancel.                               │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  Max Input Digits: [1]                                 │
│                                                         │
│  Finish on Key: [#]                                    │
│                                                         │
│  Input Timeout: [6] seconds                            │
│                                                         │
│  Repeat Menu: [1] times                                │
│                                                         │
│  ──────────────────────────────────────────────────   │
│                                                         │
│  After Gathering Digits:                               │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Next Applet: [Passthru]                          │ │
│  │                                                   │ │
│  │ Passthru URL:                                    │ │
│  │ https://exotel.mangwale.ai/api/nerve/callback   │ │
│  │                                                   │ │
│  │ Method: GET                                      │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### Fill In:
1. **Prompt Text:** "Test call from Mangwale. Press 1 to confirm. Press 2 to cancel."
2. **Max Input Digits:** 1
3. **Finish on Key:** #
4. **Input Timeout:** 6
5. **Repeat Menu:** 1
6. **After Gathering Digits → Next Applet:** Select "Passthru"
7. **Passthru URL:** `https://exotel.mangwale.ai/api/nerve/callback`
8. **Method:** GET

### Click **"Save"**

---

## How to Verify It's Configured

### Method 1: Look at the Applet List
After saving, the applet should show:
```
Name: Gather Applet (or your custom name)
ID: 1149178
Status: Active
URL: https://exotel.mangwale.ai/api/nerve/callback
```

### Method 2: Edit Again
Click edit on applet 1149178:
- If using Dynamic URL: checkbox should be checked, URL should be filled
- If using Static: Prompt text should be visible, Passthru should be configured

---

## Test Immediately After Configuration

### 1. Make Test Call
```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  -d "From=09923383838" \
  -d "CallerId=02048556923" \
  -d "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1149178" \
  -d "CustomField={\"order_id\":123}"
```

### 2. Watch Logs (In Separate Terminal)
```bash
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | grep -E "callback|CallSid|DTMF"
```

### 3. What You Should See Now

**In logs:**
```
2025-12-24 23:20:15 - nerve-system - INFO - 📥 Exotel callback ALL PARAMS: {'CallSid': '...', 'CallFrom': '09923383838', ...}
2025-12-24 23:20:15 - nerve-system - INFO - 📥 Exotel callback: CallSid=abc123, digits=None, CustomField={"order_id":123}...
2025-12-24 23:20:15 - nerve-system - INFO - 📋 Created new call_state for abc123 with current_state=greeting
2025-12-24 23:20:15 - nerve-system - INFO - 📞 New call: abc123 - Playing greeting
```

**On phone:**
- Hears TTS: "Test call from Mangwale. Press 1 to confirm. Press 2 to set 30 minutes."
- You press 1
- Hears TTS (Hindi): "Order accepted. Enter prep time..."
- You press 30#
- Hears: "Thank you! Rider arrives in 30 minutes."
- Call ends

**Call duration:** Should be **15-25 seconds** (not 6!)

---

## If It Still Doesn't Work

### Debug Checklist

1. **Verify Applet URL is accessible:**
   ```bash
   curl -I https://exotel.mangwale.ai/api/nerve/callback
   ```
   Expected: `HTTP/2 200`

2. **Check Applet ID is correct:**
   - The URL parameter must use: `http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1149178`
   - App ID 1149178 must match the applet you configured

3. **Verify service is running:**
   ```bash
   systemctl is-active nerve-system
   ```
   Expected: `active`

4. **Test callback directly:**
   ```bash
   curl -s 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test&CustomField={"order_id":1}' | jq .
   ```
   Expected: JSON with `gather_prompt`

5. **Check Exotel Dashboard logs:**
   - Go to Call Logs in dashboard
   - Find the CallSid
   - Look for error messages

---

## What Changed vs. Before

### Before (Not Working)
```
Applet 1149178:
  Configuration: EMPTY
  Dynamic URL: Not enabled
  Static Prompt: Not set
  Result: No action, timeout after 6s
```

### After (Working)
```
Applet 1149178:
  Configuration: PRESENT
  Dynamic URL: ENABLED ✅
  Primary URL: https://exotel.mangwale.ai/api/nerve/callback ✅
  Result: Calls your callback, plays TTS, captures DTMF ✅
```

---

## Summary

**The ONE thing you need to do:**
1. Go to Exotel Dashboard
2. Edit Gather Applet 1149178
3. Enable "Use Dynamic URL"
4. Set Primary URL to `https://exotel.mangwale.ai/api/nerve/callback`
5. Save
6. Run test call again

**Expected result:** Logs will appear, call will last longer, you'll hear audio, DTMF will be captured.

That's it! The code is ready, the service is running, the only missing piece is the dashboard configuration. 🎯
