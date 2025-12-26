# ✅ GATHER APPLET SETUP INSTRUCTIONS

## Status: Code Updated & Tested

Your callback at `/api/nerve/callback` now returns **JSON** (not ExoML) as required by Exotel's Gather Applet.

### Test Results ✅

```bash
# Initial call (no digits)
curl 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test456&CustomField={"order_id":123}'
→ Returns JSON with greeting prompt

# User presses 1 (accept)
curl 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test456&digits="1"'
→ Returns JSON asking for prep time

# User enters 30 (minutes)
curl 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test456&digits="30"'
→ Returns final goodbye message
```

---

## Next Step: Create Gather Applet in Exotel Dashboard

### 1. Log in to Exotel Dashboard
```
https://my.exotel.com/sarvinsuppliesllp1
```

### 2. Navigate to Applets
- Click **"Call Flow"** or **"Applets"** in the left sidebar
- Click **"+ Create New Applet"**

### 3. Select Applet Type
- Choose **"Gather Applet"**
- Give it a name: `Mangwale Order Confirmation`

### 4. Configure Gather Applet

#### Option A: Static Prompt (Simpler)
Set these fields in the dashboard:

| Field | Value |
|-------|-------|
| **Prompt Type** | Text (TTS) |
| **Prompt Text** | "Test call from Mangwale. Press 1 to confirm. Press 2 to cancel." |
| **Max Input Digits** | 1 |
| **Finish on Key** | # |
| **Input Timeout** | 6 seconds |
| **Repeat Menu** | 1 time |
| **Next Applet** | Leave blank (our callback handles it) |

#### Option B: Dynamic URL (Advanced - Use your callback for prompts too)
| Field | Value |
|-------|-------|
| **Use Dynamic URL** | ✅ Enabled |
| **Primary URL** | `https://exotel.mangwale.ai/api/nerve/callback` |
| **Fallback URL** | (leave empty or same URL) |

**If using Option B**, your callback will be called TWICE:
1. First time: To get the initial prompt (when call connects)
2. Second time: After user presses digit

---

### 5. Note the App ID

After creating the applet, you'll see:
```
App ID: 1234567
```

**Copy this number!** You'll need it for API calls.

---

## Making Test Calls

### Method 1: Using v1 API (Connect to Flow)

```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  -d "From=09923383838" \
  -d "CallerId=02048556923" \
  -d "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/YOUR_GATHER_APP_ID" \
  -d "CustomField={\"order_id\":123,\"vendor_name\":\"TestVendor\"}"
```

**Replace:**
- `YOUR_GATHER_APP_ID` with the actual App ID from step 5
- `09923383838` with your test phone number

---

## Expected Flow

```
1. Your app calls Exotel API
   ↓
2. Exotel dials vendor (09923383838)
   ↓
3. Vendor answers
   ↓
4. Gather Applet loads
   ↓
5. Exotel calls: GET /api/nerve/callback?CallSid=...
   Your callback returns JSON: {"gather_prompt": {"text": "Press 1..."}}
   ↓
6. Exotel plays TTS: "Press 1 to confirm..."
   ↓
7. Vendor presses 1
   ↓
8. Exotel calls: GET /api/nerve/callback?CallSid=...&digits="1"
   Your callback returns JSON: {"gather_prompt": {"text": "Enter prep time..."}}
   ↓
9. Exotel plays TTS: "Enter prep time..."
   ↓
10. Vendor enters 30
   ↓
11. Exotel calls: GET /api/nerve/callback?CallSid=...&digits="30"
    Your callback returns JSON: {"gather_prompt": {"text": "Thank you!"}}
   ↓
12. Exotel plays TTS: "Thank you!" and hangs up
```

---

## Troubleshooting

### Call connects but no audio
- [ ] Check if Gather Applet has initial prompt configured
- [ ] Verify callback returns valid JSON (not XML)
- [ ] Check logs: `tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log`

### DTMF not captured
- [ ] Verify "Max Input Digits" is set (not 0)
- [ ] Check "Finish on Key" setting
- [ ] Look for callback logs with `digits` parameter

### Call disconnects immediately
- [ ] Check App ID is correct in Url parameter
- [ ] Verify Url format: `http://my.exotel.com/{SID}/exoml/start_voice/{APP_ID}`
- [ ] Confirm callback URL returns HTTP 200

---

## Quick Test Commands

### Test callback manually
```bash
# Initial greeting
curl -s 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test999&CustomField={"order_id":999}' | jq .

# Accept order
curl -s 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test999&digits="1"' | jq .

# Set prep time
curl -s 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test999&digits="30"' | jq .
```

### Check service status
```bash
systemctl is-active nerve-system
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log
```

---

## Summary

✅ **Code Updated** - Callback returns JSON  
✅ **Service Restarted** - nerve-system active  
✅ **Manual Tests Pass** - All JSON responses valid  
⏳ **Next:** Create Gather Applet in dashboard  
⏳ **Then:** Test live call

---

## Quick Reference

| What | Value |
|------|-------|
| Callback URL | `https://exotel.mangwale.ai/api/nerve/callback` |
| Response Format | JSON (not XML/ExoML) |
| Initial Prompt | "Test call from Mangwale. Press 1 to confirm. Press 2 to cancel." |
| DTMF Handling | Digits come with quotes: `"1"` → strip to `1` |
| Exotel Account | `sarvinsuppliesllp1` |
| Virtual Number | `02048556923` |
| Test Vendor Number | `09923383838` |
