/**
 * Jupiter Webhooks - Receive events from Jupiter/PHP backend
 * 
 * This module handles incoming webhooks from Jupiter when:
 * - New order is placed → Notify vendor
 * - Rider is assigned → Notify rider + Create masking
 * - Order status changes → Update escalations
 * - Address changes → Notify rider
 * - Order delivered → End masking
 * 
 * Jupiter (192.168.0.156:3200) → Exotel Service (192.168.0.151:3100)
 */

import express from 'express';
import crypto from 'crypto';
import { getConfig } from '../utils/config.js';
import { publish } from '../utils/mq.js';
import { emitEvent } from '../utils/events.js';

// Import Jupiter client for data fetching
import {
  getOrderDetails,
  getStoreDetails,
  getDeliveryManDetails,
} from '../services/jupiter.service.js';

// Import masking service for automatic masking
import {
  maskCustomerRider,
  endMaskedSession
} from '../services/number-masking.service.js';

const router = express.Router();

// Webhook secret for signature verification (configure in Jupiter)
const WEBHOOK_SECRET = process.env.JUPITER_WEBHOOK_SECRET || 'mangwale-exotel-webhook-secret';

// Service URLs
const COMMS_URL = process.env.EXOTEL_SERVICE_URL || 'http://localhost:3100';
const IVR_URL = process.env.EXOTEL_SERVICE_URL || 'http://localhost:3100';

// ============================================================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================================================

function verifySignature(payload, signature) {
  if (!WEBHOOK_SECRET || WEBHOOK_SECRET === 'mangwale-exotel-webhook-secret') {
    // Skip verification in development
    console.log('⚠️ Webhook signature verification skipped (dev mode)');
    return true;
  }
  
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const expectedSignature = hmac.update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expectedSignature)
  );
}

// ============================================================================
// ORDER EVENTS
// ============================================================================

/**
 * New order placed - notify vendor
 * Jupiter sends this when a customer places an order
 */
router.post('/order/new', express.json(), async (req, res) => {
  try {
    const signature = req.headers['x-jupiter-signature'];
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const { 
      order_id,
      store_id,
      customer_id,
      amount,
      payment_method,
      items,
    } = req.body;
    
    console.log(`📦 Webhook: New order ${order_id} - ₹${amount}`);
    
    // Emit event
    emitEvent({
      type: 'jupiter.order.new',
      at: new Date().toISOString(),
      orderId: order_id,
      storeId: store_id,
      amount,
    });
    
    // Publish to message queue
    await publish('jupiter.order.new', {
      orderId: order_id,
      storeId: store_id,
      customerId: customer_id,
      amount,
      paymentMethod: payment_method,
      items,
      receivedAt: new Date().toISOString(),
    });
    
    // Start vendor notification escalation
    // The comms endpoint will fetch full details from Jupiter
    const axios = require('axios');
    try {
      await axios.post(`${COMMS_URL}/comms/notify/vendor/order`, {
        order_id,
        vendor_id: store_id,
        amount,
        items: items?.map(i => `${i.quantity}x ${i.name}`).join(', '),
        payment_mode: payment_method === 'cash_on_delivery' ? 'cod' : 'online',
      });
      console.log(`✅ Vendor escalation started for order ${order_id}`);
    } catch (commsErr) {
      console.error(`Failed to start vendor escalation: ${commsErr.message}`);
    }
    
    return res.status(200).json({ 
      received: true, 
      orderId: order_id,
      action: 'vendor_notification_started',
    });
    
  } catch (err) {
    console.error('Order new webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Order accepted by vendor
 */
router.post('/order/accepted', express.json(), async (req, res) => {
  try {
    const { order_id, store_id, prep_time_minutes } = req.body;
    
    console.log(`✅ Webhook: Order ${order_id} accepted by vendor ${store_id}`);
    
    emitEvent({
      type: 'jupiter.order.accepted',
      at: new Date().toISOString(),
      orderId: order_id,
      storeId: store_id,
      prepTime: prep_time_minutes,
    });
    
    await publish('jupiter.order.accepted', {
      orderId: order_id,
      storeId: store_id,
      prepTimeMinutes: prep_time_minutes,
      receivedAt: new Date().toISOString(),
    });
    
    // Stop vendor escalation
    const axios = require('axios');
    try {
      await axios.post(`${COMMS_URL}/comms/escalation/stop`, {
        escalation_id: `vendor_order_${order_id}`,
        reason: 'order_accepted',
      });
    } catch (stopErr) {
      console.log(`Escalation stop: ${stopErr.message}`);
    }
    
    return res.status(200).json({ received: true, orderId: order_id });
    
  } catch (err) {
    console.error('Order accepted webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Order rejected by vendor
 */
router.post('/order/rejected', express.json(), async (req, res) => {
  try {
    const { order_id, store_id, reason } = req.body;
    
    console.log(`❌ Webhook: Order ${order_id} rejected by vendor ${store_id}`);
    
    emitEvent({
      type: 'jupiter.order.rejected',
      at: new Date().toISOString(),
      orderId: order_id,
      storeId: store_id,
      reason,
    });
    
    await publish('jupiter.order.rejected', {
      orderId: order_id,
      storeId: store_id,
      reason,
      receivedAt: new Date().toISOString(),
    });
    
    // Stop vendor escalation
    const axios = require('axios');
    try {
      await axios.post(`${COMMS_URL}/comms/escalation/stop`, {
        escalation_id: `vendor_order_${order_id}`,
        reason: 'order_rejected',
      });
    } catch (stopErr) {
      console.log(`Escalation stop: ${stopErr.message}`);
    }
    
    // TODO: Notify customer, reassign to another vendor
    
    return res.status(200).json({ received: true, orderId: order_id });
    
  } catch (err) {
    console.error('Order rejected webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Order ready for pickup
 */
router.post('/order/ready', express.json(), async (req, res) => {
  try {
    const { order_id, store_id } = req.body;
    
    console.log(`🍽️ Webhook: Order ${order_id} ready for pickup`);
    
    emitEvent({
      type: 'jupiter.order.ready',
      at: new Date().toISOString(),
      orderId: order_id,
      storeId: store_id,
    });
    
    await publish('jupiter.order.ready', {
      orderId: order_id,
      storeId: store_id,
      receivedAt: new Date().toISOString(),
    });
    
    // Notify assigned rider
    // TODO: Trigger rider notification
    
    return res.status(200).json({ received: true, orderId: order_id });
    
  } catch (err) {
    console.error('Order ready webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// RIDER EVENTS
// ============================================================================

/**
 * Rider assigned to order
 */
router.post('/rider/assigned', express.json(), async (req, res) => {
  try {
    const { 
      order_id, 
      delivery_man_id, 
      delivery_man_phone,
      delivery_man_name,
    } = req.body;
    
    console.log(`🛵 Webhook: Rider ${delivery_man_id} assigned to order ${order_id}`);
    
    emitEvent({
      type: 'jupiter.rider.assigned',
      at: new Date().toISOString(),
      orderId: order_id,
      riderId: delivery_man_id,
    });
    
    await publish('jupiter.rider.assigned', {
      orderId: order_id,
      riderId: delivery_man_id,
      riderPhone: delivery_man_phone,
      riderName: delivery_man_name,
      receivedAt: new Date().toISOString(),
    });
    
    // Start rider notification escalation
    const axios = require('axios');
    try {
      await axios.post(`${COMMS_URL}/comms/notify/rider/assign`, {
        order_id,
        rider_id: delivery_man_id,
        rider_phone: delivery_man_phone,
        rider_name: delivery_man_name,
      });
      console.log(`✅ Rider escalation started for order ${order_id}`);
    } catch (commsErr) {
      console.error(`Failed to start rider escalation: ${commsErr.message}`);
    }
    
    // AUTO-CREATE NUMBER MASKING for customer ↔ rider privacy
    try {
      const order = await getOrderDetails(order_id);
      if (order && order.customer?.phone && delivery_man_phone) {
        const maskingSession = await maskCustomerRider(
          order_id, 
          order.customer.phone, 
          delivery_man_phone
        );
        console.log(`🔒 Auto-masking created for order ${order_id}: ${maskingSession.maskedNumber}`);
        
        // Emit masking event
        emitEvent({
          type: 'auto_masking.customer_rider.created',
          at: new Date().toISOString(),
          orderId: order_id,
          sessionId: maskingSession.sessionId,
          maskedNumber: maskingSession.maskedNumber
        });
      } else {
        console.log(`⚠️ Auto-masking skipped for order ${order_id}: Missing phone numbers`);
      }
    } catch (maskErr) {
      console.error(`Auto-masking failed for order ${order_id}: ${maskErr.message}`);
    }
    
    return res.status(200).json({ 
      received: true, 
      orderId: order_id,
      action: 'rider_notification_started',
    });
    
  } catch (err) {
    console.error('Rider assigned webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Rider accepted assignment
 */
router.post('/rider/accepted', express.json(), async (req, res) => {
  try {
    const { order_id, delivery_man_id } = req.body;
    
    console.log(`✅ Webhook: Rider ${delivery_man_id} accepted order ${order_id}`);
    
    emitEvent({
      type: 'jupiter.rider.accepted',
      at: new Date().toISOString(),
      orderId: order_id,
      riderId: delivery_man_id,
    });
    
    await publish('jupiter.rider.accepted', {
      orderId: order_id,
      riderId: delivery_man_id,
      receivedAt: new Date().toISOString(),
    });
    
    // Stop rider escalation
    const axios = require('axios');
    try {
      await axios.post(`${COMMS_URL}/comms/escalation/stop`, {
        escalation_id: `rider_assign_${order_id}`,
        reason: 'rider_accepted',
      });
    } catch (stopErr) {
      console.log(`Escalation stop: ${stopErr.message}`);
    }
    
    return res.status(200).json({ received: true, orderId: order_id });
    
  } catch (err) {
    console.error('Rider accepted webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Rider rejected assignment
 */
router.post('/rider/rejected', express.json(), async (req, res) => {
  try {
    const { order_id, delivery_man_id, reason } = req.body;
    
    console.log(`❌ Webhook: Rider ${delivery_man_id} rejected order ${order_id}`);
    
    emitEvent({
      type: 'jupiter.rider.rejected',
      at: new Date().toISOString(),
      orderId: order_id,
      riderId: delivery_man_id,
      reason,
    });
    
    await publish('jupiter.rider.rejected', {
      orderId: order_id,
      riderId: delivery_man_id,
      reason,
      receivedAt: new Date().toISOString(),
    });
    
    // Stop current rider escalation
    const axios = require('axios');
    try {
      await axios.post(`${COMMS_URL}/comms/escalation/stop`, {
        escalation_id: `rider_assign_${order_id}`,
        reason: 'rider_rejected',
      });
    } catch (stopErr) {
      console.log(`Escalation stop: ${stopErr.message}`);
    }
    
    // Jupiter will assign new rider and send another webhook
    
    return res.status(200).json({ received: true, orderId: order_id });
    
  } catch (err) {
    console.error('Rider rejected webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Delivery address changed - critical notification to rider
 */
router.post('/address/changed', express.json(), async (req, res) => {
  try {
    const { 
      order_id, 
      delivery_man_id,
      delivery_man_phone,
      new_address,
      old_address,
    } = req.body;
    
    console.log(`📍 Webhook: Address changed for order ${order_id}`);
    
    emitEvent({
      type: 'jupiter.address.changed',
      at: new Date().toISOString(),
      orderId: order_id,
      riderId: delivery_man_id,
      newAddress: new_address,
    });
    
    await publish('jupiter.address.changed', {
      orderId: order_id,
      riderId: delivery_man_id,
      newAddress: new_address,
      oldAddress: old_address,
      receivedAt: new Date().toISOString(),
    });
    
    // Start critical/fast escalation for address update
    const axios = require('axios');
    if (delivery_man_id) {
      try {
        await axios.post(`${COMMS_URL}/comms/notify/rider/address-update`, {
          order_id,
          rider_id: delivery_man_id,
          rider_phone: delivery_man_phone,
          new_address,
          old_address,
        });
        console.log(`✅ Address update escalation started for order ${order_id}`);
      } catch (commsErr) {
        console.error(`Failed to notify rider of address change: ${commsErr.message}`);
      }
    }
    
    return res.status(200).json({ 
      received: true, 
      orderId: order_id,
      action: 'address_update_notification_started',
    });
    
  } catch (err) {
    console.error('Address changed webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// DELIVERY EVENTS
// ============================================================================

/**
 * Order picked up from store
 */
router.post('/order/picked-up', express.json(), async (req, res) => {
  try {
    const { order_id, delivery_man_id, picked_at } = req.body;
    
    console.log(`🛵 Webhook: Order ${order_id} picked up`);
    
    emitEvent({
      type: 'jupiter.order.picked_up',
      at: new Date().toISOString(),
      orderId: order_id,
      riderId: delivery_man_id,
    });
    
    await publish('jupiter.order.picked_up', {
      orderId: order_id,
      riderId: delivery_man_id,
      pickedAt: picked_at,
      receivedAt: new Date().toISOString(),
    });
    
    // TODO: Notify customer (ETA update)
    
    return res.status(200).json({ received: true, orderId: order_id });
    
  } catch (err) {
    console.error('Order picked up webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Order delivered
 */
router.post('/order/delivered', express.json(), async (req, res) => {
  try {
    const { order_id, delivery_man_id, delivered_at } = req.body;
    
    console.log(`✅ Webhook: Order ${order_id} delivered`);
    
    emitEvent({
      type: 'jupiter.order.delivered',
      at: new Date().toISOString(),
      orderId: order_id,
      riderId: delivery_man_id,
    });
    
    await publish('jupiter.order.delivered', {
      orderId: order_id,
      riderId: delivery_man_id,
      deliveredAt: delivered_at,
      receivedAt: new Date().toISOString(),
    });
    
    // Stop all escalations for this order
    const axios = require('axios');
    try {
      await axios.post(`${COMMS_URL}/comms/escalation/stop`, {
        escalation_id: `vendor_order_${order_id}`,
        reason: 'order_delivered',
      });
      await axios.post(`${COMMS_URL}/comms/escalation/stop`, {
        escalation_id: `rider_assign_${order_id}`,
        reason: 'order_delivered',
      });
    } catch (stopErr) {
      // OK if already stopped
    }
    
    // AUTO-END NUMBER MASKING for privacy cleanup
    try {
      const session = await endMaskedSession(order_id, 'order_delivered');
      if (session) {
        console.log(`🔓 Auto-masking ended for order ${order_id}`);
        emitEvent({
          type: 'auto_masking.ended',
          at: new Date().toISOString(),
          orderId: order_id,
          sessionId: session.sessionId,
          reason: 'order_delivered'
        });
      }
    } catch (maskErr) {
      console.log(`Masking cleanup for order ${order_id}: ${maskErr.message}`);
    }
    
    return res.status(200).json({ received: true, orderId: order_id });
    
  } catch (err) {
    console.error('Order delivered webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// HEALTH & STATUS
// ============================================================================

/**
 * Webhook health check - Jupiter can ping this to verify connectivity
 */
router.get('/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    service: 'exotel-jupiter-webhooks',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/webhooks/jupiter/order/new',
      '/webhooks/jupiter/order/accepted',
      '/webhooks/jupiter/order/rejected',
      '/webhooks/jupiter/order/ready',
      '/webhooks/jupiter/rider/assigned',
      '/webhooks/jupiter/rider/accepted',
      '/webhooks/jupiter/rider/rejected',
      '/webhooks/jupiter/address/changed',
      '/webhooks/jupiter/order/picked-up',
      '/webhooks/jupiter/order/delivered',
    ],
  });
});

/**
 * Test webhook (for debugging)
 */
router.post('/test', express.json(), (req, res) => {
  console.log('🧪 Test webhook received:', JSON.stringify(req.body, null, 2));
  
  emitEvent({
    type: 'jupiter.webhook.test',
    at: new Date().toISOString(),
    payload: req.body,
  });
  
  return res.status(200).json({ 
    received: true, 
    echo: req.body,
    timestamp: new Date().toISOString(),
  });
});

export default router;
