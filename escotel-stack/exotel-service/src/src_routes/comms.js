/**
 * Mangwale Communications Orchestrator
 * 
 * Zero-chase operations using escalation ladder:
 * App → WhatsApp → Ring → IVR → Admin
 * 
 * This module coordinates all communication channels for:
 * - Order notifications
 * - Vendor/Rider escalations
 * - Customer updates
 * - SLA monitoring
 * 
 * DATA SOURCE: All order/vendor/rider data comes from Jupiter (192.168.0.156:3200)
 * via the PHP backend. This service has NO database - it's a thin orchestration layer.
 */

import express from 'express';
import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { publish } from '../utils/mq.js';
import { emitEvent } from '../utils/events.js';

// Import Jupiter client for all data operations
import {
  getOrderDetails,
  getStoreDetails,
  getDeliveryManDetails,
  getCustomerByPhone,
  notifyJupiter,
} from '../services/jupiter.service.js';

const router = express.Router();

// ============================================================================
// CONFIGURATION
// ============================================================================

const ESCALATION_CONFIG = {
  vendor: {
    // New order notification escalation
    new_order: {
      step1: { channel: 'app_push', waitMs: 0 },
      step2: { channel: 'whatsapp', waitMs: 60000 },      // 1 min
      step3: { channel: 'ring', waitMs: 120000 },         // 2 min
      step4: { channel: 'ivr', waitMs: 180000 },          // 3 min
      step5: { channel: 'admin', waitMs: 300000 },        // 5 min
    },
    // Processing reminder
    reminder: {
      step1: { channel: 'app_push', waitMs: 0 },
      step2: { channel: 'ring', waitMs: 60000 },
      step3: { channel: 'ivr', waitMs: 120000 },
    },
  },
  rider: {
    // Assignment notification
    assign: {
      step1: { channel: 'app_push', waitMs: 0 },
      step2: { channel: 'whatsapp', waitMs: 60000 },
      step3: { channel: 'ring', waitMs: 120000 },
      step4: { channel: 'ivr', waitMs: 180000 },
    },
    // Address update (critical - immediate escalation)
    address_update: {
      step1: { channel: 'whatsapp', waitMs: 0 },
      step2: { channel: 'ring', waitMs: 30000 },
      step3: { channel: 'ivr', waitMs: 90000 },
    },
  },
  customer: {
    // Order status updates
    status: {
      step1: { channel: 'app_push', waitMs: 0 },
      step2: { channel: 'whatsapp', waitMs: 30000 },
    },
    // Delay notification
    delay: {
      step1: { channel: 'whatsapp', waitMs: 0 },
    },
  },
};

// Service URLs
const EXOTEL_SERVICE_URL = process.env.EXOTEL_SERVICE_URL || 'http://localhost:3100';
const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3200/api/v1/whatsapp';
const PUSH_SERVICE_URL = process.env.PUSH_SERVICE_URL || 'http://localhost:3200/api/v1/push';

// Active escalation timers (in production, use Redis)
const escalationTimers = new Map();

// ============================================================================
// ESCALATION ORCHESTRATION
// ============================================================================

/**
 * Start escalation workflow for vendor new order
 * Fetches real order/vendor data from Jupiter if not provided
 */
router.post('/notify/vendor/order', async (req, res) => {
  try {
    const {
      order_id,
      vendor_id,
      vendor_phone,
      vendor_name,
      amount,
      items,
      payment_mode,
      city,
      language = 'hi',
    } = req.body;
    
    if (!order_id) {
      return res.status(400).json({ error: 'order_id required' });
    }
    
    // Fetch data from Jupiter if not provided
    let vendorData = {
      vendorId: vendor_id,
      phone: vendor_phone,
      name: vendor_name,
      amount,
      items,
      paymentMode: payment_mode,
      city,
      language,
    };
    
    if (!vendor_phone || !amount) {
      const order = await getOrderDetails(order_id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found in Jupiter' });
      }
      
      vendorData.vendorId = order.store?.id || vendor_id;
      vendorData.phone = order.store?.phone || vendor_phone;
      vendorData.name = order.store?.name || vendor_name;
      vendorData.amount = order.amount;
      vendorData.items = order.items.map(i => `${i.quantity}x ${i.name}`).join(', ');
      vendorData.paymentMode = order.paymentMethod === 'cash_on_delivery' ? 'cod' : 'online';
    }
    
    if (!vendorData.phone) {
      return res.status(400).json({ error: 'vendor_phone not found' });
    }
    
    const escalationId = `vendor_order_${order_id}`;
    
    console.log(`📞 Starting vendor escalation for order ${order_id}: ${vendorData.name} (${vendorData.phone})`);
    
    // Start escalation workflow
    await startEscalation(escalationId, 'vendor', 'new_order', {
      orderId: order_id,
      ...vendorData,
    });
    
    emitEvent({
      type: 'comms.escalation.started',
      at: new Date().toISOString(),
      escalationId,
      orderId: order_id,
      target: 'vendor',
      flow: 'new_order',
    });
    
    // Notify Jupiter
    await notifyJupiter('escalation_started', {
      escalationId,
      orderId: order_id,
      target: 'vendor',
      flow: 'new_order',
    });
    
    return res.status(200).json({
      success: true,
      escalationId,
      message: 'Vendor notification escalation started',
      vendorName: vendorData.name,
      amount: vendorData.amount,
    });
    
  } catch (err) {
    console.error('Vendor order notify error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Start escalation workflow for rider assignment
 * Fetches real order/rider data from Jupiter if not provided
 */
router.post('/notify/rider/assign', async (req, res) => {
  try {
    const {
      order_id,
      rider_id,
      rider_phone,
      rider_name,
      pickup_name,
      pickup_address,
      drop_address,
      amount,
      language = 'hi',
    } = req.body;
    
    if (!order_id) {
      return res.status(400).json({ error: 'order_id required' });
    }
    
    // Fetch data from Jupiter if not provided
    let riderData = {
      riderId: rider_id,
      phone: rider_phone,
      name: rider_name,
      pickupName: pickup_name,
      pickupAddress: pickup_address,
      dropAddress: drop_address,
      amount,
      language,
    };
    
    if (!rider_phone || !pickup_address) {
      const order = await getOrderDetails(order_id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found in Jupiter' });
      }
      
      riderData.riderId = order.deliveryMan?.id || rider_id;
      riderData.phone = order.deliveryMan?.phone || rider_phone;
      riderData.name = order.deliveryMan?.name || rider_name;
      riderData.pickupName = order.store?.name || pickup_name || 'Store';
      riderData.pickupAddress = order.pickupAddress?.address || order.store?.address || pickup_address;
      riderData.dropAddress = order.deliveryAddress?.address || drop_address;
      riderData.amount = order.amount;
    }
    
    if (!riderData.phone) {
      return res.status(400).json({ error: 'rider_phone not found' });
    }
    
    const escalationId = `rider_assign_${order_id}`;
    
    console.log(`📞 Starting rider escalation for order ${order_id}: ${riderData.name} (${riderData.phone})`);
    
    await startEscalation(escalationId, 'rider', 'assign', {
      orderId: order_id,
      ...riderData,
    });
    
    emitEvent({
      type: 'comms.escalation.started',
      at: new Date().toISOString(),
      escalationId,
      orderId: order_id,
      target: 'rider',
      flow: 'assign',
    });
    
    // Notify Jupiter
    await notifyJupiter('escalation_started', {
      escalationId,
      orderId: order_id,
      target: 'rider',
      flow: 'assign',
    });
    
    return res.status(200).json({
      success: true,
      escalationId,
      message: 'Rider assignment escalation started',
      riderName: riderData.name,
      pickup: riderData.pickupName,
    });
    
  } catch (err) {
    console.error('Rider assign notify error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Notify rider of address update (critical - fast escalation)
 */
router.post('/notify/rider/address-update', async (req, res) => {
  try {
    const {
      order_id,
      rider_id,
      rider_phone,
      new_address,
      map_link,
      language = 'hi',
    } = req.body;
    
    if (!order_id || !rider_id || !rider_phone || !new_address) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const escalationId = `rider_address_${order_id}`;
    
    await startEscalation(escalationId, 'rider', 'address_update', {
      orderId: order_id,
      riderId: rider_id,
      phone: rider_phone,
      newAddress: new_address,
      mapLink: map_link,
      language,
    });
    
    return res.status(200).json({
      success: true,
      escalationId,
    });
    
  } catch (err) {
    console.error('Address update notify error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Send vendor processing reminder
 */
router.post('/notify/vendor/reminder', async (req, res) => {
  try {
    const {
      order_id,
      vendor_id,
      vendor_phone,
      minutes_remaining,
      language = 'hi',
    } = req.body;
    
    const escalationId = `vendor_reminder_${order_id}`;
    
    await startEscalation(escalationId, 'vendor', 'reminder', {
      orderId: order_id,
      vendorId: vendor_id,
      phone: vendor_phone,
      minutesRemaining: minutes_remaining,
      language,
    });
    
    return res.status(200).json({
      success: true,
      escalationId,
    });
    
  } catch (err) {
    console.error('Vendor reminder error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Notify customer of order status
 */
router.post('/notify/customer/status', async (req, res) => {
  try {
    const {
      order_id,
      customer_phone,
      customer_name,
      status,
      eta_minutes,
      rider_name,
      language = 'hi',
    } = req.body;
    
    const escalationId = `customer_status_${order_id}_${Date.now()}`;
    
    await startEscalation(escalationId, 'customer', 'status', {
      orderId: order_id,
      phone: customer_phone,
      name: customer_name,
      status,
      etaMinutes: eta_minutes,
      riderName: rider_name,
      language,
    });
    
    return res.status(200).json({
      success: true,
      escalationId,
    });
    
  } catch (err) {
    console.error('Customer status notify error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Notify customer of delay
 */
router.post('/notify/customer/delay', async (req, res) => {
  try {
    const {
      order_id,
      customer_phone,
      delay_minutes,
      reason,
      language = 'hi',
    } = req.body;
    
    await sendWhatsAppTemplate(customer_phone, 'Customer_Delay', {
      orderId: order_id,
      delayMinutes: delay_minutes,
      reason,
    }, language);
    
    return res.status(200).json({ success: true });
    
  } catch (err) {
    console.error('Customer delay notify error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ESCALATION STOP (when action taken)
// ============================================================================

/**
 * Stop escalation when vendor/rider takes action
 */
router.post('/stop', async (req, res) => {
  try {
    const { escalation_id, action, actor } = req.body;
    
    if (!escalation_id) {
      return res.status(400).json({ error: 'escalation_id required' });
    }
    
    stopEscalation(escalation_id);
    
    emitEvent({
      type: 'comms.escalation.stopped',
      at: new Date().toISOString(),
      escalationId: escalation_id,
      action,
      actor,
    });
    
    await publish('comms.escalation.stopped', {
      escalationId: escalation_id,
      action,
      actor,
      timestamp: new Date().toISOString(),
    });
    
    return res.status(200).json({
      success: true,
      message: 'Escalation stopped',
    });
    
  } catch (err) {
    console.error('Stop escalation error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// BRIDGE CALLS
// ============================================================================

/**
 * Initiate bridge call between parties
 */
router.post('/bridge', async (req, res) => {
  try {
    const {
      order_id,
      party_a,        // { type: 'rider'|'vendor'|'customer', phone: '+91...' }
      party_b,        // { type: 'rider'|'vendor'|'customer'|'admin', phone: '+91...' }
      reason,
    } = req.body;
    
    if (!party_a?.phone || !party_b?.phone) {
      return res.status(400).json({ error: 'Both parties required' });
    }
    
    // Use masked bridge for privacy
    const response = await axios.post(`${EXOTEL_SERVICE_URL}/exotel/ivr/bridge/masked`, {
      party_a_phone: party_a.phone,
      party_b_phone: party_b.phone,
      context: `${party_a.type}_${party_b.type}`,
      order_id,
    });
    
    await publish('comms.bridge.initiated', {
      orderId: order_id,
      partyA: party_a.type,
      partyB: party_b.type,
      reason,
      callSid: response.data.callSid,
      timestamp: new Date().toISOString(),
    });
    
    return res.status(200).json({
      success: true,
      callSid: response.data.callSid,
    });
    
  } catch (err) {
    console.error('Bridge call error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// TIMELINE & LOGS
// ============================================================================

/**
 * Get communication timeline for an order
 */
router.get('/timeline/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // TODO: Query from database
    // For now, return structure
    const timeline = {
      orderId,
      events: [],
      channels: ['app', 'whatsapp', 'ring', 'ivr', 'bridge'],
      summary: {
        totalNotifications: 0,
        escalationsTriggered: 0,
        bridgeCalls: 0,
        avgResponseTime: null,
      },
    };
    
    return res.json(timeline);
    
  } catch (err) {
    console.error('Timeline error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ESCALATION ENGINE
// ============================================================================

async function startEscalation(escalationId, targetType, flow, data) {
  const config = ESCALATION_CONFIG[targetType]?.[flow];
  if (!config) {
    throw new Error(`Unknown escalation flow: ${targetType}.${flow}`);
  }
  
  // Store escalation state
  const escalation = {
    id: escalationId,
    targetType,
    flow,
    data,
    currentStep: 0,
    steps: Object.values(config),
    startedAt: new Date().toISOString(),
    status: 'active',
  };
  
  escalationTimers.set(escalationId, escalation);
  
  // Execute first step immediately
  await executeEscalationStep(escalation, 0);
  
  // Schedule remaining steps
  for (let i = 1; i < escalation.steps.length; i++) {
    const step = escalation.steps[i];
    const timer = setTimeout(async () => {
      // Check if escalation still active
      const current = escalationTimers.get(escalationId);
      if (current?.status === 'active') {
        await executeEscalationStep(current, i);
      }
    }, step.waitMs);
    
    escalation[`timer_${i}`] = timer;
  }
  
  return escalation;
}

function stopEscalation(escalationId) {
  const escalation = escalationTimers.get(escalationId);
  if (!escalation) return;
  
  escalation.status = 'stopped';
  
  // Clear all pending timers
  for (let i = 1; i < escalation.steps.length; i++) {
    const timer = escalation[`timer_${i}`];
    if (timer) clearTimeout(timer);
  }
  
  escalationTimers.delete(escalationId);
}

async function executeEscalationStep(escalation, stepIndex) {
  const step = escalation.steps[stepIndex];
  const { data, targetType, flow } = escalation;
  
  console.log(`📤 Escalation ${escalation.id} step ${stepIndex + 1}: ${step.channel}`);
  
  try {
    switch (step.channel) {
      case 'app_push':
        await sendAppPush(data, targetType, flow);
        break;
      case 'whatsapp':
        await sendWhatsApp(data, targetType, flow);
        break;
      case 'ring':
        await sendRing(data, targetType, flow);
        break;
      case 'ivr':
        await sendIvr(data, targetType, flow);
        break;
      case 'admin':
        await alertAdmin(data, targetType, flow);
        break;
    }
    
    // Log to message queue
    await publish('comms.notification.sent', {
      escalationId: escalation.id,
      step: stepIndex + 1,
      channel: step.channel,
      targetType,
      flow,
      orderId: data.orderId,
      timestamp: new Date().toISOString(),
    });
    
    emitEvent({
      type: 'comms.notification.sent',
      at: new Date().toISOString(),
      escalationId: escalation.id,
      step: stepIndex + 1,
      channel: step.channel,
    });
    
  } catch (err) {
    console.error(`Escalation step ${stepIndex + 1} failed:`, err);
    
    await publish('comms.notification.failed', {
      escalationId: escalation.id,
      step: stepIndex + 1,
      channel: step.channel,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// ============================================================================
// CHANNEL SENDERS
// ============================================================================

async function sendAppPush(data, targetType, flow) {
  // Send push notification via app backend
  try {
    await axios.post(`${PUSH_SERVICE_URL}/send`, {
      target: targetType,
      targetId: data.vendorId || data.riderId || data.customerId,
      flow,
      data,
    });
  } catch (err) {
    console.log('App push skipped (service unavailable)');
  }
}

async function sendWhatsApp(data, targetType, flow) {
  const templateMap = {
    vendor: {
      new_order: 'Vendor_New_Order',
      reminder: 'Vendor_Ready_Reminder',
    },
    rider: {
      assign: 'Rider_Assignment',
      address_update: 'Rider_Address_Updated',
    },
    customer: {
      status: 'Customer_Status',
      delay: 'Customer_Delay',
    },
  };
  
  const template = templateMap[targetType]?.[flow];
  if (!template) return;
  
  await sendWhatsAppTemplate(data.phone, template, data, data.language);
}

async function sendWhatsAppTemplate(phone, template, data, language = 'hi') {
  try {
    await axios.post(`${WHATSAPP_SERVICE_URL}/send`, {
      to: phone,
      template,
      language,
      parameters: data,
    });
  } catch (err) {
    console.log('WhatsApp skipped (service unavailable):', err.message);
  }
}

async function sendRing(data, targetType, flow) {
  // Simple ring (no IVR) - just alert
  const callerId = getCallerIdForFlow(flow);
  
  try {
    await axios.post(`${EXOTEL_SERVICE_URL}/exotel/call/connect`, {
      From: data.phone,
      To: data.phone,
      CallerId: callerId,
      TimeLimit: '30',  // Ring for 30 seconds
    });
  } catch (err) {
    console.error('Ring failed:', err.message);
    throw err;
  }
}

async function sendIvr(data, targetType, flow) {
  const endpoints = {
    vendor: {
      new_order: '/exotel/ivr/notify/vendor/order',
      reminder: '/exotel/ivr/notify/vendor/reminder',
    },
    rider: {
      assign: '/exotel/ivr/notify/rider/assign',
    },
  };
  
  const endpoint = endpoints[targetType]?.[flow];
  if (!endpoint) {
    console.log('No IVR endpoint for flow:', targetType, flow);
    return;
  }
  
  try {
    await axios.post(`${EXOTEL_SERVICE_URL}${endpoint}`, {
      [`${targetType}_id`]: data.vendorId || data.riderId,
      [`${targetType}_phone`]: data.phone,
      order_id: data.orderId,
      amount: data.amount,
      items: data.items,
      payment_mode: data.paymentMode,
      pickup_name: data.pickupName,
      pickup_address: data.pickupAddress,
      drop_address: data.dropAddress,
      minutes_remaining: data.minutesRemaining,
    });
  } catch (err) {
    console.error('IVR failed:', err.message);
    throw err;
  }
}

async function alertAdmin(data, targetType, flow) {
  // Create admin alert
  await publish('admin.alert.escalation', {
    type: 'escalation_failure',
    severity: 'high',
    targetType,
    flow,
    orderId: data.orderId,
    vendorId: data.vendorId,
    riderId: data.riderId,
    phone: data.phone,
    message: `No response from ${targetType} after all escalation steps`,
    timestamp: new Date().toISOString(),
  });
  
  emitEvent({
    type: 'admin.alert',
    at: new Date().toISOString(),
    orderId: data.orderId,
    severity: 'high',
    message: `Escalation to admin: ${targetType} not responding`,
  });
}

function getCallerIdForFlow(flow) {
  const callerIds = {
    new_order: process.env.EXOTEL_DID_NEW_ORDER,
    reminder: process.env.EXOTEL_DID_REMINDER,
    assign: process.env.EXOTEL_DID_NEW_ORDER,
    address_update: process.env.EXOTEL_DID_ADDRESS,
  };
  return callerIds[flow] || process.env.EXOTEL_CALLER_ID;
}

export default router;
