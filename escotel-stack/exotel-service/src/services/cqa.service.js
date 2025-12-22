/**
 * Conversation Quality Analysis (CQA) Service
 * 
 * AI-powered call analytics for Mangwale:
 * - Sentiment analysis (positive/negative/neutral)
 * - Keyword detection
 * - Agent performance scoring
 * - Customer satisfaction prediction
 * - Compliance monitoring
 * - Call summarization
 * 
 * Leverages Mangwale's internal AI stack for analysis
 */

import axios from 'axios';
import { emitEvent } from '../utils/events.js';
import NodeCache from 'node-cache';
import { updateOrderNotes } from './jupiter.service.js';

// Analysis cache (TTL: 30 days)
const analysisCache = new NodeCache({ stdTTL: 2592000, checkperiod: 86400 });

// ============================================================================
// CONFIGURATION
// ============================================================================

// Sentiment labels
export const SENTIMENT = {
  POSITIVE: 'positive',
  NEUTRAL: 'neutral',
  NEGATIVE: 'negative',
  MIXED: 'mixed'
};

// Quality dimensions
export const QUALITY_DIMENSIONS = {
  CLARITY: 'clarity',           // Was communication clear?
  RESOLUTION: 'resolution',     // Was issue resolved?
  PROFESSIONALISM: 'professionalism',
  EMPATHY: 'empathy',
  EFFICIENCY: 'efficiency',     // Time to resolution
  COMPLIANCE: 'compliance'      // Script/policy adherence
};

// Alert types
export const ALERT_TYPES = {
  NEGATIVE_SENTIMENT: 'negative_sentiment',
  ESCALATION_DETECTED: 'escalation_detected',
  COMPLIANCE_VIOLATION: 'compliance_violation',
  LONG_HOLD_TIME: 'long_hold_time',
  CUSTOMER_DISSATISFIED: 'customer_dissatisfied',
  PROFANITY_DETECTED: 'profanity_detected'
};

// Keywords to detect
const DETECTION_KEYWORDS = {
  escalation: ['manager', 'supervisor', 'escalate', 'complaint', 'legal', 'lawyer', 'consumer forum'],
  frustration: ['frustrated', 'angry', 'upset', 'terrible', 'worst', 'unacceptable', 'ridiculous'],
  satisfaction: ['thank you', 'great', 'excellent', 'helpful', 'satisfied', 'happy', 'good service'],
  refund: ['refund', 'money back', 'cancel order', 'return', 'chargeback'],
  urgency: ['urgent', 'emergency', 'immediately', 'asap', 'right now', 'hurry'],
  compliance: ['recording', 'consent', 'privacy', 'data protection']
};

// AI Analysis endpoints (Mangwale internal)
const AI_ENDPOINTS = {
  sentiment: process.env.SENTIMENT_API_URL || 'http://192.168.0.151:8090/analyze/sentiment',
  summary: process.env.SUMMARY_API_URL || 'http://192.168.0.151:8090/analyze/summary',
  keywords: process.env.KEYWORDS_API_URL || 'http://192.168.0.151:8090/analyze/keywords'
};

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Analyze a call transcript
 * 
 * @param {Object} params - Analysis parameters
 * @param {string} params.callSid - Call identifier
 * @param {string} params.transcript - Full conversation transcript
 * @param {Object} params.metadata - Call metadata (orderId, customerId, etc.)
 * @returns {Object} - Analysis results
 */
export async function analyzeCall(params) {
  const {
    callSid,
    transcript,
    duration,
    agentId,
    customerId,
    orderId,
    metadata = {}
  } = params;
  
  if (!transcript || transcript.length < 10) {
    return {
      success: false,
      error: 'Transcript too short for analysis'
    };
  }
  
  console.log(`🔍 Analyzing call: ${callSid}`);
  
  const analysis = {
    callSid,
    agentId,
    customerId,
    orderId,
    duration,
    analyzedAt: new Date().toISOString(),
    sentiment: null,
    sentimentScore: 0,
    keywords: [],
    summary: '',
    qualityScore: 0,
    qualityDimensions: {},
    alerts: [],
    insights: [],
    metadata
  };
  
  try {
    // Run analyses in parallel
    const [sentimentResult, keywordsResult, summaryResult] = await Promise.all([
      analyzeSentiment(transcript),
      extractKeywords(transcript),
      generateSummary(transcript)
    ]);
    
    analysis.sentiment = sentimentResult.sentiment;
    analysis.sentimentScore = sentimentResult.score;
    analysis.sentimentBreakdown = sentimentResult.breakdown;
    
    analysis.keywords = keywordsResult.keywords;
    analysis.topics = keywordsResult.topics;
    analysis.entities = keywordsResult.entities;
    
    analysis.summary = summaryResult.summary;
    analysis.actionItems = summaryResult.actionItems;
    
    // Detect specific patterns
    analysis.detectedPatterns = detectPatterns(transcript);
    
    // Generate alerts based on analysis
    analysis.alerts = generateAlerts(analysis, transcript);
    
    // Calculate quality score
    const qualityResult = calculateQualityScore(analysis, transcript, duration);
    analysis.qualityScore = qualityResult.overall;
    analysis.qualityDimensions = qualityResult.dimensions;
    
    // Generate insights
    analysis.insights = generateInsights(analysis);
    
    // Cache analysis
    analysisCache.set(callSid, analysis);
    
    // Emit event
    emitEvent({
      type: 'cqa.analysis.completed',
      at: new Date().toISOString(),
      callSid,
      sentiment: analysis.sentiment,
      qualityScore: analysis.qualityScore,
      alertCount: analysis.alerts.length
    });
    
    // Sync to Jupiter if there are alerts
    if (analysis.alerts.length > 0 && orderId) {
      try {
        await updateOrderNotes(orderId, {
          type: 'cqa_alert',
          alerts: analysis.alerts,
          qualityScore: analysis.qualityScore
        });
      } catch (e) {
        console.warn('Jupiter sync failed:', e.message);
      }
    }
    
    console.log(`✅ Analysis complete: ${callSid} | Score: ${analysis.qualityScore} | Sentiment: ${analysis.sentiment}`);
    
    return {
      success: true,
      analysis
    };
    
  } catch (error) {
    console.error(`❌ Analysis failed: ${error.message}`);
    
    // Return basic analysis on error
    analysis.error = error.message;
    analysis.sentiment = detectBasicSentiment(transcript);
    analysis.keywords = extractBasicKeywords(transcript);
    analysis.qualityScore = 50; // Default middle score
    
    analysisCache.set(callSid, analysis);
    
    return {
      success: false,
      analysis,
      error: error.message
    };
  }
}

/**
 * Analyze sentiment using AI
 */
async function analyzeSentiment(transcript) {
  try {
    const response = await axios.post(AI_ENDPOINTS.sentiment, {
      text: transcript,
      language: 'en'
    }, { timeout: 10000 });
    
    return response.data;
  } catch (error) {
    console.warn('AI sentiment analysis failed, using basic:', error.message);
    return {
      sentiment: detectBasicSentiment(transcript),
      score: 0.5,
      breakdown: {}
    };
  }
}

/**
 * Extract keywords using AI
 */
async function extractKeywords(transcript) {
  try {
    const response = await axios.post(AI_ENDPOINTS.keywords, {
      text: transcript,
      maxKeywords: 10
    }, { timeout: 10000 });
    
    return response.data;
  } catch (error) {
    console.warn('AI keyword extraction failed, using basic:', error.message);
    return {
      keywords: extractBasicKeywords(transcript),
      topics: [],
      entities: []
    };
  }
}

/**
 * Generate summary using AI
 */
async function generateSummary(transcript) {
  try {
    const response = await axios.post(AI_ENDPOINTS.summary, {
      text: transcript,
      maxLength: 200
    }, { timeout: 15000 });
    
    return response.data;
  } catch (error) {
    console.warn('AI summary generation failed:', error.message);
    return {
      summary: transcript.substring(0, 200) + '...',
      actionItems: []
    };
  }
}

/**
 * Basic sentiment detection (fallback)
 */
function detectBasicSentiment(transcript) {
  const lower = transcript.toLowerCase();
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  DETECTION_KEYWORDS.satisfaction.forEach(kw => {
    if (lower.includes(kw)) positiveCount++;
  });
  
  DETECTION_KEYWORDS.frustration.forEach(kw => {
    if (lower.includes(kw)) negativeCount++;
  });
  
  if (positiveCount > negativeCount + 1) return SENTIMENT.POSITIVE;
  if (negativeCount > positiveCount + 1) return SENTIMENT.NEGATIVE;
  if (positiveCount > 0 && negativeCount > 0) return SENTIMENT.MIXED;
  return SENTIMENT.NEUTRAL;
}

/**
 * Basic keyword extraction (fallback)
 */
function extractBasicKeywords(transcript) {
  const lower = transcript.toLowerCase();
  const keywords = [];
  
  Object.entries(DETECTION_KEYWORDS).forEach(([category, words]) => {
    words.forEach(word => {
      if (lower.includes(word) && !keywords.includes(word)) {
        keywords.push(word);
      }
    });
  });
  
  return keywords.slice(0, 10);
}

/**
 * Detect specific patterns in transcript
 */
function detectPatterns(transcript) {
  const lower = transcript.toLowerCase();
  const patterns = {
    escalationRequested: false,
    refundRequested: false,
    urgentIssue: false,
    customerFrustrated: false,
    customerSatisfied: false,
    complianceMentioned: false
  };
  
  DETECTION_KEYWORDS.escalation.forEach(kw => {
    if (lower.includes(kw)) patterns.escalationRequested = true;
  });
  
  DETECTION_KEYWORDS.refund.forEach(kw => {
    if (lower.includes(kw)) patterns.refundRequested = true;
  });
  
  DETECTION_KEYWORDS.urgency.forEach(kw => {
    if (lower.includes(kw)) patterns.urgentIssue = true;
  });
  
  DETECTION_KEYWORDS.frustration.forEach(kw => {
    if (lower.includes(kw)) patterns.customerFrustrated = true;
  });
  
  DETECTION_KEYWORDS.satisfaction.forEach(kw => {
    if (lower.includes(kw)) patterns.customerSatisfied = true;
  });
  
  DETECTION_KEYWORDS.compliance.forEach(kw => {
    if (lower.includes(kw)) patterns.complianceMentioned = true;
  });
  
  return patterns;
}

/**
 * Generate alerts based on analysis
 */
function generateAlerts(analysis, transcript) {
  const alerts = [];
  
  // Negative sentiment alert
  if (analysis.sentiment === SENTIMENT.NEGATIVE || analysis.sentimentScore < 0.3) {
    alerts.push({
      type: ALERT_TYPES.NEGATIVE_SENTIMENT,
      severity: 'high',
      message: 'Customer expressed significant negative sentiment',
      timestamp: new Date().toISOString()
    });
  }
  
  // Escalation detection
  if (analysis.detectedPatterns?.escalationRequested) {
    alerts.push({
      type: ALERT_TYPES.ESCALATION_DETECTED,
      severity: 'high',
      message: 'Customer requested escalation to manager/supervisor',
      timestamp: new Date().toISOString()
    });
  }
  
  // Frustration detection
  if (analysis.detectedPatterns?.customerFrustrated) {
    alerts.push({
      type: ALERT_TYPES.CUSTOMER_DISSATISFIED,
      severity: 'medium',
      message: 'Customer expressed frustration during call',
      timestamp: new Date().toISOString()
    });
  }
  
  // Check for profanity (basic)
  const profanityWords = ['damn', 'hell', 'stupid', 'idiot', 'useless'];
  const lower = transcript.toLowerCase();
  if (profanityWords.some(w => lower.includes(w))) {
    alerts.push({
      type: ALERT_TYPES.PROFANITY_DETECTED,
      severity: 'low',
      message: 'Potentially inappropriate language detected',
      timestamp: new Date().toISOString()
    });
  }
  
  return alerts;
}

/**
 * Calculate quality score
 */
function calculateQualityScore(analysis, transcript, duration) {
  const dimensions = {};
  
  // Clarity score (based on transcript length vs duration)
  const wordsPerSecond = transcript.split(' ').length / (duration || 60);
  dimensions[QUALITY_DIMENSIONS.CLARITY] = Math.min(100, Math.max(0, 
    wordsPerSecond > 1 && wordsPerSecond < 4 ? 80 : 50
  ));
  
  // Resolution score (based on positive keywords at end)
  const lastPart = transcript.slice(-200).toLowerCase();
  const resolutionKeywords = ['resolved', 'done', 'completed', 'thank you', 'helped'];
  const resolutionHits = resolutionKeywords.filter(k => lastPart.includes(k)).length;
  dimensions[QUALITY_DIMENSIONS.RESOLUTION] = Math.min(100, 50 + (resolutionHits * 15));
  
  // Professionalism (absence of negative patterns)
  dimensions[QUALITY_DIMENSIONS.PROFESSIONALISM] = analysis.detectedPatterns?.customerFrustrated ? 60 : 85;
  
  // Empathy (presence of empathy keywords)
  const empathyKeywords = ['understand', 'sorry', 'apologize', 'help you', 'let me'];
  const empathyHits = empathyKeywords.filter(k => transcript.toLowerCase().includes(k)).length;
  dimensions[QUALITY_DIMENSIONS.EMPATHY] = Math.min(100, 50 + (empathyHits * 10));
  
  // Efficiency (based on duration - optimal is 2-5 mins)
  const durationMins = (duration || 60) / 60;
  dimensions[QUALITY_DIMENSIONS.EFFICIENCY] = durationMins >= 2 && durationMins <= 5 ? 90 : 
    durationMins < 2 ? 70 : Math.max(50, 90 - (durationMins - 5) * 5);
  
  // Compliance (default high unless issues detected)
  dimensions[QUALITY_DIMENSIONS.COMPLIANCE] = analysis.alerts.some(a => 
    a.type === ALERT_TYPES.COMPLIANCE_VIOLATION
  ) ? 40 : 95;
  
  // Calculate overall score (weighted average)
  const weights = {
    [QUALITY_DIMENSIONS.CLARITY]: 0.15,
    [QUALITY_DIMENSIONS.RESOLUTION]: 0.25,
    [QUALITY_DIMENSIONS.PROFESSIONALISM]: 0.20,
    [QUALITY_DIMENSIONS.EMPATHY]: 0.15,
    [QUALITY_DIMENSIONS.EFFICIENCY]: 0.10,
    [QUALITY_DIMENSIONS.COMPLIANCE]: 0.15
  };
  
  let overall = 0;
  Object.entries(weights).forEach(([dim, weight]) => {
    overall += (dimensions[dim] || 50) * weight;
  });
  
  // Adjust for sentiment
  if (analysis.sentiment === SENTIMENT.POSITIVE) overall = Math.min(100, overall + 5);
  if (analysis.sentiment === SENTIMENT.NEGATIVE) overall = Math.max(0, overall - 10);
  
  return {
    overall: Math.round(overall),
    dimensions
  };
}

/**
 * Generate insights from analysis
 */
function generateInsights(analysis) {
  const insights = [];
  
  if (analysis.qualityScore >= 80) {
    insights.push({
      type: 'positive',
      message: 'Excellent call handling with high customer satisfaction'
    });
  }
  
  if (analysis.detectedPatterns?.refundRequested) {
    insights.push({
      type: 'action',
      message: 'Customer requested refund - may need follow-up'
    });
  }
  
  if (analysis.sentiment === SENTIMENT.NEGATIVE && !analysis.detectedPatterns?.escalationRequested) {
    insights.push({
      type: 'warning',
      message: 'Dissatisfied customer who did not escalate - high churn risk'
    });
  }
  
  if (analysis.detectedPatterns?.customerSatisfied) {
    insights.push({
      type: 'positive',
      message: 'Customer expressed satisfaction - good candidate for reviews/referrals'
    });
  }
  
  return insights;
}

// ============================================================================
// BATCH & REPORT FUNCTIONS
// ============================================================================

/**
 * Analyze multiple calls
 */
export async function analyzeCallBatch(calls) {
  const results = [];
  
  for (const call of calls) {
    const result = await analyzeCall(call);
    results.push(result);
    // Small delay to avoid overwhelming AI services
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return {
    total: calls.length,
    successful: results.filter(r => r.success).length,
    results
  };
}

/**
 * Get analysis for a call
 */
export function getAnalysis(callSid) {
  return analysisCache.get(callSid);
}

/**
 * Get all analyses
 */
export function getAllAnalyses() {
  const keys = analysisCache.keys();
  return keys.map(key => analysisCache.get(key));
}

/**
 * Get aggregate statistics
 */
export function getAggregateStats(filters = {}) {
  const analyses = getAllAnalyses();
  
  // Filter by date range if provided
  let filtered = analyses;
  if (filters.startDate) {
    filtered = filtered.filter(a => new Date(a.analyzedAt) >= new Date(filters.startDate));
  }
  if (filters.endDate) {
    filtered = filtered.filter(a => new Date(a.analyzedAt) <= new Date(filters.endDate));
  }
  if (filters.agentId) {
    filtered = filtered.filter(a => a.agentId === filters.agentId);
  }
  
  const stats = {
    totalCalls: filtered.length,
    averageQualityScore: 0,
    sentimentBreakdown: {
      positive: 0,
      neutral: 0,
      negative: 0,
      mixed: 0
    },
    alertCounts: {},
    averageDimensions: {}
  };
  
  if (filtered.length === 0) return stats;
  
  // Calculate averages and breakdowns
  let totalQuality = 0;
  const dimensionTotals = {};
  
  filtered.forEach(a => {
    totalQuality += a.qualityScore || 0;
    
    // Sentiment
    if (a.sentiment) {
      stats.sentimentBreakdown[a.sentiment] = (stats.sentimentBreakdown[a.sentiment] || 0) + 1;
    }
    
    // Alerts
    (a.alerts || []).forEach(alert => {
      stats.alertCounts[alert.type] = (stats.alertCounts[alert.type] || 0) + 1;
    });
    
    // Dimensions
    Object.entries(a.qualityDimensions || {}).forEach(([dim, score]) => {
      dimensionTotals[dim] = (dimensionTotals[dim] || 0) + score;
    });
  });
  
  stats.averageQualityScore = Math.round(totalQuality / filtered.length);
  
  Object.entries(dimensionTotals).forEach(([dim, total]) => {
    stats.averageDimensions[dim] = Math.round(total / filtered.length);
  });
  
  return stats;
}

/**
 * Get agent performance report
 */
export function getAgentPerformance(agentId) {
  const analyses = getAllAnalyses().filter(a => a.agentId === agentId);
  
  if (analyses.length === 0) {
    return { agentId, callCount: 0 };
  }
  
  const stats = getAggregateStats({ agentId });
  
  return {
    agentId,
    callCount: analyses.length,
    averageQualityScore: stats.averageQualityScore,
    sentimentBreakdown: stats.sentimentBreakdown,
    alertCounts: stats.alertCounts,
    averageDimensions: stats.averageDimensions,
    recentCalls: analyses.slice(-10).map(a => ({
      callSid: a.callSid,
      analyzedAt: a.analyzedAt,
      qualityScore: a.qualityScore,
      sentiment: a.sentiment
    }))
  };
}

export default {
  SENTIMENT,
  QUALITY_DIMENSIONS,
  ALERT_TYPES,
  analyzeCall,
  analyzeCallBatch,
  getAnalysis,
  getAllAnalyses,
  getAggregateStats,
  getAgentPerformance
};
