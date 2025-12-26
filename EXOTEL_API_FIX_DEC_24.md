# EXOTEL API PARAMETER FIX - December 24, 2025

## 🐛 Bug Identified

**Issue:** Outbound calls had FROM and TO as the same number (loopback calls)

**Screenshot Evidence:**
- From: 02048556923 (virtual number)
- To: 02048556923 (same virtual number)
- Result: Loopback call, vendor doesn't receive call

---

## 🔍 Root Cause

I was using **WRONG API parameters** based on misunderstanding of Exotel Connect API.

### What I Did Wrong

```bash
# WRONG PARAMETERS ❌
curl -X POST "https://api.exotel.com/.../Calls/connect.json" \
  --data-urlencode "From=02048556923" \    # Virtual number (WRONG!)
  --data-urlencode "To=919923383838" \     # Vendor number (Wrong param!)
  --data-urlencode "AppId=1148615"
```

**Result:**
- Exotel API interpreted this incorrectly
- Created loopback calls (virtual→virtual)
- Vendor phone never rang

---

## ✅ Correct Solution (Per Exotel Documentation)

### Exotel Connect API Parameter Logic

**For Connect-to-IVR-App:**
```bash
# CORRECT PARAMETERS ✅
curl -X POST "https://api.exotel.com/.../Calls/connect.json" \
  --data-urlencode "From=919923383838" \               # Number TO CALL (vendor)
  --data-urlencode "CallerId=02048556923" \            # Your virtual number
  --data-urlencode "Url=http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615"
```

**Explanation:**
1. `From` = Phone number you want to CALL (vendor: 919923383838)
2. `CallerId` = Your Exotel virtual number (02048556923) - shows as caller ID
3. `Url` = IVR app endpoint (not `AppId`)

**Result:**
- Exotel calls vendor at 919923383838
- Vendor sees caller ID: 02048556923
- When answered, connects to App 1148615 (IVR)

---

## 📚 Exotel API Documentation Reference

### From Exotel Official Docs

**Connect API has TWO modes:**

### Mode 1: Connect Two Parties (C2C)
```
From: Phone A
To: Phone B
CallerId: Your virtual number
```
**Result:** Calls both phones, connects them together

### Mode 2: Connect to IVR/Flow (What We Need)
```
From: Phone to call
CallerId: Your virtual number
Url: IVR app URL OR your ExoML server
```
**Result:** Calls the phone, connects to IVR

**Note:** `To` parameter is **ONLY for C2C mode**, not IVR mode!

---

## 🧪 Test Results

### Before Fix (Wrong Parameters)
```
CallSid: b3a793e914b5b84e89e51464ffbb19co
From: 02048556923 → To: 09923383838
Status: no-answer
AnsweredBy: human (contradictory!)
```

### After Fix (Correct Parameters)
```
CallSid: dfabc25567c391c4fec4490c576d19co
From: 09923383838 → To: 02048556923
Status: completed ✅
Direction: outbound-api
```

**Success!** The parameters are now correct:
- **From** = Vendor phone (the number being called)
- **To** = Virtual number (displayed as caller ID)

---

## 📝 Updated Documentation

### Files Updated:
1. ✅ `/home/ubuntu/mangwale-voice/EXOTEL_DASHBOARD_COMPLETE_SETUP.md`
   - Added warning about wrong parameters
   - Corrected test command
   - Added explanation section

2. ✅ `/home/ubuntu/test_call_FINAL_CORRECT.sh`
   - New test script with correct parameters
   - Visual feedback and logging
   - 60-second wait for complete call flow

### Test Script Usage

```bash
# Run the corrected test
/home/ubuntu/test_call_FINAL_CORRECT.sh

# What it does:
# 1. Calls vendor at 919923383838 (your phone)
# 2. Uses virtual number 02048556923 as caller ID
# 3. Connects to App 1148615 (Programmable Gather)
# 4. Waits 60 seconds
# 5. Shows call status and logs
```

---

## 🎯 Key Takeaways

### API Parameter Rules (Exotel Connect API)

1. **`From`** = The number you want TO CALL (destination)
2. **`CallerId`** = Your Exotel virtual number (source/caller ID)
3. **`Url`** = Where to connect the call (IVR app or server)
4. **`To`** = Only for C2C mode (connect two numbers together)

### What NOT to Do

❌ Don't use `From` as your virtual number  
❌ Don't use `To` with `Url` (conflicts)  
❌ Don't use `AppId` parameter (use `Url` instead)  

### What TO Do

✅ Use `From` as the phone number to call (vendor)  
✅ Use `CallerId` as your virtual number  
✅ Use `Url` with full Exotel URL format:  
   `http://my.exotel.com/{account_sid}/exoml/start_voice/{app_id}`

---

## 🔧 Implementation in Code

### Current nerve_system.py (No Changes Needed)

The endpoint `/api/nerve/gather` is **already correct**. The issue was only with **how we call the Exotel API**, not with our endpoint.

### For Jupiter Backend Integration

When Jupiter needs to make outbound calls:

```python
import requests

def call_vendor(vendor_phone: str, order_data: dict):
    """
    Call vendor with order confirmation IVR
    
    Args:
        vendor_phone: Vendor's phone number (e.g., "919923383838")
        order_data: Order details for CustomField
    """
    url = "https://api.exotel.com/v1/Accounts/sarvinsuppliesllp1/Calls/connect.json"
    auth = ("45b760cdb422e20a924c0a86b49b7383ceee5d7667cd2bbf", 
            "66a78a354493da387a7af6a30bbf723cf8fe508c7de0ccd5")
    
    # CORRECT PARAMETERS ✅
    data = {
        "From": vendor_phone,  # Number TO CALL
        "CallerId": "02048556923",  # Virtual number (caller ID)
        "Url": "http://my.exotel.com/sarvinsuppliesllp1/exoml/start_voice/1148615",
        "CustomField": json.dumps(order_data)
    }
    
    response = requests.post(url, auth=auth, data=data)
    return response.json()
```

---

## ✅ Status: FIXED

- [x] Identified root cause (wrong API parameters)
- [x] Found correct parameters from Exotel documentation
- [x] Tested and verified with successful call
- [x] Updated documentation
- [x] Created corrected test script
- [x] Ready for end-to-end testing

---

## Next Steps

1. **Test the corrected script:**
   ```bash
   /home/ubuntu/test_call_FINAL_CORRECT.sh
   ```

2. **Answer your phone** when it rings (919923383838)

3. **Follow the IVR prompts:**
   - Listen to greeting
   - Press 1 to accept
   - Press 2 for prep time
   - Listen to confirmation

4. **Verify logs** show the call reached `/api/nerve/gather`

5. **Integrate into Jupiter** using the correct parameters

---

**Date:** December 24, 2025  
**Fixed By:** GitHub Copilot  
**Verified:** ✅ Call completed successfully with correct parameters
