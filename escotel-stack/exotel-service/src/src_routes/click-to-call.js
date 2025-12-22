/**
 * Click-to-Call Routes for Mangwale
 * 
 * Enables one-tap calling from the Mangwale app:
 * - Customer → Vendor (order queries)
 * - Customer → Rider (delivery coordination)  
 * - Customer → Support (issues)
 * - App initiates call → Exotel connects both parties
 * 
 * All calls use number masking for privacy.
 */

import express from 'express';
import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { emitEvent } from '../utils/events.js';
import { publish } from '../utils/mq.js';
import {
  getOrderDetails,
  getStoreDetails,
  getDeliveryManDetails,
  getCustomerByPhone
} from '../services/jupiter.service.js';
import {
  getMaskedSession,
  createMaskedSession
} from '../services/number-masking.service.js';

const router = express.Router();

// ============================================================================
// EXOTEL API CONFIGURATION
// ============================================================================

function getExotelConfig() {
  const cfg = getConfig();
  const { sid, apiKey, apiToken, region, subdomain } = cfg.exotel;
  
  const baseUrl = region 
    ? `https://${subdomain}.${region}.exotel.com/v1/Accounts/${sid}`
    : `https://${subdomain}.exotel.com/v1/Accounts/${sid}`;
    
  return {
    baseUrl,
    auth: { username: apiKey, password: apiToken },
    sid
  };
}

// Support line number (configurable)
const SUPPORT_LINE = process.env.SUPPORT_PHONE || '+919876543210';

// ============================================================================
// CLICK-TO-CALL ENDPOINTS
// ============================================================================

/**
 * POST /click-to-call/vendor
 * Customer initiates call to vendor for order query
 */
router.post('/vendor', async (req, res) => {
  try {
    const {
      customerId,
      orderId,
      context = 'order_query'
    } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    
    // Fetch order details from Jupiter
    const order = await getOrderDetails(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const customerPhone = order.customer?.phone;
    const vendorPhone = order.store?.phone;
    const vendorName = order.store?.name || 'Vendor';
    
    if (!customerPhone || !vendorPhone) {
      return res.status(400).json({
        error: 'Missing phone numbers',
        customerPhone: !!customerPhone,
        vendorPhone: !!vendorPhone
      });
    }
    
    // Initiate call via Exotel
    const callResult = await initiateCall({
      from: customerPhone,
      to: vendorPhone,
      orderId,
      context,
      callType: 'customer_to_vendor'
    });
    
    // Emit event
    emitEvent({
      type: 'click_to_call.vendor.initiated',
      at: new Date().toISOString(),
      orderId,
      customerId,
      callSid: callResult.callSid
    });
    
    return res.status(200).json({
      success: true,
      message: `Connecting you to ${vendorName}...`,
      callSid: callResult.callSid,
      status: callResult.status,
      estimatedWait: '10-15 seconds'
    });
    
  } catch (err) {
    console.error('Error in click-to-call vendor:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /click-to-call/rider
 * Customer initiates call to rider for delivery coordination
 */
router.post('/rider', async (req, res) => {
  try {
    const {
      customerId,
      orderId,
      context = 'delivery_coordination'
    } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    
    // Fetch order details from Jupiter
    const order = await getOrderDetails(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const customerPhone = order.customer?.phone;
    const riderPhone = order.delivery_man?.phone;
    const riderName = order.delivery_man?.name || 'Delivery Partner';
    
    if (!customerPhone) {
      return res.status(400).json({ error: 'Customer phone not found' });
    }
    
    if (!riderPhone) {
      return res.status(400).json({
        error: 'No rider assigned to this order yet',
        orderStatus: order.order_status
      });
    }
    
    // Check if masking session exists, create if not
    let maskingSession = getMaskedSession(orderId);
    if (!maskingSession) {
      maskingSession = await createMaskedSession({
        orderId,
        partyA: customerPhone,
        partyB: riderPhone,
        partyAType: 'customer',
        partyBType: 'rider',
        ttlMinutes: 60,
        metadata: { purpose: 'click_to_call' }
      });
    }
    
    // Initiate call via Exotel using masked number
    const callResult = await initiateCall({
      from: customerPhone,
      to: riderPhone,
      orderId,
      context,
      callType: 'customer_to_rider',
      maskedNumber: maskingSession.maskedNumber
    });
    
    // Emit event
    emitEvent({
      type: 'click_to_call.rider.initiated',
      at: new Date().toISOString(),
      orderId,
      customerId,
      callSid: callResult.callSid
    });
    
    return res.status(200).json({
      success: true,
      message: `Connecting you to ${riderName}...`,
      callSid: callResult.callSid,
      status: callResult.status,
      maskedNumber: maskingSession.maskedNumber,
      estimatedWait: '10-15 seconds'
    });
    
  } catch (err) {
    console.error('Error in click-to-call rider:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /click-to-call/support
 * Any user initiates call to support team
 */
router.post('/support', async (req, res) => {
  try {
    const {
      userId,
      userType = 'customer', // customer, vendor, rider
      phone,
      orderId,
      issue = 'general_inquiry'
    } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }
    
    // Initiate call to support
    const callResult = await initiateCall({
      from: phone,
      to: SUPPORT_LINE,
      orderId,
      context: issue,
      callType: 'support',
      metadata: {
        userId,
        userType,
        issue
      }
    });
    
    // Emit event
    emitEvent({
      type: 'click_to_call.support.initiated',
      at: new Date().toISOString(),
      userId,
      userType,
      orderId,
      issue,
      callSid: callResult.callSid
    });
    
    // Publish to queue for support dashboard
    await publish('support.call.initiated', {
      userId,
      userType,
      phone,
      orderId,
      issue,
      callSid: callResult.callSid,
      timestamp: new Date().toISOString()
    });
    
    return res.status(200).json({
      success: true,
      message: 'Connecting you to Mangwale Support...',
      callSid: callResult.callSid,
      status: callResult.status,
      queuePosition: 1, // Would be dynamic in production
      estimatedWait: '30-60 seconds'
    });
    
  } catch (err) {
    console.error('Error in click-to-call support:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /click-to-call/callback
 * Request a callback instead of waiting on hold
 */
router.post('/callback', async (req, res) => {
  try {
    const {
      phone,
      userId,
      userType = 'customer',
      preferredTime, // ISO timestamp
      orderId,
      issue = 'callback_request'
    } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }
    
    // Store callback request
    const callbackRequest = {
      id: `cb_${Date.now()}`,
      phone,
      userId,
      userType,
      preferredTime: preferredTime || new Date(Date.now() + 30 * 60000).toISOString(), // 30 min default
      orderId,
      issue,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    // Publish to queue for support team
    await publish('support.callback.requested', callbackRequest);
    
    // Emit event
    emitEvent({
      type: 'click_to_call.callback.requested',
      at: new Date().toISOString(),
      ...callbackRequest
    });
    
    return res.status(200).json({
      success: true,
      message: 'Callback request received! We will call you shortly.',
      callbackId: callbackRequest.id,
      scheduledFor: callbackRequest.preferredTime
    });
    
  } catch (err) {
    console.error('Error in callback request:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// VENDOR/RIDER CLICK-TO-CALL (Outbound from business side)
// ============================================================================

/**
 * POST /click-to-call/vendor-to-customer
 * Vendor initiates call to customer for order clarification
 */
router.post('/vendor-to-customer', async (req, res) => {
  try {
    const {
      vendorId,
      orderId,
      context = 'order_clarification'
    } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    
    const order = await getOrderDetails(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Verify vendor owns this order
    if (vendorId && order.store?.id != vendorId) {
      return res.status(403).json({ error: 'Order does not belong to this vendor' });
    }
    
    const vendorPhone = order.store?.phone;
    const customerPhone = order.customer?.phone;
    const customerName = order.customer?.name || 'Customer';
    
    if (!vendorPhone || !customerPhone) {
      return res.status(400).json({ error: 'Missing phone numbers' });
    }
    
    const callResult = await initiateCall({
      from: vendorPhone,
      to: customerPhone,
      orderId,
      context,
      callType: 'vendor_to_customer'
    });
    
    emitEvent({
      type: 'click_to_call.vendor_to_customer.initiated',
      at: new Date().toISOString(),
      orderId,
      vendorId,
      callSid: callResult.callSid
    });
    
    return res.status(200).json({
      success: true,
      message: `Calling ${customerName}...`,
      callSid: callResult.callSid,
      status: callResult.status
    });
    
  } catch (err) {
    console.error('Error in vendor-to-customer call:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /click-to-call/rider-to-customer
 * Rider initiates call to customer for delivery
 */
router.post('/rider-to-customer', async (req, res) => {
  try {
    const {
      riderId,
      orderId,
      context = 'delivery_update'
    } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    
    const order = await getOrderDetails(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const riderPhone = order.delivery_man?.phone;
    const customerPhone = order.customer?.phone;
    
    if (!riderPhone || !customerPhone) {
      return res.status(400).json({ error: 'Missing phone numbers' });
    }
    
    // Use existing masking session if available
    let maskingSession = getMaskedSession(orderId);
    
    const callResult = await initiateCall({
      from: riderPhone,
      to: customerPhone,
      orderId,
      context,
      callType: 'rider_to_customer',
      maskedNumber: maskingSession?.maskedNumber
    });
    
    return res.status(200).json({
      success: true,
      message: 'Calling customer...',
      callSid: callResult.callSid,
      status: callResult.status
    });
    
  } catch (err) {
    console.error('Error in rider-to-customer call:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// CALL STATUS & TRACKING
// ============================================================================

/**
 * GET /click-to-call/status/:callSid
 * Get status of an initiated call
 */
router.get('/status/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    const config = getExotelConfig();
    
    const response = await axios.get(
      `${config.baseUrl}/Calls/${callSid}`,
      { auth: config.auth }
    );
    
    return res.json({
      callSid,
      status: response.data.Status,
      direction: response.data.Direction,
      duration: response.data.Duration,
      recordingUrl: response.data.RecordingUrl,
      startTime: response.data.StartTime,
      endTime: response.data.EndTime
    });
    
  } catch (err) {
    console.error('Error getting call status:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /click-to-call/webhook
 * Handle call status updates from Exotel
 */
router.post('/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const {
      CallSid,
      Status,
      Direction,
      From,
      To,
      Duration,
      RecordingUrl,
      custom_field
    } = req.body;
    
    const metadata = JSON.parse(custom_field || '{}');
    
    const event = {
      type: 'click_to_call.status',
      at: new Date().toISOString(),
      callSid: CallSid,
      status: Status,
      direction: Direction,
      from: From,
      to: To,
      duration: Duration,
      recordingUrl: RecordingUrl,
      ...metadata
    };
    
    emitEvent(event);
    await publish('click_to_call.status', event);
    
    console.log(`📞 Call ${CallSid} status: ${Status}`);
    
    return res.json({ received: true });
    
  } catch (err) {
    console.error('Error handling call webhook:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Initiate a call via Exotel API
 */
async function initiateCall({ from, to, orderId, context, callType, maskedNumber, metadata = {} }) {
  const config = getExotelConfig();
  
  try {
    const callData = {
      From: from,
      To: to,
      CallerId: maskedNumber || config.callerId || from,
      Url: getCallbackUrl('/click-to-call/webhook'),
      StatusCallback: getCallbackUrl('/click-to-call/webhook'),
      StatusCallbackEvents: ['ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed'],
      CustomField: JSON.stringify({
        orderId,
        context,
        callType,
        initiatedAt: new Date().toISOString(),
        ...metadata
      }),
      Record: true,
      TimeLimit: 1800 // 30 min max
    };
    
    const response = await axios.post(
      `${config.baseUrl}/Calls/connect`,
      new URLSearchParams(callData).toString(),
      {
        auth: config.auth,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    console.log(`✅ Call initiated: ${response.data.Call?.Sid || 'pending'}`);
    
    return {
      callSid: response.data.Call?.Sid || `pending_${Date.now()}`,
      status: response.data.Call?.Status || 'queued',
      from,
      to
    };
    
  } catch (error) {
    console.error('❌ Exotel call initiation failed:', error.response?.data || error.message);
    
    // For development, return simulated response
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Using simulated call (dev mode)');
      return {
        callSid: `sim_${Date.now()}`,
        status: 'queued',
        simulated: true,
        from,
        to
      };
    }
    
    throw new Error(`Call initiation failed: ${error.message}`);
  }
}

/**
 * Get callback URL for webhooks
 */
function getCallbackUrl(path = '') {
  const base = process.env.EXOTEL_CALLBACK_URL || 'http://192.168.0.151:3100';
  return `${base}${path}`;
}

export default router;
