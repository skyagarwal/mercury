/**
 * Conversation Quality Analysis (CQA) Routes
 * 
 * Endpoints for AI-powered call analytics:
 * - Analyze call transcripts
 * - Get quality scores and sentiment
 * - Generate reports and insights
 * - Agent performance tracking
 */

import express from 'express';
import {
  SENTIMENT,
  QUALITY_DIMENSIONS,
  ALERT_TYPES,
  analyzeCall,
  analyzeCallBatch,
  getAnalysis,
  getAllAnalyses,
  getAggregateStats,
  getAgentPerformance
} from '../services/cqa.service.js';

const router = express.Router();

// ============================================================================
// CONFIGURATION ENDPOINTS
// ============================================================================

/**
 * GET /cqa/config
 * Get CQA configuration and available options
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: {
      sentiments: SENTIMENT,
      qualityDimensions: QUALITY_DIMENSIONS,
      alertTypes: ALERT_TYPES
    }
  });
});

// ============================================================================
// ANALYSIS ENDPOINTS
// ============================================================================

/**
 * POST /cqa/analyze
 * Analyze a call transcript
 */
router.post('/analyze', async (req, res) => {
  try {
    const {
      callSid,
      transcript,
      duration,
      agentId,
      customerId,
      orderId,
      metadata
    } = req.body;
    
    if (!callSid) {
      return res.status(400).json({
        success: false,
        error: 'callSid is required'
      });
    }
    
    if (!transcript || transcript.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'transcript is required (minimum 10 characters)'
      });
    }
    
    const result = await analyzeCall({
      callSid,
      transcript,
      duration,
      agentId,
      customerId,
      orderId,
      metadata
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze call',
      message: error.message
    });
  }
});

/**
 * POST /cqa/analyze/batch
 * Analyze multiple calls
 */
router.post('/analyze/batch', async (req, res) => {
  try {
    const { calls } = req.body;
    
    if (!Array.isArray(calls) || calls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'calls array is required'
      });
    }
    
    if (calls.length > 20) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 20 calls per batch'
      });
    }
    
    const result = await analyzeCallBatch(calls);
    
    res.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('Batch analysis error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze batch',
      message: error.message
    });
  }
});

/**
 * GET /cqa/analysis/:callSid
 * Get analysis for a specific call
 */
router.get('/analysis/:callSid', (req, res) => {
  const { callSid } = req.params;
  
  const analysis = getAnalysis(callSid);
  
  if (!analysis) {
    return res.status(404).json({
      success: false,
      error: 'Analysis not found'
    });
  }
  
  res.json({
    success: true,
    analysis
  });
});

/**
 * GET /cqa/analyses
 * Get all analyses with optional filters
 */
router.get('/analyses', (req, res) => {
  const { limit, sentiment, minScore, maxScore } = req.query;
  
  let analyses = getAllAnalyses();
  
  // Apply filters
  if (sentiment) {
    analyses = analyses.filter(a => a.sentiment === sentiment);
  }
  if (minScore) {
    analyses = analyses.filter(a => a.qualityScore >= parseInt(minScore));
  }
  if (maxScore) {
    analyses = analyses.filter(a => a.qualityScore <= parseInt(maxScore));
  }
  
  // Sort by date descending
  analyses.sort((a, b) => new Date(b.analyzedAt) - new Date(a.analyzedAt));
  
  // Apply limit
  if (limit) {
    analyses = analyses.slice(0, parseInt(limit));
  }
  
  res.json({
    success: true,
    count: analyses.length,
    analyses
  });
});

// ============================================================================
// STATISTICS & REPORTS
// ============================================================================

/**
 * GET /cqa/stats
 * Get aggregate statistics
 */
router.get('/stats', (req, res) => {
  const { startDate, endDate, agentId } = req.query;
  
  const stats = getAggregateStats({
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
 * GET /cqa/stats/sentiment
 * Get sentiment breakdown
 */
router.get('/stats/sentiment', (req, res) => {
  const stats = getAggregateStats();
  
  const total = Object.values(stats.sentimentBreakdown).reduce((a, b) => a + b, 0);
  
  const breakdown = {};
  Object.entries(stats.sentimentBreakdown).forEach(([sentiment, count]) => {
    breakdown[sentiment] = {
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    };
  });
  
  res.json({
    success: true,
    totalCalls: total,
    breakdown
  });
});

/**
 * GET /cqa/stats/quality
 * Get quality score distribution
 */
router.get('/stats/quality', (req, res) => {
  const analyses = getAllAnalyses();
  
  const distribution = {
    excellent: 0,  // 80-100
    good: 0,       // 60-79
    average: 0,    // 40-59
    poor: 0        // 0-39
  };
  
  analyses.forEach(a => {
    const score = a.qualityScore || 0;
    if (score >= 80) distribution.excellent++;
    else if (score >= 60) distribution.good++;
    else if (score >= 40) distribution.average++;
    else distribution.poor++;
  });
  
  res.json({
    success: true,
    totalCalls: analyses.length,
    distribution,
    averageScore: analyses.length > 0 
      ? Math.round(analyses.reduce((sum, a) => sum + (a.qualityScore || 0), 0) / analyses.length)
      : 0
  });
});

/**
 * GET /cqa/stats/alerts
 * Get alert statistics
 */
router.get('/stats/alerts', (req, res) => {
  const stats = getAggregateStats();
  
  const totalAlerts = Object.values(stats.alertCounts).reduce((a, b) => a + b, 0);
  
  res.json({
    success: true,
    totalAlerts,
    byType: stats.alertCounts,
    alertTypes: ALERT_TYPES
  });
});

/**
 * GET /cqa/stats/dimensions
 * Get quality dimension averages
 */
router.get('/stats/dimensions', (req, res) => {
  const stats = getAggregateStats();
  
  res.json({
    success: true,
    dimensions: QUALITY_DIMENSIONS,
    averages: stats.averageDimensions,
    totalCalls: stats.totalCalls
  });
});

// ============================================================================
// AGENT PERFORMANCE
// ============================================================================

/**
 * GET /cqa/agent/:agentId
 * Get agent performance report
 */
router.get('/agent/:agentId', (req, res) => {
  const { agentId } = req.params;
  
  const performance = getAgentPerformance(agentId);
  
  res.json({
    success: true,
    performance
  });
});

/**
 * GET /cqa/agents/leaderboard
 * Get agent leaderboard
 */
router.get('/agents/leaderboard', (req, res) => {
  const analyses = getAllAnalyses();
  
  // Group by agent
  const agentStats = {};
  analyses.forEach(a => {
    if (!a.agentId) return;
    
    if (!agentStats[a.agentId]) {
      agentStats[a.agentId] = {
        agentId: a.agentId,
        callCount: 0,
        totalScore: 0,
        positiveCount: 0,
        alertCount: 0
      };
    }
    
    agentStats[a.agentId].callCount++;
    agentStats[a.agentId].totalScore += a.qualityScore || 0;
    if (a.sentiment === SENTIMENT.POSITIVE) agentStats[a.agentId].positiveCount++;
    agentStats[a.agentId].alertCount += (a.alerts || []).length;
  });
  
  // Calculate averages and rank
  const leaderboard = Object.values(agentStats)
    .map(agent => ({
      ...agent,
      averageScore: agent.callCount > 0 ? Math.round(agent.totalScore / agent.callCount) : 0,
      positiveRate: agent.callCount > 0 ? Math.round((agent.positiveCount / agent.callCount) * 100) : 0
    }))
    .sort((a, b) => b.averageScore - a.averageScore);
  
  res.json({
    success: true,
    count: leaderboard.length,
    leaderboard
  });
});

// ============================================================================
// ALERTS & INSIGHTS
// ============================================================================

/**
 * GET /cqa/alerts
 * Get recent alerts
 */
router.get('/alerts', (req, res) => {
  const { type, severity, limit } = req.query;
  
  const analyses = getAllAnalyses();
  
  let allAlerts = [];
  analyses.forEach(a => {
    (a.alerts || []).forEach(alert => {
      allAlerts.push({
        ...alert,
        callSid: a.callSid,
        orderId: a.orderId,
        customerId: a.customerId
      });
    });
  });
  
  // Filter
  if (type) {
    allAlerts = allAlerts.filter(a => a.type === type);
  }
  if (severity) {
    allAlerts = allAlerts.filter(a => a.severity === severity);
  }
  
  // Sort by timestamp descending
  allAlerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Apply limit
  if (limit) {
    allAlerts = allAlerts.slice(0, parseInt(limit));
  }
  
  res.json({
    success: true,
    count: allAlerts.length,
    alerts: allAlerts
  });
});

/**
 * GET /cqa/insights
 * Get aggregated insights
 */
router.get('/insights', (req, res) => {
  const analyses = getAllAnalyses();
  
  const insights = {
    totalCalls: analyses.length,
    topIssues: [],
    recommendations: [],
    trends: {}
  };
  
  // Count patterns
  const patternCounts = {};
  analyses.forEach(a => {
    Object.entries(a.detectedPatterns || {}).forEach(([pattern, detected]) => {
      if (detected) {
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
      }
    });
  });
  
  // Top issues
  insights.topIssues = Object.entries(patternCounts)
    .map(([pattern, count]) => ({
      pattern,
      count,
      percentage: Math.round((count / analyses.length) * 100)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  // Generate recommendations
  const stats = getAggregateStats();
  
  if (stats.averageQualityScore < 70) {
    insights.recommendations.push({
      priority: 'high',
      message: 'Average quality score is below target. Consider additional training.'
    });
  }
  
  if (stats.sentimentBreakdown.negative > stats.sentimentBreakdown.positive) {
    insights.recommendations.push({
      priority: 'high',
      message: 'Negative sentiment exceeds positive. Review common complaints.'
    });
  }
  
  if (patternCounts.escalationRequested > analyses.length * 0.1) {
    insights.recommendations.push({
      priority: 'medium',
      message: 'High escalation rate detected. Empower agents with more resolution authority.'
    });
  }
  
  res.json({
    success: true,
    insights
  });
});

// ============================================================================
// REAL-TIME ANALYSIS (for live calls)
// ============================================================================

/**
 * POST /cqa/realtime/sentiment
 * Quick sentiment check for live call monitoring
 */
router.post('/realtime/sentiment', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'text is required'
      });
    }
    
    // Quick basic analysis for real-time feedback
    const lower = text.toLowerCase();
    
    const negativeWords = ['frustrated', 'angry', 'upset', 'terrible', 'worst'];
    const positiveWords = ['thank', 'great', 'excellent', 'helpful', 'happy'];
    
    let sentiment = SENTIMENT.NEUTRAL;
    let score = 0.5;
    
    negativeWords.forEach(w => {
      if (lower.includes(w)) {
        sentiment = SENTIMENT.NEGATIVE;
        score = Math.max(0, score - 0.15);
      }
    });
    
    positiveWords.forEach(w => {
      if (lower.includes(w)) {
        sentiment = sentiment === SENTIMENT.NEGATIVE ? SENTIMENT.MIXED : SENTIMENT.POSITIVE;
        score = Math.min(1, score + 0.15);
      }
    });
    
    res.json({
      success: true,
      sentiment,
      score,
      realtime: true
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Analysis failed',
      message: error.message
    });
  }
});

export default router;
