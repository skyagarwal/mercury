/**
 * Call Recording & Voice Logger Service
 * 
 * Comprehensive call recording management:
 * - Automatic recording of all calls
 * - Recording storage and retrieval
 * - Playback URLs
 * - Transcription integration
 * - Compliance (recording disclosure)
 * - Storage management
 */

import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { emitEvent } from '../utils/events.js';
import NodeCache from 'node-cache';
import { updateOrderNotes } from './jupiter.service.js';
import { analyzeCall } from './cqa.service.js';

// Recording cache (TTL: 90 days)
const recordingCache = new NodeCache({ stdTTL: 7776000, checkperiod: 86400 });

// ============================================================================
// CONFIGURATION
// ============================================================================

// Recording settings
export const RECORDING_SETTINGS = {
  DEFAULT_FORMAT: 'mp3',
  MAX_DURATION: 3600,         // 1 hour max
  RETENTION_DAYS: 90,         // Keep recordings for 90 days
  AUTO_TRANSCRIBE: true,      // Auto-transcribe recordings
  AUTO_ANALYZE: true          // Auto-analyze with CQA
};

// Recording status
export const RECORDING_STATUS = {
  PENDING: 'pending',
  RECORDING: 'recording',
  COMPLETED: 'completed',
  PROCESSING: 'processing',
  TRANSCRIBED: 'transcribed',
  ANALYZED: 'analyzed',
  FAILED: 'failed',
  DELETED: 'deleted'
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
    sid
  };
}

// ASR service for transcription
const ASR_URL = process.env.ASR_URL || 'http://192.168.0.151:7000';

// ============================================================================
// RECORDING MANAGEMENT
// ============================================================================

/**
 * Initialize recording for a call
 */
export async function initRecording(params) {
  const {
    callSid,
    orderId,
    customerId,
    agentId,
    callType = 'inbound',
    metadata = {}
  } = params;
  
  const recording = {
    id: `rec_${callSid}`,
    callSid,
    orderId,
    customerId,
    agentId,
    callType,
    status: RECORDING_STATUS.PENDING,
    startedAt: new Date().toISOString(),
    duration: 0,
    recordingUrl: null,
    playbackUrl: null,
    transcript: null,
    transcriptStatus: 'pending',
    analysisId: null,
    metadata,
    createdAt: new Date().toISOString()
  };
  
  recordingCache.set(recording.id, recording);
  
  emitEvent({
    type: 'recording.initialized',
    at: new Date().toISOString(),
    recordingId: recording.id,
    callSid
  });
  
  console.log(`🎙️ Recording initialized: ${recording.id}`);
  
  return recording;
}

/**
 * Update recording status when recording starts
 */
export function startRecording(callSid) {
  const recordingId = `rec_${callSid}`;
  const recording = recordingCache.get(recordingId);
  
  if (!recording) {
    return initRecording({ callSid }).then(r => {
      r.status = RECORDING_STATUS.RECORDING;
      recordingCache.set(r.id, r);
      return r;
    });
  }
  
  recording.status = RECORDING_STATUS.RECORDING;
  recording.recordingStartedAt = new Date().toISOString();
  recordingCache.set(recordingId, recording);
  
  console.log(`🔴 Recording started: ${recordingId}`);
  
  return recording;
}

/**
 * Handle recording completion callback
 */
export async function handleRecordingComplete(data) {
  const {
    CallSid,
    RecordingUrl,
    RecordingDuration,
    custom_field
  } = data;
  
  const recordingId = `rec_${CallSid}`;
  let recording = recordingCache.get(recordingId);
  
  if (!recording) {
    recording = await initRecording({ callSid: CallSid });
  }
  
  recording.status = RECORDING_STATUS.COMPLETED;
  recording.recordingUrl = RecordingUrl;
  recording.playbackUrl = RecordingUrl; // Exotel provides direct URL
  recording.duration = parseInt(RecordingDuration) || 0;
  recording.completedAt = new Date().toISOString();
  
  // Parse custom field for metadata
  try {
    const customData = JSON.parse(custom_field || '{}');
    recording.orderId = customData.orderId || recording.orderId;
    recording.customerId = customData.customerId || recording.customerId;
    recording.agentId = customData.agentId || recording.agentId;
  } catch (e) {}
  
  recordingCache.set(recordingId, recording);
  
  emitEvent({
    type: 'recording.completed',
    at: new Date().toISOString(),
    recordingId,
    callSid: CallSid,
    duration: recording.duration
  });
  
  console.log(`✅ Recording completed: ${recordingId} | Duration: ${recording.duration}s`);
  
  // Auto-transcribe if enabled
  if (RECORDING_SETTINGS.AUTO_TRANSCRIBE && RecordingUrl) {
    transcribeRecording(recordingId).catch(err => {
      console.error(`Auto-transcription failed: ${err.message}`);
    });
  }
  
  // Sync to Jupiter
  if (recording.orderId) {
    try {
      await updateOrderNotes(recording.orderId, {
        type: 'call_recording',
        recordingId,
        duration: recording.duration,
        recordingUrl: RecordingUrl
      });
    } catch (e) {
      console.warn('Jupiter sync failed:', e.message);
    }
  }
  
  return recording;
}

/**
 * Get recording by ID
 */
export function getRecording(recordingId) {
  return recordingCache.get(recordingId);
}

/**
 * Get recording by call SID
 */
export function getRecordingByCallSid(callSid) {
  return recordingCache.get(`rec_${callSid}`);
}

/**
 * Get all recordings
 */
export function getAllRecordings(filters = {}) {
  const keys = recordingCache.keys();
  let recordings = keys.map(key => recordingCache.get(key)).filter(r => r);
  
  // Apply filters
  if (filters.orderId) {
    recordings = recordings.filter(r => r.orderId === filters.orderId);
  }
  if (filters.customerId) {
    recordings = recordings.filter(r => r.customerId === filters.customerId);
  }
  if (filters.agentId) {
    recordings = recordings.filter(r => r.agentId === filters.agentId);
  }
  if (filters.status) {
    recordings = recordings.filter(r => r.status === filters.status);
  }
  if (filters.startDate) {
    recordings = recordings.filter(r => new Date(r.createdAt) >= new Date(filters.startDate));
  }
  if (filters.endDate) {
    recordings = recordings.filter(r => new Date(r.createdAt) <= new Date(filters.endDate));
  }
  
  // Sort by date descending
  recordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return recordings;
}

/**
 * Get recording playback URL
 */
export async function getPlaybackUrl(recordingId) {
  const recording = recordingCache.get(recordingId);
  
  if (!recording) {
    throw new Error(`Recording not found: ${recordingId}`);
  }
  
  if (recording.playbackUrl) {
    return {
      url: recording.playbackUrl,
      expiresAt: null // Exotel URLs don't expire
    };
  }
  
  // Fetch from Exotel if not cached
  const config = getExotelConfig();
  
  try {
    const response = await axios.get(
      `${config.baseUrl}/Recordings/${recording.callSid}`,
      { auth: config.auth }
    );
    
    const url = response.data.Recording?.Url;
    if (url) {
      recording.playbackUrl = url;
      recordingCache.set(recordingId, recording);
    }
    
    return { url };
  } catch (error) {
    console.error(`Failed to get playback URL: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// TRANSCRIPTION
// ============================================================================

/**
 * Transcribe a recording
 */
export async function transcribeRecording(recordingId) {
  const recording = recordingCache.get(recordingId);
  
  if (!recording) {
    throw new Error(`Recording not found: ${recordingId}`);
  }
  
  if (!recording.recordingUrl) {
    throw new Error(`Recording URL not available: ${recordingId}`);
  }
  
  recording.transcriptStatus = 'processing';
  recordingCache.set(recordingId, recording);
  
  console.log(`📝 Transcribing recording: ${recordingId}`);
  
  try {
    // Call Mangwale ASR service
    const response = await axios.post(`${ASR_URL}/transcribe-url`, {
      url: recording.recordingUrl,
      language: 'hi', // Hindi primary
      outputLanguage: 'en', // Output in English
      format: 'mp3'
    }, { timeout: 300000 }); // 5 min timeout for long recordings
    
    recording.transcript = response.data.transcript || response.data.text;
    recording.transcriptLanguage = response.data.language || 'en';
    recording.transcriptStatus = 'completed';
    recording.transcribedAt = new Date().toISOString();
    recording.status = RECORDING_STATUS.TRANSCRIBED;
    
    recordingCache.set(recordingId, recording);
    
    emitEvent({
      type: 'recording.transcribed',
      at: new Date().toISOString(),
      recordingId,
      transcriptLength: recording.transcript?.length || 0
    });
    
    console.log(`✅ Transcription complete: ${recordingId}`);
    
    // Auto-analyze if enabled
    if (RECORDING_SETTINGS.AUTO_ANALYZE && recording.transcript) {
      analyzeRecording(recordingId).catch(err => {
        console.error(`Auto-analysis failed: ${err.message}`);
      });
    }
    
    return recording;
    
  } catch (error) {
    console.error(`❌ Transcription failed: ${error.message}`);
    
    recording.transcriptStatus = 'failed';
    recording.transcriptError = error.message;
    recordingCache.set(recordingId, recording);
    
    throw error;
  }
}

/**
 * Get transcript for recording
 */
export function getTranscript(recordingId) {
  const recording = recordingCache.get(recordingId);
  
  if (!recording) {
    return null;
  }
  
  return {
    transcript: recording.transcript,
    status: recording.transcriptStatus,
    language: recording.transcriptLanguage,
    transcribedAt: recording.transcribedAt
  };
}

// ============================================================================
// ANALYSIS INTEGRATION
// ============================================================================

/**
 * Analyze a recording (CQA integration)
 */
export async function analyzeRecording(recordingId) {
  const recording = recordingCache.get(recordingId);
  
  if (!recording) {
    throw new Error(`Recording not found: ${recordingId}`);
  }
  
  if (!recording.transcript) {
    throw new Error(`Transcript not available for analysis: ${recordingId}`);
  }
  
  console.log(`🔍 Analyzing recording: ${recordingId}`);
  
  try {
    const analysisResult = await analyzeCall({
      callSid: recording.callSid,
      transcript: recording.transcript,
      duration: recording.duration,
      agentId: recording.agentId,
      customerId: recording.customerId,
      orderId: recording.orderId,
      metadata: recording.metadata
    });
    
    if (analysisResult.success) {
      recording.analysisId = recording.callSid;
      recording.qualityScore = analysisResult.analysis.qualityScore;
      recording.sentiment = analysisResult.analysis.sentiment;
      recording.status = RECORDING_STATUS.ANALYZED;
      recording.analyzedAt = new Date().toISOString();
      
      recordingCache.set(recordingId, recording);
      
      emitEvent({
        type: 'recording.analyzed',
        at: new Date().toISOString(),
        recordingId,
        qualityScore: recording.qualityScore
      });
    }
    
    return analysisResult;
    
  } catch (error) {
    console.error(`❌ Analysis failed: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get recording statistics
 */
export function getRecordingStats(filters = {}) {
  const recordings = getAllRecordings(filters);
  
  const stats = {
    total: recordings.length,
    totalDuration: 0,
    averageDuration: 0,
    byStatus: {},
    byCallType: {},
    transcribed: 0,
    analyzed: 0,
    averageQualityScore: 0
  };
  
  if (recordings.length === 0) return stats;
  
  let totalQuality = 0;
  let qualityCount = 0;
  
  recordings.forEach(r => {
    stats.totalDuration += r.duration || 0;
    
    // By status
    stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;
    
    // By call type
    stats.byCallType[r.callType] = (stats.byCallType[r.callType] || 0) + 1;
    
    // Transcribed
    if (r.transcript) stats.transcribed++;
    
    // Analyzed
    if (r.analysisId) stats.analyzed++;
    
    // Quality score
    if (r.qualityScore) {
      totalQuality += r.qualityScore;
      qualityCount++;
    }
  });
  
  stats.averageDuration = Math.round(stats.totalDuration / recordings.length);
  stats.averageQualityScore = qualityCount > 0 ? Math.round(totalQuality / qualityCount) : 0;
  
  return stats;
}

/**
 * Get recordings for an order
 */
export function getOrderRecordings(orderId) {
  return getAllRecordings({ orderId });
}

/**
 * Get recordings for a customer
 */
export function getCustomerRecordings(customerId) {
  return getAllRecordings({ customerId });
}

/**
 * Delete old recordings (retention policy)
 */
export function cleanupOldRecordings() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RECORDING_SETTINGS.RETENTION_DAYS);
  
  const keys = recordingCache.keys();
  let deleted = 0;
  
  keys.forEach(key => {
    const recording = recordingCache.get(key);
    if (recording && new Date(recording.createdAt) < cutoffDate) {
      recording.status = RECORDING_STATUS.DELETED;
      recording.deletedAt = new Date().toISOString();
      // Keep metadata but clear sensitive data
      recording.recordingUrl = null;
      recording.playbackUrl = null;
      recording.transcript = null;
      recordingCache.set(key, recording);
      deleted++;
    }
  });
  
  console.log(`🗑️ Cleaned up ${deleted} old recordings`);
  
  return { deleted };
}

export default {
  RECORDING_SETTINGS,
  RECORDING_STATUS,
  initRecording,
  startRecording,
  handleRecordingComplete,
  getRecording,
  getRecordingByCallSid,
  getAllRecordings,
  getPlaybackUrl,
  transcribeRecording,
  getTranscript,
  analyzeRecording,
  getRecordingStats,
  getOrderRecordings,
  getCustomerRecordings,
  cleanupOldRecordings
};
