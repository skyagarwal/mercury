/**
 * Verified Calls Service (Truecaller Integration) for Mangwale
 * 
 * Integrates with Exotel's Truecaller Verified Calls feature:
 * - Shows branded "Mangwale" caller ID on customer's phone
 * - 40-60% higher pickup rate
 * - Builds trust with customers
 * 
 * Reference: https://exotel.com/products/auto-dialer/
 */

import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { emitEvent } from '../utils/events.js';
import NodeCache from 'node-cache';

// Cache for call status (TTL: 1 hour)
const callCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// ============================================================================
// CONFIGURATION
// ============================================================================

// Verified Call Reasons (shown on customer's phone)
export const CALL_REASONS = {
  ORDER_CONFIRMATION: 'Order Confirmation from Mangwale',
  ORDER_UPDATE: 'Order Update from Mangwale',
  DELIVERY_ARRIVING: 'Your Delivery is Arriving - Mangwale',
  DELIVERY_ATTEMPT: 'Delivery Attempt - Mangwale',
  PAYMENT_REMINDER: 'Payment Reminder - Mangwale',
  FEEDBACK_REQUEST: 'Share Your Experience - Mangwale',
  PROMOTIONAL: 'Special Offer from Mangwale',
  VENDOR_CALL: 'Vendor Call - Mangwale',
  RIDER_CALL: 'Delivery Update - Mangwale',
  SUPPORT_CALLBACK: 'Support Callback - Mangwale'
};

// Business identity for Truecaller
const BUSINESS_IDENTITY = {
  name: 'Mangwale',
  logoUrl: 'https://mangwale.com/logo.png',
  category: 'Food & Delivery',
  website: 'https://mangwale.com'
};

function getExotelConfig() {
  const cfg = getConfig();
  const { sid, apiKey, apiToken, region, subdomain } = cfg.exotel;
  
  const baseUrl = region 
    ? `https://${subdomain}.${region}.exotel.com/v1/Accounts/${sid}`
    : `https://${subdomain}.exotel.com/v1/Accounts/${sid}`;
    
  return {
    baseUrl,
    auth: { username: apiKey, password: apiToken },
    sid,
    truecallerEnabled: cfg.exotel.truecallerEnabled || false
  };
}

// ============================================================================
// VERIFIED CALL FUNCTIONS
// ============================================================================

/**
 * Make a verified call with branded caller ID
 * 
 * @param {Object} params - Call parameters
 * @param {string} params.to - Destination phone number
 * @param {string} params.from - Caller ID (must be Exotel virtual number)
 * @param {string} params.reason - Call reason (from CALL_REASONS)
 * @param {string} params.callbackUrl - URL for call status updates
 * @param {Object} params.metadata - Additional call metadata
 * @returns {Object} - Call details
 */
export async function makeVerifiedCall(params) {
  const {
    to,
    from,
    reason = CALL_REASONS.ORDER_UPDATE,
    callbackUrl,
    orderId,
    customerId,
    metadata = {}
  } = params;
  
  const config = getExotelConfig();
  
  try {
    const callData = {
      From: from || config.defaultCallerId,
      To: to,
      CallerId: from || config.defaultCallerId,
      // Truecaller specific parameters
      BusinessName: BUSINESS_IDENTITY.name,
      CallReason: reason,
      LogoUrl: BUSINESS_IDENTITY.logoUrl,
      // Callback for status
      StatusCallback: callbackUrl || getDefaultCallbackUrl(),
      StatusCallbackEvents: ['ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed'],
      // Custom metadata
      CustomField: JSON.stringify({
        orderId,
        customerId,
        reason,
        verifiedCall: true,
        initiatedAt: new Date().toISOString(),
        ...metadata
      }),
      // Call settings
      Record: true,
      TimeLimit: 1800 // 30 minutes max
    };
    
    console.log(`📞 Making verified call to ${to} | Reason: ${reason}`);
    
    const response = await axios.post(
      `${config.baseUrl}/Calls/connect`,
      new URLSearchParams(callData).toString(),
      {
        auth: config.auth,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    const callSid = response.data.Call?.Sid || `pending_${Date.now()}`;
    
    // Cache call info
    callCache.set(callSid, {
      callSid,
      to,
      from,
      reason,
      orderId,
      customerId,
      status: 'initiated',
      verified: true,
      createdAt: new Date().toISOString()
    });
    
    // Emit event
    emitEvent({
      type: 'verified_call.initiated',
      at: new Date().toISOString(),
      callSid,
      to,
      reason,
      orderId
    });
    
    console.log(`✅ Verified call initiated: ${callSid}`);
    
    return {
      success: true,
      callSid,
      status: response.data.Call?.Status || 'queued',
      to,
      reason,
      verified: true
    };
    
  } catch (error) {
    console.error(`❌ Verified call failed: ${error.response?.data || error.message}`);
    
    // Fallback to simulated call in development
    if (process.env.NODE_ENV !== 'production') {
      return simulateVerifiedCall(params);
    }
    
    throw new Error(`Verified call failed: ${error.message}`);
  }
}

/**
 * Simulate verified call for development
 */
function simulateVerifiedCall(params) {
  const callSid = `sim_verified_${Date.now()}`;
  
  console.log(`⚠️ Simulated verified call: ${callSid}`);
  
  return {
    success: true,
    callSid,
    status: 'queued',
    to: params.to,
    reason: params.reason,
    verified: true,
    simulated: true
  };
}

/**
 * Make order confirmation call with verification
 */
export async function callOrderConfirmation(orderId, customerPhone, orderDetails = {}) {
  return makeVerifiedCall({
    to: customerPhone,
    reason: CALL_REASONS.ORDER_CONFIRMATION,
    orderId,
    metadata: {
      type: 'order_confirmation',
      amount: orderDetails.amount,
      items: orderDetails.items
    }
  });
}

/**
 * Make delivery arriving call with verification
 */
export async function callDeliveryArriving(orderId, customerPhone, eta = '5 minutes') {
  return makeVerifiedCall({
    to: customerPhone,
    reason: CALL_REASONS.DELIVERY_ARRIVING,
    orderId,
    metadata: {
      type: 'delivery_arriving',
      eta
    }
  });
}

/**
 * Make feedback request call with verification
 */
export async function callFeedbackRequest(orderId, customerPhone) {
  return makeVerifiedCall({
    to: customerPhone,
    reason: CALL_REASONS.FEEDBACK_REQUEST,
    orderId,
    metadata: {
      type: 'feedback_request'
    }
  });
}

/**
 * Make promotional call with verification
 */
export async function callPromotion(customerPhone, promotionDetails = {}) {
  return makeVerifiedCall({
    to: customerPhone,
    reason: CALL_REASONS.PROMOTIONAL,
    metadata: {
      type: 'promotional',
      campaign: promotionDetails.campaign,
      offer: promotionDetails.offer
    }
  });
}

/**
 * Make support callback with verification
 */
export async function callSupportCallback(customerId, customerPhone, ticketId) {
  return makeVerifiedCall({
    to: customerPhone,
    reason: CALL_REASONS.SUPPORT_CALLBACK,
    customerId,
    metadata: {
      type: 'support_callback',
      ticketId
    }
  });
}

// ============================================================================
// CALL STATUS MANAGEMENT
// ============================================================================

/**
 * Handle call status callback from Exotel
 */
export function handleCallStatusCallback(data) {
  const {
    CallSid,
    Status,
    Duration,
    RecordingUrl,
    DialCallDuration,
    custom_field
  } = data;
  
  let metadata = {};
  try {
    metadata = JSON.parse(custom_field || '{}');
  } catch (e) {}
  
  // Update cache
  const cachedCall = callCache.get(CallSid) || {};
  cachedCall.status = Status;
  cachedCall.duration = Duration;
  cachedCall.recordingUrl = RecordingUrl;
  cachedCall.updatedAt = new Date().toISOString();
  callCache.set(CallSid, cachedCall);
  
  // Emit event
  emitEvent({
    type: 'verified_call.status',
    at: new Date().toISOString(),
    callSid: CallSid,
    status: Status,
    duration: Duration,
    orderId: metadata.orderId,
    verified: metadata.verifiedCall
  });
  
  console.log(`📊 Verified call ${CallSid} status: ${Status}`);
  
  return { received: true, status: Status };
}

/**
 * Get call status
 */
export function getCallStatus(callSid) {
  return callCache.get(callSid);
}

/**
 * Get all recent verified calls
 */
export function getRecentVerifiedCalls() {
  const keys = callCache.keys();
  return keys.map(key => callCache.get(key)).filter(call => call?.verified);
}

/**
 * Get verified calls statistics
 */
export function getVerifiedCallsStats() {
  const calls = getRecentVerifiedCalls();
  
  const stats = {
    total: calls.length,
    byStatus: {},
    byReason: {},
    averageDuration: 0,
    pickupRate: 0
  };
  
  let totalDuration = 0;
  let answered = 0;
  
  calls.forEach(call => {
    // By status
    stats.byStatus[call.status] = (stats.byStatus[call.status] || 0) + 1;
    
    // By reason
    const reason = call.reason || 'unknown';
    stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
    
    // Duration
    if (call.duration) {
      totalDuration += parseInt(call.duration) || 0;
    }
    
    // Answered
    if (call.status === 'completed' || call.status === 'in-progress') {
      answered++;
    }
  });
  
  stats.averageDuration = calls.length > 0 ? Math.round(totalDuration / calls.length) : 0;
  stats.pickupRate = calls.length > 0 ? Math.round((answered / calls.length) * 100) : 0;
  
  return stats;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getDefaultCallbackUrl() {
  const baseUrl = process.env.EXOTEL_CALLBACK_URL || 'http://192.168.0.151:3100';
  return `${baseUrl}/verified-calls/webhook/status`;
}

/**
 * Validate phone number format
 */
export function validatePhoneNumber(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return /^(\+91|91)?[6-9]\d{9}$/.test(cleaned);
}

/**
 * Format phone number for Exotel
 */
export function formatPhoneNumber(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+91')) return cleaned;
  if (cleaned.startsWith('91') && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 10) return `+91${cleaned}`;
  return cleaned;
}

export default {
  CALL_REASONS,
  BUSINESS_IDENTITY,
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
};
