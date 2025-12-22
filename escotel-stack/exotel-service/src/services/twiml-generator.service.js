/**
 * TwiML Generator Service
 * 
 * Generates Exotel-compatible TwiML for AI voice calls.
 * Supports:
 * - Dynamic audio playback (TTS generated)
 * - DTMF gathering
 * - Speech recognition
 * - Recording
 * - Call routing
 */

// ============================================================================
// BASE TWIML RESPONSES
// ============================================================================

/**
 * Generate TwiML for playing audio and gathering DTMF/Speech
 */
export function gatherResponse({
  audioUrl,
  text,
  voice = 'Polly.Aditi', // Hindi female voice
  language = 'hi-IN',
  numDigits = 1,
  timeout = 10,
  speechTimeout = 3,
  input = 'dtmf',  // 'dtmf', 'speech', or 'dtmf speech'
  actionUrl,
  callSid,
  loop = 1,
}) {
  const twiml = [];
  twiml.push('<?xml version="1.0" encoding="UTF-8"?>');
  twiml.push('<Response>');
  
  // Gather block
  twiml.push(`  <Gather input="${input}" `);
  twiml.push(`          numDigits="${numDigits}" `);
  twiml.push(`          timeout="${timeout}" `);
  if (input.includes('speech')) {
    twiml.push(`          speechTimeout="${speechTimeout}" `);
    twiml.push(`          language="${language}" `);
  }
  if (actionUrl) {
    twiml.push(`          action="${actionUrl}" `);
  }
  twiml.push(`          method="POST">`);
  
  // Play audio or say text
  if (audioUrl) {
    twiml.push(`    <Play loop="${loop}">${audioUrl}</Play>`);
  } else if (text) {
    twiml.push(`    <Say voice="${voice}" language="${language}">${escapeXml(text)}</Say>`);
  }
  
  twiml.push('  </Gather>');
  
  // Redirect if no input
  twiml.push(`  <Redirect method="POST">${actionUrl || '/api/voice/ai-callback/' + callSid + '/timeout'}</Redirect>`);
  
  twiml.push('</Response>');
  
  return twiml.join('\n');
}

/**
 * Generate TwiML for playing audio only (no input)
 */
export function playResponse({
  audioUrl,
  text,
  voice = 'Polly.Aditi',
  language = 'hi-IN',
  loop = 1,
  redirectUrl,
}) {
  const twiml = [];
  twiml.push('<?xml version="1.0" encoding="UTF-8"?>');
  twiml.push('<Response>');
  
  if (audioUrl) {
    twiml.push(`  <Play loop="${loop}">${audioUrl}</Play>`);
  } else if (text) {
    twiml.push(`  <Say voice="${voice}" language="${language}">${escapeXml(text)}</Say>`);
  }
  
  if (redirectUrl) {
    twiml.push(`  <Redirect method="POST">${redirectUrl}</Redirect>`);
  }
  
  twiml.push('</Response>');
  
  return twiml.join('\n');
}

/**
 * Generate TwiML for recording
 */
export function recordResponse({
  text,
  voice = 'Polly.Aditi',
  language = 'hi-IN',
  maxLength = 30,
  timeout = 5,
  finishOnKey = '#',
  actionUrl,
  transcribe = true,
  transcribeCallback,
}) {
  const twiml = [];
  twiml.push('<?xml version="1.0" encoding="UTF-8"?>');
  twiml.push('<Response>');
  
  if (text) {
    twiml.push(`  <Say voice="${voice}" language="${language}">${escapeXml(text)}</Say>`);
  }
  
  twiml.push(`  <Record maxLength="${maxLength}" `);
  twiml.push(`          timeout="${timeout}" `);
  twiml.push(`          finishOnKey="${finishOnKey}" `);
  if (actionUrl) {
    twiml.push(`          action="${actionUrl}" `);
  }
  twiml.push(`          method="POST" `);
  twiml.push(`          playBeep="true"/>`);
  
  twiml.push('</Response>');
  
  return twiml.join('\n');
}

/**
 * Generate TwiML for hangup
 */
export function hangupResponse({
  text,
  voice = 'Polly.Aditi',
  language = 'hi-IN',
}) {
  const twiml = [];
  twiml.push('<?xml version="1.0" encoding="UTF-8"?>');
  twiml.push('<Response>');
  
  if (text) {
    twiml.push(`  <Say voice="${voice}" language="${language}">${escapeXml(text)}</Say>`);
  }
  
  twiml.push('  <Hangup/>');
  twiml.push('</Response>');
  
  return twiml.join('\n');
}

/**
 * Generate TwiML for dial/transfer
 */
export function dialResponse({
  number,
  callerId,
  text,
  voice = 'Polly.Aditi',
  language = 'hi-IN',
  timeout = 30,
  timeLimit = 300,
  record = true,
  statusCallback,
}) {
  const twiml = [];
  twiml.push('<?xml version="1.0" encoding="UTF-8"?>');
  twiml.push('<Response>');
  
  if (text) {
    twiml.push(`  <Say voice="${voice}" language="${language}">${escapeXml(text)}</Say>`);
  }
  
  twiml.push(`  <Dial timeout="${timeout}" `);
  twiml.push(`        timeLimit="${timeLimit}" `);
  if (callerId) {
    twiml.push(`        callerId="${callerId}" `);
  }
  if (record) {
    twiml.push(`        record="record-from-answer" `);
  }
  if (statusCallback) {
    twiml.push(`        statusCallback="${statusCallback}" `);
  }
  twiml.push(`        method="POST">`);
  twiml.push(`    <Number>${number}</Number>`);
  twiml.push('  </Dial>');
  
  twiml.push('</Response>');
  
  return twiml.join('\n');
}

// ============================================================================
// VENDOR ORDER CONFIRMATION FLOWS
// ============================================================================

/**
 * Generate TwiML for vendor order confirmation - Initial greeting
 */
export function vendorOrderGreeting(data, callSid, language = 'hi') {
  const scripts = {
    hi: {
      greeting: `नमस्ते, यह मंगवाले से कॉल है। ${data.storeName} के लिए एक नया ऑर्डर आया है।`,
      details: `ऑर्डर नंबर ${data.orderId}, ${data.itemsCount} आइटम, कुल ${data.orderAmount} रुपये। ${data.paymentMethod}।`,
      prompt: 'क्या आप यह ऑर्डर स्वीकार करते हैं? स्वीकार करने के लिए 1 दबाएं, अस्वीकार करने के लिए 2 दबाएं।',
    },
    en: {
      greeting: `Hello, this is Mangwale calling. You have a new order for ${data.storeName}.`,
      details: `Order number ${data.orderId}, ${data.itemsCount} items, total ${data.orderAmount} rupees. ${data.paymentMethod}.`,
      prompt: 'Do you accept this order? Press 1 to accept, press 2 to reject.',
    },
    mr: {
      greeting: `नमस्कार, हा मंगवाले कडून कॉल आहे। ${data.storeName} साठी नवीन ऑर्डर आली आहे.`,
      details: `ऑर्डर नंबर ${data.orderId}, ${data.itemsCount} आयटम, एकूण ${data.orderAmount} रुपये। ${data.paymentMethod}।`,
      prompt: 'तुम्ही ही ऑर्डर स्वीकारता का? स्वीकारण्यासाठी 1 दाबा, नाकारण्यासाठी 2 दाबा.',
    },
  };

  const script = scripts[language] || scripts['en'];
  const fullText = `${script.greeting} ${script.details} ${script.prompt}`;

  return gatherResponse({
    text: fullText,
    voice: language === 'hi' ? 'Polly.Aditi' : language === 'mr' ? 'Polly.Aditi' : 'Polly.Raveena',
    language: language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : 'en-IN',
    numDigits: 1,
    timeout: 15,
    input: 'dtmf',
    actionUrl: `http://192.168.0.151:3100/api/voice/ai-callback/${callSid}/dtmf`,
    callSid,
  });
}

/**
 * Generate TwiML for prep time selection
 */
export function vendorPrepTimePrompt(callSid, language = 'hi') {
  const scripts = {
    hi: 'धन्यवाद! ऑर्डर कितने मिनट में तैयार होगा? 15 मिनट के लिए 1 दबाएं, 30 मिनट के लिए 2 दबाएं, 45 मिनट के लिए 3 दबाएं।',
    en: 'Thank you! How long to prepare? Press 1 for 15 minutes, 2 for 30 minutes, 3 for 45 minutes.',
    mr: 'धन्यवाद! ऑर्डर किती मिनिटांत तयार होईल? 15 मिनिटांसाठी 1 दाबा, 30 मिनिटांसाठी 2 दाबा, 45 मिनिटांसाठी 3 दाबा.',
  };

  return gatherResponse({
    text: scripts[language] || scripts['en'],
    voice: language === 'hi' ? 'Polly.Aditi' : 'Polly.Raveena',
    language: language === 'hi' ? 'hi-IN' : 'en-IN',
    numDigits: 1,
    timeout: 10,
    input: 'dtmf',
    actionUrl: `http://192.168.0.151:3100/api/voice/ai-callback/${callSid}/dtmf`,
    callSid,
  });
}

/**
 * Generate TwiML for rejection reason collection
 */
export function vendorRejectionReasonPrompt(callSid, language = 'hi') {
  const scripts = {
    hi: 'कृपया ऑर्डर अस्वीकार करने का कारण बताएं। बीप के बाद बोलें।',
    en: 'Please tell us why you are rejecting the order. Speak after the beep.',
    mr: 'कृपया ऑर्डर नाकारण्याचे कारण सांगा. बीप नंतर बोला.',
  };

  return recordResponse({
    text: scripts[language] || scripts['en'],
    voice: language === 'hi' ? 'Polly.Aditi' : 'Polly.Raveena',
    language: language === 'hi' ? 'hi-IN' : 'en-IN',
    maxLength: 30,
    timeout: 5,
    actionUrl: `http://192.168.0.151:3100/api/voice/ai-callback/${callSid}/recording`,
  });
}

/**
 * Generate TwiML for confirmation and goodbye
 */
export function vendorConfirmationGoodbye(prepTime, callSid, language = 'hi') {
  const scripts = {
    hi: `धन्यवाद! ऑर्डर ${prepTime} मिनट में तैयार होगा। राइडर जल्द ही पहुंचेगा। शुभ दिन!`,
    en: `Thank you! Order will be ready in ${prepTime} minutes. Rider will arrive soon. Have a great day!`,
    mr: `धन्यवाद! ऑर्डर ${prepTime} मिनिटांत तयार होईल. रायडर लवकरच येईल. शुभ दिन!`,
  };

  return hangupResponse({
    text: scripts[language] || scripts['en'],
    voice: language === 'hi' ? 'Polly.Aditi' : 'Polly.Raveena',
    language: language === 'hi' ? 'hi-IN' : 'en-IN',
  });
}

// ============================================================================
// RIDER ASSIGNMENT FLOWS
// ============================================================================

/**
 * Generate TwiML for rider assignment notification
 */
export function riderAssignmentGreeting(data, callSid, language = 'hi') {
  const scripts = {
    hi: {
      greeting: `नमस्ते, यह मंगवाले से कॉल है। आपके लिए एक नई डिलीवरी है।`,
      pickup: `पिकअप: ${data.pickupAddress}। दुकान: ${data.storeName}।`,
      delivery: `डिलीवरी: ${data.deliveryAddress}। ग्राहक: ${data.customerName}।`,
      prompt: 'क्या आप यह डिलीवरी स्वीकार करते हैं? स्वीकार के लिए 1 दबाएं।',
    },
    en: {
      greeting: `Hello, this is Mangwale. You have a new delivery.`,
      pickup: `Pickup from: ${data.pickupAddress}. Store: ${data.storeName}.`,
      delivery: `Deliver to: ${data.deliveryAddress}. Customer: ${data.customerName}.`,
      prompt: 'Do you accept this delivery? Press 1 to accept.',
    },
  };

  const script = scripts[language] || scripts['en'];
  const fullText = `${script.greeting} ${script.pickup} ${script.delivery} ${script.prompt}`;

  return gatherResponse({
    text: fullText,
    voice: language === 'hi' ? 'Polly.Aditi' : 'Polly.Raveena',
    language: language === 'hi' ? 'hi-IN' : 'en-IN',
    numDigits: 1,
    timeout: 15,
    input: 'dtmf',
    actionUrl: `http://192.168.0.151:3100/api/voice/ai-callback/${callSid}/dtmf`,
    callSid,
  });
}

/**
 * Generate TwiML for rider acceptance confirmation
 */
export function riderAcceptanceConfirmation(callSid, language = 'hi') {
  const scripts = {
    hi: 'धन्यवाद! डिलीवरी स्वीकार हो गई। पिकअप का पता व्हाट्सएप पर भेज दिया गया है। शुभ दिन!',
    en: 'Thank you! Delivery accepted. Pickup address sent to WhatsApp. Have a good day!',
  };

  return hangupResponse({
    text: scripts[language] || scripts['en'],
    voice: language === 'hi' ? 'Polly.Aditi' : 'Polly.Raveena',
    language: language === 'hi' ? 'hi-IN' : 'en-IN',
  });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  gatherResponse,
  playResponse,
  recordResponse,
  hangupResponse,
  dialResponse,
  vendorOrderGreeting,
  vendorPrepTimePrompt,
  vendorRejectionReasonPrompt,
  vendorConfirmationGoodbye,
  riderAssignmentGreeting,
  riderAcceptanceConfirmation,
};
