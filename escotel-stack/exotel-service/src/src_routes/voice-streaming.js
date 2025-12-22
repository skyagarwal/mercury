/**
 * Voice Streaming Routes for Mangwale
 * 
 * Handles Exotel AgentStream integration:
 * - WebSocket endpoints for real-time audio streaming
 * - HTTP fallback for audio chunk processing
 * - Session management
 * 
 * This enables real AI conversations over phone calls.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { emitEvent } from '../utils/events.js';
import { publish } from '../utils/mq.js';
import {
  createStreamingSession,
  getStreamingSession,
  endStreamingSession,
  getActiveSessions,
  getStreamingStats,
  processAudioChunk
} from '../services/voice-streaming.service.js';

const router = express.Router();

// Store WebSocket server reference (will be attached later)
let wss = null;

/**
 * Initialize WebSocket server for voice streaming
 * Called from server.js after HTTP server is created
 */
export function initVoiceStreamingWebSocket(server) {
  wss = new WebSocketServer({ 
    server, 
    path: '/voice-stream/ws'
  });
  
  wss.on('connection', handleWebSocketConnection);
  
  console.log('🎙️ Voice Streaming WebSocket server initialized at /voice-stream/ws');
  return wss;
}

/**
 * Handle new WebSocket connection from Exotel
 */
async function handleWebSocketConnection(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const callSid = url.searchParams.get('callSid');
  const language = url.searchParams.get('language') || 'hi-IN';
  const orderId = url.searchParams.get('orderId');
  const customerId = url.searchParams.get('customerId');
  
  if (!callSid) {
    console.error('❌ WebSocket connection without callSid');
    ws.close(1008, 'callSid required');
    return;
  }
  
  console.log(`🔌 Voice stream WebSocket connected: ${callSid}`);
  
  // Create streaming session
  const session = await createStreamingSession(callSid, {
    language,
    orderId,
    customerId,
    context: { source: 'exotel_agentstream' }
  });
  
  // Connect session to our AI stack
  await session.connect(null); // We'll pipe audio directly
  
  // Handle incoming audio from Exotel
  ws.on('message', async (data) => {
    try {
      // Parse Exotel's message format
      if (Buffer.isBuffer(data)) {
        // Raw audio data
        session.handleIncomingAudio(data);
      } else {
        const message = JSON.parse(data.toString());
        
        switch (message.event) {
          case 'start':
            console.log(`📞 Stream started for call ${callSid}`);
            emitEvent({
              type: 'voice_stream.exotel.start',
              at: new Date().toISOString(),
              callSid,
              streamSid: message.streamSid
            });
            // Send greeting
            await session.sendGreeting();
            break;
            
          case 'media':
            // Audio data in base64
            if (message.media?.payload) {
              const audioBuffer = Buffer.from(message.media.payload, 'base64');
              session.handleIncomingAudio(audioBuffer);
            }
            break;
            
          case 'stop':
            console.log(`🛑 Stream stopped for call ${callSid}`);
            session.cleanup();
            break;
            
          case 'mark':
            // Playback marker - audio we sent has been played
            console.log(`✓ Audio mark: ${message.mark?.name}`);
            break;
            
          default:
            console.log(`Unknown Exotel event: ${message.event}`);
        }
      }
    } catch (error) {
      console.error(`WebSocket message error: ${error.message}`);
    }
  });
  
  // Handle session responses - send back to Exotel
  session.on('audio_sent', (data) => {
    // Audio is sent directly in synthesizeAndSend
  });
  
  session.on('action', async (data) => {
    if (data.action.type === 'hangup') {
      ws.close(1000, 'Call ended');
    }
  });
  
  ws.on('close', () => {
    console.log(`🔌 Voice stream WebSocket closed: ${callSid}`);
    session.cleanup();
  });
  
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${callSid}: ${error.message}`);
  });
  
  // Store WebSocket reference in session for sending audio back
  session.exotelSocket = ws;
}

// ============================================================================
// HTTP ENDPOINTS (Fallback & Management)
// ============================================================================

/**
 * POST /voice-stream/start
 * Start a voice streaming session (HTTP-based)
 */
router.post('/start', async (req, res) => {
  try {
    const {
      callSid,
      language = 'hi-IN',
      orderId,
      customerId,
      context = {}
    } = req.body;
    
    if (!callSid) {
      return res.status(400).json({ error: 'callSid is required' });
    }
    
    const session = await createStreamingSession(callSid, {
      language,
      orderId,
      customerId,
      context
    });
    
    await session.connect(null);
    
    return res.status(201).json({
      success: true,
      callSid,
      sessionId: callSid,
      websocketUrl: `/voice-stream/ws?callSid=${callSid}&language=${language}`,
      message: 'Voice streaming session created'
    });
    
  } catch (err) {
    console.error('Error starting voice stream:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /voice-stream/audio
 * Process audio chunk (HTTP fallback for non-WebSocket)
 */
router.post('/audio', async (req, res) => {
  try {
    const {
      callSid,
      audio, // Base64 encoded audio
      language = 'hi-IN',
      context = {}
    } = req.body;
    
    if (!callSid || !audio) {
      return res.status(400).json({ error: 'callSid and audio are required' });
    }
    
    const result = await processAudioChunk(callSid, audio, { language, context });
    
    if (!result) {
      return res.json({ processed: false });
    }
    
    return res.json({
      processed: true,
      transcription: result.transcription,
      response: result.response,
      audio: result.audio // Base64 encoded response audio
    });
    
  } catch (err) {
    console.error('Error processing audio chunk:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /voice-stream/end
 * End a voice streaming session
 */
router.post('/end', async (req, res) => {
  try {
    const { callSid } = req.body;
    
    if (!callSid) {
      return res.status(400).json({ error: 'callSid is required' });
    }
    
    const ended = endStreamingSession(callSid);
    
    return res.json({
      success: ended,
      callSid,
      message: ended ? 'Session ended' : 'Session not found'
    });
    
  } catch (err) {
    console.error('Error ending voice stream:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /voice-stream/session/:callSid
 * Get session status
 */
router.get('/session/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    const session = getStreamingSession(callSid);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    return res.json({
      session: session.getStats()
    });
    
  } catch (err) {
    console.error('Error getting session:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /voice-stream/active
 * List all active streaming sessions
 */
router.get('/active', async (req, res) => {
  try {
    const sessions = getActiveSessions();
    return res.json({
      count: sessions.length,
      sessions
    });
  } catch (err) {
    console.error('Error listing sessions:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /voice-stream/stats
 * Get streaming service statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = getStreamingStats();
    return res.json(stats);
  } catch (err) {
    console.error('Error getting stats:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// EXOTEL WEBHOOKS (for AgentStream configuration)
// ============================================================================

/**
 * POST /voice-stream/webhook/connect
 * Exotel calls this when a call should connect to voice streaming
 * Returns TwiML-like response to start streaming
 */
router.post('/webhook/connect', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const {
      CallSid,
      From,
      To,
      Direction,
      // Custom parameters
      language,
      orderId,
      customerId
    } = req.body;
    
    console.log(`📞 Voice stream connect request: ${CallSid}`);
    
    // Create session
    await createStreamingSession(CallSid, {
      language: language || 'hi-IN',
      orderId,
      customerId,
      callerNumber: From,
      calledNumber: To
    });
    
    // Return Exotel streaming instruction
    // This tells Exotel to stream audio to our WebSocket
    const wsUrl = `wss://${req.headers.host}/voice-stream/ws?callSid=${CallSid}&language=${language || 'hi-IN'}`;
    
    // Exotel expects XML response for streaming
    const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="callSid" value="${CallSid}"/>
      <Parameter name="language" value="${language || 'hi-IN'}"/>
      <Parameter name="orderId" value="${orderId || ''}"/>
    </Stream>
  </Connect>
</Response>`;
    
    return res.status(200).type('application/xml').send(response);
    
  } catch (err) {
    console.error('Voice stream webhook error:', err);
    return res.status(500).type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, there was an error. Please try again.</Say>
  <Hangup/>
</Response>`);
  }
});

/**
 * POST /voice-stream/webhook/status
 * Handle streaming status updates from Exotel
 */
router.post('/webhook/status', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const {
      CallSid,
      StreamSid,
      StreamStatus, // 'started', 'stopped', 'error'
      ErrorCode,
      ErrorMessage
    } = req.body;
    
    console.log(`📊 Stream status: ${CallSid} - ${StreamStatus}`);
    
    emitEvent({
      type: 'voice_stream.status',
      at: new Date().toISOString(),
      callSid: CallSid,
      streamSid: StreamSid,
      status: StreamStatus,
      error: ErrorCode ? { code: ErrorCode, message: ErrorMessage } : null
    });
    
    if (StreamStatus === 'stopped' || StreamStatus === 'error') {
      endStreamingSession(CallSid);
    }
    
    return res.json({ received: true });
    
  } catch (err) {
    console.error('Stream status webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
