/**
 * Mangwale Voice Gateway - Enhanced Real-time Voice Streaming
 * 
 * Features:
 * - Multi-provider support (Local Whisper/XTTS + Cloud fallbacks)
 * - Real-time streaming with low latency
 * - Voice Activity Detection (VAD)
 * - Automatic provider failover
 * - ElevenLabs, Deepgram, Google, Azure support
 */

import { WebSocket, WebSocketServer } from 'ws';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import axios from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
  // Server
  wsPort: parseInt(process.env.WS_PORT || '7100'),
  httpPort: parseInt(process.env.HTTP_PORT || '7101'),
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtSecret: process.env.JWT_SECRET || 'mangwale_jwt_secret_2024',
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),
  
  // Local Services (Mercury)
  localAsrUrl: process.env.ASR_URL || 'http://asr:8000',
  localTtsUrl: process.env.TTS_URL || 'http://tts:5501',
  
  // Cloud ASR Providers
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
  googleCloudApiKey: process.env.GOOGLE_CLOUD_API_KEY || '',
  azureSpeechKey: process.env.AZURE_SPEECH_KEY || '',
  azureSpeechRegion: process.env.AZURE_SPEECH_REGION || 'centralindia',
  
  // Cloud TTS Providers
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Adam
  
  // Provider Priority (comma-separated)
  asrProviderPriority: (process.env.ASR_PROVIDER_PRIORITY || 'local,deepgram,google,azure').split(','),
  ttsProviderPriority: (process.env.TTS_PROVIDER_PRIORITY || 'local,elevenlabs,deepgram,google,azure').split(','),
  
  // Performance
  wsPingInterval: parseInt(process.env.WS_PING_INTERVAL || '25000'),
  wsPingTimeout: parseInt(process.env.WS_PING_TIMEOUT || '60000'),
  maxAudioBufferSize: parseInt(process.env.MAX_AUDIO_BUFFER_SIZE || '2097152'), // 2MB
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  
  // Real-time settings
  enableVAD: process.env.ENABLE_VAD !== 'false',
  vadSilenceThresholdMs: parseInt(process.env.VAD_SILENCE_THRESHOLD_MS || '700'),
  streamingChunkSizeMs: parseInt(process.env.STREAMING_CHUNK_SIZE_MS || '100'),
};

// Logger
const logger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

// ============================================================================
// TYPES
// ============================================================================

interface VoiceSession {
  id: string;
  ws: WebSocket;
  userId?: string;
  language: string;
  audioBuffer: Buffer[];
  bufferSize: number;
  isStreaming: boolean;
  isRecording: boolean;
  lastActivity: number;
  vadSilenceStart: number | null;
  currentProvider: { asr: string; tts: string };
  metadata: Record<string, any>;
}

interface ASRResult {
  text: string;
  language: string;
  confidence: number;
  provider: string;
  isFinal: boolean;
  latencyMs?: number;
  segments?: Array<{ text: string; start: number; end: number }>;
}

interface TTSRequest {
  text: string;
  language?: string;
  voice?: string;
  speed?: number;
  provider?: string;
  stream?: boolean;
}

interface ProviderHealth {
  name: string;
  available: boolean;
  latencyMs?: number;
  lastCheck: number;
}

// ============================================================================
// PROVIDER HEALTH TRACKING
// ============================================================================

const providerHealth: Map<string, ProviderHealth> = new Map();

async function checkProviderHealth(provider: string, type: 'asr' | 'tts'): Promise<boolean> {
  const key = `${type}:${provider}`;
  const cached = providerHealth.get(key);
  
  // Cache for 30 seconds
  if (cached && Date.now() - cached.lastCheck < 30000) {
    return cached.available;
  }
  
  let available = false;
  const start = Date.now();
  
  try {
    switch (provider) {
      case 'local':
        const url = type === 'asr' ? config.localAsrUrl : config.localTtsUrl;
        const response = await axios.get(`${url}/health`, { timeout: 5000 });
        available = response.status === 200;
        break;
      case 'deepgram':
        available = !!config.deepgramApiKey;
        break;
      case 'elevenlabs':
        available = !!config.elevenlabsApiKey;
        break;
      case 'google':
        available = !!config.googleCloudApiKey;
        break;
      case 'azure':
        available = !!config.azureSpeechKey;
        break;
    }
  } catch (error) {
    available = false;
  }
  
  providerHealth.set(key, {
    name: provider,
    available,
    latencyMs: Date.now() - start,
    lastCheck: Date.now(),
  });
  
  return available;
}

async function selectProvider(type: 'asr' | 'tts'): Promise<string> {
  const priority = type === 'asr' ? config.asrProviderPriority : config.ttsProviderPriority;
  
  for (const provider of priority) {
    if (await checkProviderHealth(provider.trim(), type)) {
      return provider.trim();
    }
  }
  
  return 'local'; // Fallback to local
}

// ============================================================================
// ASR PROVIDERS
// ============================================================================

async function transcribeLocal(audioData: Buffer, language: string): Promise<ASRResult> {
  const startTime = Date.now();
  const formData = new FormData();
  formData.append('audio', audioData, { filename: 'audio.wav', contentType: 'audio/wav' });
  formData.append('language', language);
  
  const response = await axios.post(`${config.localAsrUrl}/transcribe`, formData, {
    headers: formData.getHeaders(),
    timeout: 30000,
  });
  
  return {
    text: response.data.text || '',
    language: response.data.language || language,
    confidence: response.data.confidence || 0.9,
    provider: 'local',
    isFinal: true,
    latencyMs: Date.now() - startTime,
  };
}

async function transcribeDeepgram(audioData: Buffer, language: string): Promise<ASRResult> {
  const startTime = Date.now();
  const langCode = language === 'hi' ? 'hi' : language === 'mr' ? 'mr' : 'en';
  
  const response = await axios.post(
    `https://api.deepgram.com/v1/listen?model=nova-2&language=${langCode}&smart_format=true`,
    audioData,
    {
      headers: {
        'Authorization': `Token ${config.deepgramApiKey}`,
        'Content-Type': 'audio/wav',
      },
      timeout: 30000,
    }
  );
  
  const result = response.data.results?.channels?.[0]?.alternatives?.[0];
  
  return {
    text: result?.transcript || '',
    language: langCode,
    confidence: result?.confidence || 0.9,
    provider: 'deepgram',
    isFinal: true,
    latencyMs: Date.now() - startTime,
  };
}

async function transcribeGoogle(audioData: Buffer, language: string): Promise<ASRResult> {
  const startTime = Date.now();
  const langCode = language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : 'en-US';
  
  const response = await axios.post(
    `https://speech.googleapis.com/v1/speech:recognize?key=${config.googleCloudApiKey}`,
    {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: langCode,
        enableAutomaticPunctuation: true,
      },
      audio: {
        content: audioData.toString('base64'),
      },
    },
    { timeout: 30000 }
  );
  
  const result = response.data.results?.[0]?.alternatives?.[0];
  
  return {
    text: result?.transcript || '',
    language,
    confidence: result?.confidence || 0.9,
    provider: 'google',
    isFinal: true,
    latencyMs: Date.now() - startTime,
  };
}

async function transcribeAzure(audioData: Buffer, language: string): Promise<ASRResult> {
  const startTime = Date.now();
  const langCode = language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : 'en-US';
  
  const response = await axios.post(
    `https://${config.azureSpeechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${langCode}`,
    audioData,
    {
      headers: {
        'Ocp-Apim-Subscription-Key': config.azureSpeechKey,
        'Content-Type': 'audio/wav',
      },
      timeout: 30000,
    }
  );
  
  return {
    text: response.data.DisplayText || '',
    language,
    confidence: response.data.Confidence || 0.9,
    provider: 'azure',
    isFinal: true,
    latencyMs: Date.now() - startTime,
  };
}

async function transcribe(audioData: Buffer, language: string, preferredProvider?: string): Promise<ASRResult> {
  const providers = preferredProvider 
    ? [preferredProvider, ...config.asrProviderPriority.filter(p => p !== preferredProvider)]
    : config.asrProviderPriority;
  
  for (const provider of providers) {
    try {
      const isAvailable = await checkProviderHealth(provider, 'asr');
      if (!isAvailable) continue;
      
      logger.info({ provider }, 'Attempting ASR transcription');
      
      switch (provider) {
        case 'local':
          return await transcribeLocal(audioData, language);
        case 'deepgram':
          return await transcribeDeepgram(audioData, language);
        case 'google':
          return await transcribeGoogle(audioData, language);
        case 'azure':
          return await transcribeAzure(audioData, language);
      }
    } catch (error: any) {
      logger.warn({ provider, error: error.message }, 'ASR provider failed, trying next');
    }
  }
  
  throw new Error('All ASR providers failed');
}

// ============================================================================
// TTS PROVIDERS
// ============================================================================

async function synthesizeLocal(text: string, language: string, voice?: string): Promise<Buffer> {
  // Use Orpheus TTS with voice selection
  const orpheusVoice = voice || (language === 'hi' ? 'tara' : 'tara');
  
  const response = await axios.post(
    `${config.localTtsUrl}/synthesize`,
    { 
      text, 
      voice: orpheusVoice,
      language: language,
      temperature: 0.6,
      top_p: 0.8,
      repetition_penalty: 1.3,
    },
    { responseType: 'arraybuffer', timeout: 60000 }
  );
  
  return Buffer.from(response.data);
}

async function synthesizeElevenLabs(text: string, language: string, voice?: string): Promise<Buffer> {
  const voiceId = voice || config.elevenlabsVoiceId;
  
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    },
    {
      headers: {
        'xi-api-key': config.elevenlabsApiKey,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );
  
  return Buffer.from(response.data);
}

async function synthesizeDeepgram(text: string, language: string, voice?: string): Promise<Buffer> {
  const model = language === 'hi' ? 'aura-asteria-en' : 'aura-asteria-en'; // Deepgram Hindi TBD
  
  const response = await axios.post(
    `https://api.deepgram.com/v1/speak?model=${model}`,
    { text },
    {
      headers: {
        'Authorization': `Token ${config.deepgramApiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );
  
  return Buffer.from(response.data);
}

async function synthesizeGoogle(text: string, language: string, voice?: string): Promise<Buffer> {
  const langCode = language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : 'en-US';
  const voiceName = voice || (language === 'hi' ? 'hi-IN-Wavenet-A' : 'en-US-Wavenet-D');
  
  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.googleCloudApiKey}`,
    {
      input: { text },
      voice: { languageCode: langCode, name: voiceName },
      audioConfig: { audioEncoding: 'MP3' },
    },
    { timeout: 60000 }
  );
  
  return Buffer.from(response.data.audioContent, 'base64');
}

async function synthesizeAzure(text: string, language: string, voice?: string): Promise<Buffer> {
  const langCode = language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : 'en-US';
  const voiceName = voice || (language === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-JennyNeural');
  
  const ssml = `
    <speak version='1.0' xml:lang='${langCode}'>
      <voice xml:lang='${langCode}' name='${voiceName}'>${text}</voice>
    </speak>
  `;
  
  const response = await axios.post(
    `https://${config.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    ssml,
    {
      headers: {
        'Ocp-Apim-Subscription-Key': config.azureSpeechKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );
  
  return Buffer.from(response.data);
}

async function synthesize(request: TTSRequest): Promise<{ audio: Buffer; provider: string }> {
  const providers = request.provider 
    ? [request.provider, ...config.ttsProviderPriority.filter(p => p !== request.provider)]
    : config.ttsProviderPriority;
  
  const language = request.language || 'hi';
  
  for (const provider of providers) {
    try {
      const isAvailable = await checkProviderHealth(provider, 'tts');
      if (!isAvailable) continue;
      
      logger.info({ provider, textLength: request.text.length }, 'Attempting TTS synthesis');
      
      let audio: Buffer;
      switch (provider) {
        case 'local':
          audio = await synthesizeLocal(request.text, language, request.voice);
          break;
        case 'elevenlabs':
          audio = await synthesizeElevenLabs(request.text, language, request.voice);
          break;
        case 'deepgram':
          audio = await synthesizeDeepgram(request.text, language, request.voice);
          break;
        case 'google':
          audio = await synthesizeGoogle(request.text, language, request.voice);
          break;
        case 'azure':
          audio = await synthesizeAzure(request.text, language, request.voice);
          break;
        default:
          continue;
      }
      
      return { audio, provider };
    } catch (error: any) {
      logger.warn({ provider, error: error.message }, 'TTS provider failed, trying next');
    }
  }
  
  throw new Error('All TTS providers failed');
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

const sessions = new Map<string, VoiceSession>();

function createSession(ws: WebSocket, userId?: string, language = 'hi'): VoiceSession {
  const session: VoiceSession = {
    id: uuidv4(),
    ws,
    userId,
    language,
    audioBuffer: [],
    bufferSize: 0,
    isStreaming: false,
    isRecording: false,
    lastActivity: Date.now(),
    vadSilenceStart: null,
    currentProvider: { asr: 'local', tts: 'local' },
    metadata: {},
  };
  sessions.set(session.id, session);
  return session;
}

function cleanupSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) {
    session.audioBuffer = [];
    session.bufferSize = 0;
    sessions.delete(sessionId);
    logger.info({ sessionId }, 'Session cleaned up');
  }
}

function sendToClient(session: VoiceSession, type: string, data: any) {
  if (session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({ type, data, sessionId: session.id, timestamp: Date.now() }));
  }
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMaxRequests }));

const httpServer = http.createServer(app);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeSessions: sessions.size,
    uptime: process.uptime(),
    providers: {
      asr: config.asrProviderPriority,
      tts: config.ttsProviderPriority,
    },
  });
});

// Provider health
app.get('/api/providers/health', async (req, res) => {
  const health: Record<string, any> = { asr: {}, tts: {} };
  
  for (const provider of config.asrProviderPriority) {
    health.asr[provider] = await checkProviderHealth(provider, 'asr');
  }
  
  for (const provider of config.ttsProviderPriority) {
    health.tts[provider] = await checkProviderHealth(provider, 'tts');
  }
  
  res.json(health);
});

// REST API for ASR
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio, language = 'hi', provider } = req.body;
    if (!audio) return res.status(400).json({ error: 'Audio data required' });
    
    const audioBuffer = Buffer.from(audio, 'base64');
    const result = await transcribe(audioBuffer, language, provider);
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, 'REST ASR failed');
    res.status(500).json({ error: 'Transcription failed' });
  }
});

// REST API for TTS
app.post('/api/speak', async (req, res) => {
  try {
    const { text, language = 'hi', voice, provider, speed } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    
    const result = await synthesize({ text, language, voice, provider, speed });
    res.set({
      'Content-Type': 'audio/mpeg',
      'X-Provider': result.provider,
    });
    res.send(result.audio);
  } catch (error: any) {
    logger.error({ error: error.message }, 'REST TTS failed');
    res.status(500).json({ error: 'Speech synthesis failed' });
  }
});

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

const wss = new WebSocketServer({ port: config.wsPort });

logger.info({ wsPort: config.wsPort, httpPort: config.httpPort }, 'Voice Gateway starting');

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const language = url.searchParams.get('language') || 'hi';
  
  let userId: string | undefined;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as any;
      userId = decoded.sub || decoded.userId || decoded.id;
    } catch (e) {
      // Invalid token, continue without auth
    }
  }
  
  const session = createSession(ws, userId, language);
  logger.info({ sessionId: session.id, userId, language }, 'New WebSocket connection');
  
  // Send session info
  sendToClient(session, 'connected', {
    sessionId: session.id,
    language: session.language,
    capabilities: ['asr', 'tts', 'streaming', 'vad'],
    providers: {
      asr: config.asrProviderPriority,
      tts: config.ttsProviderPriority,
    },
  });
  
  // Ping/pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, config.wsPingInterval);
  
  let pongReceived = true;
  ws.on('pong', () => { pongReceived = true; });
  
  const healthCheck = setInterval(() => {
    if (!pongReceived) {
      logger.warn({ sessionId: session.id }, 'Client not responding');
      ws.terminate();
    }
    pongReceived = false;
  }, config.wsPingTimeout);
  
  // Handle messages
  ws.on('message', async (data: Buffer | string) => {
    session.lastActivity = Date.now();
    
    try {
      // Binary = audio
      if (Buffer.isBuffer(data)) {
        if (session.bufferSize + data.length <= config.maxAudioBufferSize) {
          session.audioBuffer.push(data);
          session.bufferSize += data.length;
          
          // VAD: Check for silence
          if (config.enableVAD && session.isRecording) {
            const hasVoice = detectVoiceActivity(data);
            if (!hasVoice) {
              if (!session.vadSilenceStart) {
                session.vadSilenceStart = Date.now();
              } else if (Date.now() - session.vadSilenceStart > config.vadSilenceThresholdMs) {
                // Auto-stop recording after silence
                sendToClient(session, 'vad_silence_detected', {});
                session.vadSilenceStart = null;
              }
            } else {
              session.vadSilenceStart = null;
            }
          }
          
          sendToClient(session, 'audio_received', { bytes: data.length, totalBuffered: session.bufferSize });
        } else {
          sendToClient(session, 'error', { message: 'Audio buffer full', code: 'BUFFER_OVERFLOW' });
        }
        return;
      }
      
      // JSON command
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'start_recording':
          session.isRecording = true;
          session.audioBuffer = [];
          session.bufferSize = 0;
          session.vadSilenceStart = null;
          sendToClient(session, 'recording_started', { vad: config.enableVAD });
          break;
          
        case 'stop_recording':
          session.isRecording = false;
          if (session.audioBuffer.length > 0) {
            const audioData = Buffer.concat(session.audioBuffer);
            session.audioBuffer = [];
            session.bufferSize = 0;
            
            try {
              const result = await transcribe(audioData, session.language, message.provider);
              session.currentProvider.asr = result.provider;
              sendToClient(session, 'asr_result', result);
            } catch (error: any) {
              sendToClient(session, 'error', { message: error.message, code: 'ASR_ERROR' });
            }
          }
          break;
          
        case 'transcribe':
          if (message.audio) {
            const audioBuffer = Buffer.from(message.audio, 'base64');
            try {
              const result = await transcribe(audioBuffer, session.language, message.provider);
              sendToClient(session, 'asr_result', result);
            } catch (error: any) {
              sendToClient(session, 'error', { message: error.message, code: 'ASR_ERROR' });
            }
          }
          break;
          
        case 'speak':
          if (message.text) {
            try {
              sendToClient(session, 'tts_start', { text: message.text });
              
              const result = await synthesize({
                text: message.text,
                language: message.language || session.language,
                voice: message.voice,
                provider: message.provider,
                speed: message.speed,
              });
              
              session.currentProvider.tts = result.provider;
              ws.send(result.audio);
              
              sendToClient(session, 'tts_complete', { 
                status: 'done', 
                provider: result.provider,
                audioSize: result.audio.length,
              });
            } catch (error: any) {
              sendToClient(session, 'error', { message: error.message, code: 'TTS_ERROR' });
            }
          }
          break;
          
        case 'set_language':
          session.language = message.language || 'hi';
          sendToClient(session, 'language_changed', { language: session.language });
          break;
          
        case 'set_providers':
          if (message.asr) session.currentProvider.asr = message.asr;
          if (message.tts) session.currentProvider.tts = message.tts;
          sendToClient(session, 'providers_changed', session.currentProvider);
          break;
          
        case 'ping':
          sendToClient(session, 'pong', { timestamp: Date.now() });
          break;
          
        default:
          sendToClient(session, 'error', { message: `Unknown: ${message.type}`, code: 'UNKNOWN' });
      }
    } catch (error: any) {
      logger.error({ error: error.message, sessionId: session.id }, 'Error processing message');
      sendToClient(session, 'error', { message: 'Processing error', code: 'PROCESSING_ERROR' });
    }
  });
  
  ws.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(healthCheck);
    cleanupSession(session.id);
  });
  
  ws.on('error', (error) => {
    logger.error({ error: error.message, sessionId: session.id }, 'WebSocket error');
    cleanupSession(session.id);
  });
});

// Simple VAD (voice activity detection) - checks for audio energy
function detectVoiceActivity(audioData: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < audioData.length; i += 2) {
    const sample = audioData.readInt16LE(i);
    sum += Math.abs(sample);
  }
  const avgAmplitude = sum / (audioData.length / 2);
  return avgAmplitude > 500; // Threshold for voice vs silence
}

// Start HTTP server
httpServer.listen(config.httpPort, () => {
  logger.info({ port: config.httpPort }, 'HTTP server listening');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  wss.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
  wss.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});

logger.info('Voice Gateway started with multi-provider support');
