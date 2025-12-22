/**
 * Mangwale IVR Routes - Voice-First Commerce
 * 
 * This module handles all IVR (Interactive Voice Response) flows for:
 * - Voice ordering (customer → AI → order)
 * - Vendor notifications (new order, reminders)
 * - Rider assignment (pickup/delivery)
 * - Masked calling (privacy between parties)
 * - Missed call → callback flows
 * 
 * DATA SOURCE: All order/vendor/rider data comes from Jupiter (192.168.0.156:3200)
 * via the PHP backend. This service has NO database - it's a thin orchestration layer.
 */

import express from 'express';
import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { publish } from '../utils/mq.js';
import { emitEvent, bus } from '../utils/events.js';

// Import Jupiter client for all data operations
import {
  getOrderDetails,
  getStoreDetails,
  getStoreByPhone,
  getDeliveryManDetails,
  getDeliveryManByPhone,
  getCustomerByPhone,
  notifyJupiter,
  updateOrderStatus,
} from '../services/jupiter.service.js';

const router = express.Router();

// ============================================================================
// IVR FLOW STATES (Stored in Redis via Voice Agent)
// ============================================================================

const IVR_FLOWS = {
  // Customer ordering flow
  CUSTOMER_ORDER: {
    welcome: 'customer_order_welcome',
    category: 'customer_order_category',     // 1=Food, 2=Parcel, 3=Local Shop
    food_order: 'customer_order_food',
    parcel_order: 'customer_order_parcel',
    shop_order: 'customer_order_shop',
    confirm: 'customer_order_confirm',
    payment: 'customer_order_payment',
    complete: 'customer_order_complete',
  },
  
  // Vendor notification flow
  VENDOR_NEW_ORDER: {
    announce: 'vendor_new_order_announce',   // "New order ₹325"
    action: 'vendor_new_order_action',        // 1=Accept, 2=Reject, 3=Prep time
    prep_time: 'vendor_new_order_prep',       // 1=15min, 2=20min, 3=30min
    confirm: 'vendor_new_order_confirm',
  },
  
  // Vendor reminder flow
  VENDOR_REMINDER: {
    announce: 'vendor_reminder_announce',     // "Order ready in 3 min"
    action: 'vendor_reminder_action',         // 1=Mark ready, 2=Extend 10min
    confirm: 'vendor_reminder_confirm',
  },
  
  // Rider assignment flow
  RIDER_ASSIGN: {
    announce: 'rider_assign_announce',        // "Pickup from X, drop at Y"
    action: 'rider_assign_action',            // 1=Accept, 2=Reject
    confirm: 'rider_assign_confirm',
  },
  
  // Address update flow
  ADDRESS_UPDATE: {
    announce: 'address_update_announce',      // "Address changed to..."
    confirm: 'address_update_confirm',        // 1=Confirm, 2=Problem
  },
  
  // Bridge call menu
  BRIDGE: {
    menu: 'bridge_menu',                      // 5=Admin support
    connecting: 'bridge_connecting',
  }
};

// ============================================================================
// EXOTEL API HELPERS
// ============================================================================

function exotelBaseUrl() {
  const cfg = getConfig();
  const { sid, region, subdomain } = cfg.exotel;
  if (region) return `https://${subdomain}.${region}.exotel.com/v1/Accounts/${sid}`;
  return `https://${subdomain}.exotel.com/v1/Accounts/${sid}`;
}

function auth() {
  const cfg = getConfig();
  return { username: cfg.exotel.apiKey, password: cfg.exotel.apiToken };
}

// Voice Agent URL (Mercury)
const VOICE_AGENT_URL = process.env.VOICE_AGENT_URL || 'http://192.168.0.151:8090';

// ============================================================================
// IVR WEBHOOKS - Handle DTMF Input from Exotel
// ============================================================================

/**
 * Handle DTMF input from IVR calls
 * Exotel sends: CallSid, digits, From, To, Direction, context (custom param)
 */
router.post('/dtmf', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
  try {
    const {
      CallSid,
      digits,
      From,
      To,
      Direction,
      RecordingUrl,
      // Custom context passed via Exotel applet
      context,
      order_id,
      vendor_id,
      rider_id,
      flow_state,
    } = req.body;
    
    console.log(`📞 IVR DTMF: ${digits} | Context: ${context} | From: ${From}`);
    
    const event = {
      type: 'ivr.dtmf',
      callSid: CallSid,
      digits,
      from: From,
      to: To,
      direction: Direction,
      context,
      orderId: order_id,
      vendorId: vendor_id,
      riderId: rider_id,
      flowState: flow_state,
      recordingUrl: RecordingUrl,
      receivedAt: new Date().toISOString(),
    };
    
    // Emit event for real-time dashboard
    emitEvent({ type: 'exotel.ivr.dtmf', at: new Date().toISOString(), event });
    
    // Publish to message queue for processing
    await publish('exotel.ivr.dtmf', event);
    
    // Process DTMF based on context and return TwiML-like response
    const response = await processIvrDtmf(event);
    
    // Return Exotel-compatible response
    return res.status(200).type('text/plain').send(response.action || 'hangup');
    
  } catch (err) {
    console.error('IVR DTMF error:', err);
    return res.status(500).json({ error: 'IVR processing failed' });
  }
});

/**
 * Handle incoming calls - route to appropriate IVR flow
 */
router.post('/incoming', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
  try {
    const { CallSid, From, To, Direction, CallType } = req.body;
    
    console.log(`📞 Incoming call: ${From} → ${To}`);
    
    const event = {
      type: 'ivr.incoming',
      callSid: CallSid,
      from: From,
      to: To,
      direction: Direction,
      callType: CallType,
      receivedAt: new Date().toISOString(),
    };
    
    emitEvent({ type: 'exotel.ivr.incoming', at: new Date().toISOString(), event });
    await publish('exotel.ivr.incoming', event);
    
    // Identify caller type and route to appropriate flow
    const callerId = await identifyCaller(From);
    
    let flow;
    if (callerId.type === 'vendor') {
      flow = 'vendor_support';
    } else if (callerId.type === 'rider') {
      flow = 'rider_support';
    } else {
      // Customer - start ordering flow
      flow = 'customer_order';
    }
    
    // Return initial IVR response
    return res.status(200).json({
      action: 'play',
      flow: flow,
      callerId: callerId,
      next: getIvrWelcome(flow, callerId),
    });
    
  } catch (err) {
    console.error('Incoming call error:', err);
    return res.status(500).json({ error: 'Call routing failed' });
  }
});

/**
 * Handle missed calls - trigger callback flow
 */
router.post('/missed-call', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
  try {
    const { From, To, CallSid, CallType } = req.body;
    
    console.log(`📵 Missed call from: ${From}`);
    
    const event = {
      type: 'ivr.missed_call',
      callSid: CallSid,
      from: From,
      to: To,
      callType: CallType || 'missed',
      receivedAt: new Date().toISOString(),
    };
    
    emitEvent({ type: 'exotel.ivr.missed_call', at: new Date().toISOString(), event });
    await publish('exotel.ivr.missed_call', event);
    
    // Queue callback after 30 seconds
    setTimeout(async () => {
      try {
        await initiateCallback(From, To, 'missed_call_callback');
        console.log(`📞 Callback initiated to: ${From}`);
      } catch (err) {
        console.error('Callback failed:', err);
      }
    }, 30000);
    
    return res.status(202).json({ 
      accepted: true, 
      message: 'Callback scheduled',
      callbackIn: '30s'
    });
    
  } catch (err) {
    console.error('Missed call handler error:', err);
    return res.status(500).json({ error: 'Missed call processing failed' });
  }
});

// ============================================================================
// OUTBOUND IVR CALLS
// ============================================================================

/**
 * Notify vendor of new order via IVR
 * Fetches real order data from Jupiter/PHP
 */
router.post('/notify/vendor/order', async (req, res) => {
  try {
    const { 
      vendor_id, 
      vendor_phone, 
      order_id, 
      // These can be provided OR will be fetched from Jupiter
      amount, 
      items, 
      payment_mode,
      callback_url
    } = req.body;
    
    if (!order_id) {
      return res.status(400).json({ error: 'order_id required' });
    }
    
    // Fetch order details from Jupiter if not provided
    let orderData = { amount, items, payment_mode };
    let vendorPhone = vendor_phone;
    let vendorId = vendor_id;
    
    if (!amount || !items) {
      const order = await getOrderDetails(order_id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found in Jupiter' });
      }
      
      orderData.amount = order.amount;
      orderData.items = order.items.map(i => `${i.quantity}x ${i.name}`).join(', ');
      orderData.payment_mode = order.paymentMethod === 'cash_on_delivery' ? 'cod' : 'online';
      
      // Get vendor phone from order's store
      if (order.store && !vendorPhone) {
        vendorPhone = order.store.phone;
        vendorId = order.store.id;
      }
    }
    
    if (!vendorPhone) {
      return res.status(400).json({ error: 'vendor_phone required (not found in order)' });
    }
    
    console.log(`📞 Notifying vendor ${vendorId} for order ${order_id}: ₹${orderData.amount}`);
    
    // Build IVR script with real data
    const script = buildVendorOrderScript(orderData);
    
    // Initiate outbound call with IVR
    const result = await initiateIvrCall({
      to: vendorPhone,
      callerId: process.env.EXOTEL_DID_NEW_ORDER || process.env.EXOTEL_CALLER_ID,
      context: 'vendor_new_order',
      orderId: order_id,
      vendorId: vendorId,
      script: script,
      statusCallback: callback_url,
    });
    
    emitEvent({ 
      type: 'exotel.ivr.vendor_notify', 
      at: new Date().toISOString(),
      orderId: order_id,
      vendorId: vendorId,
      amount: orderData.amount,
      callSid: result.callSid,
    });
    
    // Notify Jupiter about the call
    await notifyJupiter('vendor_call_initiated', {
      orderId: order_id,
      vendorId: vendorId,
      callSid: result.callSid,
      channel: 'ivr',
    });
    
    return res.status(200).json({
      success: true,
      callSid: result.callSid,
      message: 'Vendor notification call initiated',
      orderAmount: orderData.amount,
    });
    
  } catch (err) {
    console.error('Vendor notify error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Notify rider of assignment via IVR
 * Fetches real order/store data from Jupiter/PHP
 */
router.post('/notify/rider/assign', async (req, res) => {
  try {
    const {
      rider_id,
      rider_phone,
      order_id,
      // These can be provided OR will be fetched from Jupiter
      pickup_name,
      pickup_address,
      drop_address,
      amount,
      callback_url,
    } = req.body;
    
    if (!order_id) {
      return res.status(400).json({ error: 'order_id required' });
    }
    
    // Fetch order details from Jupiter if not provided
    let deliveryData = { pickup_name, pickup_address, drop_address, amount };
    let riderPhone = rider_phone;
    let riderId = rider_id;
    
    if (!pickup_address || !drop_address) {
      const order = await getOrderDetails(order_id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found in Jupiter' });
      }
      
      deliveryData.pickup_name = order.store?.name || 'Store';
      deliveryData.pickup_address = order.pickupAddress?.address || order.store?.address;
      deliveryData.drop_address = order.deliveryAddress?.address || 'Customer location';
      deliveryData.amount = order.amount;
      
      // Get rider phone from order's delivery man
      if (order.deliveryMan && !riderPhone) {
        riderPhone = order.deliveryMan.phone;
        riderId = order.deliveryMan.id;
      }
    }
    
    if (!riderPhone) {
      return res.status(400).json({ error: 'rider_phone required (not found in order)' });
    }
    
    console.log(`📞 Notifying rider ${riderId} for order ${order_id}: ${deliveryData.pickup_name} → ${deliveryData.drop_address}`);
    
    const script = buildRiderAssignScript(deliveryData);
    
    const result = await initiateIvrCall({
      to: riderPhone,
      callerId: process.env.EXOTEL_DID_NEW_ORDER || process.env.EXOTEL_CALLER_ID,
      context: 'rider_assign',
      orderId: order_id,
      riderId: riderId,
      script: script,
      statusCallback: callback_url,
    });
    
    emitEvent({
      type: 'exotel.ivr.rider_assign',
      at: new Date().toISOString(),
      orderId: order_id,
      riderId: riderId,
      pickup: deliveryData.pickup_name,
      callSid: result.callSid,
    });
    
    // Notify Jupiter about the call
    await notifyJupiter('rider_call_initiated', {
      orderId: order_id,
      riderId: riderId,
      callSid: result.callSid,
      channel: 'ivr',
    });
    
    return res.status(200).json({
      success: true,
      callSid: result.callSid,
      message: 'Rider assignment call initiated',
      pickup: deliveryData.pickup_name,
    });
    
  } catch (err) {
    console.error('Rider assign error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Send reminder call to vendor
 */
router.post('/notify/vendor/reminder', async (req, res) => {
  try {
    const {
      vendor_id,
      vendor_phone,
      order_id,
      minutes_remaining,
      callback_url,
    } = req.body;
    
    const script = buildVendorReminderScript({ minutes_remaining });
    
    const result = await initiateIvrCall({
      to: vendor_phone,
      callerId: process.env.EXOTEL_DID_REMINDER || process.env.EXOTEL_CALLER_ID,
      context: 'vendor_reminder',
      orderId: order_id,
      vendorId: vendor_id,
      script: script,
      statusCallback: callback_url,
    });
    
    return res.status(200).json({
      success: true,
      callSid: result.callSid,
    });
    
  } catch (err) {
    console.error('Vendor reminder error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MASKED/BRIDGE CALLS
// ============================================================================

/**
 * Create masked call between two parties (privacy protection)
 * Neither party sees the other's real number
 */
router.post('/bridge/masked', async (req, res) => {
  try {
    const {
      party_a_phone,  // Customer
      party_b_phone,  // Rider/Vendor
      context,        // 'rider_customer' | 'vendor_customer'
      order_id,
      time_limit = 300,  // 5 min default
      callback_url,
    } = req.body;
    
    if (!party_a_phone || !party_b_phone) {
      return res.status(400).json({ error: 'Both party phones required' });
    }
    
    // Use Exotel's call connect for masked calling
    const url = `${exotelBaseUrl()}/Calls/connect.json`;
    const params = new URLSearchParams({
      From: party_a_phone,
      To: party_b_phone,
      CallerId: process.env.EXOTEL_CALLER_ID,
      TimeLimit: String(time_limit),
      Record: 'true',  // Record for dispute resolution
    });
    
    if (callback_url) {
      params.append('StatusCallback', callback_url);
    }
    
    const { data, status } = await axios.post(url, params, { auth: auth() });
    
    emitEvent({
      type: 'exotel.bridge.masked',
      at: new Date().toISOString(),
      orderId: order_id,
      context: context,
      partyA: party_a_phone.slice(-4),  // Last 4 digits only (privacy)
      partyB: party_b_phone.slice(-4),
      callSid: data?.Call?.Sid,
    });
    
    await publish('exotel.bridge.initiated', {
      orderId: order_id,
      context,
      callSid: data?.Call?.Sid,
      timestamp: new Date().toISOString(),
    });
    
    return res.status(status).json({
      success: true,
      callSid: data?.Call?.Sid,
      message: 'Masked call initiated',
    });
    
  } catch (err) {
    console.error('Masked bridge error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Connect to admin support (from IVR option 5)
 */
router.post('/bridge/admin', async (req, res) => {
  try {
    const {
      caller_phone,
      call_sid,
      order_id,
      context,  // Who's calling - vendor/rider/customer
    } = req.body;
    
    const adminPhone = process.env.ADMIN_SUPPORT_PHONE || process.env.EXOTEL_ADMIN_NUMBER;
    
    if (!adminPhone) {
      return res.status(503).json({ error: 'Admin support not configured' });
    }
    
    // Bridge to admin
    const url = `${exotelBaseUrl()}/Calls/connect.json`;
    const params = new URLSearchParams({
      From: caller_phone,
      To: adminPhone,
      CallerId: process.env.EXOTEL_CALLER_ID,
      TimeLimit: '600',  // 10 min max
      Record: 'true',
    });
    
    const { data, status } = await axios.post(url, params, { auth: auth() });
    
    emitEvent({
      type: 'exotel.bridge.admin',
      at: new Date().toISOString(),
      orderId: order_id,
      context: context,
      callSid: data?.Call?.Sid,
    });
    
    return res.status(status).json({
      success: true,
      callSid: data?.Call?.Sid,
      message: 'Connected to admin support',
    });
    
  } catch (err) {
    console.error('Admin bridge error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// VOICE ORDERING FLOW (AI-Powered)
// ============================================================================

/**
 * Handle voice input from customer during IVR
 * Routes audio to Mercury's ASR → Jupiter AI → TTS response
 */
router.post('/voice/process', async (req, res) => {
  try {
    const {
      call_sid,
      from_phone,
      recording_url,
      context,
      session_id,
    } = req.body;
    
    if (!recording_url && !req.body.text) {
      return res.status(400).json({ error: 'recording_url or text required' });
    }
    
    let inputText = req.body.text;
    
    // If recording provided, transcribe via Mercury ASR
    if (recording_url && !inputText) {
      const asrResponse = await axios.post(`${VOICE_AGENT_URL}/api/voice/transcribe`, {
        audio_url: recording_url,
        language: 'hi',  // Hindi default for Mangwale
      });
      inputText = asrResponse.data.text;
    }
    
    // Process through Jupiter AI via Voice Agent
    const voiceResponse = await axios.post(`${VOICE_AGENT_URL}/api/voice/process`, {
      session_id: session_id || `call-${call_sid}`,
      text: inputText,
      language: 'hi',
      context: {
        channel: 'ivr',
        phone: from_phone,
        flow: context,
      }
    });
    
    const responseText = voiceResponse.data.text;
    
    // Generate TTS audio URL
    const ttsResponse = await axios.post(`${VOICE_AGENT_URL}/api/voice/synthesize`, {
      text: responseText,
      language: 'hi',
      format: 'mp3',
    });
    
    emitEvent({
      type: 'exotel.voice.processed',
      at: new Date().toISOString(),
      callSid: call_sid,
      input: inputText?.substring(0, 50),
      output: responseText?.substring(0, 50),
    });
    
    return res.status(200).json({
      success: true,
      input: inputText,
      response: responseText,
      audioUrl: ttsResponse.data.audio_url,
      audioBase64: ttsResponse.data.audio_base64,
      nextAction: voiceResponse.data.metadata?.nextAction || 'continue',
    });
    
  } catch (err) {
    console.error('Voice process error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ANALYTICS & REPORTING
// ============================================================================

/**
 * Get IVR analytics
 */
router.get('/analytics', async (req, res) => {
  try {
    const { from, to, type } = req.query;
    
    // TODO: Query from database/Redis
    // For now, return mock data
    const analytics = {
      period: { from, to },
      calls: {
        total: 0,
        answered: 0,
        missed: 0,
        voiceOrders: 0,
      },
      vendors: {
        notified: 0,
        accepted: 0,
        rejected: 0,
        noResponse: 0,
        avgResponseTime: '0s',
      },
      riders: {
        notified: 0,
        accepted: 0,
        rejected: 0,
      },
      bridges: {
        total: 0,
        avgDuration: '0s',
      },
    };
    
    return res.json(analytics);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// HELPER FUNCTIONS (Jupiter-integrated)
// ============================================================================

/**
 * Identify caller type by querying Jupiter for vendor/rider/customer data
 */
async function identifyCaller(phone) {
  try {
    // Check if vendor
    const vendor = await getStoreByPhone(phone);
    if (vendor) {
      console.log(`📞 Identified vendor: ${vendor.name} (${phone})`);
      return {
        type: 'vendor',
        phone: phone,
        id: vendor.id,
        name: vendor.name,
        language: 'hi',
      };
    }

    // Check if rider
    const rider = await getDeliveryManByPhone(phone);
    if (rider) {
      console.log(`📞 Identified rider: ${rider.name} (${phone})`);
      return {
        type: 'rider',
        phone: phone,
        id: rider.id,
        name: rider.name,
        language: 'hi',
      };
    }

    // Default to customer
    const customer = await getCustomerByPhone(phone);
    console.log(`📞 Identified customer: ${phone}`);
    return {
      type: 'customer',
      phone: phone,
      name: customer?.name || null,
      isRegistered: customer?.isRegistered || false,
      language: 'hi',
    };
  } catch (err) {
    console.error(`Caller identification failed: ${err.message}`);
    return {
      type: 'customer',
      phone: phone,
      name: null,
      language: 'hi',
    };
  }
}

function getIvrWelcome(flow, caller) {
  const welcomes = {
    customer_order: {
      hi: 'नमस्ते! मंगवाले में आपका स्वागत है। Food order के लिए 1 दबाएं, Parcel के लिए 2 दबाएं, Local shop से order के लिए 3 दबाएं।',
      en: 'Welcome to Mangwale! Press 1 for food order, 2 for parcel, 3 for local shop.',
    },
    vendor_support: {
      hi: 'नमस्ते! Order status के लिए 1 दबाएं, Payment issue के लिए 2 दबाएं, Admin से बात करने के लिए 5 दबाएं।',
      en: 'Press 1 for order status, 2 for payment issues, 5 to speak with admin.',
    },
    rider_support: {
      hi: 'नमस्ते! Pickup issue के लिए 1 दबाएं, Drop issue के लिए 2 दबाएं, Admin के लिए 5 दबाएं।',
      en: 'Press 1 for pickup issues, 2 for drop issues, 5 for admin.',
    },
  };
  
  const lang = caller.language || 'hi';
  return welcomes[flow]?.[lang] || welcomes[flow]?.hi;
}

function buildVendorOrderScript({ amount, items, payment_mode }) {
  const paymentText = payment_mode === 'cod' ? 'Cash on delivery' : 'Online payment ho chuka hai';
  return {
    hi: `नया Mangwale order। Amount ${amount} rupees। Items: ${items}। ${paymentText}। Accept करने के लिए 1 दबाएं, reject के लिए 2, preparation time set करने के लिए 3।`,
    en: `New Mangwale order. Amount ${amount} rupees. Items: ${items}. ${paymentText}. Press 1 to accept, 2 to reject, 3 to set prep time.`,
  };
}

function buildRiderAssignScript({ pickup_name, pickup_address, drop_address, amount }) {
  return {
    hi: `Mangwale delivery। Pickup: ${pickup_name}, ${pickup_address}। Drop: ${drop_address}। Amount: ${amount} rupees। Accept के लिए 1 दबाएं, reject के लिए 2।`,
    en: `Mangwale delivery. Pickup from ${pickup_name}, ${pickup_address}. Drop at ${drop_address}. Amount ${amount} rupees. Press 1 to accept, 2 to reject.`,
  };
}

function buildVendorReminderScript({ minutes_remaining }) {
  return {
    hi: `Reminder: Order की prep time ${minutes_remaining} minute में end हो रही है। Ready mark करने के लिए 1 दबाएं, 10 minute extend करने के लिए 2।`,
    en: `Reminder: Order prep time ending in ${minutes_remaining} minutes. Press 1 to mark ready, 2 to extend by 10 minutes.`,
  };
}

async function processIvrDtmf(event) {
  const { context, digits, orderId, vendorId, riderId } = event;
  
  // Route to appropriate handler based on context
  switch (context) {
    case 'vendor_new_order':
      return handleVendorOrderDtmf(digits, orderId, vendorId);
    case 'vendor_reminder':
      return handleVendorReminderDtmf(digits, orderId, vendorId);
    case 'rider_assign':
      return handleRiderAssignDtmf(digits, orderId, riderId);
    case 'customer_order':
      return handleCustomerOrderDtmf(digits, event);
    default:
      return { action: 'hangup' };
  }
}

async function handleVendorOrderDtmf(digits, orderId, vendorId) {
  // Get order details from Jupiter
  const order = await getOrderDetails(orderId);
  
  switch (digits) {
    case '1':
      // Accept order - update status via Jupiter
      await updateOrderStatus(orderId, 'confirmed', { 
        vendorId, 
        source: 'ivr',
        acceptedAt: new Date().toISOString()
      });
      await publish('order.vendor.accepted', { orderId, vendorId, source: 'ivr' });
      await notifyJupiter('order_accepted', { orderId, vendorId, channel: 'ivr' });
      return { action: 'play', message: 'Order accept ho gaya. Thank you!' };
      
    case '2':
      // Reject order
      await updateOrderStatus(orderId, 'canceled', { 
        vendorId, 
        source: 'ivr',
        reason: 'vendor_rejected',
        rejectedAt: new Date().toISOString()
      });
      await publish('order.vendor.rejected', { orderId, vendorId, source: 'ivr' });
      await notifyJupiter('order_rejected', { orderId, vendorId, channel: 'ivr' });
      return { action: 'play', message: 'Order reject ho gaya.' };
      
    case '3':
      return { action: 'collect', prompt: '15 minute ke liye 1, 20 ke liye 2, 30 ke liye 3 dabayein.', context: 'vendor_prep_time' };
      
    default:
      return { action: 'play', message: 'Invalid option. Please try again.' };
  }
}

async function handleVendorReminderDtmf(digits, orderId, vendorId) {
  switch (digits) {
    case '1':
      // Mark order ready
      await updateOrderStatus(orderId, 'processing', { 
        vendorId, 
        source: 'ivr',
        readyAt: new Date().toISOString()
      });
      await publish('order.vendor.ready', { orderId, vendorId, source: 'ivr' });
      await notifyJupiter('order_ready', { orderId, vendorId, channel: 'ivr' });
      return { action: 'play', message: 'Order ready mark ho gaya. Rider aa raha hai!' };
      
    case '2':
      // Extend prep time
      await publish('order.vendor.extended', { orderId, vendorId, extendMinutes: 10, source: 'ivr' });
      await notifyJupiter('prep_time_extended', { orderId, vendorId, extendMinutes: 10, channel: 'ivr' });
      return { action: 'play', message: '10 minute extend ho gaya.' };
      
    default:
      return { action: 'play', message: 'Invalid option.' };
  }
}

async function handleRiderAssignDtmf(digits, orderId, riderId) {
  switch (digits) {
    case '1':
      // Rider accepts delivery
      await updateOrderStatus(orderId, 'picked_up', { 
        riderId, 
        source: 'ivr',
        acceptedAt: new Date().toISOString()
      });
      await publish('order.rider.accepted', { orderId, riderId, source: 'ivr' });
      await notifyJupiter('rider_accepted', { orderId, riderId, channel: 'ivr' });
      return { action: 'play', message: 'Delivery accept! Pickup location ka map aapke phone pe aayega.' };
      
    case '2':
      // Rider rejects
      await publish('order.rider.rejected', { orderId, riderId, source: 'ivr' });
      await notifyJupiter('rider_rejected', { orderId, riderId, channel: 'ivr' });
      return { action: 'play', message: 'Delivery reject ho gayi.' };
      
    default:
      return { action: 'play', message: 'Invalid option.' };
  }
}

async function handleCustomerOrderDtmf(digits, event) {
  // Route to voice AI for natural conversation
  return { 
    action: 'voice',
    message: 'Aap apna order bol sakte hain. Recording ke baad # dabayein.',
    voiceEndpoint: '/ivr/voice/process',
  };
}

async function initiateIvrCall({ to, callerId, context, orderId, vendorId, riderId, script, statusCallback }) {
  const url = `${exotelBaseUrl()}/Calls/connect.json`;
  
  const params = new URLSearchParams({
    From: to,
    To: to,  // Self-call for IVR
    CallerId: callerId,
    TimeLimit: '180',  // 3 min max for IVR
    // CustomField for context
    CustomField: JSON.stringify({ context, orderId, vendorId, riderId }),
  });
  
  if (statusCallback) {
    params.append('StatusCallback', statusCallback);
  }
  
  const { data } = await axios.post(url, params, { auth: auth() });
  
  return {
    callSid: data?.Call?.Sid,
    status: data?.Call?.Status,
  };
}

async function initiateCallback(to, from, context) {
  const url = `${exotelBaseUrl()}/Calls/connect.json`;
  
  const params = new URLSearchParams({
    From: from,
    To: to,
    CallerId: process.env.EXOTEL_CALLER_ID,
    TimeLimit: '300',
    CustomField: JSON.stringify({ context, isCallback: true }),
  });
  
  const { data } = await axios.post(url, params, { auth: auth() });
  
  await publish('exotel.callback.initiated', {
    to,
    from,
    context,
    callSid: data?.Call?.Sid,
    timestamp: new Date().toISOString(),
  });
  
  return data;
}

export default router;
