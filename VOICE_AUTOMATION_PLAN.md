# Mangwale Voice Call Automation Plan

## Current System Status ✅

| Component | Location | Status | Port |
|-----------|----------|--------|------|
| **Nerve System** | Mercury | ✅ Running | 7100 |
| **ASR (Whisper)** | Mercury | ✅ Healthy | 7001 |
| **TTS (Kokoro/Indic)** | Mercury | ✅ Healthy | 7002 |
| **Orchestrator** | Mercury | ✅ Healthy | 7000 |
| **Exotel JS Service** | Mercury | ✅ Healthy | 3100 |
| **Jupiter Backend** | Jupiter | ✅ Healthy | 3200 |
| **vLLM (Qwen2.5-7B)** | Jupiter | ✅ Healthy | 8002 |
| **Voice DB Tables** | Jupiter | ✅ Ready | - |

---

## Pain Points → Automated Call Solutions

### 1. 🏪 VENDOR - Order Not Seen on App (CRITICAL)

**Problem**: Vendors miss orders because they're busy and don't check the app.

**Solution**: Automated vendor confirmation call

```
Trigger: New order assigned to vendor
Flow:
1. Jupiter creates order → triggers Nerve
2. Nerve calls vendor: "नमस्ते [vendor_name], मंगवाले से कॉल। 
   ऑर्डर #[order_id], [items_count] आइटम, ₹[amount]।
   स्वीकार करने के लिए 1 दबाएं, अस्वीकार करने के लिए 2 दबाएं।"
3. DTMF Response:
   - Press 1 → Order accepted → Ask prep time
   - Press 2 → Order rejected → Ask reason
   - No response → Retry after 30 seconds (max 3 times)
4. Report to Jupiter → Update order status
```

**Already Implemented**: ✅ In Nerve System (`/api/nerve/vendor-order-confirmation`)

---

### 2. 🏪 VENDOR - Shop Closed / Forgot to Mark

**Problem**: Vendor shop is closed but still receiving orders

**Solution**: Proactive shop status calls (Morning + During slow periods)

```
Trigger: Scheduled (8 AM, 2 PM) OR If no order acceptance in 2 hours
Flow:
1. Jupiter scheduler → triggers Nerve
2. Nerve calls: "नमस्ते [vendor_name], क्या आपकी दुकान खुली है?
   खुली है तो 1 दबाएं, बंद है तो 2 दबाएं।"
3. If Press 2 → Mark shop closed in app
4. If no response → Mark as "possibly closed"
```

**To Implement**: New endpoint `/api/nerve/vendor-availability-check`

---

### 3. 🏪 VENDOR - Item Listed but Not Available

**Problem**: Items shown in app but actually not in stock

**Solution**: Item availability confirmation (part of order confirmation)

```
Enhanced Order Confirmation Flow:
1. After order acceptance, ask about specific items
2. "क्या [item_name] अभी उपलब्ध है? हाँ के लिए 1, नहीं के लिए 2"
3. If unavailable → Suggest alternatives OR partial order confirmation
```

**To Implement**: Enhance vendor-order-confirmation flow

---

### 4. 🏪 VENDOR - Order Delay

**Problem**: Vendors delay orders without communication

**Solution**: Prep time tracking + Delay escalation calls

```
Trigger: Order prep_time exceeded by 10 minutes
Flow:
1. Jupiter monitors prep times
2. If delayed → Nerve calls: "ऑर्डर #[id] तैयार है क्या?
   तैयार है तो 1 दबाएं, और [X] मिनट चाहिए तो 2 दबाएं।"
3. If Press 2 → Update prep time + notify customer
4. If no response → Escalate to operations team
```

**To Implement**: New endpoint `/api/nerve/vendor-order-delay-check`

---

### 5. 🏍️ RIDER - Third-Party Rider Instructions (CRITICAL)

**Problem**: Riders from Dunzo/Porter/etc don't understand Mangwale prepaid orders

**Solution**: Rider briefing call with AI conversation

```
Trigger: Rider assigned to prepaid order
Flow:
1. Jupiter assigns rider → triggers Nerve
2. Nerve calls: "नमस्ते, यह मंगवाले से कॉल है।
   आपको [store] से [customer] के लिए डिलीवरी मिली है।
   
   महत्वपूर्ण: यह PREPAID ऑर्डर है!
   ग्राहक से कैश लेने की जरूरत नहीं है।
   
   समझ गए तो 1 दबाएं।"
3. If no response → Retry + Send SMS
```

**Already Implemented**: ✅ In Nerve System (`/api/nerve/rider-assignment`)

---

### 6. 🏍️ RIDER - ETA / Arrival Time

**Problem**: Need to know when rider will reach pickup

**Solution**: ETA collection call

```
Trigger: After rider accepts assignment
Flow:
1. Ask: "पिकअप पर कितने मिनट में पहुंचेंगे?
   10 मिनट के लिए 1, 20 मिनट के लिए 2, 30 मिनट के लिए 3"
2. Store ETA in order
3. Notify vendor: "राइडर [X] मिनट में आ रहा है"
```

**To Implement**: Enhance rider-assignment flow

---

### 7. 🏍️ RIDER - Pickup Confirmation

**Problem**: Rider picked up but didn't mark in app

**Solution**: Pickup confirmation call (triggered by geofence OR time)

```
Trigger: Rider near vendor location for 5+ mins OR Expected pickup time reached
Flow:
1. Nerve calls: "क्या आपने ऑर्डर #[id] पिकअप कर लिया?
   हाँ के लिए 1, नहीं के लिए 2"
2. If Press 1 → Mark as picked up
3. If Press 2 → Ask reason
```

**To Implement**: New endpoint `/api/nerve/rider-pickup-check`

---

### 8. 🏍️ RIDER - Delivery Confirmation

**Problem**: Rider delivered but didn't mark in app

**Solution**: Delivery confirmation call

```
Trigger: Expected delivery time reached OR Rider near customer
Flow:
1. Nerve calls: "क्या आपने ऑर्डर #[id] डिलीवर कर दिया?
   हाँ के लिए 1, नहीं के लिए 2"
2. If Press 1 → Mark delivered → Trigger customer feedback
3. If Press 2 → Ask what's the issue
```

**To Implement**: New endpoint `/api/nerve/rider-delivery-check`

---

### 9. 🏍️ RIDER - Order Not Delivered for Hours

**Problem**: Rider picks up but doesn't deliver for hours

**Solution**: Automated escalation calls

```
Trigger: Order picked up > 1 hour ago but not delivered
Flow:
1. Call rider: "ऑर्डर #[id] अभी तक डिलीवर क्यों नहीं हुआ?
   डिलीवर हो गया तो 1, रास्ते में हूं तो 2, समस्या है तो 3"
2. If Press 3 → Connect to AI support OR human escalation
3. If no response → Alert ops team + GPS check
```

**To Implement**: New endpoint `/api/nerve/rider-escalation`

---

### 10. 👤 CUSTOMER - Not Picking Rider's Call

**Problem**: Customer doesn't answer rider's call

**Solution**: Mangwale-initiated customer call

```
Trigger: Rider reports customer not answering
Flow:
1. Nerve calls customer: "नमस्ते, मंगवाले से। 
   आपका ऑर्डर डिलीवरी के लिए आ गया है।
   कृपया राइडर का कॉल उठाएं या अपना पता बताएं।"
2. If customer responds → Give location OR connect to rider
3. If no response → Wait 5 min → Send SMS → Mark as attempted
```

**To Implement**: New endpoint `/api/nerve/customer-unreachable`

---

### 11. 👤 CUSTOMER - Location Issue

**Problem**: Rider can't find customer location

**Solution**: Location clarification call

```
Trigger: Rider reports location issue
Flow:
1. Nerve calls customer: "राइडर को आपका पता नहीं मिल रहा।
   कृपया एक लैंडमार्क बताएं या राइडर से बात करने के लिए 1 दबाएं।"
2. If response → AI extracts landmark OR connects call
3. Share updated location with rider
```

**To Implement**: New endpoint `/api/nerve/customer-location-help`

---

### 12. 🏪 VENDOR - Special Notes from Customer

**Problem**: Vendor doesn't see customer notes

**Solution**: Include notes in confirmation call

```
Enhanced Order Confirmation:
1. After basic details, add: "ग्राहक की विशेष टिप्पणी: [note]"
2. Ask: "क्या आप यह कर सकते हैं? हाँ के लिए 1, नहीं के लिए 2"
```

**To Implement**: Enhance vendor-order-confirmation payload

---

### 13. 📢 MARKETING CALLS

**Problem**: Need automated marketing/promotional calls

**Solution**: Campaign-based auto-dialer

```
Features:
- Upload phone list via CSV
- Pre-record message OR use TTS
- Schedule calls at optimal times
- Track responses (DTMF)
- Report analytics

Flow:
1. Admin uploads campaign
2. Nerve queues calls
3. Plays message: "[offer details]... स्वीकार करने के लिए 1 दबाएं"
4. Track responses → Add to CRM
```

**Already Available**: Via Exotel JS Service auto-dialer (`/api/auto-dialer`)

---

## Implementation Priority

| Priority | Call Type | Impact | Effort |
|----------|-----------|--------|--------|
| 🔴 P0 | Vendor order confirmation | High | ✅ Done |
| 🔴 P0 | Rider prepaid briefing | High | ✅ Done |
| 🟠 P1 | Rider pickup/delivery confirmation | High | Medium |
| 🟠 P1 | Customer unreachable | High | Medium |
| 🟡 P2 | Vendor availability check | Medium | Low |
| 🟡 P2 | Order delay escalation | Medium | Medium |
| 🟢 P3 | Marketing campaigns | Medium | ✅ Done |
| 🟢 P3 | Customer location help | Medium | Medium |

---

## Questions for You

1. **Phone Numbers**: Do you want calls from Mangwale's own number (02048556923) or should it show as "Mangwale" caller ID?

2. **Language Priority**: You mentioned Hindi. Do you also need Marathi for vendors in Maharashtra? Or English backup?

3. **Retry Logic**: How many times should we retry if vendor/rider doesn't answer?
   - Current: 3 attempts with 30-second gaps
   - Do you want different retry logic?

4. **Escalation**: When should we escalate to human ops team?
   - After X failed call attempts?
   - For specific rejection reasons?

5. **Voice vs DTMF**: 
   - Current: DTMF (press 1, 2, 3)
   - Do you want conversational AI where they can speak responses?
   - (This is possible but adds ~2-3 seconds latency)

6. **Third-Party Riders**: 
   - How do you currently assign Dunzo/Porter riders?
   - Do you get their phone numbers?
   - Should we also send them SMS with instructions?

7. **Testing**: 
   - Can you give me a test phone number to try the flows?
   - Should we start with vendor confirmation calls first?

8. **Working Hours**: 
   - What are the call hours? (Don't want to call at night)
   - Different hours for vendors vs riders vs customers?

---

## Next Steps

1. ✅ Nerve System running and connected
2. ✅ Jupiter can talk to Nerve
3. 🔄 Choose first use case to implement fully
4. 🔄 Test with real phone number
5. 🔄 Add remaining call types one by one
