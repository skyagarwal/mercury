/**
 * AI Voice Call Routes
 * 
 * Endpoints for Jupiter to trigger outbound AI calls
 * and for Exotel to callback with call events
 */

import express from 'express';
import multer from 'multer';
import {
  initiateAICall,
  handleAICallback,
  getCallHandler,
  getActiveCalls,
  CALL_TYPES,
} from '../services/ai-voice-call.service.js';

const router = express.Router();

// Multer for parsing multipart/form-data (Exotel uses this)
const upload = multer();

// ============================================================================
// OUTBOUND CALL ENDPOINT (Called by Jupiter)
// ============================================================================

/**
 * POST /api/voice/outbound-call
 * 
 * Initiate an AI-powered outbound call
 * 
 * Body:
 * {
 *   phone: "+919923383838",
 *   callType: "vendor_order_confirmation",
 *   language: "hi",
 *   data: {
 *     orderId: "ORD-12345",
 *     storeName: "Sharma General Store",
 *     itemsCount: 5,
 *     orderAmount: 450,
 *     paymentMethod: "Cash on Delivery"
 *   },
 *   priority: 5,
 *   callbackUrl: "http://192.168.0.156:3200/api/voice/callback"
 * }
 */
router.post('/outbound-call', async (req, res) => {
  try {
    console.log('📞 Received outbound call request:', JSON.stringify(req.body, null, 2));

    const { phone, callType, data, language, priority, callbackUrl } = req.body;

    // Validate required fields
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

    // Validate data based on call type
    if (callType === CALL_TYPES.VENDOR_ORDER_CONFIRMATION) {
      if (!data?.orderId || !data?.storeName) {
        return res.status(400).json({
          success: false,
          error: 'orderId and storeName are required for vendor order confirmation',
        });
      }
    }

    // Initiate the call
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

// ============================================================================
// EXOTEL CALLBACK ENDPOINTS
// ============================================================================

/**
 * GET /api/voice/ai-callback
 * Exotel Passthru Applet callback (GET request with query params)
 * 
 * Parameters received:
 * - CallSid: Unique call identifier
 * - CallFrom: Caller number
 * - CallTo: Called number  
 * - digits: DTMF input (if after Gather/IVR applet)
 * - CustomField: Custom data passed via API
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
      CallStatus
    } = req.query;
    
    console.log(`📞 Call: ${CallSid} | From: ${CallFrom} | Status: ${CallStatus}`);
    
    // Parse CustomField if present (contains our call context)
    let callContext = {};
    if (CustomField) {
      try {
        callContext = JSON.parse(CustomField);
        console.log('📋 Call Context:', callContext);
      } catch (e) {
        console.log('📋 CustomField (raw):', CustomField);
      }
    }
    
    // Handle DTMF digits if present (from Gather/IVR applet)
    if (digits) {
      const cleanDigits = digits.replace(/"/g, '').trim(); // Remove quotes
      console.log(`📱 DTMF Received: ${cleanDigits}`);
      
      // Process based on call type
      const callType = callContext.callType || 'unknown';
      
      if (callType === 'vendor_order_confirmation') {
        if (cleanDigits === '1') {
          console.log('✅ Vendor ACCEPTED order');
          // Report to Jupiter
          await reportToJupiter(CallSid, {
            type: 'vendor_order_confirmation',
            status: 'accepted',
            orderId: callContext.data?.orderId,
            digits: cleanDigits
          });
          return res.status(200).send('OK'); // Success path
        } else if (cleanDigits === '2') {
          console.log('❌ Vendor REJECTED order');
          await reportToJupiter(CallSid, {
            type: 'vendor_order_confirmation', 
            status: 'rejected',
            orderId: callContext.data?.orderId,
            digits: cleanDigits
          });
          return res.status(302).send('Rejected'); // Failure path
        }
      } else if (callType === 'rider_assignment') {
        if (cleanDigits === '1') {
          console.log('✅ Rider ACCEPTED pickup');
          await reportToJupiter(CallSid, {
            type: 'rider_assignment',
            status: 'accepted', 
            orderId: callContext.data?.orderId,
            digits: cleanDigits
          });
          return res.status(200).send('OK');
        } else if (cleanDigits === '2') {
          console.log('❌ Rider DECLINED pickup');
          await reportToJupiter(CallSid, {
            type: 'rider_assignment',
            status: 'declined',
            orderId: callContext.data?.orderId,
            digits: cleanDigits
          });
          return res.status(302).send('Declined');
        }
      }
      
      // Generic DTMF handling
      console.log(`📱 DTMF ${cleanDigits} processed`);
      await reportToJupiter(CallSid, {
        type: callType,
        status: 'dtmf_received',
        digits: cleanDigits,
        context: callContext
      });
      return res.status(200).send('OK');
    }
    
    // No DTMF - this is initial passthru (call just answered)
    console.log('📞 Call answered, no DTMF yet');
    await reportToJupiter(CallSid, {
      type: callContext.callType || 'unknown',
      status: 'answered',
      from: CallFrom,
      context: callContext
    });
    
    return res.status(200).send('OK');
    
  } catch (error) {
    console.error('❌ Passthru callback error:', error);
    return res.status(200).send('OK'); // Still return 200 to not break call
  }
});

// Helper function to report to Jupiter
async function reportToJupiter(callSid, data) {
  try {
    const jupiterUrl = process.env.JUPITER_URL || 'http://192.168.0.156:3200';
    console.log(`📤 Reporting to Jupiter: ${JSON.stringify(data)}`);
    
    const axios = (await import('axios')).default;
    await axios.post(`${jupiterUrl}/api/voice/call-result`, {
      callSid,
      ...data,
      timestamp: new Date().toISOString()
    }, { timeout: 5000 });
    
    console.log('✅ Reported to Jupiter successfully');
  } catch (error) {
    console.error(`❌ Failed to report to Jupiter: ${error.message}`);
  }
}

router.post('/ai-callback', upload.none(), async (req, res) => {
  try {
    console.log('📥 AI Callback Body:', JSON.stringify(req.body, null, 2));
    const callSid = req.body.CallSid || req.body.call_sid;
    console.log('📥 AI Callback (answered):', callSid);

    const twiml = await handleAICallback(callSid, 'answered', req.body);
    res.type('application/xml').send(twiml);

  } catch (error) {
    console.error('❌ AI callback error:', error);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`);
  }
});

/**
 * POST /api/voice/ai-callback/:callSid/dtmf
 * DTMF input callback
 */
router.post('/ai-callback/:callSid/dtmf', upload.none(), async (req, res) => {
  try {
    const { callSid } = req.params;
    console.log('📱 DTMF Callback:', callSid, JSON.stringify(req.body, null, 2));

    const twiml = await handleAICallback(callSid, 'dtmf', req.body);
    res.type('application/xml').send(twiml);

  } catch (error) {
    console.error('❌ DTMF callback error:', error);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`);
  }
});

/**
 * POST /api/voice/ai-callback/:callSid/speech
 * Speech input callback
 */
router.post('/ai-callback/:callSid/speech', upload.none(), async (req, res) => {
  try {
    const { callSid } = req.params;
    console.log('🎤 Speech Callback:', callSid, JSON.stringify(req.body, null, 2));

    const twiml = await handleAICallback(callSid, 'speech', req.body);
    res.type('application/xml').send(twiml);

  } catch (error) {
    console.error('❌ Speech callback error:', error);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`);
  }
});

/**
 * POST /api/voice/ai-callback/:callSid/recording
 * Recording completed callback
 */
router.post('/ai-callback/:callSid/recording', upload.none(), async (req, res) => {
  try {
    const { callSid } = req.params;
    console.log('🎙️ Recording Callback:', callSid, JSON.stringify(req.body, null, 2));

    const twiml = await handleAICallback(callSid, 'recording', req.body);
    res.type('application/xml').send(twiml);

  } catch (error) {
    console.error('❌ Recording callback error:', error);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`);
  }
});

/**
 * POST /api/voice/ai-callback/status
 * Call status callback (ringing, in-progress, completed, etc.)
 * Exotel sends as multipart/form-data
 */
router.post('/ai-callback/status', upload.none(), async (req, res) => {
  try {
    // Log everything for debugging
    console.log('📋 FULL STATUS CALLBACK BODY:', JSON.stringify(req.body, null, 2));
    
    // Exotel uses various field names - try all possibilities
    const callSid = req.body.CallSid || req.body.call_sid || req.body.Sid || req.query.CallSid;
    const status = req.body.CallStatus || req.body.Status || req.body.status || req.body.EventType;
    
    console.log('📊 Status Callback:', callSid, status);

    await handleAICallback(callSid, status, req.body);
    
    res.json({ received: true });

  } catch (error) {
    console.error('❌ Status callback error:', error);
    res.json({ received: true, error: error.message });
  }
});

// ============================================================================
// MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/voice/active-calls
 * Get list of active AI calls
 */
router.get('/active-calls', (req, res) => {
  const calls = getActiveCalls();
  res.json({
    success: true,
    count: calls.length,
    calls,
  });
});

/**
 * GET /api/voice/call/:callSid
 * Get details of a specific call
 */
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
      duration: Math.floor((Date.now() - handler.startTime) / 1000),
      conversationHistory: handler.conversationHistory,
    },
  });
});

/**
 * GET /api/voice/call-types
 * Get available call types
 */
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

/**
 * POST /api/voice/test-call
 * Test call endpoint for development
 */
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
