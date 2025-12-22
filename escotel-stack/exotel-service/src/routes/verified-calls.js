/**
 * Verified Calls Routes (Truecaller Integration)
 * 
 * Endpoints for making branded/verified calls that show
 * "Mangwale" on customer's Truecaller-enabled phone.
 * 
 * 40-60% higher pickup rate compared to unknown numbers!
 */

import express from 'express';
import {
  CALL_REASONS,
  makeVerifiedCall,
  callOrderConfirmation,
  callDeliveryArriving,
  callFeedbackRequest,
  callPromotion,
  callSupportCallback,
  handleCallStatusCallback,
  getCallStatus,
  getRecentVerifiedCalls,
  getVerifiedCallsStats,
  validatePhoneNumber,
  formatPhoneNumber
} from '../services/verified-calls.service.js';
import { getOrder } from '../services/jupiter.service.js';

const router = express.Router();

// ============================================================================
// VERIFIED CALL ENDPOINTS
// ============================================================================

/**
 * GET /verified-calls/reasons
 * Get all available call reasons for verified calls
 */
router.get('/reasons', (req, res) => {
  res.json({
    success: true,
    reasons: CALL_REASONS,
    description: 'These reasons are shown on customer\'s Truecaller-enabled phone'
  });
});

/**
 * POST /verified-calls/make
 * Make a verified call with custom parameters
 */
router.post('/make', async (req, res) => {
  try {
    const {
      to,
      from,
      reason,
      orderId,
      customerId,
      metadata
    } = req.body;
    
    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Phone number (to) is required'
      });
    }
    
    if (!validatePhoneNumber(to)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format'
      });
    }
    
    const result = await makeVerifiedCall({
      to: formatPhoneNumber(to),
      from,
      reason: reason || CALL_REASONS.ORDER_UPDATE,
      orderId,
      customerId,
      metadata
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Verified call error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to make verified call',
      message: error.message
    });
  }
});

/**
 * POST /verified-calls/order-confirmation
 * Call customer to confirm their order (verified)
 */
router.post('/order-confirmation', async (req, res) => {
  try {
    const { orderId, customerPhone, orderDetails } = req.body;
    
    if (!orderId || !customerPhone) {
      return res.status(400).json({
        success: false,
        error: 'orderId and customerPhone are required'
      });
    }
    
    // Try to get order details from Jupiter if not provided
    let details = orderDetails;
    if (!details && orderId) {
      try {
        const orderData = await getOrder(orderId);
        details = orderData;
      } catch (e) {
        details = {};
      }
    }
    
    const result = await callOrderConfirmation(
      orderId,
      formatPhoneNumber(customerPhone),
      details
    );
    
    res.json(result);
    
  } catch (error) {
    console.error('Order confirmation call error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to make order confirmation call',
      message: error.message
    });
  }
});

/**
 * POST /verified-calls/delivery-arriving
 * Call customer that their delivery is arriving (verified)
 */
router.post('/delivery-arriving', async (req, res) => {
  try {
    const { orderId, customerPhone, eta } = req.body;
    
    if (!orderId || !customerPhone) {
      return res.status(400).json({
        success: false,
        error: 'orderId and customerPhone are required'
      });
    }
    
    const result = await callDeliveryArriving(
      orderId,
      formatPhoneNumber(customerPhone),
      eta || '5 minutes'
    );
    
    res.json(result);
    
  } catch (error) {
    console.error('Delivery arriving call error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to make delivery arriving call',
      message: error.message
    });
  }
});

/**
 * POST /verified-calls/feedback-request
 * Call customer to request feedback (verified)
 */
router.post('/feedback-request', async (req, res) => {
  try {
    const { orderId, customerPhone } = req.body;
    
    if (!orderId || !customerPhone) {
      return res.status(400).json({
        success: false,
        error: 'orderId and customerPhone are required'
      });
    }
    
    const result = await callFeedbackRequest(
      orderId,
      formatPhoneNumber(customerPhone)
    );
    
    res.json(result);
    
  } catch (error) {
    console.error('Feedback request call error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to make feedback request call',
      message: error.message
    });
  }
});

/**
 * POST /verified-calls/promotion
 * Call customer with promotional offer (verified)
 */
router.post('/promotion', async (req, res) => {
  try {
    const { customerPhone, campaign, offer } = req.body;
    
    if (!customerPhone) {
      return res.status(400).json({
        success: false,
        error: 'customerPhone is required'
      });
    }
    
    const result = await callPromotion(
      formatPhoneNumber(customerPhone),
      { campaign, offer }
    );
    
    res.json(result);
    
  } catch (error) {
    console.error('Promotion call error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to make promotion call',
      message: error.message
    });
  }
});

/**
 * POST /verified-calls/support-callback
 * Call customer back for support (verified)
 */
router.post('/support-callback', async (req, res) => {
  try {
    const { customerId, customerPhone, ticketId } = req.body;
    
    if (!customerPhone) {
      return res.status(400).json({
        success: false,
        error: 'customerPhone is required'
      });
    }
    
    const result = await callSupportCallback(
      customerId,
      formatPhoneNumber(customerPhone),
      ticketId
    );
    
    res.json(result);
    
  } catch (error) {
    console.error('Support callback error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to make support callback',
      message: error.message
    });
  }
});

// ============================================================================
// BULK VERIFIED CALLS
// ============================================================================

/**
 * POST /verified-calls/bulk
 * Make bulk verified calls (e.g., delivery arriving for multiple orders)
 */
router.post('/bulk', async (req, res) => {
  try {
    const { calls } = req.body;
    
    if (!Array.isArray(calls) || calls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'calls array is required'
      });
    }
    
    // Limit bulk calls
    if (calls.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 calls per bulk request'
      });
    }
    
    const results = [];
    const errors = [];
    
    // Process sequentially to avoid rate limiting
    for (const call of calls) {
      try {
        if (!validatePhoneNumber(call.to)) {
          errors.push({
            to: call.to,
            error: 'Invalid phone number'
          });
          continue;
        }
        
        const result = await makeVerifiedCall({
          to: formatPhoneNumber(call.to),
          reason: call.reason || CALL_REASONS.ORDER_UPDATE,
          orderId: call.orderId,
          customerId: call.customerId,
          metadata: call.metadata
        });
        
        results.push(result);
        
        // Small delay between calls
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        errors.push({
          to: call.to,
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      total: calls.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    console.error('Bulk verified calls error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process bulk calls',
      message: error.message
    });
  }
});

// ============================================================================
// STATUS & STATS ENDPOINTS
// ============================================================================

/**
 * GET /verified-calls/status/:callSid
 * Get status of a verified call
 */
router.get('/status/:callSid', (req, res) => {
  const { callSid } = req.params;
  
  const status = getCallStatus(callSid);
  
  if (!status) {
    return res.status(404).json({
      success: false,
      error: 'Call not found'
    });
  }
  
  res.json({
    success: true,
    call: status
  });
});

/**
 * GET /verified-calls/recent
 * Get recent verified calls
 */
router.get('/recent', (req, res) => {
  const calls = getRecentVerifiedCalls();
  
  res.json({
    success: true,
    count: calls.length,
    calls
  });
});

/**
 * GET /verified-calls/stats
 * Get verified calls statistics
 */
router.get('/stats', (req, res) => {
  const stats = getVerifiedCallsStats();
  
  res.json({
    success: true,
    stats,
    description: {
      pickupRate: 'Percentage of calls answered (typically 40-60% higher with verified calls)',
      averageDuration: 'Average call duration in seconds'
    }
  });
});

// ============================================================================
// WEBHOOKS
// ============================================================================

/**
 * POST /verified-calls/webhook/status
 * Handle call status updates from Exotel
 */
router.post('/webhook/status', (req, res) => {
  console.log('📞 Verified call webhook received:', req.body);
  
  const result = handleCallStatusCallback(req.body);
  
  res.json(result);
});

// ============================================================================
// UTILITY ENDPOINTS
// ============================================================================

/**
 * POST /verified-calls/validate
 * Validate phone number
 */
router.post('/validate', (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({
      success: false,
      error: 'phone is required'
    });
  }
  
  const isValid = validatePhoneNumber(phone);
  const formatted = formatPhoneNumber(phone);
  
  res.json({
    success: true,
    phone,
    valid: isValid,
    formatted: isValid ? formatted : null
  });
});

export default router;
