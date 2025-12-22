import express from 'express';
import morgan from 'morgan';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bodyParser from 'body-parser';
import http from 'http';
import { getConfig } from './utils/config.js';
import { findAvailablePort } from './utils/port.js';
import exotelRouter from './src_routes/exotel.js';
import ivrRouter from './src_routes/ivr.js';
import commsRouter from './src_routes/comms.js';
import campaignsRouter from './src_routes/campaigns.js';
import webhooksRouter from './src_routes/webhooks.js';
import maskingRouter from './src_routes/masking.js';
import clickToCallRouter from './src_routes/click-to-call.js';
// v2.3.0 - New feature routes
import voiceStreamingRouter, { initVoiceStreamingWebSocket } from './src_routes/voice-streaming.js';
import verifiedCallsRouter from './routes/verified-calls.js';
import messagingRouter from './routes/messaging.js';
import autoDialerRouter from './routes/auto-dialer.js';
import cqaRouter from './routes/cqa.js';
import recordingsRouter from './routes/recordings.js';
// v2.4.0 - AI Voice Calls (Human-free operations)
import aiVoiceRouter from './routes/ai-voice.routes.js';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import { allowedOrigins } from './utils/security.js';

// Import Jupiter client for health checks
import { checkJupiterHealth, checkPhpHealth, getCacheStats, JUPITER_URL, PHP_BACKEND_URL } from './services/jupiter.service.js';
// Import masking stats for health
import { getMaskingStats } from './services/number-masking.service.js';
// Import stats from new services
import { getVerifiedCallsStats } from './services/verified-calls.service.js';
import { getMessagingStats } from './services/messaging.service.js';
import { getRecordingStats } from './services/recording.service.js';
import { getAggregateStats as getCQAStats } from './services/cqa.service.js';

const app = express();
// Security & observability
// Trust Traefik/X-Forwarded-* so rate limiting uses real client IP
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: allowedOrigins(),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check with Jupiter/PHP connectivity status
app.get('/health', async (req, res) => {
  const jupiterStatus = await checkJupiterHealth();
  const phpStatus = await checkPhpHealth();
  const maskingStats = getMaskingStats();
  const verifiedCallsStats = getVerifiedCallsStats();
  const messagingStats = getMessagingStats();
  const recordingStats = getRecordingStats();
  const cqaStats = getCQAStats();
  
  res.json({ 
    status: 'ok', 
    service: 'exotel-service', 
    version: '2.3.0',  // Major update with all Exotel features
    features: [
      'ivr', 
      'comms', 
      'campaigns', 
      'voice-ordering', 
      'jupiter-integration',
      'number-masking',
      'click-to-call',
      'voice-streaming',     // v2.3.0
      'verified-calls',       // v2.3.0 - Truecaller
      'sms-whatsapp',         // v2.3.0
      'auto-dialer',          // v2.3.0 - PACE
      'cqa',                  // v2.3.0 - Conversation Quality Analysis
      'call-recording',       // v2.3.0
      'ai-voice-calls',       // v2.4.0 - Human-free AI calls
    ],
    connections: {
      jupiter: {
        url: JUPITER_URL,
        connected: jupiterStatus.connected,
        latency: jupiterStatus.latency,
      },
      php: {
        url: PHP_BACKEND_URL,
        connected: phpStatus.connected,
        latency: phpStatus.latency,
      },
    },
    masking: maskingStats,
    verifiedCalls: verifiedCallsStats,
    messaging: messagingStats,
    recordings: recordingStats,
    cqa: { analyzedCalls: cqaStats.totalCalls, avgQuality: cqaStats.averageQualityScore },
    cache: getCacheStats(),
    time: new Date().toISOString() 
  });
});

// Core Exotel API routes
app.use('/exotel', exotelRouter);

// IVR flows (voice ordering, vendor/rider notifications)
app.use('/exotel/ivr', ivrRouter);

// Communications orchestrator (escalation workflows)
app.use('/comms', commsRouter);

// Outbound campaigns (marketing, re-engagement)
app.use('/campaigns', campaignsRouter);

// Jupiter webhooks (receive events from Jupiter backend)
app.use('/webhooks/jupiter', webhooksRouter);

// Number masking (ExoBridge - privacy protection)
app.use('/masking', maskingRouter);

// Click-to-call from app
app.use('/click-to-call', clickToCallRouter);

// ============================================================================
// v2.3.0 - NEW EXOTEL FEATURES
// ============================================================================

// Voice Streaming (AgentStream) - Real-time audio processing
app.use('/voice-stream', voiceStreamingRouter);

// Verified Calls (Truecaller) - Branded caller ID
app.use('/verified-calls', verifiedCallsRouter);

// Messaging (SMS & WhatsApp)
app.use('/messaging', messagingRouter);

// Auto Dialer (PACE) - Predictive/Progressive dialing
app.use('/auto-dialer', autoDialerRouter);

// Conversation Quality Analysis (CQA)
app.use('/cqa', cqaRouter);

// Call Recordings & Transcription
app.use('/recordings', recordingsRouter);

// ============================================================================
// v2.4.0 - AI VOICE CALLS (Human-Free Operations)
// ============================================================================

// AI-powered outbound calls (vendor confirmation, rider assignment, etc.)
// Endpoint: POST /api/voice/outbound-call (Called by Jupiter)
app.use('/api/voice', aiVoiceRouter);

// Swagger/OpenAPI docs for Exotel service
try {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const specPath = path.join(__dirname, 'openapi-exotel.json');
  const specRaw = fs.readFileSync(specPath, 'utf-8');
  const openapiSpec = JSON.parse(specRaw);
  app.get('/exotel/openapi.json', (req, res) => res.json(openapiSpec));
  app.use('/exotel/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
  console.log('Exotel Swagger docs available at /exotel/docs');
} catch (err) {
  console.warn('Swagger not initialized for exotel-service:', err.message);
}

(async () => {
  const preferred = Number(process.env.PORT) || 3000;
  const port = await findAvailablePort(preferred, preferred + 50);
  if (port !== preferred) {
    console.warn(`Preferred port ${preferred} in use. Using available port ${port}.`);
  }
  
  // Create HTTP server for WebSocket support
  const server = http.createServer(app);
  
  // Initialize Voice Streaming WebSocket
  try {
    initVoiceStreamingWebSocket(server);
    console.log('Voice Streaming WebSocket initialized at /voice-stream/ws');
  } catch (err) {
    console.warn('Voice Streaming WebSocket initialization failed:', err.message);
  }
  
  server.listen(port, () => {
    console.log(`🚀 Exotel service v2.3.0 listening on port ${port}`);
    console.log(`📡 Features: IVR, Comms, Campaigns, Voice Ordering, Number Masking, Click-to-Call`);
    console.log(`🆕 v2.3.0: Voice Streaming, Verified Calls, SMS/WhatsApp, Auto Dialer, CQA, Recordings`);
  });
})();
