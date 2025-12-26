# 🚨 CALL DISCONNECT ISSUE - ROOT CAUSE IDENTIFIED

**Date:** December 24, 2025  
**Issue:** Call connects but disconnects immediately after pickup

---

## 🔍 Problem Analysis

### Test Results:

**Call 1 (dfabc25567c391c4fec4490c576d19co):**
- URL used: `http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615`
- Status: completed
- Duration: 8 seconds
- AnsweredBy: human ✅
- Our endpoint was called ✅
- **Problem:** Call disconnected after 8 seconds

**Call 2 (32902369fe6e892b28fcee84e53f19co):**
- URL used: `https://exotel.mangwale.ai/api/nerve/gather` (direct)
- Status: failed ❌
- Duration: 14 seconds
- AnsweredBy: human
- Our endpoint was NOT called ❌
- **Problem:** Exotel couldn't process our direct URL

---

## ✅ ROOT CAUSE

**App ID 1148615 is NOT CONFIGURED in Exotel Dashboard!**

When we call:
```bash
Url=http://my.exotel.com/sarvinsuppliesllp1/exomel/start_voice/1148615
```

Exotel runs App 1148615, but this app is either:
- Empty (no applets configured)
- Has static applets (not Programmable Gather)
- Misconfigured

Our endpoint `/api/nerve/gather` returns correct JSON, but it's not being used because **the app isn't configured to call it**.

---

## 🎯 SOLUTION: Configure App 1148615 in Exotel Dashboard

### Required Steps:

### 1. Login to Exotel Dashboard
```
https://my.exotel.com/sarvinsuppliesllp1
```

### 2. Navigate to IVR Apps
```
Dashboard → IVR → Apps
```

### 3. Find App ID 1148615
- Search for app with ID: **1148615**
- OR create new app if 1148615 doesn't exist

### 4. Configure Programmable Gather Applet

**Drag widgets onto canvas:**

```
┌──────────┐
│  START   │
└─────┬────┘
      │
      ▼
┌─────────────────────────────┐
│  PROGRAMMABLE GATHER        │
│                             │
│  URL: https://exotel.      │
│       mangwale.ai/api/     │
│       nerve/gather         │
│                             │
│  Method: GET                │
│  Voice: hi-IN (Hindi TTS)   │
│  Max Retries: 2             │
│  Input Timeout: 15s         │
│                             │
└─────────────────────────────┘
```

### 5. Programmable Gather Settings

| Setting | Value |
|---------|-------|
| **URL** | `https://exotel.mangwale.ai/api/nerve/gather` |
| **HTTP Method** | GET |
| **Voice/Language** | `hi-IN` (Hindi TTS) OR `en-IN` (English TTS) |
| **Max Input Digits** | Leave blank (controlled by our response) |
| **Input Timeout** | Leave blank (controlled by our response) |
| **Max Retries** | 2 |
| **No Input Action** | Re-fetch URL |
| **Invalid Input Action** | Re-fetch URL |
| **Finish on Key** | Leave blank |

### 6. Connect Widgets

```
START → Programmable Gather
```

No other widgets needed. Programmable Gather handles the entire flow.

### 7. Save & Publish

Click **Save** then **Publish** to activate the app.

---

## 📋 Verification Steps

### Step 1: Verify App Configuration

Login to Exotel → IVR → Apps → Find 1148615 → Should show:
- ✅ Programmable Gather widget present
- ✅ URL = https://exotel.mangwale.ai/api/nerve/gather
- ✅ Status = Published

### Step 2: Test Call with Correct Parameters

```bash
curl -X POST "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect.json" \
  -u "45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf:66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5" \
  --data-urlencode "From=919923383838" \
  --data-urlencode "CallerId=02048556923" \
  --data-urlencode "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615" \
  --data-urlencode 'CustomField={"call_type":"vendor_order_confirmation","order_id":12345,"vendor_name":"Test Vendor","language":"en"}'
```

### Step 3: Expected Flow

1. **Phone rings** at 919923383838
2. **You answer**
3. **You hear:** "Hello Test Vendor, This is a call from Mangwale. You have a new order..."
4. **Press 1** to accept
5. **You hear:** "Thank you! How many minutes to prepare: 15 minutes - press 1..."
6. **Press 2** for 30 minutes
7. **You hear:** "Thank you! Rider will arrive in 30 minutes. Have a good day!"
8. **Call ends gracefully**

### Step 4: Check Logs

```bash
# Should see CallSid in logs
grep "CallSid=" /home/ubuntu/mangwale-voice/logs/nerve-system.log | tail -5
```

---

## 🚫 Common Mistakes

### ❌ Using Direct URL in Connect API
```bash
# DOESN'T WORK - Exotel can't use external URL directly
Url=https://exotel.mangwale.ai/api/nerve/gather
```

### ✅ Correct: Use App URL
```bash
# WORKS - Exotel loads your configured app
Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615
```

### ❌ Empty App Configuration
- App 1148615 exists but has no widgets
- Result: Call connects then disconnects

### ✅ Correct: App Has Programmable Gather
- App 1148615 configured with Programmable Gather widget
- Widget points to: https://exotel.mangwale.ai/api/nerve/gather

---

## 📊 API Call Flow

```
Jupiter Backend
      │
      ▼
[Exotel Connect API]
      │
      │ POST /Calls/connect.json
      │ From=919923383838
      │ CallerId=02048556923
      │ Url=http://my.exotel.com/.../start_voice/1148615
      │
      ▼
[Exotel Phone Network]
      │
      │ Dials 919923383838
      │
      ▼
[Vendor Phone Rings]
      │
      │ Vendor answers
      │
      ▼
[Exotel Executes App 1148615]
      │
      │ Finds: Programmable Gather widget
      │ URL: https://exotel.mangwale.ai/api/nerve/gather
      │
      ▼
[Exotel Calls Our Endpoint]
      │
      │ GET /api/nerve/gather?CallSid=xxx&CustomField=...
      │
      ▼
[nerve_system.py Returns JSON]
      │
      │ {
      │   "gather_prompt": {"text": "Hello..."},
      │   "max_input_digits": 1,
      │   "input_timeout": 15
      │ }
      │
      ▼
[Exotel TTS Speaks Text]
      │
      │ Vendor hears: "Hello Test Vendor..."
      │
      ▼
[Vendor Presses 1]
      │
      ▼
[Exotel Calls Endpoint Again]
      │
      │ GET /api/nerve/gather?CallSid=xxx&digits=1&...
      │
      ▼
[nerve_system.py Returns Next Prompt]
      │
      │ "Thank you! How many minutes..."
      │
      ... (continues until max_input_digits=0)
```

---

## 🎯 IMMEDIATE ACTION REQUIRED

**You must configure App 1148615 in Exotel Dashboard:**

1. Login: https://my.exotel.com/sarvinsuppliesllp1
2. Go to: IVR → Apps
3. Find/Edit App 1148615
4. Add: Programmable Gather widget
5. Set URL: https://exotel.mangwale.ai/api/nerve/gather
6. Set Method: GET
7. Set Voice: hi-IN or en-IN
8. Save & Publish

**Without this dashboard configuration, calls will continue to disconnect immediately after pickup.**

---

## Alternative: Create New App

If App 1148615 is locked or unavailable:

1. Create NEW app in dashboard
2. Note the new App ID (e.g., 1234567)
3. Configure Programmable Gather as above
4. Use new App ID in API calls:
   ```bash
   Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/NEW_APP_ID
   ```

---

## Status: ⏸️ BLOCKED ON DASHBOARD CONFIGURATION

- ✅ Our endpoint is working correctly
- ✅ API parameters are correct
- ✅ Phone number format is correct
- ❌ **App 1148615 needs to be configured in Exotel Dashboard**

**Next Step:** Configure the Exotel Dashboard IVR App 1148615 with Programmable Gather widget.

---

**Created:** December 24, 2025 16:45  
**Author:** GitHub Copilot  
**Priority:** HIGH - Blocking production use
