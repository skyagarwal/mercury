# 🔄 PASSTHRU APPLET SOLUTION

## The Approach: Gather → Passthru → Your Callback

Instead of having Gather applet call your URL after digit capture, we'll use Exotel's Passthru applet as a bridge:

```
Flow:
1. Gather Applet (1149178) → Plays TTS, captures DTMF
2. After digits captured → Connects to Passthru Applet 
3. Passthru Applet → Calls https://exotel.mangwale.ai/api/nerve/callback
4. Your service → Returns next step as ExoML (XML)
5. Exotel executes ExoML (including any <Gather>) and continues the flow
```

---

## Step 1: Configure Passthru Applet in Exotel Dashboard

### Option A: Use Existing Passthru (ID: 1148615)

Dashboard → Applets → Find Passthru Applet (ID: 1148615) → Edit

**Configure:**
```
Passthru URL: https://exotel.mangwale.ai/api/nerve/callback
Method: GET
Timeout: 5 seconds
☑ Forward all parameters (important - this passes Digits, CallSid, etc.)
```

### Option B: Create New Passthru Applet

1. Dashboard → Applets → Create New → Passthru
2. Name: "Mangwale IVR Callback Handler"
3. Configure:
   ```
   URL: https://exotel.mangwale.ai/api/nerve/callback
   Method: GET
   Timeout: 5 seconds
   ☑ Forward all parameters
   ```
4. Save and note the Applet ID

---

## Step 2: Link Gather → Passthru

### In Gather Applet (ID: 1149178) → Edit:

Scroll down to find section called **"After Gathering Digits"** or **"On Input Received"** or **"Next Action"**

**Configure:**
```
When digits are gathered:
  → Action: Connect to Applet
  → Select Applet: [Passthru - 1148615] (or your new Passthru)
```

**Alternative section names to look for:**
- "On Digit Capture"
- "After Input"
- "Next Step"
- "Connect To"
- "Chain Applets"

**Save the configuration**

---

## Step 3: Update Your API Call to Use Passthru Flow

### Current Test Call (Works):
```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  -d "From=09923383838" \
  -d "CallerId=02048556923" \
  -d "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1149178" \
  -d "CustomField={\"order_id\":123}"
```

Keep using Gather applet (1149178) - it now chains to Passthru internally.

---

## Step 4: Test the Complete Flow

### Start Monitoring Logs First:
```bash
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | grep -E "CallSid|callback|DTMF|State"
```

### Make Test Call:
```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  -d "From=09923383838" \
  -d "CallerId=02048556923" \
  -d "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1149178" \
  -d "CustomField={\"order_id\":123}"
```

### Expected Log Sequence:

**1st Callback (Initial - Gather applet calls for prompt):**
```
📥 Exotel callback: CallSid=abc123, digits=None, CustomField={"order_id":123}
📋 Created new call_state for abc123 with current_state=greeting
📞 New call: abc123 - Playing greeting
```

**Phone: Hears Hindi greeting asking to press 1 or 0**

**2nd Callback (After pressing 1 - Passthru forwards to your URL):**
```
📥 Exotel callback: CallSid=abc123, digits=1, CustomField={"order_id":123}
📱 DTMF: 1 | State: greeting
📞 State transition: greeting → accepted
📞 Playing: ऑर्डर स्वीकार किया। तैयारी का समय बताएं...
```

**Phone: Hears prep time inquiry**

**3rd Callback (After pressing 3, then 0):**
```
📥 Exotel callback: CallSid=abc123, digits=3, CustomField={"order_id":123}
📱 DTMF: 3 | State: prep_time_inquiry
📞 Collecting prep time: 3
```

**4th Callback (After pressing #):**
```
📥 Exotel callback: CallSid=abc123, digits=#, CustomField={"order_id":123}
📱 DTMF: # | State: prep_time_inquiry
📞 Prep time complete: 30 minutes
📞 Playing goodbye: धन्यवाद! राइडर 30 मिनट में पहुंचेगा।
```

**Call ends after ~20-25 seconds**

---

## Step 5: Verify Call Details

### Check Call Duration:
```bash
# Get CallSid from logs, then:
curl -s "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/{CallSid}.json" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  | jq '.Call | {Sid, Status, Duration, DialCallDuration, AnsweredBy}'
```

**Expected:**
```json
{
  "Sid": "abc123...",
  "Status": "completed",
  "Duration": 20-25,  ← Should be longer now!
  "DialCallDuration": null,
  "AnsweredBy": "human"
}
```

---

## What Each Component Does

### Gather Applet (1149178):
- Receives initial call
- Calls your callback: `GET https://exotel.mangwale.ai/api/nerve/callback?CallSid=...`
- Gets JSON with `gather_prompt`
- Plays TTS
- Captures DTMF (max 1 digit, finish on #, timeout 6s)
- **After digit captured:** Connects to Passthru applet

### Passthru Applet (1148615):
- Receives call from Gather with Digits parameter
- Calls your callback: `GET https://exotel.mangwale.ai/api/nerve/callback?CallSid=...&Digits=1&...`
- Forwards response back to call flow
- If response has `gather_prompt`, it acts like a Gather and captures more DTMF
- **After digit captured:** Loops back to itself (calls callback again)

### Your Callback (/api/nerve/callback):
- Receives: CallSid, Digits (if any), CustomField
- Tracks state: greeting → accepted → prep_time_inquiry → goodbye
- Returns ExoML (XML) with <Say> and <Gather> to control the call
- When flow complete: Returns final message and call ends

---

## Debugging Tips

### If Call Still Ends After 10 Seconds:

**Check 1: Passthru is configured**
```bash
# Look for Passthru applet in dashboard, verify URL is set
```

**Check 2: Gather chains to Passthru**
```bash
# In Gather applet settings, verify "Next Action" points to Passthru
```

**Check 3: Check logs for second callback**
```bash
grep "digits=" /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | tail -20
```
If you see `digits=None` only (no `digits=1` or `digits=0`), then chaining isn't configured.

**Check 4: Manually test Passthru**
```bash
curl -s 'https://exotel.mangwale.ai/api/nerve/callback?CallSid=test&Digits=1&CustomField={"order_id":123}'
```
Should return ExoML (XML) with the next prompt.

---

## Alternative: Direct Passthru (If Gather Chaining Doesn't Work)

If you can't chain Gather → Passthru, use Passthru directly:

### Change the API call URL:
```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  -d "From=09923383838" \
  -d "CallerId=02048556923" \
  -d "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615" \
  -d "CustomField={\"order_id\":123}"
```
↑ Changed 1149178 to 1148615 (Passthru applet)

**Advantage:** Simpler - one applet handles everything  
**Disadvantage:** Your callback must return Gather-compatible JSON for DTMF capture

Our current JSON format already works with Passthru! The `gather_prompt` field tells Passthru to capture DTMF.

---

## Summary: Two Working Approaches

### Approach 1: Gather → Passthru Chain (Recommended)
```
Start with Gather 1149178 → After digits → Chain to Passthru 1148615 → Callback
```
**Pros:** Clean separation, Gather handles TTS/DTMF  
**Cons:** Requires dashboard configuration of chaining

### Approach 2: Direct Passthru (Alternative)
```
Start with Passthru 1148615 → Callback (returns gather_prompt JSON)
```
**Pros:** Single applet, simpler setup  
**Cons:** Passthru must interpret gather_prompt JSON (it does!)

---

## Quick Setup Checklist

- [ ] **Passthru applet configured** (URL set to https://exotel.mangwale.ai/api/nerve/callback)
- [ ] **Gather applet "After digits" action** set to connect to Passthru
- [ ] **Test callback manually** with Digits parameter
- [ ] **Make test call** and monitor logs
- [ ] **Verify multiple callbacks** received (initial + DTMF callbacks)
- [ ] **Check call duration** is 20-25 seconds

---

## Next Steps

1. **Configure Passthru applet 1148615** in dashboard
2. **Link Gather 1149178 to Passthru** in "After digits" section
3. **Run test call** (I'll help monitor)
4. **Press 1 during call** to test DTMF
5. **Verify logs show multiple callbacks**

Tell me when Passthru is configured and I'll run the test! 🚀
