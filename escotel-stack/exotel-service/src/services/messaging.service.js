/**
 * Messaging Service - SMS & WhatsApp Integration
 * 
 * Multi-channel messaging for Mangwale:
 * - SMS for order updates, OTPs, alerts
 * - WhatsApp for rich media, catalogs, customer engagement
 * 
 * Uses Exotel's messaging APIs
 */

import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { emitEvent } from '../utils/events.js';
import NodeCache from 'node-cache';

// Message cache (TTL: 24 hours)
const messageCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

// ============================================================================
// CONFIGURATION
// ============================================================================

// SMS Templates (DLT registered for India)
export const SMS_TEMPLATES = {
  ORDER_CONFIRMED: {
    id: 'order_confirmed_v1',
    template: 'Your Mangwale order #{ORDER_ID} has been confirmed! Amount: Rs.{AMOUNT}. Track: {TRACK_URL}',
    variables: ['ORDER_ID', 'AMOUNT', 'TRACK_URL']
  },
  ORDER_DISPATCHED: {
    id: 'order_dispatched_v1',
    template: 'Your Mangwale order #{ORDER_ID} is on the way! Rider: {RIDER_NAME}, Contact: {RIDER_PHONE}. ETA: {ETA}',
    variables: ['ORDER_ID', 'RIDER_NAME', 'RIDER_PHONE', 'ETA']
  },
  ORDER_DELIVERED: {
    id: 'order_delivered_v1',
    template: 'Your Mangwale order #{ORDER_ID} has been delivered! Thank you for ordering. Rate us: {FEEDBACK_URL}',
    variables: ['ORDER_ID', 'FEEDBACK_URL']
  },
  OTP: {
    id: 'otp_v1',
    template: 'Your Mangwale OTP is {OTP}. Valid for {VALIDITY} minutes. Do not share with anyone.',
    variables: ['OTP', 'VALIDITY']
  },
  PAYMENT_RECEIVED: {
    id: 'payment_received_v1',
    template: 'Payment of Rs.{AMOUNT} received for Mangwale order #{ORDER_ID}. Thank you!',
    variables: ['AMOUNT', 'ORDER_ID']
  },
  PROMO: {
    id: 'promo_v1',
    template: 'Mangwale: {OFFER_TEXT}! Use code {PROMO_CODE}. Valid till {EXPIRY}. Order now: {ORDER_URL}',
    variables: ['OFFER_TEXT', 'PROMO_CODE', 'EXPIRY', 'ORDER_URL']
  },
  DELIVERY_DELAY: {
    id: 'delivery_delay_v1',
    template: 'Mangwale: Your order #{ORDER_ID} is slightly delayed. New ETA: {NEW_ETA}. We apologize for the inconvenience.',
    variables: ['ORDER_ID', 'NEW_ETA']
  }
};

// WhatsApp Templates (pre-approved)
export const WHATSAPP_TEMPLATES = {
  ORDER_CONFIRMATION: {
    name: 'order_confirmation',
    language: 'en',
    components: [
      { type: 'header', format: 'IMAGE' },
      { type: 'body', text: 'Your order from Mangwale is confirmed! 🎉\n\nOrder ID: {{1}}\nTotal: ₹{{2}}\n\nYou can track your order here:' },
      { type: 'button', subType: 'url', text: 'Track Order' }
    ]
  },
  ORDER_DISPATCHED: {
    name: 'order_dispatched',
    language: 'en',
    components: [
      { type: 'body', text: 'Your Mangwale order is on the way! 🚀\n\nOrder ID: {{1}}\nRider: {{2}}\nETA: {{3}}\n\nCall rider if needed:' },
      { type: 'button', subType: 'phone', text: 'Call Rider' }
    ]
  },
  ORDER_DELIVERED: {
    name: 'order_delivered',
    language: 'en',
    components: [
      { type: 'body', text: 'Order delivered! 🎊\n\nThank you for ordering from Mangwale!\n\nHow was your experience?' },
      { type: 'button', subType: 'quick_reply', text: '⭐ Great!' },
      { type: 'button', subType: 'quick_reply', text: '😐 Okay' },
      { type: 'button', subType: 'quick_reply', text: '😞 Issue' }
    ]
  },
  CATALOG_SHARE: {
    name: 'catalog_share',
    language: 'en',
    components: [
      { type: 'header', format: 'IMAGE' },
      { type: 'body', text: 'Check out our latest products! 🛒\n\nFresh vegetables, fruits, groceries and more delivered to your doorstep.' },
      { type: 'button', subType: 'url', text: 'Browse Catalog' }
    ]
  },
  CART_REMINDER: {
    name: 'cart_reminder',
    language: 'en',
    components: [
      { type: 'body', text: 'Hey! 👋\n\nYou left items in your cart. Complete your order now and get free delivery!' },
      { type: 'button', subType: 'url', text: 'Complete Order' }
    ]
  },
  FEEDBACK_REQUEST: {
    name: 'feedback_request',
    language: 'en',
    components: [
      { type: 'body', text: 'Hi {{1}}! 👋\n\nWe hope you enjoyed your recent order. Your feedback helps us improve!\n\nRate your experience:' },
      { type: 'button', subType: 'url', text: 'Give Feedback' }
    ]
  }
};

function getExotelConfig() {
  const cfg = getConfig();
  const { sid, apiKey, apiToken, region, subdomain } = cfg.exotel;
  
  const smsBaseUrl = region 
    ? `https://${subdomain}.${region}.exotel.com/v1/Accounts/${sid}`
    : `https://${subdomain}.exotel.com/v1/Accounts/${sid}`;
    
  // WhatsApp API (typically different endpoint)
  const whatsappBaseUrl = cfg.exotel.whatsappApiUrl || `https://api.exotel.com/v1/Accounts/${sid}/WhatsApp`;
    
  return {
    smsBaseUrl,
    whatsappBaseUrl,
    auth: { username: apiKey, password: apiToken },
    sid,
    senderId: cfg.exotel.smsSenderId || 'MNGWLE'
  };
}

// ============================================================================
// SMS FUNCTIONS
// ============================================================================

/**
 * Send SMS
 * 
 * @param {Object} params - SMS parameters
 * @param {string} params.to - Recipient phone number
 * @param {string} params.message - SMS text
 * @param {string} params.templateId - DLT template ID (required for India)
 * @param {Object} params.metadata - Additional metadata
 */
export async function sendSMS(params) {
  const {
    to,
    message,
    templateId,
    metadata = {}
  } = params;
  
  const config = getExotelConfig();
  
  try {
    const smsData = {
      From: config.senderId,
      To: formatPhoneNumber(to),
      Body: message,
      // DLT compliance for India
      DLTTemplateId: templateId,
      // Custom field for tracking
      CustomField: JSON.stringify({
        ...metadata,
        sentAt: new Date().toISOString()
      })
    };
    
    console.log(`📱 Sending SMS to ${to}`);
    
    const response = await axios.post(
      `${config.smsBaseUrl}/Sms/send`,
      new URLSearchParams(smsData).toString(),
      {
        auth: config.auth,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    const messageId = response.data.SMSMessage?.Sid || `sms_${Date.now()}`;
    
    // Cache message
    messageCache.set(messageId, {
      id: messageId,
      type: 'sms',
      to,
      message: message.substring(0, 50) + '...',
      status: 'sent',
      createdAt: new Date().toISOString(),
      metadata
    });
    
    // Emit event
    emitEvent({
      type: 'sms.sent',
      at: new Date().toISOString(),
      messageId,
      to
    });
    
    console.log(`✅ SMS sent: ${messageId}`);
    
    return {
      success: true,
      messageId,
      status: 'sent',
      to
    };
    
  } catch (error) {
    console.error(`❌ SMS failed: ${error.response?.data || error.message}`);
    
    // Simulate in development
    if (process.env.NODE_ENV !== 'production') {
      return simulateSMS(params);
    }
    
    throw new Error(`SMS failed: ${error.message}`);
  }
}

/**
 * Simulate SMS for development
 */
function simulateSMS(params) {
  const messageId = `sim_sms_${Date.now()}`;
  console.log(`⚠️ Simulated SMS: ${messageId}`);
  return {
    success: true,
    messageId,
    status: 'simulated',
    to: params.to,
    simulated: true
  };
}

/**
 * Send templated SMS
 */
export async function sendTemplateSMS(to, templateKey, variables, metadata = {}) {
  const template = SMS_TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown SMS template: ${templateKey}`);
  }
  
  // Replace variables in template
  let message = template.template;
  for (const [key, value] of Object.entries(variables)) {
    message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  
  return sendSMS({
    to,
    message,
    templateId: template.id,
    metadata: {
      templateKey,
      ...metadata
    }
  });
}

/**
 * Send order confirmed SMS
 */
export async function sendOrderConfirmedSMS(to, orderId, amount, trackUrl) {
  return sendTemplateSMS(to, 'ORDER_CONFIRMED', {
    ORDER_ID: orderId,
    AMOUNT: amount,
    TRACK_URL: trackUrl || `https://mangwale.com/track/${orderId}`
  }, { orderId });
}

/**
 * Send order dispatched SMS
 */
export async function sendOrderDispatchedSMS(to, orderId, riderName, riderPhone, eta) {
  return sendTemplateSMS(to, 'ORDER_DISPATCHED', {
    ORDER_ID: orderId,
    RIDER_NAME: riderName,
    RIDER_PHONE: riderPhone,
    ETA: eta || '30 mins'
  }, { orderId });
}

/**
 * Send OTP SMS
 */
export async function sendOTPSMS(to, otp, validity = 5) {
  return sendTemplateSMS(to, 'OTP', {
    OTP: otp,
    VALIDITY: validity.toString()
  }, { type: 'otp' });
}

/**
 * Send promo SMS
 */
export async function sendPromoSMS(to, offerText, promoCode, expiry, orderUrl) {
  return sendTemplateSMS(to, 'PROMO', {
    OFFER_TEXT: offerText,
    PROMO_CODE: promoCode,
    EXPIRY: expiry,
    ORDER_URL: orderUrl || 'https://mangwale.com'
  }, { type: 'promo', promoCode });
}

// ============================================================================
// WHATSAPP FUNCTIONS
// ============================================================================

/**
 * Send WhatsApp message
 * 
 * @param {Object} params - WhatsApp message parameters
 * @param {string} params.to - Recipient phone number (with country code)
 * @param {string} params.templateName - Template name
 * @param {Array} params.templateParams - Template parameters
 * @param {Object} params.media - Media attachment (optional)
 * @param {Object} params.metadata - Additional metadata
 */
export async function sendWhatsApp(params) {
  const {
    to,
    templateName,
    templateParams = [],
    media,
    metadata = {}
  } = params;
  
  const config = getExotelConfig();
  
  try {
    const waData = {
      to: formatPhoneNumber(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: []
      }
    };
    
    // Add header with media if provided
    if (media && media.url) {
      waData.template.components.push({
        type: 'header',
        parameters: [{
          type: media.type || 'image',
          [media.type || 'image']: { link: media.url }
        }]
      });
    }
    
    // Add body parameters
    if (templateParams.length > 0) {
      waData.template.components.push({
        type: 'body',
        parameters: templateParams.map(p => ({
          type: 'text',
          text: p
        }))
      });
    }
    
    console.log(`📲 Sending WhatsApp to ${to} | Template: ${templateName}`);
    
    const response = await axios.post(
      `${config.whatsappBaseUrl}/Messages`,
      waData,
      {
        auth: config.auth,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    const messageId = response.data.id || `wa_${Date.now()}`;
    
    // Cache message
    messageCache.set(messageId, {
      id: messageId,
      type: 'whatsapp',
      to,
      templateName,
      status: 'sent',
      createdAt: new Date().toISOString(),
      metadata
    });
    
    // Emit event
    emitEvent({
      type: 'whatsapp.sent',
      at: new Date().toISOString(),
      messageId,
      to,
      templateName
    });
    
    console.log(`✅ WhatsApp sent: ${messageId}`);
    
    return {
      success: true,
      messageId,
      status: 'sent',
      to,
      templateName
    };
    
  } catch (error) {
    console.error(`❌ WhatsApp failed: ${error.response?.data || error.message}`);
    
    // Simulate in development
    if (process.env.NODE_ENV !== 'production') {
      return simulateWhatsApp(params);
    }
    
    throw new Error(`WhatsApp failed: ${error.message}`);
  }
}

/**
 * Simulate WhatsApp for development
 */
function simulateWhatsApp(params) {
  const messageId = `sim_wa_${Date.now()}`;
  console.log(`⚠️ Simulated WhatsApp: ${messageId}`);
  return {
    success: true,
    messageId,
    status: 'simulated',
    to: params.to,
    templateName: params.templateName,
    simulated: true
  };
}

/**
 * Send order confirmation WhatsApp
 */
export async function sendOrderConfirmationWhatsApp(to, orderId, amount, trackUrl) {
  return sendWhatsApp({
    to,
    templateName: 'order_confirmation',
    templateParams: [orderId, amount.toString()],
    media: {
      type: 'image',
      url: 'https://mangwale.com/images/order-confirmed.png'
    },
    metadata: { orderId, type: 'order_confirmation' }
  });
}

/**
 * Send order dispatched WhatsApp
 */
export async function sendOrderDispatchedWhatsApp(to, orderId, riderName, eta) {
  return sendWhatsApp({
    to,
    templateName: 'order_dispatched',
    templateParams: [orderId, riderName, eta],
    metadata: { orderId, type: 'order_dispatched' }
  });
}

/**
 * Send order delivered WhatsApp with feedback buttons
 */
export async function sendOrderDeliveredWhatsApp(to, orderId) {
  return sendWhatsApp({
    to,
    templateName: 'order_delivered',
    templateParams: [],
    metadata: { orderId, type: 'order_delivered' }
  });
}

/**
 * Send catalog WhatsApp
 */
export async function sendCatalogWhatsApp(to, catalogUrl, imageUrl) {
  return sendWhatsApp({
    to,
    templateName: 'catalog_share',
    templateParams: [],
    media: {
      type: 'image',
      url: imageUrl || 'https://mangwale.com/images/catalog.png'
    },
    metadata: { type: 'catalog' }
  });
}

/**
 * Send cart reminder WhatsApp
 */
export async function sendCartReminderWhatsApp(to, cartId) {
  return sendWhatsApp({
    to,
    templateName: 'cart_reminder',
    templateParams: [],
    metadata: { cartId, type: 'cart_reminder' }
  });
}

// ============================================================================
// MULTI-CHANNEL MESSAGING
// ============================================================================

/**
 * Send message via best available channel
 * Tries WhatsApp first, falls back to SMS
 */
export async function sendMessage(to, type, data) {
  const results = { whatsapp: null, sms: null };
  
  // Try WhatsApp first (richer experience)
  try {
    switch (type) {
      case 'order_confirmed':
        results.whatsapp = await sendOrderConfirmationWhatsApp(
          to, data.orderId, data.amount, data.trackUrl
        );
        break;
      case 'order_dispatched':
        results.whatsapp = await sendOrderDispatchedWhatsApp(
          to, data.orderId, data.riderName, data.eta
        );
        break;
      case 'order_delivered':
        results.whatsapp = await sendOrderDeliveredWhatsApp(to, data.orderId);
        break;
    }
  } catch (waError) {
    console.warn(`WhatsApp failed, trying SMS: ${waError.message}`);
  }
  
  // Always send SMS as backup for critical messages
  if (!results.whatsapp?.success || ['order_confirmed', 'order_dispatched'].includes(type)) {
    try {
      switch (type) {
        case 'order_confirmed':
          results.sms = await sendOrderConfirmedSMS(
            to, data.orderId, data.amount, data.trackUrl
          );
          break;
        case 'order_dispatched':
          results.sms = await sendOrderDispatchedSMS(
            to, data.orderId, data.riderName, data.riderPhone, data.eta
          );
          break;
      }
    } catch (smsError) {
      console.error(`SMS also failed: ${smsError.message}`);
    }
  }
  
  return {
    success: results.whatsapp?.success || results.sms?.success,
    whatsapp: results.whatsapp,
    sms: results.sms
  };
}

// ============================================================================
// BULK MESSAGING
// ============================================================================

/**
 * Send bulk SMS
 */
export async function sendBulkSMS(messages) {
  const results = [];
  const errors = [];
  
  for (const msg of messages) {
    try {
      const result = await sendSMS(msg);
      results.push(result);
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      errors.push({ to: msg.to, error: error.message });
    }
  }
  
  return {
    success: errors.length === 0,
    total: messages.length,
    successful: results.length,
    failed: errors.length,
    results,
    errors
  };
}

/**
 * Send bulk WhatsApp
 */
export async function sendBulkWhatsApp(messages) {
  const results = [];
  const errors = [];
  
  for (const msg of messages) {
    try {
      const result = await sendWhatsApp(msg);
      results.push(result);
      // Rate limiting (WhatsApp has stricter limits)
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      errors.push({ to: msg.to, error: error.message });
    }
  }
  
  return {
    success: errors.length === 0,
    total: messages.length,
    successful: results.length,
    failed: errors.length,
    results,
    errors
  };
}

// ============================================================================
// STATUS & WEBHOOKS
// ============================================================================

/**
 * Handle delivery status webhook
 */
export function handleDeliveryStatus(data) {
  const { MessageSid, Status, To, ErrorCode } = data;
  
  const cached = messageCache.get(MessageSid);
  if (cached) {
    cached.status = Status;
    cached.errorCode = ErrorCode;
    cached.updatedAt = new Date().toISOString();
    messageCache.set(MessageSid, cached);
  }
  
  emitEvent({
    type: 'message.status',
    at: new Date().toISOString(),
    messageId: MessageSid,
    status: Status,
    to: To
  });
  
  return { received: true, status: Status };
}

/**
 * Handle incoming WhatsApp message
 */
export function handleIncomingWhatsApp(data) {
  console.log('📥 Incoming WhatsApp:', data);
  
  emitEvent({
    type: 'whatsapp.incoming',
    at: new Date().toISOString(),
    from: data.From,
    body: data.Body,
    mediaUrl: data.MediaUrl
  });
  
  // This could trigger auto-responses or route to customer service
  return { received: true };
}

/**
 * Get message status
 */
export function getMessageStatus(messageId) {
  return messageCache.get(messageId);
}

/**
 * Get messaging statistics
 */
export function getMessagingStats() {
  const keys = messageCache.keys();
  const messages = keys.map(k => messageCache.get(k));
  
  const stats = {
    total: messages.length,
    sms: { sent: 0, delivered: 0, failed: 0 },
    whatsapp: { sent: 0, delivered: 0, failed: 0 }
  };
  
  messages.forEach(msg => {
    const channel = msg.type === 'sms' ? 'sms' : 'whatsapp';
    stats[channel].sent++;
    if (msg.status === 'delivered') stats[channel].delivered++;
    if (msg.status === 'failed') stats[channel].failed++;
  });
  
  return stats;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatPhoneNumber(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+91')) return cleaned;
  if (cleaned.startsWith('91') && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 10) return `+91${cleaned}`;
  return cleaned;
}

export default {
  SMS_TEMPLATES,
  WHATSAPP_TEMPLATES,
  sendSMS,
  sendTemplateSMS,
  sendOrderConfirmedSMS,
  sendOrderDispatchedSMS,
  sendOTPSMS,
  sendPromoSMS,
  sendWhatsApp,
  sendOrderConfirmationWhatsApp,
  sendOrderDispatchedWhatsApp,
  sendOrderDeliveredWhatsApp,
  sendCatalogWhatsApp,
  sendCartReminderWhatsApp,
  sendMessage,
  sendBulkSMS,
  sendBulkWhatsApp,
  handleDeliveryStatus,
  handleIncomingWhatsApp,
  getMessageStatus,
  getMessagingStats
};
