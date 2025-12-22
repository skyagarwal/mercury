/**
 * Number Masking Routes for Mangwale
 * 
 * Endpoints for creating, managing, and handling masked calls
 * between customers, vendors, and riders.
 * 
 * Privacy Protection: Neither party sees the other's actual phone number.
 */

import express from 'express';
import { emitEvent } from '../utils/events.js';
import { publish } from '../utils/mq.js';
import {
  createMaskedSession,
  getMaskedSession,
  endMaskedSession,
  handleMaskedCall,
  handleCallStatusCallback,
  getMaskingStats,
  listActiveSessions,
  maskCustomerRider,
  maskCustomerVendor,
  maskRiderVendor
} from '../services/number-masking.service.js';

// Import Jupiter client for data fetching
import {
  getOrderDetails,
  getDeliveryManDetails,
  getStoreDetails,
  getCustomerByPhone
} from '../services/jupiter.service.js';

const router = express.Router();

// ============================================================================
// CREATE MASKING SESSIONS
// ============================================================================

/**
 * POST /masking/create
 * Create a generic masking session between two parties
 */
router.post('/create', async (req, res) => {
  try {
    const {
      orderId,
      partyA,
      partyB,
      partyAType = 'customer',
      partyBType = 'rider',
      ttlMinutes = 120,
      metadata = {}
    } = req.body;
    
    if (!orderId || !partyA || !partyB) {
      return res.status(400).json({
        error: 'Missing required fields: orderId, partyA, partyB'
      });
    }
    
    const session = await createMaskedSession({
      orderId,
      partyA,
      partyB,
      partyAType,
      partyBType,
      ttlMinutes,
      metadata
    });
    
    return res.status(201).json({
      success: true,
      session,
      maskedNumber: session.maskedNumber,
      message: `Both parties can use ${session.maskedNumber} to call each other`
    });
    
  } catch (err) {
    console.error('Error creating masking session:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /masking/customer-rider
 * Create masking session for customer ↔ rider communication
 * Typically triggered when rider is assigned to an order
 */
router.post('/customer-rider', async (req, res) => {
  try {
    const { orderId } = req.body;
    
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
    
    if (!customerPhone || !riderPhone) {
      return res.status(400).json({
        error: 'Missing customer or rider phone number',
        customerPhone: !!customerPhone,
        riderPhone: !!riderPhone
      });
    }
    
    const session = await maskCustomerRider(orderId, customerPhone, riderPhone);
    
    // Emit event for real-time tracking
    emitEvent({
      type: 'masking.customer_rider.created',
      at: new Date().toISOString(),
      orderId,
      sessionId: session.sessionId
    });
    
    return res.status(201).json({
      success: true,
      session,
      message: 'Customer and rider can now call each other using the masked number'
    });
    
  } catch (err) {
    console.error('Error creating customer-rider masking:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /masking/customer-vendor
 * Create masking session for customer ↔ vendor communication
 * For order queries and issues
 */
router.post('/customer-vendor', async (req, res) => {
  try {
    const { orderId } = req.body;
    
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
    
    if (!customerPhone || !vendorPhone) {
      return res.status(400).json({
        error: 'Missing customer or vendor phone number',
        customerPhone: !!customerPhone,
        vendorPhone: !!vendorPhone
      });
    }
    
    const session = await maskCustomerVendor(orderId, customerPhone, vendorPhone);
    
    return res.status(201).json({
      success: true,
      session,
      message: 'Customer and vendor can now call each other using the masked number'
    });
    
  } catch (err) {
    console.error('Error creating customer-vendor masking:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /masking/rider-vendor
 * Create masking session for rider ↔ vendor communication
 * For pickup coordination
 */
router.post('/rider-vendor', async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    
    // Fetch order details from Jupiter
    const order = await getOrderDetails(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const riderPhone = order.delivery_man?.phone;
    const vendorPhone = order.store?.phone;
    
    if (!riderPhone || !vendorPhone) {
      return res.status(400).json({
        error: 'Missing rider or vendor phone number',
        riderPhone: !!riderPhone,
        vendorPhone: !!vendorPhone
      });
    }
    
    const session = await maskRiderVendor(orderId, riderPhone, vendorPhone);
    
    return res.status(201).json({
      success: true,
      session,
      message: 'Rider and vendor can now call each other using the masked number'
    });
    
  } catch (err) {
    console.error('Error creating rider-vendor masking:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * GET /masking/session/:orderId
 * Get masking session details for an order
 */
router.get('/session/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const session = getMaskedSession(orderId);
    
    if (!session) {
      return res.status(404).json({
        error: 'No active masking session found for this order',
        orderId
      });
    }
    
    return res.json({ session });
    
  } catch (err) {
    console.error('Error getting masking session:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /masking/end
 * End a masking session (typically when order is delivered)
 */
router.post('/end', async (req, res) => {
  try {
    const { orderId, reason = 'order_completed' } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    
    const session = await endMaskedSession(orderId, reason);
    
    if (!session) {
      return res.status(404).json({
        error: 'No active masking session found for this order',
        orderId
      });
    }
    
    return res.json({
      success: true,
      session,
      message: 'Masking session ended successfully'
    });
    
  } catch (err) {
    console.error('Error ending masking session:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /masking/active
 * List all active masking sessions
 */
router.get('/active', async (req, res) => {
  try {
    const sessions = listActiveSessions();
    const stats = getMaskingStats();
    
    return res.json({
      stats,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        orderId: s.orderId,
        maskedNumber: s.maskedNumber,
        partyAType: s.partyA?.type,
        partyBType: s.partyB?.type,
        status: s.status,
        expiresAt: s.expiresAt
      }))
    });
    
  } catch (err) {
    console.error('Error listing active sessions:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /masking/stats
 * Get masking service statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = getMaskingStats();
    return res.json(stats);
  } catch (err) {
    console.error('Error getting masking stats:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// EXOTEL CALLBACKS (Webhooks)
// ============================================================================

/**
 * POST /masking/callback
 * Handle incoming calls on masked numbers (from Exotel)
 */
router.post('/callback', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const {
      CallSid,
      From,
      To,
      Direction,
      CallType,
      custom_field
    } = req.body;
    
    console.log(`📞 Masked call: ${From} → ${To}`);
    
    // Handle the masked call and get dial instructions
    const result = await handleMaskedCall(CallSid, From, To, custom_field);
    
    if (result.action === 'dial') {
      // Return Exotel-compatible response to dial the other party
      // This would typically be XML or specific format based on Exotel's applet
      return res.status(200).type('application/xml').send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Dial record="${result.record}" callerId="${result.callerId}" timeout="${result.timeout}">
            <Number>${result.number}</Number>
          </Dial>
        </Response>
      `);
    } else {
      return res.status(200).type('application/xml').send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Hangup reason="${result.reason}" />
        </Response>
      `);
    }
    
  } catch (err) {
    console.error('Error handling masked call callback:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /masking/status
 * Handle call status updates from Exotel
 */
router.post('/status', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const result = await handleCallStatusCallback(req.body);
    return res.json(result);
  } catch (err) {
    console.error('Error handling status callback:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// INTEGRATION WITH JUPITER WEBHOOKS
// ============================================================================

/**
 * POST /masking/auto/rider-assigned
 * Automatically create masking when rider is assigned
 * Called by Jupiter webhook
 */
router.post('/auto/rider-assigned', async (req, res) => {
  try {
    const { orderId, riderId, customerId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    
    // Fetch order details to get phone numbers
    const order = await getOrderDetails(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const customerPhone = order.customer?.phone;
    const riderPhone = order.delivery_man?.phone;
    
    if (!customerPhone || !riderPhone) {
      console.log(`⚠️ Auto-masking skipped: missing phone numbers for order ${orderId}`);
      return res.json({
        success: false,
        reason: 'Missing phone numbers',
        customerPhone: !!customerPhone,
        riderPhone: !!riderPhone
      });
    }
    
    const session = await maskCustomerRider(orderId, customerPhone, riderPhone);
    
    // Publish to MQ for other services
    await publish('masking.auto.created', {
      orderId,
      sessionId: session.sessionId,
      trigger: 'rider_assigned'
    });
    
    return res.status(201).json({
      success: true,
      session,
      trigger: 'rider_assigned'
    });
    
  } catch (err) {
    console.error('Error in auto rider-assigned masking:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /masking/auto/order-delivered
 * Automatically end masking when order is delivered
 * Called by Jupiter webhook
 */
router.post('/auto/order-delivered', async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    
    const session = await endMaskedSession(orderId, 'order_delivered');
    
    if (session) {
      // Publish to MQ
      await publish('masking.auto.ended', {
        orderId,
        sessionId: session.sessionId,
        trigger: 'order_delivered'
      });
    }
    
    return res.json({
      success: true,
      session,
      trigger: 'order_delivered'
    });
    
  } catch (err) {
    console.error('Error in auto order-delivered masking end:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
