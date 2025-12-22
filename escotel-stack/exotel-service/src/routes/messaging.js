/**
 * Messaging Routes - SMS & WhatsApp
 * 
 * Multi-channel messaging endpoints for:
 * - Transactional SMS (order updates, OTPs)
 * - WhatsApp rich messages (order updates, catalogs, feedback)
 * - Promotional campaigns
 * - Bulk messaging
 */

import express from 'express';
import {
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
} from '../services/messaging.service.js';

const router = express.Router();

// ============================================================================
// SMS ENDPOINTS
// ============================================================================

/**
 * GET /messaging/sms/templates
 * Get available SMS templates
 */
router.get('/sms/templates', (req, res) => {
  res.json({
    success: true,
    templates: SMS_TEMPLATES
  });
});

/**
 * POST /messaging/sms/send
 * Send custom SMS
 */
router.post('/sms/send', async (req, res) => {
  try {
    const { to, message, templateId, metadata } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({
        success: false,
        error: 'to and message are required'
      });
    }
    
    const result = await sendSMS({ to, message, templateId, metadata });
    res.json(result);
    
  } catch (error) {
    console.error('SMS send error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to send SMS',
      message: error.message
    });
  }
});

/**
 * POST /messaging/sms/template
 * Send templated SMS
 */
router.post('/sms/template', async (req, res) => {
  try {
    const { to, templateKey, variables, metadata } = req.body;
    
    if (!to || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'to and templateKey are required'
      });
    }
    
    if (!SMS_TEMPLATES[templateKey]) {
      return res.status(400).json({
        success: false,
        error: `Unknown template: ${templateKey}`,
        availableTemplates: Object.keys(SMS_TEMPLATES)
      });
    }
    
    const result = await sendTemplateSMS(to, templateKey, variables || {}, metadata);
    res.json(result);
    
  } catch (error) {
    console.error('Templated SMS error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to send templated SMS',
      message: error.message
    });
  }
});

/**
 * POST /messaging/sms/order-confirmed
 * Send order confirmed SMS
 */
router.post('/sms/order-confirmed', async (req, res) => {
  try {
    const { to, orderId, amount, trackUrl } = req.body;
    
    if (!to || !orderId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'to, orderId, and amount are required'
      });
    }
    
    const result = await sendOrderConfirmedSMS(to, orderId, amount, trackUrl);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send order confirmed SMS',
      message: error.message
    });
  }
});

/**
 * POST /messaging/sms/order-dispatched
 * Send order dispatched SMS
 */
router.post('/sms/order-dispatched', async (req, res) => {
  try {
    const { to, orderId, riderName, riderPhone, eta } = req.body;
    
    if (!to || !orderId || !riderName || !riderPhone) {
      return res.status(400).json({
        success: false,
        error: 'to, orderId, riderName, and riderPhone are required'
      });
    }
    
    const result = await sendOrderDispatchedSMS(to, orderId, riderName, riderPhone, eta);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send order dispatched SMS',
      message: error.message
    });
  }
});

/**
 * POST /messaging/sms/otp
 * Send OTP SMS
 */
router.post('/sms/otp', async (req, res) => {
  try {
    const { to, otp, validity } = req.body;
    
    if (!to || !otp) {
      return res.status(400).json({
        success: false,
        error: 'to and otp are required'
      });
    }
    
    const result = await sendOTPSMS(to, otp, validity);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send OTP SMS',
      message: error.message
    });
  }
});

/**
 * POST /messaging/sms/promo
 * Send promotional SMS
 */
router.post('/sms/promo', async (req, res) => {
  try {
    const { to, offerText, promoCode, expiry, orderUrl } = req.body;
    
    if (!to || !offerText || !promoCode || !expiry) {
      return res.status(400).json({
        success: false,
        error: 'to, offerText, promoCode, and expiry are required'
      });
    }
    
    const result = await sendPromoSMS(to, offerText, promoCode, expiry, orderUrl);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send promo SMS',
      message: error.message
    });
  }
});

/**
 * POST /messaging/sms/bulk
 * Send bulk SMS
 */
router.post('/sms/bulk', async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'messages array is required'
      });
    }
    
    if (messages.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 messages per bulk request'
      });
    }
    
    const result = await sendBulkSMS(messages);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send bulk SMS',
      message: error.message
    });
  }
});

// ============================================================================
// WHATSAPP ENDPOINTS
// ============================================================================

/**
 * GET /messaging/whatsapp/templates
 * Get available WhatsApp templates
 */
router.get('/whatsapp/templates', (req, res) => {
  res.json({
    success: true,
    templates: WHATSAPP_TEMPLATES
  });
});

/**
 * POST /messaging/whatsapp/send
 * Send WhatsApp message
 */
router.post('/whatsapp/send', async (req, res) => {
  try {
    const { to, templateName, templateParams, media, metadata } = req.body;
    
    if (!to || !templateName) {
      return res.status(400).json({
        success: false,
        error: 'to and templateName are required'
      });
    }
    
    const result = await sendWhatsApp({
      to,
      templateName,
      templateParams: templateParams || [],
      media,
      metadata
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to send WhatsApp',
      message: error.message
    });
  }
});

/**
 * POST /messaging/whatsapp/order-confirmed
 * Send order confirmed WhatsApp
 */
router.post('/whatsapp/order-confirmed', async (req, res) => {
  try {
    const { to, orderId, amount, trackUrl } = req.body;
    
    if (!to || !orderId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'to, orderId, and amount are required'
      });
    }
    
    const result = await sendOrderConfirmationWhatsApp(to, orderId, amount, trackUrl);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send order confirmed WhatsApp',
      message: error.message
    });
  }
});

/**
 * POST /messaging/whatsapp/order-dispatched
 * Send order dispatched WhatsApp
 */
router.post('/whatsapp/order-dispatched', async (req, res) => {
  try {
    const { to, orderId, riderName, eta } = req.body;
    
    if (!to || !orderId || !riderName) {
      return res.status(400).json({
        success: false,
        error: 'to, orderId, and riderName are required'
      });
    }
    
    const result = await sendOrderDispatchedWhatsApp(to, orderId, riderName, eta || '30 mins');
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send order dispatched WhatsApp',
      message: error.message
    });
  }
});

/**
 * POST /messaging/whatsapp/order-delivered
 * Send order delivered WhatsApp with feedback
 */
router.post('/whatsapp/order-delivered', async (req, res) => {
  try {
    const { to, orderId } = req.body;
    
    if (!to || !orderId) {
      return res.status(400).json({
        success: false,
        error: 'to and orderId are required'
      });
    }
    
    const result = await sendOrderDeliveredWhatsApp(to, orderId);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send order delivered WhatsApp',
      message: error.message
    });
  }
});

/**
 * POST /messaging/whatsapp/catalog
 * Send catalog WhatsApp
 */
router.post('/whatsapp/catalog', async (req, res) => {
  try {
    const { to, catalogUrl, imageUrl } = req.body;
    
    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'to is required'
      });
    }
    
    const result = await sendCatalogWhatsApp(to, catalogUrl, imageUrl);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send catalog WhatsApp',
      message: error.message
    });
  }
});

/**
 * POST /messaging/whatsapp/cart-reminder
 * Send cart reminder WhatsApp
 */
router.post('/whatsapp/cart-reminder', async (req, res) => {
  try {
    const { to, cartId } = req.body;
    
    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'to is required'
      });
    }
    
    const result = await sendCartReminderWhatsApp(to, cartId);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send cart reminder WhatsApp',
      message: error.message
    });
  }
});

/**
 * POST /messaging/whatsapp/bulk
 * Send bulk WhatsApp
 */
router.post('/whatsapp/bulk', async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'messages array is required'
      });
    }
    
    if (messages.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 WhatsApp messages per bulk request'
      });
    }
    
    const result = await sendBulkWhatsApp(messages);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send bulk WhatsApp',
      message: error.message
    });
  }
});

// ============================================================================
// MULTI-CHANNEL ENDPOINTS
// ============================================================================

/**
 * POST /messaging/send
 * Send message via best available channel (WhatsApp first, SMS fallback)
 */
router.post('/send', async (req, res) => {
  try {
    const { to, type, data } = req.body;
    
    if (!to || !type || !data) {
      return res.status(400).json({
        success: false,
        error: 'to, type, and data are required'
      });
    }
    
    const validTypes = ['order_confirmed', 'order_dispatched', 'order_delivered'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }
    
    const result = await sendMessage(to, type, data);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send message',
      message: error.message
    });
  }
});

// ============================================================================
// STATUS & WEBHOOKS
// ============================================================================

/**
 * GET /messaging/status/:messageId
 * Get message status
 */
router.get('/status/:messageId', (req, res) => {
  const { messageId } = req.params;
  
  const status = getMessageStatus(messageId);
  
  if (!status) {
    return res.status(404).json({
      success: false,
      error: 'Message not found'
    });
  }
  
  res.json({
    success: true,
    message: status
  });
});

/**
 * GET /messaging/stats
 * Get messaging statistics
 */
router.get('/stats', (req, res) => {
  const stats = getMessagingStats();
  
  res.json({
    success: true,
    stats
  });
});

/**
 * POST /messaging/webhook/delivery
 * Handle delivery status webhook
 */
router.post('/webhook/delivery', (req, res) => {
  console.log('📬 Delivery webhook received:', req.body);
  
  const result = handleDeliveryStatus(req.body);
  res.json(result);
});

/**
 * POST /messaging/webhook/incoming
 * Handle incoming WhatsApp messages
 */
router.post('/webhook/incoming', (req, res) => {
  console.log('📥 Incoming message webhook:', req.body);
  
  const result = handleIncomingWhatsApp(req.body);
  res.json(result);
});

export default router;
