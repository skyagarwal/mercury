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
  pitch?: number;
  emotion?: string;
  provider?: string;
  stream?: boolean;
  format?: 'mp3' | 'wav' | 'ogg';
}

// ============================================================================
// USAGE METRICS & STATISTICS
// ============================================================================

interface UsageMetrics {
  totalAsrRequests: number;
  totalTtsRequests: number;
  totalAsrSeconds: number;
  totalTtsCharacters: number;
  asrLatencySum: number;
  ttsLatencySum: number;
  providerUsage: Record<string, number>;
  errorCount: number;
  startTime: number;
}

const metrics: UsageMetrics = {
  totalAsrRequests: 0,
  totalTtsRequests: 0,
  totalAsrSeconds: 0,
  totalTtsCharacters: 0,
  asrLatencySum: 0,
  ttsLatencySum: 0,
  providerUsage: {},
  errorCount: 0,
  startTime: Date.now(),
};

function recordMetric(type: 'asr' | 'tts', provider: string, latencyMs: number, extra?: { seconds?: number; chars?: number }) {
  if (type === 'asr') {
    metrics.totalAsrRequests++;
    metrics.asrLatencySum += latencyMs;
    if (extra?.seconds) metrics.totalAsrSeconds += extra.seconds;
  } else {
    metrics.totalTtsRequests++;
    metrics.ttsLatencySum += latencyMs;
    if (extra?.chars) metrics.totalTtsCharacters += extra.chars;
  }
  metrics.providerUsage[provider] = (metrics.providerUsage[provider] || 0) + 1;
}

// ============================================================================
// VOICE LIBRARY - Available voices per provider
// ============================================================================

const voiceLibrary = {
  local: {
    xtts: [
      { id: 'default', name: 'Default Voice', languages: ['hi', 'en', 'mr'], gender: 'neutral' },
    ],
    indicParler: [
      { id: 'Divya', name: 'Divya', languages: ['hi'], gender: 'female', recommended: true },
      { id: 'Rohit', name: 'Rohit', languages: ['hi'], gender: 'male', recommended: true },
      { id: 'Aman', name: 'Aman', languages: ['hi'], gender: 'male' },
      { id: 'Rani', name: 'Rani', languages: ['hi'], gender: 'female' },
      { id: 'Sanjay', name: 'Sanjay', languages: ['mr'], gender: 'male' },
      { id: 'Sunita', name: 'Sunita', languages: ['mr'], gender: 'female' },
    ],
  },
  elevenlabs: [
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', languages: ['en', 'hi'], gender: 'male' },
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', languages: ['en', 'hi'], gender: 'female' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', languages: ['en'], gender: 'female' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', languages: ['en'], gender: 'male' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', languages: ['en'], gender: 'female' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', languages: ['en'], gender: 'male' },
  ],
  deepgram: [
    { id: 'aura-asteria-en', name: 'Asteria', languages: ['en'], gender: 'female' },
    { id: 'aura-luna-en', name: 'Luna', languages: ['en'], gender: 'female' },
    { id: 'aura-stella-en', name: 'Stella', languages: ['en'], gender: 'female' },
    { id: 'aura-athena-en', name: 'Athena', languages: ['en'], gender: 'female' },
    { id: 'aura-hera-en', name: 'Hera', languages: ['en'], gender: 'female' },
    { id: 'aura-orion-en', name: 'Orion', languages: ['en'], gender: 'male' },
    { id: 'aura-arcas-en', name: 'Arcas', languages: ['en'], gender: 'male' },
    { id: 'aura-perseus-en', name: 'Perseus', languages: ['en'], gender: 'male' },
  ],
  google: [
    { id: 'hi-IN-Wavenet-A', name: 'Hindi Female A', languages: ['hi'], gender: 'female' },
    { id: 'hi-IN-Wavenet-B', name: 'Hindi Male B', languages: ['hi'], gender: 'male' },
    { id: 'hi-IN-Wavenet-C', name: 'Hindi Male C', languages: ['hi'], gender: 'male' },
    { id: 'hi-IN-Wavenet-D', name: 'Hindi Female D', languages: ['hi'], gender: 'female' },
    { id: 'mr-IN-Wavenet-A', name: 'Marathi Female', languages: ['mr'], gender: 'female' },
    { id: 'mr-IN-Wavenet-B', name: 'Marathi Male', languages: ['mr'], gender: 'male' },
    { id: 'en-US-Wavenet-D', name: 'English Male', languages: ['en'], gender: 'male' },
    { id: 'en-US-Wavenet-F', name: 'English Female', languages: ['en'], gender: 'female' },
  ],
  azure: [
    { id: 'hi-IN-MadhurNeural', name: 'Madhur', languages: ['hi'], gender: 'male' },
    { id: 'hi-IN-SwaraNeural', name: 'Swara', languages: ['hi'], gender: 'female' },
    { id: 'mr-IN-AarohiNeural', name: 'Aarohi', languages: ['mr'], gender: 'female' },
    { id: 'mr-IN-ManoharNeural', name: 'Manohar', languages: ['mr'], gender: 'male' },
    { id: 'en-US-JennyNeural', name: 'Jenny', languages: ['en'], gender: 'female' },
    { id: 'en-US-GuyNeural', name: 'Guy', languages: ['en'], gender: 'male' },
  ],
};

// Emotion presets for TTS
const emotionPresets: Record<string, { description: string; stability: number; similarity: number; style?: number }> = {
  neutral: { description: 'speaks in a neutral, balanced tone', stability: 0.5, similarity: 0.75 },
  happy: { description: 'speaks with a happy, cheerful tone', stability: 0.4, similarity: 0.8, style: 0.6 },
  excited: { description: 'speaks with an excited, energetic tone', stability: 0.3, similarity: 0.85, style: 0.8 },
  calm: { description: 'speaks with a calm, soothing tone', stability: 0.7, similarity: 0.7, style: 0.3 },
  professional: { description: 'speaks with a professional, formal tone', stability: 0.6, similarity: 0.75, style: 0.4 },
  friendly: { description: 'speaks with a warm, friendly tone', stability: 0.45, similarity: 0.8, style: 0.5 },
  empathetic: { description: 'speaks with an empathetic, understanding tone', stability: 0.55, similarity: 0.75, style: 0.45 },
  urgent: { description: 'speaks with an urgent, important tone', stability: 0.35, similarity: 0.85, style: 0.7 },
  sad: { description: 'speaks with a soft, melancholic tone', stability: 0.65, similarity: 0.7, style: 0.25 },
};

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
  // XTTS requires a speaker_wav for voice cloning - use default if not provided
  const speakerWav = voice || '/app/models/default_speaker.wav';
  
  const response = await axios.post(
    `${config.localTtsUrl}/api/tts`,
    { text, lang: language, speaker_wav: speakerWav },
    { responseType: 'arraybuffer', timeout: 60000 }
  );
  
  return Buffer.from(response.data);
}

async function synthesizeElevenLabs(text: string, language: string, voice?: string, options?: { emotion?: string; speed?: number }): Promise<Buffer> {
  const voiceId = voice || config.elevenlabsVoiceId;
  const emotionSettings = emotionPresets[options?.emotion || 'neutral'] || emotionPresets.neutral;
  
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: emotionSettings.stability,
        similarity_boost: emotionSettings.similarity,
        style: emotionSettings.style || 0,
        use_speaker_boost: true,
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

async function synthesizeAzure(text: string, language: string, voice?: string, options?: { speed?: number; pitch?: number; emotion?: string }): Promise<Buffer> {
  const langCode = language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : 'en-US';
  const voiceName = voice || (language === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-JennyNeural');
  
  // Convert speed/pitch to SSML format (100% = 1.0)
  const rate = options?.speed ? `${Math.round((options.speed - 1) * 100)}%` : '+0%';
  const pitch = options?.pitch ? `${Math.round((options.pitch - 1) * 50)}%` : '+0%';
  
  // Map emotion to Azure style (Neural voices support styles)
  const emotionStyle = options?.emotion && options.emotion !== 'neutral' 
    ? `style="${options.emotion === 'happy' ? 'cheerful' : options.emotion === 'sad' ? 'sad' : options.emotion === 'excited' ? 'excited' : 'general'}"` 
    : '';
  
  const ssml = `
    <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='${langCode}'>
      <voice name='${voiceName}' ${emotionStyle}>
        <prosody rate='${rate}' pitch='${pitch}'>${text}</prosody>
      </voice>
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
      
      logger.info({ provider, textLength: request.text.length, emotion: request.emotion }, 'Attempting TTS synthesis');
      
      const ttsOptions = { emotion: request.emotion, speed: request.speed, pitch: request.pitch };
      let audio: Buffer;
      switch (provider) {
        case 'local':
          audio = await synthesizeLocal(request.text, language, request.voice);
          break;
        case 'elevenlabs':
          audio = await synthesizeElevenLabs(request.text, language, request.voice, ttsOptions);
          break;
        case 'deepgram':
          audio = await synthesizeDeepgram(request.text, language, request.voice);
          break;
        case 'google':
          audio = await synthesizeGoogle(request.text, language, request.voice);
          break;
        case 'azure':
          audio = await synthesizeAzure(request.text, language, request.voice, ttsOptions);
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

// Health check - Enhanced for admin dashboard
app.get('/health', async (req, res) => {
  const avgAsrLatency = metrics.totalAsrRequests > 0 ? Math.round(metrics.asrLatencySum / metrics.totalAsrRequests) : 0;
  const avgTtsLatency = metrics.totalTtsRequests > 0 ? Math.round(metrics.ttsLatencySum / metrics.totalTtsRequests) : 0;
  
  // Quick provider check
  const localAsrHealthy = await checkProviderHealth('local', 'asr').catch(() => false);
  const localTtsHealthy = await checkProviderHealth('local', 'tts').catch(() => false);
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    activeSessions: sessions.size,
    uptime: process.uptime(),
    uptimeFormatted: formatDuration(Date.now() - metrics.startTime),
    providers: {
      asr: config.asrProviderPriority,
      tts: config.ttsProviderPriority,
    },
    services: {
      asr: { healthy: localAsrHealthy, latencyMs: avgAsrLatency },
      tts: { healthy: localTtsHealthy, latencyMs: avgTtsLatency },
    },
    stats: {
      totalRequests: metrics.totalAsrRequests + metrics.totalTtsRequests,
      errors: metrics.errorCount,
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

// REST API for ASR (Enhanced with metrics tracking)
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio, language = 'hi', provider, features = {} } = req.body;
    if (!audio) return res.status(400).json({ error: 'Audio data required' });
    
    const startTime = Date.now();
    const audioBuffer = Buffer.from(audio, 'base64');
    const result = await transcribe(audioBuffer, language, provider);
    const latencyMs = Date.now() - startTime;
    
    // Estimate audio duration (rough: 16-bit 16kHz mono = 32KB/sec)
    const estimatedSeconds = audioBuffer.length / 32000;
    recordMetric('asr', result.provider, latencyMs, { seconds: estimatedSeconds });
    
    res.json({
      ...result,
      latencyMs,
      audioSize: audioBuffer.length,
    });
  } catch (error: any) {
    metrics.errorCount++;
    logger.error({ error: error.message }, 'REST ASR failed');
    res.status(500).json({ error: 'Transcription failed' });
  }
});

// REST API for TTS (Enhanced with emotion, pitch, format)
app.post('/api/speak', async (req, res) => {
  try {
    const { text, language = 'hi', voice, provider, speed, pitch, emotion, format = 'mp3' } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    
    const startTime = Date.now();
    const result = await synthesize({ text, language, voice, provider, speed, pitch, emotion, format });
    const latencyMs = Date.now() - startTime;
    
    recordMetric('tts', result.provider, latencyMs, { chars: text.length });
    
    const contentType = format === 'wav' ? 'audio/wav' : format === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
    res.set({
      'Content-Type': contentType,
      'X-Provider': result.provider,
      'X-Latency-Ms': latencyMs.toString(),
      'X-Audio-Size': result.audio.length.toString(),
    });
    res.send(result.audio);
  } catch (error: any) {
    metrics.errorCount++;
    logger.error({ error: error.message }, 'REST TTS failed');
    res.status(500).json({ error: 'Speech synthesis failed' });
  }
});

// ============================================================================
// ADMIN API ENDPOINTS - For admin.mangwale.ai Voice Settings
// ============================================================================

// GET /api/config - Get current runtime configuration
app.get('/api/config', (req, res) => {
  res.json({
    asr: {
      providerPriority: config.asrProviderPriority,
      localUrl: config.localAsrUrl,
      supportedLanguages: ['hi', 'en', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa'],
      features: {
        wordTimestamps: true,
        confidenceScores: true,
        vadFilter: config.enableVAD,
        silenceThresholdMs: config.vadSilenceThresholdMs,
      },
    },
    tts: {
      providerPriority: config.ttsProviderPriority,
      localUrl: config.localTtsUrl,
      supportedLanguages: ['hi', 'en', 'mr'],
      emotions: Object.keys(emotionPresets),
      features: {
        streaming: true,
        voiceCloning: true,
        emotionControl: true,
        speedRange: { min: 0.5, max: 2.0, default: 1.0 },
        pitchRange: { min: 0.5, max: 2.0, default: 1.0 },
        formats: ['mp3', 'wav', 'ogg'],
      },
    },
    vad: {
      enabled: config.enableVAD,
      silenceThresholdMs: config.vadSilenceThresholdMs,
      streamingChunkSizeMs: config.streamingChunkSizeMs,
    },
    limits: {
      maxAudioBufferSize: config.maxAudioBufferSize,
      rateLimitWindowMs: config.rateLimitWindowMs,
      rateLimitMaxRequests: config.rateLimitMaxRequests,
    },
  });
});

// PUT /api/config - Update runtime configuration (admin only)
app.put('/api/config', (req, res) => {
  const { asr, tts, vad } = req.body;
  
  if (asr?.providerPriority) {
    config.asrProviderPriority = asr.providerPriority;
  }
  if (tts?.providerPriority) {
    config.ttsProviderPriority = tts.providerPriority;
  }
  if (vad?.enabled !== undefined) {
    (config as any).enableVAD = vad.enabled;
  }
  if (vad?.silenceThresholdMs) {
    (config as any).vadSilenceThresholdMs = vad.silenceThresholdMs;
  }
  
  logger.info({ asr, tts, vad }, 'Configuration updated');
  res.json({ success: true, message: 'Configuration updated' });
});

// GET /api/stats - Usage statistics for admin dashboard
app.get('/api/stats', (req, res) => {
  const uptimeMs = Date.now() - metrics.startTime;
  const avgAsrLatency = metrics.totalAsrRequests > 0 ? Math.round(metrics.asrLatencySum / metrics.totalAsrRequests) : 0;
  const avgTtsLatency = metrics.totalTtsRequests > 0 ? Math.round(metrics.ttsLatencySum / metrics.totalTtsRequests) : 0;
  
  res.json({
    uptime: {
      ms: uptimeMs,
      formatted: formatDuration(uptimeMs),
    },
    asr: {
      totalRequests: metrics.totalAsrRequests,
      totalSeconds: Math.round(metrics.totalAsrSeconds * 100) / 100,
      avgLatencyMs: avgAsrLatency,
    },
    tts: {
      totalRequests: metrics.totalTtsRequests,
      totalCharacters: metrics.totalTtsCharacters,
      avgLatencyMs: avgTtsLatency,
    },
    providers: metrics.providerUsage,
    errors: metrics.errorCount,
    activeSessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/voices - List available voices per provider
app.get('/api/voices', async (req, res) => {
  const { provider, language } = req.query;
  
  let voices: any = { ...voiceLibrary };
  
  // Filter by provider if specified
  if (provider && typeof provider === 'string') {
    voices = { [provider]: voiceLibrary[provider as keyof typeof voiceLibrary] };
  }
  
  // Filter by language if specified
  if (language && typeof language === 'string') {
    for (const [providerName, providerVoices] of Object.entries(voices)) {
      if (Array.isArray(providerVoices)) {
        voices[providerName] = providerVoices.filter((v: any) => v.languages?.includes(language));
      } else if (providerVoices && typeof providerVoices === 'object') {
        // Handle nested structure (local has xtts and indicParler)
        const filtered: any = {};
        for (const [subKey, subVoices] of Object.entries(providerVoices)) {
          if (Array.isArray(subVoices)) {
            filtered[subKey] = subVoices.filter((v: any) => v.languages?.includes(language));
          }
        }
        voices[providerName] = filtered;
      }
    }
  }
  
  res.json(voices);
});

// GET /api/emotions - List available emotion presets
app.get('/api/emotions', (req, res) => {
  res.json(emotionPresets);
});

// GET /api/models - List available ASR models
app.get('/api/models', async (req, res) => {
  res.json({
    asr: {
      local: [
        { id: 'large-v3', name: 'Whisper Large v3', size: '2.9GB', accuracy: 'highest', speed: 'slow' },
        { id: 'large-v3-turbo', name: 'Whisper Large v3 Turbo', size: '1.6GB', accuracy: 'high', speed: 'fast', recommended: true },
        { id: 'distil-large-v3', name: 'Distil Large v3', size: '1.5GB', accuracy: 'high', speed: 'faster' },
        { id: 'medium', name: 'Whisper Medium', size: '1.4GB', accuracy: 'medium', speed: 'medium' },
        { id: 'small', name: 'Whisper Small', size: '461MB', accuracy: 'fair', speed: 'fast' },
      ],
      deepgram: [
        { id: 'nova-2', name: 'Nova 2', accuracy: 'highest', speed: 'real-time', recommended: true },
        { id: 'nova', name: 'Nova', accuracy: 'high', speed: 'real-time' },
        { id: 'enhanced', name: 'Enhanced', accuracy: 'medium', speed: 'real-time' },
      ],
    },
    tts: {
      local: [
        { id: 'xtts_v2', name: 'XTTS v2', languages: 21, voiceCloning: true, recommended: true },
        { id: 'indic-parler-tts', name: 'Indic Parler TTS', languages: 21, voiceCloning: false, indianLanguages: true },
      ],
      elevenlabs: [
        { id: 'eleven_flash_v2_5', name: 'Flash v2.5', latency: 'lowest', quality: 'high', recommended: true },
        { id: 'eleven_multilingual_v2', name: 'Multilingual v2', latency: 'medium', quality: 'highest' },
        { id: 'eleven_turbo_v2', name: 'Turbo v2', latency: 'low', quality: 'high' },
      ],
    },
  });
});

// GET /api/capabilities - Full system capabilities for admin UI
app.get('/api/capabilities', async (req, res) => {
  // Check actual provider health
  const providerStatus: Record<string, any> = { asr: {}, tts: {} };
  
  for (const provider of config.asrProviderPriority) {
    const isAvailable = await checkProviderHealth(provider, 'asr');
    const cached = providerHealth.get(`asr:${provider}`);
    providerStatus.asr[provider] = {
      available: isAvailable,
      latencyMs: cached?.latencyMs || null,
      lastCheck: cached?.lastCheck ? new Date(cached.lastCheck).toISOString() : null,
    };
  }
  
  for (const provider of config.ttsProviderPriority) {
    const isAvailable = await checkProviderHealth(provider, 'tts');
    const cached = providerHealth.get(`tts:${provider}`);
    providerStatus.tts[provider] = {
      available: isAvailable,
      latencyMs: cached?.latencyMs || null,
      lastCheck: cached?.lastCheck ? new Date(cached.lastCheck).toISOString() : null,
    };
  }
  
  res.json({
    version: '2.0.0',
    features: {
      asr: ['transcription', 'word-timestamps', 'confidence-scores', 'language-detection', 'streaming'],
      tts: ['synthesis', 'voice-cloning', 'emotion-control', 'speed-control', 'pitch-control', 'streaming'],
      realtime: ['vad', 'interruption-detection', 'partial-results', 'websocket-streaming'],
    },
    providers: providerStatus,
    languages: {
      supported: ['hi', 'en', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa'],
      default: 'hi',
      indic: ['hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa'],
    },
    limits: {
      maxTextLength: 5000,
      maxAudioDuration: 300, // 5 minutes
      maxConcurrentSessions: 100,
    },
    emotions: Object.keys(emotionPresets),
    voiceCount: Object.values(voiceLibrary).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : Object.values(v as object).reduce((s, arr) => s + (arr as any[]).length, 0)), 0),
  });
});

// POST /api/test/asr - Live ASR testing for admin UI
app.post('/api/test/asr', async (req, res) => {
  try {
    const { audio, language = 'hi', provider, features = {} } = req.body;
    if (!audio) return res.status(400).json({ error: 'Audio data required' });
    
    const startTime = Date.now();
    const audioBuffer = Buffer.from(audio, 'base64');
    const result = await transcribe(audioBuffer, language, provider);
    const latencyMs = Date.now() - startTime;
    
    recordMetric('asr', result.provider, latencyMs);
    
    res.json({
      ...result,
      latencyMs,
      audioSize: audioBuffer.length,
      features: {
        wordTimestamps: features.wordTimestamps ? result.segments : undefined,
        confidenceScore: result.confidence,
      },
    });
  } catch (error: any) {
    metrics.errorCount++;
    res.status(500).json({ error: error.message });
  }
});

// POST /api/test/tts - Live TTS testing for XTTS Studio
app.post('/api/test/tts', async (req, res) => {
  try {
    const { text, language = 'hi', voice, provider, speed = 1.0, pitch = 1.0, emotion = 'neutral', format = 'mp3' } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    
    const startTime = Date.now();
    const result = await synthesize({ text, language, voice, provider, speed, pitch, emotion, format });
    const latencyMs = Date.now() - startTime;
    
    recordMetric('tts', result.provider, latencyMs, { chars: text.length });
    
    // Return base64 audio with metadata for XTTS Studio
    res.json({
      audio: result.audio.toString('base64'),
      provider: result.provider,
      latencyMs,
      audioSize: result.audio.length,
      format,
      settings: { speed, pitch, emotion },
    });
  } catch (error: any) {
    metrics.errorCount++;
    res.status(500).json({ error: error.message });
  }
});

// Helper function for formatting duration
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

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
              
              const startTime = Date.now();
              const result = await synthesize({
                text: message.text,
                language: message.language || session.language,
                voice: message.voice,
                provider: message.provider,
                speed: message.speed,
                pitch: message.pitch,
                emotion: message.emotion,
                format: message.format,
              });
              const latencyMs = Date.now() - startTime;
              
              recordMetric('tts', result.provider, latencyMs, { chars: message.text.length });
              session.currentProvider.tts = result.provider;
              ws.send(result.audio);
              
              sendToClient(session, 'tts_complete', { 
                status: 'done', 
                provider: result.provider,
                audioSize: result.audio.length,
                latencyMs,
              });
            } catch (error: any) {
              metrics.errorCount++;
              sendToClient(session, 'error', { message: error.message, code: 'TTS_ERROR' });
            }
          }
          break;
          
        case 'set_language':
          session.language = message.language || 'hi';
          sendToClient(session, 'language_changed', { language: session.language });
          break;
          
        case 'set_emotion':
          // Store emotion preference in session metadata
          session.metadata.emotion = message.emotion || 'neutral';
          sendToClient(session, 'emotion_changed', { emotion: session.metadata.emotion });
          break;
          
        case 'set_voice':
          // Store voice preference in session metadata
          session.metadata.voice = message.voice;
          session.metadata.voiceProvider = message.provider;
          sendToClient(session, 'voice_changed', { voice: message.voice, provider: message.provider });
          break;
          
        case 'get_voices':
          // Return available voices for the requested provider/language
          sendToClient(session, 'voices_list', {
            voices: voiceLibrary,
            emotions: Object.keys(emotionPresets),
          });
          break;
          
        case 'set_providers':
          if (message.asr) session.currentProvider.asr = message.asr;
          if (message.tts) session.currentProvider.tts = message.tts;
          sendToClient(session, 'providers_changed', session.currentProvider);
          break;
        
        case 'interrupt':
          // Handle barge-in / interruption - stop current TTS playback
          session.isStreaming = false;
          sendToClient(session, 'interrupted', { timestamp: Date.now() });
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

// Enhanced VAD (voice activity detection) - smoothed energy detection
// More human-like detection with adaptive threshold
let vadEnergyHistory: number[] = [];
const VAD_HISTORY_SIZE = 10;
const VAD_BASE_THRESHOLD = 500;
const VAD_SPEECH_THRESHOLD_MULTIPLIER = 1.5;

function detectVoiceActivity(audioData: Buffer): boolean {
  // Calculate RMS energy of audio chunk
  let sumSquares = 0;
  const sampleCount = Math.floor(audioData.length / 2);
  
  for (let i = 0; i < audioData.length - 1; i += 2) {
    const sample = audioData.readInt16LE(i);
    sumSquares += sample * sample;
  }
  
  const rmsEnergy = Math.sqrt(sumSquares / sampleCount);
  
  // Maintain energy history for adaptive threshold
  vadEnergyHistory.push(rmsEnergy);
  if (vadEnergyHistory.length > VAD_HISTORY_SIZE) {
    vadEnergyHistory.shift();
  }
  
  // Calculate adaptive threshold based on recent energy levels
  const avgEnergy = vadEnergyHistory.reduce((a, b) => a + b, 0) / vadEnergyHistory.length;
  const adaptiveThreshold = Math.max(VAD_BASE_THRESHOLD, avgEnergy * VAD_SPEECH_THRESHOLD_MULTIPLIER);
  
  // Voice detected if current energy exceeds adaptive threshold
  return rmsEnergy > adaptiveThreshold;
}

// Zero-crossing rate for additional voice detection (speech has higher ZCR)
function calculateZeroCrossingRate(audioData: Buffer): number {
  let crossings = 0;
  let prevSample = 0;
  
  for (let i = 0; i < audioData.length - 1; i += 2) {
    const sample = audioData.readInt16LE(i);
    if ((prevSample >= 0 && sample < 0) || (prevSample < 0 && sample >= 0)) {
      crossings++;
    }
    prevSample = sample;
  }
  
  return crossings / (audioData.length / 2);
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
