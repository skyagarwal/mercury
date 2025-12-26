# QUICK START - Testing the Integration

## 🚀 One-Minute Setup

1. **Verify service is running:**
   ```bash
   sudo systemctl status nerve-system
   ```

2. **Check logs are flowing:**
   ```bash
   tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log
   ```

3. **Place a test call** (replace with real test number that won't be NDNC-blocked):
   ```bash
   curl -X POST http://localhost:7100/api/nerve/vendor-order-confirmation \
     -H 'Content-Type: application/json' \
     -d '{
       "order_id": 9999,
       "vendor_id": "VTEST",
       "vendor_phone": "+919XXXXXXXXX",
       "vendor_name": "Test Vendor",
       "order_items": [{"name": "Item", "quantity": 1}],
       "order_amount": 100,
       "payment_method": "COD",
       "language": "hi"
     }'
   ```

4. **Watch logs for this sequence:**
   ```
   ✅ Call initiated successfully: [CallSid]
   ✅ 📥 PROGRAMMABLE GATHER REQUEST RECEIVED (initial greeting)
   ✅ 📤 PROGRAMMABLE GATHER RESPONSE (Initial Greeting)
   [Vendor answers phone - should hear Hindi audio]
   [Vendor presses "1" to accept]
   ✅ 📥 PROGRAMMABLE GATHER REQUEST (digits=1)
   ✅ 📱 DTMF received: 1
   ✅ 📤 PROGRAMMABLE GATHER RESPONSE (Prep Time Prompt)
   [Vendor presses "2" for 30 minutes]
   ✅ 📥 PROGRAMMABLE GATHER REQUEST (digits=2)
   ✅ ⏱️ Prep time set to 30 minutes
   ✅ 📤 PROGRAMMABLE GATHER RESPONSE (Final Goodbye, max_input_digits=0)
   [Call ends - Exotel hangs up]
   ✅ 📊 EXOTEL STATUS CALLBACK (completed, Duration > 30s)
   ```

---

## 📋 What to Check If Something Goes Wrong

### Issue: Call connects but no audio
**Check:**
```bash
# 1. Audio file exists and is accessible
curl -I http://localhost:7100/api/nerve/ivr/vendor-8k/V01_greeting_pcm.wav
# Should return 200 OK with Content-Type: audio/wav

# 2. Format is correct (8kHz mono PCM)
ffprobe -v quiet -print_format json -show_streams \
  /home/ubuntu/mangwale-voice/ivr-audio/vendor-8k/V01_greeting_pcm.wav
# Should show: sample_rate: 8000, channels: 1, codec_name: pcm_s16le
```

### Issue: DTMF not captured
**Check logs for:**
```bash
grep "DTMF received" /home/ubuntu/mangwale-voice/logs/nerve-system.error.log
# Should show each digit pressed with timestamp
```

If no "DTMF received" message:
- Exotel not routing DTMF to `/api/nerve/gather`
- Check Exotel Applet 1148538 URL configuration
- Verify Passthru URL: `https://exotel.mangwale.ai/api/nerve/callback` (if using Passthru)

### Issue: Call duration is 0-3 seconds
**Check logs for:**
```bash
# Look for DTMF processing
grep "📱 DTMF received" /home/ubuntu/mangwale-voice/logs/nerve-system.error.log

# Look for response format
grep "📤 PROGRAMMABLE GATHER RESPONSE" /home/ubuntu/mangwale-voice/logs/nerve-system.error.log
```

Short duration usually means:
- Missing `</Response>` in ExoML (should be fixed now)
- Missing `max_input_digits: 0` in final response (should be fixed now)
- Exotel detecting malformed response format

---

## 🔍 Key Log Patterns to Look For

### ✅ Good Flow
```
REQUEST → (no digits) → Initial Greeting Response
REQUEST → (digits=1) → Prep Time Response  
REQUEST → (digits=2) → Final Goodbye (max_input_digits=0)
STATUS CALLBACK → completed, Duration: 35s
```

### ❌ Bad Flow
```
REQUEST → (no digits) → Initial Response
[silence for 30+ seconds]
STATUS CALLBACK → busy, Duration: 0s
# No DTMF capture = Exotel flow issue
```

### ❌ Malformed Response
```
REQUEST → Error reading response → Status: failed
# ExoML/JSON format issue (should be fixed now)
```

---

## 📊 Test Call Template

**File:** `/tmp/test-call.sh`
```bash
#!/bin/bash
ORDER_ID=9999
VENDOR_PHONE="+919XXXXXXXXX"  # ← REPLACE WITH REAL TEST NUMBER

echo "📞 Initiating test call..."
RESPONSE=$(curl -s -X POST http://localhost:7100/api/nerve/vendor-order-confirmation \
  -H 'Content-Type: application/json' \
  -d "{
    \"order_id\": $ORDER_ID,
    \"vendor_id\": \"VTEST\",
    \"vendor_phone\": \"$VENDOR_PHONE\",
    \"vendor_name\": \"Test Vendor\",
    \"order_items\": [{\"name\": \"Test Item\", \"quantity\": 1}],
    \"order_amount\": 100,
    \"payment_method\": \"COD\",
    \"language\": \"hi\"
  }")

CALL_SID=$(echo $RESPONSE | grep -o '"call_sid":"[^"]*' | cut -d'"' -f4)
echo "✅ Call initiated: $CALL_SID"
echo "📋 Watching logs for CallSid=$CALL_SID..."

# Watch logs for this CallSid
tail -f /home/ubuntu/mangwale-voice/logs/nerve-system.error.log | grep "$CALL_SID"
```

---

## 🧪 Endpoint Testing (No Phone Required)

Test endpoints directly (no Exotel call needed):

```bash
# Test 1: Initial greeting request (no DTMF)
echo "Test 1: Initial Greeting"
curl -s 'http://localhost:7100/api/nerve/gather?CallSid=test123' | jq .

# Test 2: DTMF "1" (accept)
echo "Test 2: Accept (DTMF=1)"
curl -s 'http://localhost:7100/api/nerve/gather?CallSid=test123&digits=1' | jq .

# Test 3: DTMF "2" (prep time 30 min)
echo "Test 3: Prep Time (DTMF=2)"
curl -s 'http://localhost:7100/api/nerve/gather?CallSid=test123&digits=2' | jq .

# Test 4: Check response has max_input_digits=0 (hangup signal)
echo "Test 4: Verify Hangup Signal"
curl -s 'http://localhost:7100/api/nerve/gather?CallSid=test123&digits=2' | jq '.max_input_digits'
# Should output: 0
```

---

## 📱 Testing DTMF Reception

To verify Exotel can send DTMF to our endpoint:

```bash
# Simulate what Exotel sends when vendor presses "1"
curl -X GET 'http://localhost:7100/api/nerve/gather?CallSid=test123&digits=1' \
  -H 'X-Forwarded-For: exotel-api' \
  -v

# Check response in logs:
grep "DTMF received: 1" /home/ubuntu/mangwale-voice/logs/nerve-system.error.log
# Should find it
```

---

## 🔧 If You Need to Restart

```bash
# Restart service and see logs
sudo systemctl restart nerve-system && \
sleep 2 && \
sudo systemctl status nerve-system && \
echo "---" && \
tail -20 /home/ubuntu/mangwale-voice/logs/nerve-system.error.log
```

---

## 📞 Real Test Call Checklist

Before placing a real call:
- [ ] Service is running: `systemctl status nerve-system`
- [ ] Port 7100 is responding: `curl http://localhost:7100/health`
- [ ] HTTPS is valid: `curl https://exotel.mangwale.ai/health`
- [ ] Have a test phone number (won't block on NDNC)
- [ ] Open 2 terminals: one for curl, one for logs
- [ ] Enable detailed logging: Check nerve-system.error.log

After placing call:
- [ ] Hear audio greeting on phone
- [ ] Can press keys (DTMF)
- [ ] See DTMF in logs
- [ ] Call ends properly (not stuck)
- [ ] Duration > 20 seconds
- [ ] No errors in logs

---

## 🎯 Success Indicator

✅ **Call is working if:**
1. Logs show: `📤 PROGRAMMABLE GATHER RESPONSE (Initial Greeting)` within 3 seconds of call
2. You hear Hindi audio on the phone
3. Logs show: `📱 DTMF received: 1` when you press "1"
4. Call completes normally (duration 30-45 seconds)
5. Logs show: `📊 EXOTEL STATUS CALLBACK ... completed`

❌ **Something is wrong if:**
1. Call connects but no audio (check audio file)
2. No DTMF logged (Exotel not routing DTMF)
3. Call duration is 0-3 seconds (format issue - should be fixed now)
4. Logs show "Error" or "Exception" (check error messages)

---

## 📌 Important Files

```
Main service:
  /home/ubuntu/mangwale-voice/escotel-stack/exotel-service/nerve_system.py

Configuration:
  /home/ubuntu/mangwale-voice/escotel-stack/.env

Logs:
  /home/ubuntu/mangwale-voice/logs/nerve-system.error.log
  /home/ubuntu/mangwale-voice/logs/nerve-system.log

Audio files:
  /home/ubuntu/mangwale-voice/ivr-audio/vendor-8k/V01_greeting_pcm.wav

systemd service:
  /etc/systemd/system/nerve-system.service
```

---

## 🚀 Ready to Go!

The system is ready for testing. Start with endpoint tests, then proceed to real calls.

**Questions?** Check the error logs - they now include detailed request/response information.

