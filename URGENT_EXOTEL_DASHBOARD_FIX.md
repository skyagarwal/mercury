# URGENT: Exotel Dashboard Configuration Fix Required

## 🔴 ISSUE IDENTIFIED

The Passthru flow (App ID: 1148615) is calling our callback endpoint but **NOT processing the ExoML response correctly**.

### Evidence:
1. ✅ Exotel calls: `https://exotel.mangwale.ai/api/nerve/callback?CallSid=xxx...`  
2. ✅ We return proper ExoML with `<Play>` audio URL  
3. ❌ Exotel calls again with **EMPTY parameters** (CallSid=None)  
4. ❌ User hears **NOTHING** on the phone

## ✅ SOLUTION

### Option 1: Change Passthru URL to Programmable Gather (RECOMMENDED)

1. Login to Exotel Dashboard: https://my.exotel.com/
2. Navigate to: **Flows** → Find App ID **1148615**
3. Change URL from:
   ```
   https://exotel.mangwale.ai/api/nerve/callback
   ```
   To:
   ```
   https://exotel.mangwale.ai/api/nerve/gather
   ```
4. Save changes

**Why**: The `/api/nerve/gather` endpoint returns JSON format (Programmable Gather), which is what Exotel's Passthru expects.

### Option 2: Create NEW Programmable Gather Applet

1. Dashboard → Create New Applet
2. Type: **Programmable Gather**
3. URL: `https://exotel.mangwale.ai/api/nerve/gather`
4. Copy the new App ID
5. Update `.env` file: `IVR_APP_ID=<new_app_id>`
6. Restart service: `sudo systemctl restart nerve-system.service`

## 📋 WHAT WE FIXED (Already Done)

1. ✅ Disabled broken storage.mangwale.ai (502 error)
2. ✅ Enabled in-memory audio storage
3. ✅ Audio URLs now served via: `https://exotel.mangwale.ai/api/nerve/audio/{id}`
4. ✅ ExoML responses properly formatted
5. ✅ Comprehensive logging added

## 🧪 TO VERIFY AFTER DASHBOARD FIX

```bash
curl -X POST http://localhost:7100/api/nerve/vendor-order-confirmation \
  -H 'Content-Type: application/json' \
  -d '{"order_id":99999,"vendor_id":"TEST","vendor_phone":"+919923383838","vendor_name":"Final Test","order_items":[{"name":"Item","quantity":1}],"order_amount":999}'
```

Then answer phone - you should hear Hindi greeting!

## 📞 EXOTEL SUPPORT (If Dashboard Access Issues)

- WhatsApp: +91 8088919888
- Email: support@exotel.com  
- Message: "Need to update Passthru URL for App ID 1148615 to use Programmable Gather endpoint"

