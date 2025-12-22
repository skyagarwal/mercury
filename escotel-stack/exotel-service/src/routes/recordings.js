/**
 * Call Recording Routes
 * 
 * Endpoints for recording management:
 * - Recording retrieval and playback
 * - Transcription
 * - Analysis integration
 * - Statistics
 */

import express from 'express';
import {
  RECORDING_SETTINGS,
  RECORDING_STATUS,
  initRecording,
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
  handleRecordingComplete,
  cleanupOldRecordings
} from '../services/recording.service.js';

const router = express.Router();

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * GET /recordings/config
 * Get recording configuration
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    settings: RECORDING_SETTINGS,
    statuses: RECORDING_STATUS
  });
});

// ============================================================================
// RECORDING MANAGEMENT
// ============================================================================

/**
 * POST /recordings/init
 * Initialize a recording (called at start of call)
 */
router.post('/init', async (req, res) => {
  try {
    const { callSid, orderId, customerId, agentId, callType, metadata } = req.body;
    
    if (!callSid) {
      return res.status(400).json({
        success: false,
        error: 'callSid is required'
      });
    }
    
    const recording = await initRecording({
      callSid,
      orderId,
      customerId,
      agentId,
      callType,
      metadata
    });
    
    res.json({
      success: true,
      recording
    });
    
  } catch (error) {
    console.error('Init recording error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize recording',
      message: error.message
    });
  }
});

/**
 * GET /recordings/:recordingId
 * Get recording details
 */
router.get('/:recordingId', (req, res) => {
  const { recordingId } = req.params;
  
  const recording = getRecording(recordingId);
  
  if (!recording) {
    return res.status(404).json({
      success: false,
      error: 'Recording not found'
    });
  }
  
  res.json({
    success: true,
    recording
  });
});

/**
 * GET /recordings/call/:callSid
 * Get recording by call SID
 */
router.get('/call/:callSid', (req, res) => {
  const { callSid } = req.params;
  
  const recording = getRecordingByCallSid(callSid);
  
  if (!recording) {
    return res.status(404).json({
      success: false,
      error: 'Recording not found for this call'
    });
  }
  
  res.json({
    success: true,
    recording
  });
});

/**
 * GET /recordings
 * Get all recordings with filters
 */
router.get('/', (req, res) => {
  const { orderId, customerId, agentId, status, startDate, endDate, limit } = req.query;
  
  let recordings = getAllRecordings({
    orderId,
    customerId,
    agentId,
    status,
    startDate,
    endDate
  });
  
  // Apply limit
  if (limit) {
    recordings = recordings.slice(0, parseInt(limit));
  }
  
  res.json({
    success: true,
    count: recordings.length,
    recordings
  });
});

/**
 * GET /recordings/:recordingId/playback
 * Get playback URL for a recording
 */
router.get('/:recordingId/playback', async (req, res) => {
  try {
    const { recordingId } = req.params;
    
    const result = await getPlaybackUrl(recordingId);
    
    res.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('Get playback URL error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get playback URL',
      message: error.message
    });
  }
});

// ============================================================================
// TRANSCRIPTION
// ============================================================================

/**
 * POST /recordings/:recordingId/transcribe
 * Transcribe a recording
 */
router.post('/:recordingId/transcribe', async (req, res) => {
  try {
    const { recordingId } = req.params;
    
    const recording = await transcribeRecording(recordingId);
    
    res.json({
      success: true,
      message: 'Transcription complete',
      recording: {
        id: recording.id,
        transcriptStatus: recording.transcriptStatus,
        transcribedAt: recording.transcribedAt
      }
    });
    
  } catch (error) {
    console.error('Transcription error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to transcribe recording',
      message: error.message
    });
  }
});

/**
 * GET /recordings/:recordingId/transcript
 * Get transcript for a recording
 */
router.get('/:recordingId/transcript', (req, res) => {
  const { recordingId } = req.params;
  
  const result = getTranscript(recordingId);
  
  if (!result) {
    return res.status(404).json({
      success: false,
      error: 'Recording or transcript not found'
    });
  }
  
  res.json({
    success: true,
    ...result
  });
});

// ============================================================================
// ANALYSIS
// ============================================================================

/**
 * POST /recordings/:recordingId/analyze
 * Analyze a recording with CQA
 */
router.post('/:recordingId/analyze', async (req, res) => {
  try {
    const { recordingId } = req.params;
    
    const result = await analyzeRecording(recordingId);
    
    res.json(result);
    
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze recording',
      message: error.message
    });
  }
});

/**
 * POST /recordings/:recordingId/full-process
 * Full processing: transcribe + analyze
 */
router.post('/:recordingId/full-process', async (req, res) => {
  try {
    const { recordingId } = req.params;
    
    // Transcribe
    await transcribeRecording(recordingId);
    
    // Then analyze
    const analysisResult = await analyzeRecording(recordingId);
    
    const recording = getRecording(recordingId);
    
    res.json({
      success: true,
      message: 'Full processing complete',
      recording: {
        id: recording.id,
        status: recording.status,
        transcriptStatus: recording.transcriptStatus,
        qualityScore: recording.qualityScore,
        sentiment: recording.sentiment
      },
      analysis: analysisResult.analysis
    });
    
  } catch (error) {
    console.error('Full process error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Processing failed',
      message: error.message
    });
  }
});

// ============================================================================
// ORDER & CUSTOMER RECORDINGS
// ============================================================================

/**
 * GET /recordings/order/:orderId
 * Get all recordings for an order
 */
router.get('/order/:orderId', (req, res) => {
  const { orderId } = req.params;
  
  const recordings = getOrderRecordings(orderId);
  
  res.json({
    success: true,
    orderId,
    count: recordings.length,
    recordings
  });
});

/**
 * GET /recordings/customer/:customerId
 * Get all recordings for a customer
 */
router.get('/customer/:customerId', (req, res) => {
  const { customerId } = req.params;
  
  const recordings = getCustomerRecordings(customerId);
  
  res.json({
    success: true,
    customerId,
    count: recordings.length,
    recordings
  });
});

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * GET /recordings/stats
 * Get recording statistics
 */
router.get('/stats/summary', (req, res) => {
  const { startDate, endDate, agentId } = req.query;
  
  const stats = getRecordingStats({
    startDate,
    endDate,
    agentId
  });
  
  res.json({
    success: true,
    stats,
    filters: { startDate, endDate, agentId }
  });
});

/**
 * GET /recordings/stats/by-agent
 * Get recording stats grouped by agent
 */
router.get('/stats/by-agent', (req, res) => {
  const recordings = getAllRecordings();
  
  const byAgent = {};
  
  recordings.forEach(r => {
    const agentId = r.agentId || 'unassigned';
    
    if (!byAgent[agentId]) {
      byAgent[agentId] = {
        agentId,
        totalRecordings: 0,
        totalDuration: 0,
        transcribed: 0,
        analyzed: 0,
        avgQualityScore: 0,
        qualityScores: []
      };
    }
    
    byAgent[agentId].totalRecordings++;
    byAgent[agentId].totalDuration += r.duration || 0;
    if (r.transcript) byAgent[agentId].transcribed++;
    if (r.analysisId) byAgent[agentId].analyzed++;
    if (r.qualityScore) byAgent[agentId].qualityScores.push(r.qualityScore);
  });
  
  // Calculate averages
  Object.values(byAgent).forEach(agent => {
    if (agent.qualityScores.length > 0) {
      agent.avgQualityScore = Math.round(
        agent.qualityScores.reduce((a, b) => a + b, 0) / agent.qualityScores.length
      );
    }
    delete agent.qualityScores;
    agent.avgDuration = agent.totalRecordings > 0 
      ? Math.round(agent.totalDuration / agent.totalRecordings) 
      : 0;
  });
  
  res.json({
    success: true,
    agents: Object.values(byAgent)
  });
});

// ============================================================================
// WEBHOOKS
// ============================================================================

/**
 * POST /recordings/webhook/complete
 * Handle recording completion webhook from Exotel
 */
router.post('/webhook/complete', async (req, res) => {
  console.log('🎙️ Recording webhook received:', req.body);
  
  try {
    const recording = await handleRecordingComplete(req.body);
    
    res.json({
      success: true,
      recordingId: recording.id
    });
    
  } catch (error) {
    console.error('Recording webhook error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// MAINTENANCE
// ============================================================================

/**
 * POST /recordings/cleanup
 * Cleanup old recordings (admin only)
 */
router.post('/cleanup', (req, res) => {
  const result = cleanupOldRecordings();
  
  res.json({
    success: true,
    ...result,
    retentionDays: RECORDING_SETTINGS.RETENTION_DAYS
  });
});

export default router;
