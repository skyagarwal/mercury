# Exotel IVR Flow Configuration - Vendor Order Confirmation

## Overview

This document describes the Exotel IVR flow configuration for vendor order confirmation with:
- Order details TTS readout
- Prep time collection
- Rejection flow with reason capture

## Flow Structure

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    VENDOR-ORDER-CONFIRMATION IVR FLOW                       │
│                         (Exotel App ID: TBD)                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ START: Connect API call                                               │   │
│  │ POST /Calls/connect                                                   │   │
│  │ Url: http://my.exotel.com/exoml/start_voice/{APP_ID}                │   │
│  │ CustomField: {orderId, vendorId, items[], amount, vendorName}        │   │
│  └───────────────────────────────┬─────────────────────────────────────┘   │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ APPLET 1: Play TTS - Greeting                                        │   │
│  │                                                                       │   │
│  │ Text: "नमस्ते {vendorName}, यह मंगवाले से कॉल है।                      │   │
│  │        आपके लिए एक नया ऑर्डर आया है।"                                  │   │
│  │                                                                       │   │
│  │ Language: Hindi (hi-IN)                                               │   │
│  │ Voice: Female                                                         │   │
│  └───────────────────────────────┬─────────────────────────────────────┘   │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ APPLET 2: Play TTS - Order Details                                   │   │
│  │                                                                       │   │
│  │ Text: "ऑर्डर नंबर {orderId} में है:                                     │   │
│  │        {item1_name} - {item1_qty} पीस,                                │   │
│  │        {item2_name} - {item2_qty} पीस,                                │   │
│  │        ...                                                            │   │
│  │        कुल राशि: {orderAmount} रुपये।                                  │   │
│  │        पेमेंट: {paymentMethod}।"                                       │   │
│  │                                                                       │   │
│  │ Variable interpolation required                                       │   │
│  └───────────────────────────────┬─────────────────────────────────────┘   │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ APPLET 3: Gather DTMF - Confirmation                                 │   │
│  │                                                                       │   │
│  │ Text: "ऑर्डर स्वीकार करने के लिए 1 दबाएं।                               │   │
│  │        रद्द करने के लिए 0 दबाएं।"                                      │   │
│  │                                                                       │   │
│  │ Config:                                                               │   │
│  │ - numDigits: 1                                                        │   │
│  │ - timeout: 10 seconds                                                 │   │
│  │ - retries: 2                                                          │   │
│  └───────────────────────────────┬─────────────────────────────────────┘   │
│                                  │                                          │
│         ┌────────────────────────┼────────────────────────┐                │
│         │                        │                        │                │
│         ▼                        ▼                        ▼                │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐          │
│  │ DIGIT: 1    │         │ DIGIT: 0    │         │ TIMEOUT     │          │
│  │ (Accept)    │         │ (Reject)    │         │             │          │
│  └──────┬──────┘         └──────┬──────┘         └──────┬──────┘          │
│         │                       │                       │                  │
│         ▼                       ▼                       ▼                  │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐          │
│  │ Passthru    │         │ APPLET 4:   │         │ Passthru    │          │
│  │ digits=1    │         │ Rejection   │         │ status=     │          │
│  │ ───────────►│         │ Reason      │         │ NO_RESPONSE │          │
│  │ PREP_TIME   │         │ Flow        │         │ ───────────►│          │
│  │ FLOW        │         └──────┬──────┘         │ HANGUP      │          │
│  └──────┬──────┘                │                └─────────────┘          │
│         │                       │                                          │
│         ▼                       ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    PREP TIME COLLECTION BRANCH                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │ APPLET 5: Play TTS - Accepted Confirmation                           │   │
│  │ Text: "धन्यवाद! ऑर्डर स्वीकार हो गया।"                                 │   │
│  │                                                                       │   │
│  │         │                                                             │   │
│  │         ▼                                                             │   │
│  │                                                                       │   │
│  │ APPLET 6: Gather DTMF - Prep Time                                    │   │
│  │ Text: "खाना तैयार करने में कितने मिनट लगेंगे?                          │   │
│  │        15 मिनट के लिए 1 दबाएं,                                        │   │
│  │        30 मिनट के लिए 2 दबाएं,                                        │   │
│  │        45 मिनट के लिए 3 दबाएं,                                        │   │
│  │        या अपना समय डालें और # दबाएं।"                                  │   │
│  │                                                                       │   │
│  │ Config:                                                               │   │
│  │ - numDigits: 2                                                        │   │
│  │ - finishOnKey: #                                                      │   │
│  │ - timeout: 15 seconds                                                 │   │
│  │                                                                       │   │
│  │         │                                                             │   │
│  │         ├─────────────┬─────────────┬─────────────┬────────┐          │   │
│  │         ▼             ▼             ▼             ▼        ▼          │   │
│  │    [DIGIT: 1]    [DIGIT: 2]    [DIGIT: 3]   [XX#]   [TIMEOUT]        │   │
│  │    15 mins       30 mins       45 mins     Custom   Default 30       │   │
│  │         │             │             │         │        │              │   │
│  │         └─────────────┴─────────────┴─────────┴────────┘              │   │
│  │                                     │                                 │   │
│  │                                     ▼                                 │   │
│  │                                                                       │   │
│  │ APPLET 7: Passthru - Report Prep Time                                │   │
│  │ URL: https://exotel.mangwale.ai/api/ai-voice/ai-callback             │   │
│  │ CustomField: {callType, orderId, status: PREP_TIME_SET}              │   │
│  │                                                                       │   │
│  │         │                                                             │   │
│  │         ▼                                                             │   │
│  │                                                                       │   │
│  │ APPLET 8: Play TTS - Goodbye                                         │   │
│  │ Text: "धन्यवाद! राइडर {prepTime} मिनट में पहुंचेगा। शुभ दिन!"          │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      REJECTION FLOW BRANCH                           │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │ APPLET 4: Gather DTMF - Rejection Reason                             │   │
│  │ Text: "कृपया रद्द करने का कारण बताएं:                                  │   │
│  │        1 - आइटम उपलब्ध नहीं है,                                       │   │
│  │        2 - बहुत व्यस्त हैं,                                            │   │
│  │        3 - दुकान बंद है,                                              │   │
│  │        4 - अन्य कारण।"                                                │   │
│  │                                                                       │   │
│  │ Config:                                                               │   │
│  │ - numDigits: 1                                                        │   │
│  │ - timeout: 10 seconds                                                 │   │
│  │                                                                       │   │
│  │         │                                                             │   │
│  │         ├───────────┬───────────┬───────────┬───────────┐             │   │
│  │         ▼           ▼           ▼           ▼           ▼             │   │
│  │   [DIGIT: 1]   [DIGIT: 2]  [DIGIT: 3]  [DIGIT: 4]  [TIMEOUT]         │   │
│  │   ITEM_UNAVAIL TOO_BUSY    SHOP_CLOSED OTHER       DEFAULT=OTHER     │   │
│  │         │           │           │           │           │             │   │
│  │         └───────────┴───────────┴───────────┴───────────┘             │   │
│  │                                     │                                 │   │
│  │                                     ▼                                 │   │
│  │                                                                       │   │
│  │ APPLET 9: Passthru - Report Rejection                                │   │
│  │ URL: https://exotel.mangwale.ai/api/ai-voice/ai-callback             │   │
│  │ CustomField: {callType, orderId, status: REJECTED, reason}           │   │
│  │                                                                       │   │
│  │         │                                                             │   │
│  │         ▼                                                             │   │
│  │                                                                       │   │
│  │ APPLET 10: Play TTS - Rejection Acknowledged                         │   │
│  │ Text: "धन्यवाद, हम किसी और को यह ऑर्डर देंगे। शुभ दिन!"                │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                               END                                           │
└────────────────────────────────────────────────────────────────────────────┘
```

## API Integration Points

### 1. Call Initiation (Jupiter → Mercury → Exotel)

```json
POST http://mercury:3100/api/ai-voice/vendor-order-confirmation
Content-Type: application/json

{
  "orderId": 12345,
  "vendorId": 67,
  "vendorPhone": "+919876543210",
  "vendorName": "Sharma Restaurant",
  "customerName": "Rahul",
  "orderItems": [
    { "name": "Butter Chicken", "quantity": 2, "price": 350 },
    { "name": "Naan", "quantity": 4, "price": 40 },
    { "name": "Dal Tadka", "quantity": 1, "price": 180 }
  ],
  "orderAmount": 920,
  "language": "hi"
}
```

### 2. Exotel Connect API (Mercury → Exotel)

```bash
POST https://api.exotel.com/v2/Accounts/{SID}/Calls/connect
Content-Type: application/x-www-form-urlencoded

From=02048556923
To=+919876543210
CallerId=02048556923
CallType=trans
Url=http://my.exotel.com/exoml/start_voice/{VENDOR_ORDER_APP_ID}
StatusCallback=https://exotel.mangwale.ai/api/ai-voice/ai-callback/status
CustomField={"callType":"vendor_order_confirmation","orderId":12345,"vendorId":67,"orderItems":[...]}
```

### 3. Passthru Callback (Exotel → Mercury)

```
GET https://exotel.mangwale.ai/api/ai-voice/ai-callback
  ?CallSid=abc123
  &digits=1
  &From=09876543210
  &CustomField={"callType":"vendor_order_confirmation","orderId":12345,"status":"PREP_TIME_SET","prepTime":25}
```

### 4. Result Callback (Mercury → Jupiter)

```json
POST http://jupiter:3200/api/voice-calls/result
Content-Type: application/json

{
  "callSid": "abc123",
  "callType": "VENDOR_ORDER_CONFIRMATION",
  "status": "PREP_TIME_SET",
  "orderId": 12345,
  "vendorId": 67,
  "digits": "25",
  "prepTimeMinutes": 25,
  "answeredAt": "2025-01-17T10:30:00Z"
}
```

## TTS Text Templates

### Hindi (hi-IN)

```javascript
const HINDI_TEMPLATES = {
  // Greeting
  greeting: `नमस्ते {vendorName}, यह मंगवाले से कॉल है। आपके लिए एक नया ऑर्डर आया है।`,
  
  // Order details (dynamically built)
  orderDetails: `ऑर्डर नंबर {orderId} में है: {itemsList}। कुल राशि: {orderAmount} रुपये। पेमेंट: {paymentMethod}।`,
  
  // Items list builder
  buildItemsList: (items) => {
    return items.map(item => 
      `${item.name} ${item.quantity > 1 ? `(${item.quantity} पीस)` : ''}`
    ).join(', ');
  },
  
  // Confirmation prompt
  confirmationPrompt: `ऑर्डर स्वीकार करने के लिए 1 दबाएं। रद्द करने के लिए 0 दबाएं।`,
  
  // Accepted confirmation
  acceptedConfirmation: `धन्यवाद! ऑर्डर स्वीकार हो गया।`,
  
  // Prep time prompt
  prepTimePrompt: `खाना तैयार करने में कितने मिनट लगेंगे? 15 मिनट के लिए 1 दबाएं, 30 मिनट के लिए 2 दबाएं, 45 मिनट के लिए 3 दबाएं, या अपना समय डालें और # दबाएं।`,
  
  // Goodbye with prep time
  goodbyeWithPrepTime: `धन्यवाद! राइडर {prepTime} मिनट में पहुंचेगा। शुभ दिन!`,
  
  // Rejection reason prompt
  rejectionReasonPrompt: `कृपया रद्द करने का कारण बताएं: 1 - आइटम उपलब्ध नहीं है, 2 - बहुत व्यस्त हैं, 3 - दुकान बंद है, 4 - अन्य कारण।`,
  
  // Rejection acknowledged
  rejectionAcknowledged: `धन्यवाद, हम किसी और को यह ऑर्डर देंगे। शुभ दिन!`,
  
  // No response
  noResponse: `कोई जवाब नहीं मिला। कृपया ऐप चेक करें।`,
};
```

### English (en-IN)

```javascript
const ENGLISH_TEMPLATES = {
  greeting: `Hello {vendorName}, this is Mangwale. You have a new order.`,
  orderDetails: `Order number {orderId} contains: {itemsList}. Total amount: {orderAmount} rupees. Payment: {paymentMethod}.`,
  confirmationPrompt: `Press 1 to accept the order. Press 0 to reject.`,
  acceptedConfirmation: `Thank you! Order accepted.`,
  prepTimePrompt: `How many minutes to prepare? Press 1 for 15 minutes, 2 for 30 minutes, 3 for 45 minutes, or enter your time and press hash.`,
  goodbyeWithPrepTime: `Thank you! Rider will arrive in {prepTime} minutes. Have a great day!`,
  rejectionReasonPrompt: `Please select rejection reason: 1 - Item unavailable, 2 - Too busy, 3 - Shop closed, 4 - Other reason.`,
  rejectionAcknowledged: `Thank you, we will assign this order to another vendor. Have a good day!`,
  noResponse: `No response received. Please check the app.`,
};
```

## TTS Script Generator (Mercury)

```javascript
/**
 * Generate TTS script for vendor order confirmation
 */
function generateVendorOrderTTS(order, language = 'hi') {
  const templates = language === 'hi' ? HINDI_TEMPLATES : ENGLISH_TEMPLATES;
  
  // Build items list
  const itemsList = order.orderItems.map(item => {
    if (language === 'hi') {
      return `${item.name} ${item.quantity > 1 ? `(${item.quantity} पीस)` : ''}`;
    } else {
      return `${item.name} ${item.quantity > 1 ? `(quantity ${item.quantity})` : ''}`;
    }
  }).join(', ');
  
  // Replace placeholders
  const greeting = templates.greeting
    .replace('{vendorName}', order.vendorName);
  
  const orderDetails = templates.orderDetails
    .replace('{orderId}', order.orderId)
    .replace('{itemsList}', itemsList)
    .replace('{orderAmount}', order.orderAmount)
    .replace('{paymentMethod}', order.paymentMethod || 'Cash on Delivery');
  
  const confirmation = templates.confirmationPrompt;
  
  return {
    fullScript: `${greeting} ${orderDetails} ${confirmation}`,
    greeting,
    orderDetails,
    confirmation,
    acceptedScript: templates.acceptedConfirmation,
    prepTimeScript: templates.prepTimePrompt,
    goodbyeScript: templates.goodbyeWithPrepTime,
    rejectionScript: templates.rejectionReasonPrompt,
    rejectedScript: templates.rejectionAcknowledged,
  };
}
```

## Exotel Dashboard Configuration Steps

### Step 1: Create New App Flow

1. Go to **App Bazaar** → **My Apps**
2. Click **Create New App**
3. Name: `VENDOR-ORDER-CONFIRMATION`

### Step 2: Configure Applets

#### Applet 1: Play (Greeting)
- Type: **Play**
- Text: Use greeting template
- Language: Hindi
- Voice: Female

#### Applet 2: Play (Order Details)
- Type: **Play** 
- Text: Use orderDetails template (with variables)
- **Note**: Exotel may require dynamic TTS via webhook

#### Applet 3: Gather (Confirmation)
- Type: **Gather**
- Prompt: Confirmation prompt
- Num Digits: 1
- Timeout: 10 seconds
- Retries: 2
- On 1 → Goto Applet 5 (Accepted)
- On 0 → Goto Applet 4 (Rejection Reason)
- On timeout → Goto Passthru (NO_RESPONSE)

#### Applet 4: Gather (Rejection Reason)
- Type: **Gather**
- Prompt: Rejection reason prompt
- Num Digits: 1
- Timeout: 10 seconds
- On 1/2/3/4 → Goto Passthru with reason

#### Applet 5: Play (Accepted)
- Type: **Play**
- Text: Accepted confirmation

#### Applet 6: Gather (Prep Time)
- Type: **Gather**
- Prompt: Prep time prompt
- Num Digits: 2
- Finish On Key: #
- Timeout: 15 seconds

#### Applet 7: Passthru (Report Result)
- Type: **Passthru**
- URL: `https://exotel.mangwale.ai/api/ai-voice/ai-callback`
- Method: GET

#### Applet 8: Play (Goodbye)
- Type: **Play**
- Text: Goodbye message

### Step 3: Configure Status Callback

In the **App Settings**:
- Status Callback URL: `https://exotel.mangwale.ai/api/ai-voice/ai-callback/status`
- Events: `completed`, `no-answer`, `busy`, `failed`

## Testing Checklist

- [ ] Vendor receives call with correct order details
- [ ] Hindi TTS plays clearly with correct pronunciation
- [ ] DTMF 1 triggers acceptance flow
- [ ] DTMF 0 triggers rejection flow
- [ ] Prep time collection works (15/30/45/custom)
- [ ] Rejection reason collection works (1/2/3/4)
- [ ] Mercury receives Passthru callbacks
- [ ] Jupiter receives and stores call results
- [ ] Retry logic works for no-answer/busy
- [ ] Recording URL is captured
- [ ] Call duration is logged
