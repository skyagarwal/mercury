/**
 * Jupiter Voice Integration Service
 * 
 * Handles communication between Mercury (Voice) and Jupiter (Brain)
 * 
 * Mercury sends:
 * - Call results (accepted/rejected, prep time, etc.)
 * - Real-time transcriptions
 * - Call status updates
 * 
 * Mercury receives:
 * - Call triggers (outbound calls to vendors, riders)
 * - Conversation scripts (from database)
 * - Business context (order details, vendor info)
 */

import axios from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';

const JUPITER_URL = process.env.JUPITER_URL || 'http://192.168.0.156:3200';
const JUPITER_WS_URL = process.env.JUPITER_WS_URL || 'ws://192.168.0.156:3200';

class JupiterVoiceClient extends EventEmitter {
  constructor() {
    super();
    this.httpClient = axios.create({
      baseURL: JUPITER_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service': 'mercury-voice',
      },
    });
    
    this.wsConnection = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.isConnected = false;
    
    // Stats
    this.stats = {
      callsReported: 0,
      eventsReceived: 0,
      errorsCount: 0,
      lastConnected: null,
    };
  }

  // ===========================================================================
  // HTTP API CALLS TO JUPITER
  // ===========================================================================

  /**
   * Report call result to Jupiter
   */
  async reportCallResult(data) {
    const {
      callSid,
      orderId,
      vendorId,
      riderId,
      callType,
      result,
      duration,
      conversationHistory,
    } = data;

    try {
      console.log(`📤 Reporting call result to Jupiter: ${callSid}`);
      
      const response = await this.httpClient.post('/api/voice/call-result', {
        callSid,
        orderId,
        vendorId,
        riderId,
        callType,
        result,
        duration,
        conversationHistory,
        timestamp: new Date().toISOString(),
        source: 'mercury-voice',
      });

      this.stats.callsReported++;
      console.log(`✅ Call result reported: ${response.data.message || 'success'}`);
      
      return { success: true, data: response.data };
    } catch (error) {
      this.stats.errorsCount++;
      console.error(`❌ Failed to report call result: ${error.message}`);
      
      // Queue for retry if Jupiter is down
      this.queueFailedReport(data);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Report vendor order confirmation
   */
  async reportVendorOrderConfirmation(data) {
    const {
      orderId,
      vendorId,
      accepted,
      prepTimeMinutes,
      rejectionReason,
      callSid,
      duration,
    } = data;

    try {
      console.log(`📤 Reporting vendor order confirmation: Order ${orderId}`);

      const endpoint = accepted 
        ? '/api/orders/vendor-confirmed'
        : '/api/orders/vendor-rejected';

      const response = await this.httpClient.post(endpoint, {
        orderId,
        vendorId,
        accepted,
        prepTimeMinutes,
        rejectionReason,
        callSid,
        duration,
        confirmedAt: new Date().toISOString(),
        source: 'ai-voice-call',
      });

      this.stats.callsReported++;
      console.log(`✅ Vendor confirmation reported`);
      
      return { success: true, data: response.data };
    } catch (error) {
      this.stats.errorsCount++;
      console.error(`❌ Failed to report vendor confirmation: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Report rider assignment acceptance
   */
  async reportRiderAcceptance(data) {
    const {
      orderId,
      riderId,
      accepted,
      callSid,
      duration,
    } = data;

    try {
      console.log(`📤 Reporting rider acceptance: Order ${orderId}, Rider ${riderId}`);

      const response = await this.httpClient.post('/api/orders/rider-accepted', {
        orderId,
        riderId,
        accepted,
        callSid,
        duration,
        acceptedAt: new Date().toISOString(),
        source: 'ai-voice-call',
      });

      this.stats.callsReported++;
      console.log(`✅ Rider acceptance reported`);
      
      return { success: true, data: response.data };
    } catch (error) {
      this.stats.errorsCount++;
      console.error(`❌ Failed to report rider acceptance: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get conversation script from Jupiter (database-driven)
   */
  async getConversationScript(callType, language = 'hi') {
    try {
      const response = await this.httpClient.get('/api/voice/scripts', {
        params: { callType, language },
      });

      return { success: true, script: response.data };
    } catch (error) {
      console.error(`❌ Failed to get conversation script: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get vendor/store details for call
   */
  async getVendorDetails(vendorId) {
    try {
      const response = await this.httpClient.get(`/api/stores/${vendorId}`);
      return { success: true, vendor: response.data };
    } catch (error) {
      console.error(`❌ Failed to get vendor details: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get rider details for call
   */
  async getRiderDetails(riderId) {
    try {
      const response = await this.httpClient.get(`/api/riders/${riderId}`);
      return { success: true, rider: response.data };
    } catch (error) {
      console.error(`❌ Failed to get rider details: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get order details for call
   */
  async getOrderDetails(orderId) {
    try {
      const response = await this.httpClient.get(`/api/orders/${orderId}`);
      return { success: true, order: response.data };
    } catch (error) {
      console.error(`❌ Failed to get order details: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get call configuration from database
   */
  async getCallConfig(configKey) {
    try {
      const response = await this.httpClient.get('/api/system/settings', {
        params: { key: configKey },
      });
      return { success: true, config: response.data };
    } catch (error) {
      console.error(`❌ Failed to get call config: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ===========================================================================
  // WEBSOCKET FOR REAL-TIME UPDATES
  // ===========================================================================

  /**
   * Connect to Jupiter WebSocket for real-time call triggers
   */
  connectWebSocket() {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    try {
      console.log(`🔌 Connecting to Jupiter WebSocket: ${JUPITER_WS_URL}/voice`);
      
      this.wsConnection = new WebSocket(`${JUPITER_WS_URL}/voice`, {
        headers: {
          'X-Service': 'mercury-voice',
        },
      });

      this.wsConnection.on('open', () => {
        console.log('✅ Jupiter WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.stats.lastConnected = new Date().toISOString();
        
        // Register as voice service
        this.wsConnection.send(JSON.stringify({
          type: 'register',
          service: 'mercury-voice',
          capabilities: ['outbound-calls', 'asr', 'tts', 'dtmf'],
        }));
      });

      this.wsConnection.on('message', (data) => {
        this.handleWebSocketMessage(data);
      });

      this.wsConnection.on('close', () => {
        console.log('⚠️ Jupiter WebSocket disconnected');
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.wsConnection.on('error', (error) => {
        console.error('❌ Jupiter WebSocket error:', error.message);
        this.stats.errorsCount++;
      });

    } catch (error) {
      console.error('❌ Failed to connect WebSocket:', error.message);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  handleWebSocketMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      this.stats.eventsReceived++;
      
      console.log(`📥 Jupiter WebSocket message: ${message.type}`);

      switch (message.type) {
        case 'trigger_call':
          // Jupiter wants us to make a call
          this.emit('triggerCall', message.data);
          break;

        case 'cancel_call':
          // Jupiter wants us to cancel a call
          this.emit('cancelCall', message.data);
          break;

        case 'update_script':
          // Jupiter updated conversation script
          this.emit('scriptUpdated', message.data);
          break;

        case 'health_check':
          // Respond to health check
          this.wsConnection.send(JSON.stringify({
            type: 'health_response',
            status: 'healthy',
            activeCalls: this.getActiveCallsCount(),
          }));
          break;

        default:
          console.log(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('❌ Failed to parse WebSocket message:', error.message);
    }
  }

  /**
   * Send message to Jupiter via WebSocket
   */
  sendWebSocketMessage(type, data) {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify({ type, data }));
    } else {
      console.warn('WebSocket not connected, queuing message');
      // Could queue messages here for later sending
    }
  }

  /**
   * Schedule WebSocket reconnection
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    
    console.log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Queue failed report for retry
   */
  queueFailedReport(data) {
    // In production, this would use Redis or similar
    console.log('📦 Queuing failed report for retry');
    // this.failedReportsQueue.push({ data, timestamp: Date.now() });
  }

  /**
   * Get active calls count (placeholder)
   */
  getActiveCallsCount() {
    // This would be injected from ai-voice-call.service.js
    return 0;
  }

  /**
   * Get connection stats
   */
  getStats() {
    return {
      ...this.stats,
      isConnected: this.isConnected,
      jupiterUrl: JUPITER_URL,
    };
  }

  /**
   * Check Jupiter health
   */
  async checkHealth() {
    try {
      const response = await this.httpClient.get('/health', { timeout: 5000 });
      return {
        connected: true,
        status: response.data.status,
        latency: response.config?.metadata?.duration || 'N/A',
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
      };
    }
  }
}

// Singleton instance
const jupiterVoiceClient = new JupiterVoiceClient();

// Export both the instance and class
export { JupiterVoiceClient };
export default jupiterVoiceClient;

// Named exports for convenience
export const reportCallResult = (data) => jupiterVoiceClient.reportCallResult(data);
export const reportVendorOrderConfirmation = (data) => jupiterVoiceClient.reportVendorOrderConfirmation(data);
export const reportRiderAcceptance = (data) => jupiterVoiceClient.reportRiderAcceptance(data);
export const getConversationScript = (callType, lang) => jupiterVoiceClient.getConversationScript(callType, lang);
export const getVendorDetails = (vendorId) => jupiterVoiceClient.getVendorDetails(vendorId);
export const getRiderDetails = (riderId) => jupiterVoiceClient.getRiderDetails(riderId);
export const getOrderDetails = (orderId) => jupiterVoiceClient.getOrderDetails(orderId);
export const getCallConfig = (key) => jupiterVoiceClient.getCallConfig(key);
export const connectWebSocket = () => jupiterVoiceClient.connectWebSocket();
export const getJupiterStats = () => jupiterVoiceClient.getStats();
export const checkJupiterHealth = () => jupiterVoiceClient.checkHealth();
