/**
 * Enhanced AI Voice Call Routes for Mangwale
 * 
 * This version properly integrates with Jupiter's voice-calls module.
 * 
 * Flow:
 * 1. Jupiter POST /api/ai-voice/vendor-order-confirmation → Mercury initiates call
 * 2. Exotel calls vendor → IVR plays order details
 * 3. Vendor presses DTMF → Exotel Passthru → GET /api/ai-voice/ai-callback
 * 4. Mercury processes → POST to Jupiter /api/voice-calls/result
 * 5. Jupiter updates database → triggers next action
 */

import express from 'express';
import multer from 'multer';
import axios from 'axios';
import {
  initiateAICall,
  handleAICallback,
  getCallHandler,
  getActiveCalls,
  CALL_TYPES,
} from '../services/ai-voice-call.service.js';

const router = express.Router();
const upload = multer();

// Jupiter callback URL (voice-calls module)
const JUPITER_URL = process.env.JUPITER_URL || 'http://192.168.0.156:3200';
const JUPITER_CALLBACK_PATH = '/api/voice-calls/result';

// ================================================================================
// JUPITER → MERCURY: Vendor Order Confirmation
// ================================================================================

/**
 * POST /api/ai-voice/vendor-order-confirmation
 * 
 * Called by Jupiter when a new order needs vendor confirmation.
 * 
 * Request body:
 * {
 *   orderId: 12345,
 *   vendorId: 67,
 *   vendorPhone: "+919876543210",
 *   vendorName: "Sharma Restaurant",
 *   customerName: "Rahul",
 *   orderItems: [
 *     { name: "Butter Chicken", quantity: 2, price: 350 },
 *     { name: "Naan", quantity: 4, price: 40 }
 *   ],
 *   orderAmount: 860,
 *   language: "hi",
 *   callbackUrl: "http://jupiter:3200/api/voice-calls/result"
 * }
 */
router.post('/vendor-order-confirmation', async (req, res) => {
  try {
    console.log('📞 Vendor order confirmation request:', JSON.stringify(req.body, null, 2));

    const {
      orderId,
      vendorId,
      vendorPhone,
      vendorName,
      customerName,
      orderItems,
      orderAmount,
      language = 'hi',
      callbackUrl,
    } = req.body;

    // Validate required fields
    if (!orderId || !vendorPhone || !vendorName) {
      return res.status(400).json({
        success: false,
        error: 'orderId, vendorPhone, and vendorName are required',
      });
    }

    // Build order summary for TTS
    const itemsSummary = orderItems
      ?.map(item => `${item.name} ${item.quantity > 1 ? `(${item.quantity})` : ''}`)
      .join(', ') || 'Order items';

    // Initiate call via Exotel
    const result = await initiateAICall({
      phone: vendorPhone,
      callType: CALL_TYPES.VENDOR_ORDER_CONFIRMATION,
      language,
      data: {
        orderId,
        vendorId,
        storeName: vendorName,
        customerName: customerName || 'Customer',
        itemsCount: orderItems?.length || 0,
        itemsSummary,
        orderAmount,
        paymentMethod: 'Cash on Delivery', // TODO: Pass from Jupiter
      },
      callbackUrl: callbackUrl || `${JUPITER_URL}${JUPITER_CALLBACK_PATH}`,
    });

    if (result.success) {
      // Store callback URL for later use
      const handler = getCallHandler(result.callSid);
      if (handler) {
        handler.jupiterCallbackUrl = callbackUrl || `${JUPITER_URL}${JUPITER_CALLBACK_PATH}`;
        handler.orderId = orderId;
        handler.vendorId = vendorId;
      }

      res.json({
        success: true,
        callSid: result.callSid,
        message: 'Vendor confirmation call initiated',
        status: 'initiated',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to initiate call',
      });
    }

  } catch (error) {
    console.error('❌ Vendor confirmation error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================================================================================
// JUPITER → MERCURY: Rider Assignment Call
// ================================================================================

/**
 * POST /api/ai-voice/rider-assignment
 * 
 * Called by Jupiter when a rider needs to be assigned to an order.
 */
router.post('/rider-assignment', async (req, res) => {
  try {
    console.log('🏍️ Rider assignment request:', JSON.stringify(req.body, null, 2));

    const {
      orderId,
      riderId,
      riderPhone,
      riderName,
      restaurantName,
      restaurantAddress,
      pickupTimeMinutes,
      customerName,
      deliveryAddress,
      language = 'hi',
      callbackUrl,
    } = req.body;

    if (!orderId || !riderPhone || !riderName) {
      return res.status(400).json({
        success: false,
        error: 'orderId, riderPhone, and riderName are required',
      });
    }

    const result = await initiateAICall({
      phone: riderPhone,
      callType: CALL_TYPES.RIDER_ASSIGNMENT,
      language,
      data: {
        orderId,
        riderId,
        riderName,
        storeName: restaurantName,
        pickupAddress: restaurantAddress,
        deliveryAddress,
        customerName,
        pickupTimeMinutes: pickupTimeMinutes || 30,
      },
      callbackUrl: callbackUrl || `${JUPITER_URL}${JUPITER_CALLBACK_PATH}`,
    });

    if (result.success) {
      const handler = getCallHandler(result.callSid);
      if (handler) {
        handler.jupiterCallbackUrl = callbackUrl || `${JUPITER_URL}${JUPITER_CALLBACK_PATH}`;
        handler.orderId = orderId;
        handler.riderId = riderId;
      }

      res.json({
        success: true,
        callSid: result.callSid,
        message: 'Rider assignment call initiated',
        status: 'initiated',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }

  } catch (error) {
    console.error('❌ Rider assignment error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================================================================================
// EXOTEL → MERCURY: Passthru Callback (GET)
// ================================================================================

/**
 * GET /api/ai-voice/ai-callback
 * 
 * Exotel Passthru applet sends GET request with query params.
 * 
 * Query params:
 * - CallSid: Unique call identifier
 * - CallFrom: Caller number
 * - CallTo: Called number  
 * - digits: DTMF input (if after Gather/IVR applet)
 * - CustomField: JSON with callType, orderId, etc.
 * 
 * Response:
 * - 200 OK: Success path (call continues to "success" applet)
 * - 302 Found: Failure path (call continues to "failure" applet)
 */
router.get('/ai-callback', async (req, res) => {
  try {
    console.log('📥 Passthru Callback (GET):', JSON.stringify(req.query, null, 2));
    
    const {
      CallSid,
      CallFrom,
      CallTo,
      digits,
      CustomField,
      Direction,
      CallStatus,
      CurrentTime,
    } = req.query;
    
    console.log(`📞 Call: ${CallSid} | From: ${CallFrom} | Status: ${CallStatus}`);
    
    // Parse CustomField (contains call context from our API)
    let callContext = {};
    if (CustomField) {
      try {
        callContext = JSON.parse(CustomField);
        console.log('📋 Call Context:', callContext);
      } catch (e) {
        console.log('📋 CustomField (raw):', CustomField);
      }
    }
    
    // Get call handler for additional context
    const handler = getCallHandler(CallSid);
    
    // Merge contexts
    const orderId = handler?.orderId || callContext.data?.orderId || callContext.orderId;
    const vendorId = handler?.vendorId || callContext.data?.vendorId || callContext.vendorId;
    const riderId = handler?.riderId || callContext.data?.riderId;
    const callType = handler?.callType || callContext.callType || 'unknown';
    
    // Handle DTMF digits if present
    if (digits) {
      const cleanDigits = digits.replace(/"/g, '').trim();
      console.log(`📱 DTMF Received: ${cleanDigits}`);
      
      // Determine status based on digits and call type
      let status, prepTimeMinutes, rejectionReason;
      
      if (callType === CALL_TYPES.VENDOR_ORDER_CONFIRMATION || callType === 'vendor_order_confirmation') {
        if (cleanDigits === '1') {
          status = 'ACCEPTED';
          console.log('✅ Vendor ACCEPTED order');
        } else if (cleanDigits === '0') {
          status = 'REJECTED';
          console.log('❌ Vendor REJECTED order');
        } else if (/^\d{1,2}#?$/.test(cleanDigits)) {
          // Prep time entered (e.g., "15", "25#")
          prepTimeMinutes = parseInt(cleanDigits.replace('#', ''));
          status = 'PREP_TIME_SET';
          console.log(`⏱️ Prep time set: ${prepTimeMinutes} minutes`);
        }
      } else if (callType === CALL_TYPES.RIDER_ASSIGNMENT || callType === 'rider_assignment') {
        if (cleanDigits === '1') {
          status = 'ACCEPTED';
          console.log('✅ Rider ACCEPTED pickup');
        } else if (cleanDigits === '0' || cleanDigits === '2') {
          status = 'REJECTED';
          console.log('❌ Rider DECLINED pickup');
        }
      }
      
      // Handle rejection reason digits (1-4)
      if (callType === 'rejection_reason' || (status === 'REJECTED' && cleanDigits >= '1' && cleanDigits <= '4')) {
        const reasons = {
          '1': 'ITEM_UNAVAILABLE',
          '2': 'TOO_BUSY',
          '3': 'SHOP_CLOSED',
          '4': 'OTHER',
        };
        rejectionReason = reasons[cleanDigits] || 'OTHER';
        status = 'REJECTED';
      }
      
      // Report to Jupiter
      await reportToJupiter({
        callSid: CallSid,
        callType: mapCallType(callType),
        status: status || 'ANSWERED',
        orderId,
        vendorId,
        riderId,
        digits: cleanDigits,
        prepTimeMinutes,
        rejectionReason,
        answeredAt: CurrentTime || new Date().toISOString(),
        exotelStatus: CallStatus,
      });
      
      // Return appropriate status code
      if (status === 'REJECTED') {
        return res.status(302).send('Rejected');
      }
      return res.status(200).send('OK');
    }
    
    // No DTMF - call just answered
    console.log('📞 Call answered, no DTMF yet');
    await reportToJupiter({
      callSid: CallSid,
      callType: mapCallType(callType),
      status: 'ANSWERED',
      orderId,
      vendorId,
      riderId,
      answeredAt: CurrentTime || new Date().toISOString(),
      exotelStatus: CallStatus,
    });
    
    return res.status(200).send('OK');
    
  } catch (error) {
    console.error('❌ Passthru callback error:', error);
    return res.status(200).send('OK'); // Still return 200 to not break call
  }
});

/**
 * Map internal call types to Jupiter enum values
 */
function mapCallType(callType) {
  const mapping = {
    'vendor_order_confirmation': 'VENDOR_ORDER_CONFIRMATION',
    'vendor_order_ready': 'VENDOR_ORDER_READY',
    'rider_assignment': 'RIDER_ASSIGNMENT',
    'rider_pickup_reminder': 'RIDER_PICKUP_READY',
    'customer_support': 'CUSTOMER_DELIVERY_UPDATE',
  };
  return mapping[callType] || callType;
}

/**
 * Report call result to Jupiter's voice-calls module
 */
async function reportToJupiter(data) {
  try {
    const url = `${JUPITER_URL}${JUPITER_CALLBACK_PATH}`;
    console.log(`📤 Reporting to Jupiter: ${url}`);
    console.log(`📤 Data: ${JSON.stringify(data, null, 2)}`);
    
    await axios.post(url, data, { 
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' },
    });
    
    console.log('✅ Reported to Jupiter successfully');
  } catch (error) {
    console.error(`❌ Failed to report to Jupiter: ${error.message}`);
    // Don't throw - call should continue even if Jupiter is down
  }
}

// ================================================================================
// EXOTEL → MERCURY: Status Callback (POST)
// ================================================================================

/**
 * POST /api/ai-voice/ai-callback/status
 * 
 * Exotel sends call status updates here.
 */
router.post('/ai-callback/status', upload.none(), async (req, res) => {
  try {
    console.log('📊 Status Callback:', JSON.stringify(req.body, null, 2));
    
    const callSid = req.body.CallSid || req.body.call_sid || req.body.Sid;
    const status = req.body.CallStatus || req.body.Status || req.body.status;
    const duration = req.body.Duration || req.body.duration;
    const recordingUrl = req.body.RecordingUrl || req.body.recording_url;
    
    // Map Exotel status to our status
    const statusMap = {
      'completed': 'COMPLETED',
      'no-answer': 'NO_RESPONSE',
      'busy': 'BUSY',
      'failed': 'FAILED',
      'canceled': 'CANCELLED',
      'ringing': 'RINGING',
      'in-progress': 'ANSWERED',
    };
    
    const mappedStatus = statusMap[status?.toLowerCase()] || status;
    
    // Get handler for context
    const handler = getCallHandler(callSid);
    
    // Report final status to Jupiter
    if (['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(status?.toLowerCase())) {
      await reportToJupiter({
        callSid,
        callType: handler?.callType ? mapCallType(handler.callType) : 'VENDOR_ORDER_CONFIRMATION',
        status: mappedStatus,
        orderId: handler?.orderId,
        vendorId: handler?.vendorId,
        riderId: handler?.riderId,
        duration: parseInt(duration) || 0,
        recordingUrl,
        endedAt: new Date().toISOString(),
        exotelStatus: status,
      });
      
      // Cleanup handler
      if (handler) {
        handler.cleanup();
      }
    }
    
    res.json({ received: true });
    
  } catch (error) {
    console.error('❌ Status callback error:', error);
    res.json({ received: true, error: error.message });
  }
});

// ================================================================================
// LEGACY ROUTES (for backward compatibility)
// ================================================================================

router.post('/outbound-call', async (req, res) => {
  try {
    console.log('📞 Received outbound call request:', JSON.stringify(req.body, null, 2));

    const { phone, callType, data, language, priority, callbackUrl } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    if (!callType || !Object.values(CALL_TYPES).includes(callType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid call type. Valid types: ${Object.values(CALL_TYPES).join(', ')}`,
      });
    }

    const result = await initiateAICall({
      phone,
      callType,
      data,
      language: language || 'hi',
      priority: priority || 5,
      callbackUrl,
    });

    if (result.success) {
      res.json({
        success: true,
        callSid: result.callSid,
        message: 'Call initiated successfully',
        status: 'initiated',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }

  } catch (error) {
    console.error('❌ Outbound call error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST callback handler (legacy)
router.post('/ai-callback', upload.none(), async (req, res) => {
  try {
    console.log('📥 AI Callback Body:', JSON.stringify(req.body, null, 2));
    const callSid = req.body.CallSid || req.body.call_sid;
    const twiml = await handleAICallback(callSid, 'answered', req.body);
    res.type('application/xml').send(twiml);
  } catch (error) {
    console.error('❌ AI callback error:', error);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
});

// DTMF callback
router.post('/ai-callback/:callSid/dtmf', upload.none(), async (req, res) => {
  try {
    const { callSid } = req.params;
    console.log('📱 DTMF Callback:', callSid, JSON.stringify(req.body, null, 2));
    const twiml = await handleAICallback(callSid, 'dtmf', req.body);
    res.type('application/xml').send(twiml);
  } catch (error) {
    console.error('❌ DTMF callback error:', error);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
});

// ================================================================================
// MANAGEMENT ENDPOINTS
// ================================================================================

router.get('/active-calls', (req, res) => {
  const calls = getActiveCalls();
  res.json({
    success: true,
    count: calls.length,
    calls,
  });
});

router.get('/call/:callSid', (req, res) => {
  const { callSid } = req.params;
  const handler = getCallHandler(callSid);

  if (!handler) {
    return res.status(404).json({
      success: false,
      error: 'Call not found',
    });
  }

  res.json({
    success: true,
    call: {
      callSid,
      callType: handler.callType,
      state: handler.state,
      phone: handler.callData.phone,
      language: handler.language,
      orderId: handler.orderId,
      vendorId: handler.vendorId,
      duration: Math.floor((Date.now() - handler.startTime) / 1000),
      conversationHistory: handler.conversationHistory,
    },
  });
});

router.get('/call-types', (req, res) => {
  res.json({
    success: true,
    callTypes: Object.entries(CALL_TYPES).map(([key, value]) => ({
      key,
      value,
      description: getCallTypeDescription(value),
    })),
  });
});

function getCallTypeDescription(callType) {
  const descriptions = {
    vendor_order_confirmation: 'Confirm new order with vendor, get preparation time',
    vendor_order_ready: 'Notify vendor that order is ready for pickup',
    rider_assignment: 'Assign delivery to rider with pickup/delivery details',
    rider_pickup_reminder: 'Remind rider to pick up order',
    customer_support: 'Automated customer support callback',
    payment_reminder: 'Remind about pending payment',
    feedback_request: 'Request feedback after delivery',
  };
  return descriptions[callType] || 'Unknown call type';
}

// Test call endpoint
router.post('/test-call', async (req, res) => {
  try {
    const { phone, language = 'hi' } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    const result = await initiateAICall({
      phone,
      callType: CALL_TYPES.VENDOR_ORDER_CONFIRMATION,
      language,
      data: {
        orderId: 'TEST-' + Date.now(),
        storeName: 'Test Restaurant',
        itemsCount: 3,
        orderAmount: 350,
        paymentMethod: 'Online Paid',
        itemsSummary: 'Paneer Butter Masala, Naan (2), Rice',
      },
    });

    res.json(result);

  } catch (error) {
    console.error('❌ Test call error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
