/**
 * Number Masking Service (ExoBridge) for Mangwale
 * 
 * This service provides privacy protection between:
 * - Customer ↔ Rider communication
 * - Customer ↔ Vendor communication  
 * - Rider ↔ Vendor coordination
 * 
 * Neither party sees the other's actual phone number.
 * Uses Exotel's LeadAssist API for virtual number bridging.
 * 
 * Reference: https://exotel.com/use-cases/number-masking/
 */

import axios from 'axios';
import { getConfig } from '../utils/config.js';
import NodeCache from 'node-cache';
import { emitEvent } from '../utils/events.js';
import { notifyJupiter } from './jupiter.service.js';

// Cache for active masking sessions (TTL: 4 hours)
const maskingCache = new NodeCache({ stdTTL: 14400, checkperiod: 600 });

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

// ============================================================================
// NUMBER MASKING SESSION MANAGEMENT
// ============================================================================

/**
 * Create a masked calling session for an order
 * 
 * @param {Object} params - Session parameters
 * @param {string} params.orderId - Order ID
 * @param {string} params.partyA - First party phone (customer)
 * @param {string} params.partyB - Second party phone (rider/vendor)
 * @param {string} params.partyAType - 'customer', 'vendor', 'rider'
 * @param {string} params.partyBType - 'customer', 'vendor', 'rider'
 * @param {number} params.ttlMinutes - Session TTL (default: 120 mins)
 * @returns {Object} - Session details with masked number
 */
export async function createMaskedSession(params) {
  const {
    orderId,
    partyA,
    partyB,
    partyAType = 'customer',
    partyBType = 'rider',
    ttlMinutes = 120,
    metadata = {}
  } = params;
  
  // Check if session already exists for this order
  const existingSession = getMaskedSession(orderId);
  if (existingSession) {
    console.log(`📞 Existing masking session found for order ${orderId}`);
    return existingSession;
  }
  
  const config = getExotelConfig();
  
  try {
    // Create LeadAssist session via Exotel API
    // This returns a virtual number that bridges both parties
    const response = await axios.post(
      `${config.baseUrl}/LeadAssist/Numbers`,
      {
        call_to: partyA,
        virtual_number: null, // Exotel assigns from pool
        fallback_number: getCallbackUrl(),
        // Custom parameters for our webhook
        custom_field: JSON.stringify({
          orderId,
          partyAType,
          partyBType,
          partyAPhone: partyA,
          partyBPhone: partyB,
          createdAt: new Date().toISOString()
        }),
        // Session settings
        status_callback: `${getCallbackUrl()}/masking/callback`,
        record: true, // Record for quality analysis
        time_limit: ttlMinutes * 60, // Convert to seconds
        time_out: 60 // Ring timeout
      },
      {
        auth: config.auth,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    const session = {
      sessionId: response.data.sid || `mask_${orderId}_${Date.now()}`,
      orderId,
      maskedNumber: response.data.virtual_number || response.data.phone_number,
      partyA: {
        phone: partyA,
        type: partyAType,
        maskedView: response.data.virtual_number
      },
      partyB: {
        phone: partyB,
        type: partyBType,
        maskedView: response.data.virtual_number
      },
      status: 'active',
      expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
      createdAt: new Date().toISOString(),
      metadata
    };
    
    // Cache the session
    maskingCache.set(`order_${orderId}`, session);
    maskingCache.set(`session_${session.sessionId}`, session);
    
    // Emit event
    emitEvent({
      type: 'masking.session.created',
      at: new Date().toISOString(),
      session
    });
    
    console.log(`✅ Masking session created: ${session.sessionId} for order ${orderId}`);
    console.log(`   Masked number: ${session.maskedNumber}`);
    
    return session;
    
  } catch (error) {
    console.error('❌ Failed to create masking session:', error.response?.data || error.message);
    
    // Fallback: Create a simulated session for development
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Using simulated masking session (dev mode)');
      return createSimulatedSession(params);
    }
    
    throw new Error(`Masking session creation failed: ${error.message}`);
  }
}

/**
 * Create simulated session for development/testing
 */
function createSimulatedSession(params) {
  const { orderId, partyA, partyB, partyAType, partyBType, ttlMinutes = 120 } = params;
  
  const session = {
    sessionId: `sim_mask_${orderId}_${Date.now()}`,
    orderId,
    maskedNumber: '+91-1800-XXX-XXXX', // Simulated
    partyA: { phone: partyA, type: partyAType },
    partyB: { phone: partyB, type: partyBType },
    status: 'active',
    simulated: true,
    expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
    createdAt: new Date().toISOString()
  };
  
  maskingCache.set(`order_${orderId}`, session);
  return session;
}

/**
 * Get active masking session for an order
 */
export function getMaskedSession(orderId) {
  return maskingCache.get(`order_${orderId}`);
}

/**
 * Get session by session ID
 */
export function getSessionById(sessionId) {
  return maskingCache.get(`session_${sessionId}`);
}

/**
 * End masking session (typically when order is delivered)
 */
export async function endMaskedSession(orderId, reason = 'order_completed') {
  const session = getMaskedSession(orderId);
  
  if (!session) {
    console.log(`⚠️ No masking session found for order ${orderId}`);
    return null;
  }
  
  const config = getExotelConfig();
  
  try {
    // End session via Exotel API
    if (!session.simulated) {
      await axios.delete(
        `${config.baseUrl}/LeadAssist/Numbers/${session.sessionId}`,
        { auth: config.auth }
      );
    }
    
    // Update session status
    session.status = 'ended';
    session.endedAt = new Date().toISOString();
    session.endReason = reason;
    
    // Remove from cache
    maskingCache.del(`order_${orderId}`);
    maskingCache.del(`session_${session.sessionId}`);
    
    // Emit event
    emitEvent({
      type: 'masking.session.ended',
      at: new Date().toISOString(),
      session
    });
    
    console.log(`✅ Masking session ended for order ${orderId}: ${reason}`);
    
    return session;
    
  } catch (error) {
    console.error('❌ Failed to end masking session:', error.message);
    // Still clean up local cache
    maskingCache.del(`order_${orderId}`);
    return session;
  }
}

// ============================================================================
// MASKED CALL HANDLING
// ============================================================================

/**
 * Handle incoming call on masked number
 * Determines which party is calling and connects to the other
 */
export async function handleMaskedCall(callSid, fromNumber, toNumber, customField) {
  try {
    const sessionData = JSON.parse(customField || '{}');
    const { orderId, partyAPhone, partyBPhone, partyAType, partyBType } = sessionData;
    
    // Determine who's calling and who to connect
    let connectTo, callerType;
    
    if (normalizePhone(fromNumber) === normalizePhone(partyAPhone)) {
      // Party A (customer) is calling → connect to Party B (rider/vendor)
      connectTo = partyBPhone;
      callerType = partyAType;
      console.log(`📞 ${partyAType} calling ${partyBType} via masked number`);
    } else if (normalizePhone(fromNumber) === normalizePhone(partyBPhone)) {
      // Party B (rider) is calling → connect to Party A (customer)
      connectTo = partyAPhone;
      callerType = partyBType;
      console.log(`📞 ${partyBType} calling ${partyAType} via masked number`);
    } else {
      console.error('⚠️ Unknown caller on masked number:', fromNumber);
      return { action: 'hangup', reason: 'unknown_caller' };
    }
    
    // Log the call
    emitEvent({
      type: 'masking.call.initiated',
      at: new Date().toISOString(),
      callSid,
      orderId,
      callerType,
      from: fromNumber,
      to: connectTo
    });
    
    // Return dial instruction for Exotel
    return {
      action: 'dial',
      number: connectTo,
      record: true,
      callerId: toNumber, // Show masked number to recipient
      timeout: 45
    };
    
  } catch (error) {
    console.error('❌ Error handling masked call:', error);
    return { action: 'hangup', reason: 'error' };
  }
}

/**
 * Handle call status callbacks from Exotel
 */
export async function handleCallStatusCallback(data) {
  const {
    CallSid,
    Status, // 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed'
    Duration,
    RecordingUrl,
    custom_field
  } = data;
  
  const sessionData = JSON.parse(custom_field || '{}');
  
  const event = {
    type: 'masking.call.status',
    at: new Date().toISOString(),
    callSid: CallSid,
    status: Status,
    duration: Duration,
    recordingUrl: RecordingUrl,
    orderId: sessionData.orderId
  };
  
  emitEvent(event);
  
  // If call completed, update analytics
  if (Status === 'completed' && sessionData.orderId) {
    try {
      await notifyJupiter('call.completed', {
        orderId: sessionData.orderId,
        callSid: CallSid,
        duration: Duration,
        recordingUrl: RecordingUrl,
        callType: 'masked'
      });
    } catch (err) {
      console.error('Failed to notify Jupiter of completed call:', err.message);
    }
  }
  
  return { received: true };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Normalize phone number for comparison
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)]/g, '').replace(/^\+91/, '').replace(/^91/, '');
}

/**
 * Get callback URL for webhooks
 */
function getCallbackUrl() {
  return process.env.EXOTEL_CALLBACK_URL || 'http://192.168.0.151:3100';
}

/**
 * Get statistics on active masking sessions
 */
export function getMaskingStats() {
  const keys = maskingCache.keys();
  const sessions = keys.filter(k => k.startsWith('order_')).length;
  
  return {
    activeSessions: sessions,
    cacheKeys: keys.length
  };
}

/**
 * List all active masking sessions
 */
export function listActiveSessions() {
  const keys = maskingCache.keys().filter(k => k.startsWith('order_'));
  return keys.map(k => maskingCache.get(k)).filter(Boolean);
}

// ============================================================================
// CONVENIENCE FUNCTIONS FOR COMMON FLOWS
// ============================================================================

/**
 * Create Customer ↔ Rider masking for delivery
 */
export async function maskCustomerRider(orderId, customerPhone, riderPhone) {
  return createMaskedSession({
    orderId,
    partyA: customerPhone,
    partyB: riderPhone,
    partyAType: 'customer',
    partyBType: 'rider',
    ttlMinutes: 120, // 2 hours for delivery
    metadata: { purpose: 'delivery' }
  });
}

/**
 * Create Customer ↔ Vendor masking for order queries
 */
export async function maskCustomerVendor(orderId, customerPhone, vendorPhone) {
  return createMaskedSession({
    orderId,
    partyA: customerPhone,
    partyB: vendorPhone,
    partyAType: 'customer',
    partyBType: 'vendor',
    ttlMinutes: 60, // 1 hour for queries
    metadata: { purpose: 'order_query' }
  });
}

/**
 * Create Rider ↔ Vendor masking for pickup coordination
 */
export async function maskRiderVendor(orderId, riderPhone, vendorPhone) {
  return createMaskedSession({
    orderId,
    partyA: riderPhone,
    partyB: vendorPhone,
    partyAType: 'rider',
    partyBType: 'vendor',
    ttlMinutes: 60, // 1 hour for pickup
    metadata: { purpose: 'pickup_coordination' }
  });
}

export default {
  createMaskedSession,
  getMaskedSession,
  getSessionById,
  endMaskedSession,
  handleMaskedCall,
  handleCallStatusCallback,
  getMaskingStats,
  listActiveSessions,
  maskCustomerRider,
  maskCustomerVendor,
  maskRiderVendor
};
