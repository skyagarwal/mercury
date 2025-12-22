# Exotel Dashboard Setup - Step by Step

## Login & Access

1. Go to: **https://my.exotel.com**
2. Login with your credentials for account: `sarvinsuppliesllp1`

## Option 1: Configure Existing App 1145886 (Faster)

### Step 1: Find the App

1. Click **"IVR"** in the left sidebar
2. Click **"Apps"** or **"Manage Apps"**
3. Search for app ID: **1145886**

### Step 2: Edit the App

If app **1145886 exists**:
1. Click on it to edit
2. **Delete any existing applets** (if any)
3. Go to **Step 3** below

If app **1145886 does NOT exist**:
- Go to **Option 2** below to create a new app

### Step 3: Add Programmable Gather Applet

1. Drag **"Programmable Gather"** widget onto the canvas
2. Configure it with these exact settings:
   ```
   URL: https://exotel.mangwale.ai/api/nerve/gather
   HTTP Method: GET
   Voice/Language: hi-IN (Hindi - India)
   Gender: Female (optional)
   Max Retries: 2
   No Input Action: Re-fetch URL
   Invalid Input Action: Re-fetch URL
   Timeout: 15 seconds
   ```

3. Connect **"Start"** node → **"Programmable Gather"** node

4. **Save** the app

5. **Test it** (see Testing section below)

---

## Option 2: Create New App (If 1145886 doesn't exist)

### Step 1: Create New App

1. Click **"IVR"** in sidebar → **"Apps"**
2. Click **"Create New App"** button
3. Name: `Mangwale-Voice-Orders`
4. Description: `Hindi voice calls for vendor order confirmations`
5. Click **Create**

### Step 2: Add Programmable Gather

Same as **Option 1, Step 3** above

### Step 3: Note the App ID

1. After saving, check the URL or app details
2. Note the **App ID** (e.g., 1234567)
3. Update the configuration:

```bash
# SSH to Mercury
ssh mercury

# Update .env file
cd /home/ubuntu/mangwale-voice/escotel-stack/exotel-service
nano .env

# Change this line:
IVR_APP_ID=1145886
# To:
IVR_APP_ID=YOUR_NEW_APP_ID

# Save and exit (Ctrl+X, Y, Enter)

# Restart Nerve
pkill -9 -f nerve_system.py
cd /home/ubuntu/mangwale-voice/escotel-stack/exotel-service
nohup .venv/bin/python nerve_system.py >> /tmp/nerve-debug.log 2>&1 &
```

---

## Alternative: Use Passthru (If Programmable Gather not available)

If "Programmable Gather" widget is not available in your dashboard, use **Passthru**:

1. Drag **"Passthru"** widget onto canvas
2. Configure:
   ```
   URL: https://exotel.mangwale.ai/api/nerve/callback
   HTTP Method: GET
   ```
3. Connect **Start** → **Passthru**
4. Save

---

## Testing After Configuration

### Step 1: Initiate Test Call

```bash
# SSH to Mercury
ssh mercury

# Make test call
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

### Step 2: Expected Behavior

1. **Phone rings**: 9923383838
2. **Pick up call**
3. **Should hear**: "नमस्ते Saurabh, यह मंगवाले से कॉल है। आपके लिए एक नया ऑर्डर आया है। ऑर्डर नंबर 12345..."
4. **Press 1** to accept
5. **Should hear**: "धन्यवाद! खाना तैयार करने में कितने मिनट लगेंगे? 15 मिनट के लिए 1 दबाएं..."
6. **Press 2** for 30 minutes
7. **Should hear**: "धन्यवाद! राइडर 30 मिनट में पहुंचेगा। शुभ दिन!"
8. **Call ends**

### Step 3: Check Logs

```bash
# Watch logs in real-time
tail -f /tmp/nerve-debug.log

# Look for these lines:
# ✅ "GET /api/nerve/gather?CallSid=...&CustomField=..." 200 OK
# ✅ "Returning gather response for CallSid..."
# ✅ "DTMF input: 1"
```

**Good Signs:**
- ✅ You see `GET /api/nerve/gather` requests from Exotel
- ✅ Hindi audio plays
- ✅ DTMF (keypress) detection works

**Bad Signs:**
- ❌ No GET requests in logs
- ❌ Call disconnects immediately
- ❌ Check dashboard app configuration again

---

## Troubleshooting

### Issue: "Programmable Gather" widget not available

**Solution**: Use **Passthru** widget instead (see alternative above)

### Issue: Call still disconnects

**Check**:
1. Is the app **published/active** in dashboard?
2. Is the Start node connected to Programmable Gather?
3. Is the URL correct: `https://exotel.mangwale.ai/api/nerve/gather`?
4. Try testing the URL manually:
   ```bash
   curl "https://exotel.mangwale.ai/api/nerve/gather?CallSid=test&CustomField=%7B%22order_id%22%3A123%7D"
   ```

### Issue: No Hindi audio, only English

**Check**:
1. Voice/Language setting in Programmable Gather: Must be `hi-IN`
2. Check the JSON response from `/gather` endpoint - it should have Hindi Unicode text

### Issue: "App not found" error

**Solution**: The app ID might be wrong
1. Double-check the app ID in dashboard
2. Update IVR_APP_ID in .env if needed
3. Restart Nerve

---

## Dashboard Screenshots Reference

If you're unsure where to find things:

**IVR Apps Location:**
```
Dashboard → IVR → Apps → [Your App]
```

**Programmable Gather Settings:**
```
1. URL field: https://exotel.mangwale.ai/api/nerve/gather
2. Method dropdown: GET
3. Voice dropdown: hi-IN or Hindi (India)
4. Retry settings: 2 times
```

**Canvas Layout:**
```
[Start] ----→ [Programmable Gather] ----→ [End]
```

---

## Support

If you encounter any issues:

1. **Check logs**: `tail -f /tmp/nerve-debug.log`
2. **Test endpoint**: `curl https://exotel.mangwale.ai/api/nerve/gather?CallSid=test&CustomField=%7B%22order_id%22%3A123%7D`
3. **Verify app ID**: Check dashboard and .env match
4. **Contact**: Exotel support if dashboard issues

---

## Quick Reference

| Setting | Value |
|---------|-------|
| **Account SID** | sarvinsuppliesllp1 |
| **Caller ID** | 02048556923 |
| **IVR App ID** | 1145886 (or new one) |
| **Programmable Gather URL** | https://exotel.mangwale.ai/api/nerve/gather |
| **Passthru URL** | https://exotel.mangwale.ai/api/nerve/callback |
| **Voice Language** | hi-IN (Hindi) |
| **Test Phone** | 9923383838 |

---

**Once configured, your Hindi voice calls will work perfectly! 🎉**
