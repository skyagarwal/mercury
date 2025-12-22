/**
 * Voice Streaming Service (AgentStream) for Mangwale
 * 
 * Connects Exotel's real-time voice stream to Mangwale's AI stack:
 * - Mercury: ASR (7001), TTS (7002), Voice Orchestrator (7000)
 * - Jupiter: LLM (8002), NLU (7010), Backend (3200)
 * 
 * Architecture:
 * - Mercury = Voice & Hearing (ASR, TTS, VAD)
 * - Jupiter = Brain (Qwen2.5-7B-Instruct-AWQ LLM, NLU)
 * 
 * Flow:
 * Customer speaks → Exotel streams → ASR (Mercury) → LLM (Jupiter) → TTS (Mercury) → Customer
 * 
 * Reference: https://exotel.com/products/voice-streaming/
 */

import WebSocket from 'ws';
import axios from 'axios';
import { EventEmitter } from 'events';
import { getConfig } from '../utils/config.js';
import { emitEvent } from '../utils/events.js';
import { publish } from '../utils/mq.js';

// Mercury - Voice Services (v2 stack)
const ASR_WS_URL = process.env.ASR_WS_URL || 'ws://192.168.0.151:7000/ws/voice';
const ASR_HTTP_URL = process.env.ASR_HTTP_URL || 'http://192.168.0.151:7001';
const TTS_URL = process.env.TTS_URL || 'http://192.168.0.151:7002';
const VOICE_AGENT_URL = process.env.VOICE_AGENT_URL || 'http://192.168.0.151:7000';
const VOICE_AGENT_WS_URL = process.env.VOICE_AGENT_WS_URL || 'ws://192.168.0.151:7000/ws/voice';

// Audio configuration (matching Exotel's format)
const AUDIO_CONFIG = {
  sampleRate: 8000,      // Telephony standard
  channels: 1,           // Mono
  encoding: 'mulaw',     // μ-law encoding for telephony
  chunkSize: 160,        // 20ms at 8kHz
};

// Active streaming sessions
const activeSessions = new Map();

/**
 * Voice Stream Handler - Manages a single call's audio stream
 */
export class VoiceStreamHandler extends EventEmitter {
  constructor(callSid, options = {}) {
    super();
    this.callSid = callSid;
    this.options = {
      language: options.language || 'hi-IN', // Hindi default
      context: options.context || {},
      orderId: options.orderId,
      customerId: options.customerId,
      ...options
    };
    
    this.asrSocket = null;
    this.agentSocket = null;
    this.exotelSocket = null;
    
    this.conversationHistory = [];
    this.isProcessing = false;
    this.sessionStartTime = Date.now();
    this.audioBuffer = [];
    
    this.state = 'initializing';
  }
  
  /**
   * Connect to Exotel's voice stream and our AI stack
   */
  async connect(exotelStreamUrl) {
    try {
      console.log(`🎙️ Starting voice stream for call ${this.callSid}`);
      
      // 1. Connect to Voice Agent for conversation management
      await this.connectToVoiceAgent();
      
      // 2. Connect to ASR for speech recognition
      await this.connectToASR();
      
      // 3. Connect to Exotel's stream (incoming audio)
      if (exotelStreamUrl) {
        await this.connectToExotel(exotelStreamUrl);
      }
      
      this.state = 'connected';
      
      emitEvent({
        type: 'voice_stream.connected',
        at: new Date().toISOString(),
        callSid: this.callSid,
        options: this.options
      });
      
      console.log(`✅ Voice stream connected for call ${this.callSid}`);
      return true;
      
    } catch (error) {
      console.error(`❌ Voice stream connection failed: ${error.message}`);
      this.state = 'error';
      this.emit('error', error);
      return false;
    }
  }
  
  /**
   * Connect to Voice Agent WebSocket
   */
  async connectToVoiceAgent() {
    return new Promise((resolve, reject) => {
      try {
        this.agentSocket = new WebSocket(VOICE_AGENT_WS_URL);
        
        this.agentSocket.on('open', () => {
          console.log(`🤖 Connected to Voice Agent for call ${this.callSid}`);
          
          // Initialize conversation with context
          this.agentSocket.send(JSON.stringify({
            type: 'init',
            callSid: this.callSid,
            language: this.options.language,
            context: this.options.context,
            orderId: this.options.orderId,
            customerId: this.options.customerId
          }));
          
          resolve();
        });
        
        this.agentSocket.on('message', (data) => {
          this.handleAgentResponse(data);
        });
        
        this.agentSocket.on('error', (err) => {
          console.error(`Voice Agent WebSocket error: ${err.message}`);
          // Don't reject - agent might not have WS endpoint, use HTTP fallback
          resolve();
        });
        
        this.agentSocket.on('close', () => {
          console.log(`Voice Agent connection closed for call ${this.callSid}`);
        });
        
        // Timeout for connection
        setTimeout(() => {
          if (this.agentSocket.readyState !== WebSocket.OPEN) {
            console.log('⚠️ Voice Agent WS timeout, will use HTTP fallback');
            resolve();
          }
        }, 5000);
        
      } catch (error) {
        console.log(`⚠️ Voice Agent WS not available, using HTTP: ${error.message}`);
        resolve(); // Continue with HTTP fallback
      }
    });
  }
  
  /**
   * Connect to ASR WebSocket for real-time transcription
   */
  async connectToASR() {
    return new Promise((resolve, reject) => {
      try {
        this.asrSocket = new WebSocket(ASR_WS_URL);
        
        this.asrSocket.on('open', () => {
          console.log(`🎤 Connected to ASR for call ${this.callSid}`);
          
          // Configure ASR
          this.asrSocket.send(JSON.stringify({
            type: 'config',
            language: this.options.language,
            sampleRate: AUDIO_CONFIG.sampleRate,
            encoding: AUDIO_CONFIG.encoding,
            interimResults: true
          }));
          
          resolve();
        });
        
        this.asrSocket.on('message', (data) => {
          this.handleASRResult(data);
        });
        
        this.asrSocket.on('error', (err) => {
          console.error(`ASR WebSocket error: ${err.message}`);
          resolve(); // Continue with HTTP fallback
        });
        
        this.asrSocket.on('close', () => {
          console.log(`ASR connection closed for call ${this.callSid}`);
        });
        
        setTimeout(() => {
          if (this.asrSocket?.readyState !== WebSocket.OPEN) {
            console.log('⚠️ ASR WS timeout, will use HTTP fallback');
            resolve();
          }
        }, 5000);
        
      } catch (error) {
        console.log(`⚠️ ASR WS not available: ${error.message}`);
        resolve();
      }
    });
  }
  
  /**
   * Connect to Exotel's audio stream
   */
  async connectToExotel(streamUrl) {
    return new Promise((resolve, reject) => {
      try {
        this.exotelSocket = new WebSocket(streamUrl);
        
        this.exotelSocket.on('open', () => {
          console.log(`📞 Connected to Exotel stream for call ${this.callSid}`);
          resolve();
        });
        
        this.exotelSocket.on('message', (data) => {
          this.handleIncomingAudio(data);
        });
        
        this.exotelSocket.on('error', (err) => {
          console.error(`Exotel stream error: ${err.message}`);
        });
        
        this.exotelSocket.on('close', () => {
          console.log(`Exotel stream closed for call ${this.callSid}`);
          this.cleanup();
        });
        
        setTimeout(() => reject(new Error('Exotel stream connection timeout')), 10000);
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Handle incoming audio from Exotel
   */
  handleIncomingAudio(data) {
    try {
      // Parse Exotel's audio packet
      let audioData;
      if (Buffer.isBuffer(data)) {
        audioData = data;
      } else {
        const packet = JSON.parse(data.toString());
        if (packet.event === 'media' && packet.media?.payload) {
          audioData = Buffer.from(packet.media.payload, 'base64');
        } else if (packet.event === 'start') {
          console.log(`🎙️ Stream started: ${packet.streamSid}`);
          return;
        } else if (packet.event === 'stop') {
          console.log(`🛑 Stream stopped`);
          return;
        } else {
          return; // Unknown event
        }
      }
      
      // Buffer audio for processing
      this.audioBuffer.push(audioData);
      
      // Send to ASR for transcription (if connected via WebSocket)
      if (this.asrSocket?.readyState === WebSocket.OPEN) {
        this.asrSocket.send(audioData);
      } else {
        // Batch and send via HTTP
        this.processAudioBuffer();
      }
      
    } catch (error) {
      console.error(`Error handling audio: ${error.message}`);
    }
  }
  
  /**
   * Process buffered audio via HTTP (fallback)
   */
  async processAudioBuffer() {
    if (this.isProcessing || this.audioBuffer.length < 50) return; // ~1 second of audio
    
    this.isProcessing = true;
    const audioChunk = Buffer.concat(this.audioBuffer.splice(0, 50));
    
    try {
      // Send to ASR via HTTP
      const response = await axios.post(`${ASR_HTTP_URL}/transcribe`, audioChunk, {
        headers: { 
          'Content-Type': 'audio/raw',
          'X-Language': this.options.language,
          'X-Sample-Rate': AUDIO_CONFIG.sampleRate.toString()
        },
        timeout: 5000
      });
      
      if (response.data?.text) {
        this.handleTranscription(response.data.text, response.data.isFinal);
      }
      
    } catch (error) {
      // Silently ignore transcription errors
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Handle ASR transcription result
   */
  handleASRResult(data) {
    try {
      const result = JSON.parse(data.toString());
      
      if (result.text) {
        this.handleTranscription(result.text, result.isFinal);
      }
      
    } catch (error) {
      console.error(`Error parsing ASR result: ${error.message}`);
    }
  }
  
  /**
   * Handle transcription and send to Voice Agent
   */
  async handleTranscription(text, isFinal = false) {
    if (!text || text.trim().length === 0) return;
    
    console.log(`📝 Transcription (${isFinal ? 'final' : 'interim'}): "${text}"`);
    
    this.emit('transcription', { text, isFinal, callSid: this.callSid });
    
    // Only process final transcriptions
    if (!isFinal) return;
    
    // Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    });
    
    // Send to Voice Agent
    await this.sendToVoiceAgent(text);
  }
  
  /**
   * Send user input to Voice Agent and get response
   */
  async sendToVoiceAgent(userText) {
    try {
      let response;
      
      // Try WebSocket first
      if (this.agentSocket?.readyState === WebSocket.OPEN) {
        this.agentSocket.send(JSON.stringify({
          type: 'message',
          text: userText,
          callSid: this.callSid
        }));
        return; // Response will come via handleAgentResponse
      }
      
      // HTTP fallback
      response = await axios.post(`${VOICE_AGENT_URL}/api/conversation`, {
        sessionId: this.callSid,
        message: userText,
        language: this.options.language,
        context: {
          ...this.options.context,
          orderId: this.options.orderId,
          customerId: this.options.customerId,
          conversationHistory: this.conversationHistory.slice(-5) // Last 5 turns
        }
      }, { timeout: 10000 });
      
      if (response.data?.response) {
        await this.handleAgentTextResponse(response.data.response);
      }
      
    } catch (error) {
      console.error(`Voice Agent error: ${error.message}`);
      // Fallback response
      await this.handleAgentTextResponse('माफ़ कीजिए, कृपया दोबारा बोलिए।'); // "Sorry, please say again"
    }
  }
  
  /**
   * Handle response from Voice Agent (WebSocket)
   */
  async handleAgentResponse(data) {
    try {
      const response = JSON.parse(data.toString());
      
      if (response.type === 'response' && response.text) {
        await this.handleAgentTextResponse(response.text);
      } else if (response.type === 'action') {
        this.handleAgentAction(response.action);
      }
      
    } catch (error) {
      console.error(`Error parsing agent response: ${error.message}`);
    }
  }
  
  /**
   * Handle text response from Voice Agent - convert to speech
   */
  async handleAgentTextResponse(text) {
    console.log(`🤖 Agent response: "${text}"`);
    
    // Add to conversation history
    this.conversationHistory.push({
      role: 'assistant',
      content: text,
      timestamp: new Date().toISOString()
    });
    
    this.emit('response', { text, callSid: this.callSid });
    
    // Convert to speech using TTS
    await this.synthesizeAndSend(text);
  }
  
  /**
   * Handle agent actions (hangup, transfer, etc.)
   */
  handleAgentAction(action) {
    console.log(`⚡ Agent action: ${action.type}`);
    
    this.emit('action', { action, callSid: this.callSid });
    
    switch (action.type) {
      case 'hangup':
        this.cleanup();
        break;
      case 'transfer':
        // Would trigger Exotel transfer
        break;
      case 'hold':
        // Would trigger hold music
        break;
    }
  }
  
  /**
   * Synthesize text to speech and send back to caller
   */
  async synthesizeAndSend(text) {
    try {
      // Request TTS
      const response = await axios.post(`${TTS_URL}/synthesize`, {
        text,
        language: this.options.language,
        voice: this.options.voice || 'female',
        format: 'raw',
        sampleRate: AUDIO_CONFIG.sampleRate,
        encoding: AUDIO_CONFIG.encoding
      }, {
        responseType: 'arraybuffer',
        timeout: 15000
      });
      
      const audioData = Buffer.from(response.data);
      
      // Send audio back to Exotel stream
      if (this.exotelSocket?.readyState === WebSocket.OPEN) {
        // Exotel expects base64 encoded audio in specific format
        const packet = {
          event: 'media',
          streamSid: this.callSid,
          media: {
            payload: audioData.toString('base64')
          }
        };
        this.exotelSocket.send(JSON.stringify(packet));
      }
      
      this.emit('audio_sent', { textLength: text.length, audioSize: audioData.length });
      
    } catch (error) {
      console.error(`TTS error: ${error.message}`);
    }
  }
  
  /**
   * Send a greeting when call starts
   */
  async sendGreeting(greeting) {
    const defaultGreeting = this.options.language === 'hi-IN' 
      ? 'नमस्ते! मंगवाले में आपका स्वागत है। मैं आपकी कैसे मदद कर सकता हूं?'
      : 'Hello! Welcome to Mangwale. How can I help you?';
    
    await this.synthesizeAndSend(greeting || defaultGreeting);
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    console.log(`🧹 Cleaning up voice stream for call ${this.callSid}`);
    
    this.state = 'closed';
    
    if (this.asrSocket) {
      this.asrSocket.close();
      this.asrSocket = null;
    }
    
    if (this.agentSocket) {
      this.agentSocket.close();
      this.agentSocket = null;
    }
    
    if (this.exotelSocket) {
      this.exotelSocket.close();
      this.exotelSocket = null;
    }
    
    // Log session metrics
    const duration = Date.now() - this.sessionStartTime;
    emitEvent({
      type: 'voice_stream.ended',
      at: new Date().toISOString(),
      callSid: this.callSid,
      duration,
      turns: this.conversationHistory.length
    });
    
    // Remove from active sessions
    activeSessions.delete(this.callSid);
    
    this.emit('close');
  }
  
  /**
   * Get session statistics
   */
  getStats() {
    return {
      callSid: this.callSid,
      state: this.state,
      duration: Date.now() - this.sessionStartTime,
      conversationTurns: this.conversationHistory.length,
      language: this.options.language
    };
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new voice streaming session
 */
export async function createStreamingSession(callSid, options = {}) {
  if (activeSessions.has(callSid)) {
    console.log(`⚠️ Session already exists for call ${callSid}`);
    return activeSessions.get(callSid);
  }
  
  const handler = new VoiceStreamHandler(callSid, options);
  activeSessions.set(callSid, handler);
  
  return handler;
}

/**
 * Get existing streaming session
 */
export function getStreamingSession(callSid) {
  return activeSessions.get(callSid);
}

/**
 * End a streaming session
 */
export function endStreamingSession(callSid) {
  const session = activeSessions.get(callSid);
  if (session) {
    session.cleanup();
    return true;
  }
  return false;
}

/**
 * Get all active sessions
 */
export function getActiveSessions() {
  const sessions = [];
  activeSessions.forEach((session, callSid) => {
    sessions.push(session.getStats());
  });
  return sessions;
}

/**
 * Get streaming service statistics
 */
export function getStreamingStats() {
  return {
    activeSessions: activeSessions.size,
    sessions: getActiveSessions()
  };
}

// ============================================================================
// HTTP-BASED STREAMING (Alternative for non-WebSocket)
// ============================================================================

/**
 * Process audio chunk via HTTP (for webhooks)
 */
export async function processAudioChunk(callSid, audioBase64, options = {}) {
  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    // Transcribe
    const asrResponse = await axios.post(`${ASR_HTTP_URL}/transcribe`, audioBuffer, {
      headers: {
        'Content-Type': 'audio/raw',
        'X-Language': options.language || 'hi-IN'
      },
      timeout: 5000
    });
    
    const transcription = asrResponse.data?.text;
    if (!transcription) return null;
    
    // Get AI response
    const agentResponse = await axios.post(`${VOICE_AGENT_URL}/api/conversation`, {
      sessionId: callSid,
      message: transcription,
      language: options.language || 'hi-IN',
      context: options.context || {}
    }, { timeout: 10000 });
    
    const responseText = agentResponse.data?.response;
    if (!responseText) return { transcription };
    
    // Synthesize response
    const ttsResponse = await axios.post(`${TTS_URL}/synthesize`, {
      text: responseText,
      language: options.language || 'hi-IN',
      format: 'base64'
    }, { timeout: 15000 });
    
    return {
      transcription,
      response: responseText,
      audio: ttsResponse.data?.audio
    };
    
  } catch (error) {
    console.error(`Audio chunk processing error: ${error.message}`);
    return null;
  }
}

export default {
  VoiceStreamHandler,
  createStreamingSession,
  getStreamingSession,
  endStreamingSession,
  getActiveSessions,
  getStreamingStats,
  processAudioChunk,
  AUDIO_CONFIG
};
