/**
 * Auto Dialer Service (PACE Enhancement)
 * 
 * Advanced predictive dialing for Mangwale campaigns:
 * - Predictive dialing (predicts agent availability)
 * - Progressive dialing (one call per available agent)
 * - Preview dialing (agent sees info before call)
 * - Power dialing (multiple lines per agent)
 * 
 * Integrates with Mangwale AI Voice Agent for automated conversations
 */

import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { emitEvent } from '../utils/events.js';
import NodeCache from 'node-cache';
import { makeVerifiedCall, CALL_REASONS } from './verified-calls.service.js';

// Campaign cache (TTL: 7 days)
const campaignCache = new NodeCache({ stdTTL: 604800, checkperiod: 3600 });

// ============================================================================
// CONFIGURATION
// ============================================================================

// Dialer modes
export const DIALER_MODES = {
  PREDICTIVE: 'predictive',    // AI predicts agent availability, max efficiency
  PROGRESSIVE: 'progressive',   // One call per available agent
  PREVIEW: 'preview',          // Agent reviews before call
  POWER: 'power',              // Multiple simultaneous calls per agent
  AI_AUTOMATED: 'ai_automated' // Fully automated with Mangwale Voice Agent
};

// Campaign types
export const CAMPAIGN_TYPES = {
  ORDER_CONFIRMATION: 'order_confirmation',
  DELIVERY_NOTIFICATION: 'delivery_notification',
  FEEDBACK_COLLECTION: 'feedback_collection',
  PROMOTIONAL: 'promotional',
  REACTIVATION: 'reactivation',
  PAYMENT_REMINDER: 'payment_reminder',
  SURVEY: 'survey',
  LEAD_FOLLOWUP: 'lead_followup'
};

// Call outcomes
export const CALL_OUTCOMES = {
  ANSWERED: 'answered',
  NO_ANSWER: 'no_answer',
  BUSY: 'busy',
  VOICEMAIL: 'voicemail',
  WRONG_NUMBER: 'wrong_number',
  DNC: 'do_not_call',
  CALLBACK_REQUESTED: 'callback_requested',
  SUCCESS: 'success',
  FAILED: 'failed'
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

// ============================================================================
// CAMPAIGN MANAGEMENT
// ============================================================================

/**
 * Create a new dialing campaign
 */
export async function createCampaign(params) {
  const {
    name,
    type = CAMPAIGN_TYPES.PROMOTIONAL,
    mode = DIALER_MODES.PROGRESSIVE,
    contacts = [],
    schedule,
    settings = {},
    metadata = {}
  } = params;
  
  const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const campaign = {
    id: campaignId,
    name,
    type,
    mode,
    status: 'created',
    contacts: contacts.map((c, idx) => ({
      id: `contact_${idx}`,
      phone: c.phone,
      name: c.name,
      metadata: c.metadata || {},
      status: 'pending',
      attempts: 0
    })),
    totalContacts: contacts.length,
    schedule: {
      startTime: schedule?.startTime || new Date().toISOString(),
      endTime: schedule?.endTime,
      daysOfWeek: schedule?.daysOfWeek || [1, 2, 3, 4, 5], // Mon-Fri
      callWindowStart: schedule?.callWindowStart || '09:00',
      callWindowEnd: schedule?.callWindowEnd || '21:00',
      timezone: schedule?.timezone || 'Asia/Kolkata'
    },
    settings: {
      maxAttempts: settings.maxAttempts || 3,
      retryDelay: settings.retryDelay || 3600, // 1 hour
      callsPerAgent: settings.callsPerAgent || 1,
      abandonedCallThreshold: settings.abandonedCallThreshold || 3, // % allowed
      maxWaitTime: settings.maxWaitTime || 30, // seconds
      recordCalls: settings.recordCalls !== false,
      useVerifiedCalls: settings.useVerifiedCalls !== false,
      useAIAgent: settings.useAIAgent || false,
      aiAgentScript: settings.aiAgentScript || null
    },
    stats: {
      totalCalls: 0,
      answered: 0,
      noAnswer: 0,
      busy: 0,
      failed: 0,
      avgDuration: 0,
      successRate: 0
    },
    metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  campaignCache.set(campaignId, campaign);
  
  emitEvent({
    type: 'campaign.created',
    at: new Date().toISOString(),
    campaignId,
    name,
    type,
    mode,
    totalContacts: contacts.length
  });
  
  console.log(`📞 Campaign created: ${campaignId} | Mode: ${mode} | Contacts: ${contacts.length}`);
  
  return campaign;
}

/**
 * Start a campaign
 */
export async function startCampaign(campaignId) {
  const campaign = campaignCache.get(campaignId);
  
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }
  
  if (campaign.status === 'running') {
    throw new Error(`Campaign already running: ${campaignId}`);
  }
  
  campaign.status = 'running';
  campaign.startedAt = new Date().toISOString();
  campaign.updatedAt = new Date().toISOString();
  
  campaignCache.set(campaignId, campaign);
  
  emitEvent({
    type: 'campaign.started',
    at: new Date().toISOString(),
    campaignId
  });
  
  console.log(`▶️ Campaign started: ${campaignId}`);
  
  // Start processing contacts based on mode
  processCampaign(campaignId);
  
  return campaign;
}

/**
 * Pause a campaign
 */
export async function pauseCampaign(campaignId) {
  const campaign = campaignCache.get(campaignId);
  
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }
  
  campaign.status = 'paused';
  campaign.updatedAt = new Date().toISOString();
  
  campaignCache.set(campaignId, campaign);
  
  emitEvent({
    type: 'campaign.paused',
    at: new Date().toISOString(),
    campaignId
  });
  
  console.log(`⏸️ Campaign paused: ${campaignId}`);
  
  return campaign;
}

/**
 * Resume a campaign
 */
export async function resumeCampaign(campaignId) {
  const campaign = campaignCache.get(campaignId);
  
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }
  
  if (campaign.status !== 'paused') {
    throw new Error(`Campaign is not paused: ${campaignId}`);
  }
  
  campaign.status = 'running';
  campaign.updatedAt = new Date().toISOString();
  
  campaignCache.set(campaignId, campaign);
  
  emitEvent({
    type: 'campaign.resumed',
    at: new Date().toISOString(),
    campaignId
  });
  
  console.log(`▶️ Campaign resumed: ${campaignId}`);
  
  processCampaign(campaignId);
  
  return campaign;
}

/**
 * Stop a campaign
 */
export async function stopCampaign(campaignId) {
  const campaign = campaignCache.get(campaignId);
  
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }
  
  campaign.status = 'stopped';
  campaign.stoppedAt = new Date().toISOString();
  campaign.updatedAt = new Date().toISOString();
  
  campaignCache.set(campaignId, campaign);
  
  emitEvent({
    type: 'campaign.stopped',
    at: new Date().toISOString(),
    campaignId,
    stats: campaign.stats
  });
  
  console.log(`⏹️ Campaign stopped: ${campaignId}`);
  
  return campaign;
}

/**
 * Get campaign status
 */
export function getCampaign(campaignId) {
  return campaignCache.get(campaignId);
}

/**
 * Get all campaigns
 */
export function getAllCampaigns() {
  const keys = campaignCache.keys();
  return keys.map(key => campaignCache.get(key));
}

/**
 * Add contacts to existing campaign
 */
export function addContactsToCampaign(campaignId, contacts) {
  const campaign = campaignCache.get(campaignId);
  
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }
  
  const startIdx = campaign.contacts.length;
  const newContacts = contacts.map((c, idx) => ({
    id: `contact_${startIdx + idx}`,
    phone: c.phone,
    name: c.name,
    metadata: c.metadata || {},
    status: 'pending',
    attempts: 0
  }));
  
  campaign.contacts.push(...newContacts);
  campaign.totalContacts = campaign.contacts.length;
  campaign.updatedAt = new Date().toISOString();
  
  campaignCache.set(campaignId, campaign);
  
  return {
    added: newContacts.length,
    totalContacts: campaign.totalContacts
  };
}

// ============================================================================
// CAMPAIGN PROCESSING
// ============================================================================

/**
 * Process campaign - dial contacts based on mode
 */
async function processCampaign(campaignId) {
  const campaign = campaignCache.get(campaignId);
  
  if (!campaign || campaign.status !== 'running') {
    return;
  }
  
  // Check time window
  if (!isWithinCallWindow(campaign.schedule)) {
    console.log(`⏰ Campaign ${campaignId} outside call window, waiting...`);
    setTimeout(() => processCampaign(campaignId), 60000); // Check again in 1 minute
    return;
  }
  
  // Get pending contacts
  const pendingContacts = campaign.contacts.filter(
    c => c.status === 'pending' && c.attempts < campaign.settings.maxAttempts
  );
  
  if (pendingContacts.length === 0) {
    campaign.status = 'completed';
    campaign.completedAt = new Date().toISOString();
    campaign.updatedAt = new Date().toISOString();
    campaignCache.set(campaignId, campaign);
    
    emitEvent({
      type: 'campaign.completed',
      at: new Date().toISOString(),
      campaignId,
      stats: campaign.stats
    });
    
    console.log(`✅ Campaign completed: ${campaignId}`);
    return;
  }
  
  // Process based on mode
  switch (campaign.mode) {
    case DIALER_MODES.PROGRESSIVE:
      await processProgressive(campaign, pendingContacts);
      break;
    case DIALER_MODES.PREDICTIVE:
      await processPredictive(campaign, pendingContacts);
      break;
    case DIALER_MODES.POWER:
      await processPower(campaign, pendingContacts);
      break;
    case DIALER_MODES.AI_AUTOMATED:
      await processAIAutomated(campaign, pendingContacts);
      break;
    default:
      await processProgressive(campaign, pendingContacts);
  }
  
  // Continue processing
  if (campaign.status === 'running') {
    setTimeout(() => processCampaign(campaignId), 5000); // Process next batch
  }
}

/**
 * Progressive dialing - one call at a time
 */
async function processProgressive(campaign, contacts) {
  const contact = contacts[0];
  if (!contact) return;
  
  try {
    await dialContact(campaign, contact);
  } catch (error) {
    console.error(`Progressive dial error: ${error.message}`);
  }
}

/**
 * Predictive dialing - multiple calls anticipating agent availability
 */
async function processPredictive(campaign, contacts) {
  // Calculate optimal number of calls based on historical answer rate
  const answerRate = campaign.stats.answered / (campaign.stats.totalCalls || 1);
  const optimalCalls = Math.ceil(1 / (answerRate || 0.3)); // Default 30% answer rate
  
  const batch = contacts.slice(0, Math.min(optimalCalls, 3)); // Max 3 simultaneous
  
  await Promise.all(batch.map(contact => dialContact(campaign, contact).catch(e => {
    console.error(`Predictive dial error: ${e.message}`);
  })));
}

/**
 * Power dialing - multiple lines per agent
 */
async function processPower(campaign, contacts) {
  const callsPerAgent = campaign.settings.callsPerAgent || 2;
  const batch = contacts.slice(0, callsPerAgent);
  
  await Promise.all(batch.map(contact => dialContact(campaign, contact).catch(e => {
    console.error(`Power dial error: ${e.message}`);
  })));
}

/**
 * AI Automated dialing - Mangwale Voice Agent handles conversations
 */
async function processAIAutomated(campaign, contacts) {
  const contact = contacts[0];
  if (!contact) return;
  
  try {
    // Dial and connect to AI Voice Agent
    await dialContactWithAI(campaign, contact);
  } catch (error) {
    console.error(`AI automated dial error: ${error.message}`);
  }
}

// ============================================================================
// DIALING FUNCTIONS
// ============================================================================

/**
 * Dial a single contact
 */
async function dialContact(campaign, contact) {
  const config = getExotelConfig();
  
  contact.status = 'dialing';
  contact.attempts++;
  contact.lastAttemptAt = new Date().toISOString();
  
  campaignCache.set(campaign.id, campaign);
  
  console.log(`📞 Dialing: ${contact.phone} | Campaign: ${campaign.name}`);
  
  try {
    // Use verified calls if enabled
    if (campaign.settings.useVerifiedCalls) {
      const callResult = await makeVerifiedCall({
        to: contact.phone,
        reason: getCallReason(campaign.type),
        metadata: {
          campaignId: campaign.id,
          contactId: contact.id,
          contactName: contact.name
        }
      });
      
      contact.callSid = callResult.callSid;
    } else {
      // Regular Exotel call
      const callData = {
        From: contact.phone,
        CallerId: config.defaultCallerId,
        StatusCallback: `${process.env.EXOTEL_CALLBACK_URL || 'http://192.168.0.151:3100'}/auto-dialer/webhook/status`,
        CustomField: JSON.stringify({
          campaignId: campaign.id,
          contactId: contact.id
        })
      };
      
      const response = await axios.post(
        `${config.baseUrl}/Calls/connect`,
        new URLSearchParams(callData).toString(),
        {
          auth: config.auth,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      
      contact.callSid = response.data.Call?.Sid;
    }
    
    contact.status = 'called';
    campaign.stats.totalCalls++;
    
    emitEvent({
      type: 'campaign.call.initiated',
      at: new Date().toISOString(),
      campaignId: campaign.id,
      contactId: contact.id,
      callSid: contact.callSid
    });
    
  } catch (error) {
    contact.status = 'failed';
    contact.error = error.message;
    campaign.stats.failed++;
    
    console.error(`❌ Dial failed for ${contact.phone}: ${error.message}`);
    
    // Simulate for development
    if (process.env.NODE_ENV !== 'production') {
      contact.callSid = `sim_${Date.now()}`;
      contact.status = 'called';
      campaign.stats.totalCalls++;
    }
  }
  
  campaign.updatedAt = new Date().toISOString();
  campaignCache.set(campaign.id, campaign);
}

/**
 * Dial contact and connect to AI Voice Agent
 */
async function dialContactWithAI(campaign, contact) {
  const config = getExotelConfig();
  
  contact.status = 'dialing';
  contact.attempts++;
  contact.lastAttemptAt = new Date().toISOString();
  
  console.log(`🤖 AI-dialing: ${contact.phone} | Campaign: ${campaign.name}`);
  
  try {
    // Build applet URL that connects to Voice Agent
    const voiceAgentUrl = process.env.VOICE_AGENT_URL || 'http://192.168.0.151:8090';
    const appletUrl = `${voiceAgentUrl}/exotel/applet?` + new URLSearchParams({
      campaignId: campaign.id,
      contactId: contact.id,
      script: campaign.settings.aiAgentScript || 'default',
      customerName: contact.name || 'Customer',
      type: campaign.type
    }).toString();
    
    const callData = {
      From: contact.phone,
      CallerId: config.defaultCallerId,
      Url: appletUrl, // Voice Agent will handle the conversation
      StatusCallback: `${process.env.EXOTEL_CALLBACK_URL || 'http://192.168.0.151:3100'}/auto-dialer/webhook/status`,
      Record: campaign.settings.recordCalls ? 'true' : 'false',
      CustomField: JSON.stringify({
        campaignId: campaign.id,
        contactId: contact.id,
        aiAgent: true
      })
    };
    
    const response = await axios.post(
      `${config.baseUrl}/Calls/connect`,
      new URLSearchParams(callData).toString(),
      {
        auth: config.auth,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    contact.callSid = response.data.Call?.Sid;
    contact.status = 'ai_handling';
    campaign.stats.totalCalls++;
    
    emitEvent({
      type: 'campaign.ai_call.initiated',
      at: new Date().toISOString(),
      campaignId: campaign.id,
      contactId: contact.id,
      callSid: contact.callSid
    });
    
  } catch (error) {
    contact.status = 'failed';
    contact.error = error.message;
    campaign.stats.failed++;
    
    console.error(`❌ AI dial failed for ${contact.phone}: ${error.message}`);
    
    // Simulate for development
    if (process.env.NODE_ENV !== 'production') {
      contact.callSid = `sim_ai_${Date.now()}`;
      contact.status = 'ai_handling';
      campaign.stats.totalCalls++;
    }
  }
  
  campaign.updatedAt = new Date().toISOString();
  campaignCache.set(campaign.id, campaign);
}

// ============================================================================
// CALL STATUS HANDLING
// ============================================================================

/**
 * Handle call status callback
 */
export function handleCallStatus(data) {
  const { CallSid, Status, Duration, RecordingUrl, custom_field } = data;
  
  let metadata = {};
  try {
    metadata = JSON.parse(custom_field || '{}');
  } catch (e) {}
  
  const { campaignId, contactId } = metadata;
  
  if (!campaignId) return { received: true };
  
  const campaign = campaignCache.get(campaignId);
  if (!campaign) return { received: true };
  
  const contact = campaign.contacts.find(c => c.id === contactId);
  if (!contact) return { received: true };
  
  // Update contact status
  contact.status = mapCallStatus(Status);
  contact.duration = Duration;
  contact.recordingUrl = RecordingUrl;
  contact.completedAt = new Date().toISOString();
  
  // Update campaign stats
  switch (contact.status) {
    case 'answered':
    case 'success':
      campaign.stats.answered++;
      break;
    case 'no_answer':
      campaign.stats.noAnswer++;
      break;
    case 'busy':
      campaign.stats.busy++;
      break;
    case 'failed':
      campaign.stats.failed++;
      break;
  }
  
  // Calculate average duration
  const completedCalls = campaign.contacts.filter(c => c.duration);
  const totalDuration = completedCalls.reduce((sum, c) => sum + (parseInt(c.duration) || 0), 0);
  campaign.stats.avgDuration = completedCalls.length > 0 
    ? Math.round(totalDuration / completedCalls.length) 
    : 0;
  
  // Calculate success rate
  campaign.stats.successRate = campaign.stats.totalCalls > 0
    ? Math.round((campaign.stats.answered / campaign.stats.totalCalls) * 100)
    : 0;
  
  campaign.updatedAt = new Date().toISOString();
  campaignCache.set(campaign.id, campaign);
  
  emitEvent({
    type: 'campaign.call.completed',
    at: new Date().toISOString(),
    campaignId,
    contactId,
    status: contact.status,
    duration: Duration
  });
  
  console.log(`📊 Call completed: ${contact.phone} | Status: ${contact.status} | Duration: ${Duration}s`);
  
  return { received: true, status: contact.status };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function isWithinCallWindow(schedule) {
  const now = new Date();
  const day = now.getDay();
  
  // Check day of week (0 = Sunday)
  const dayMap = [7, 1, 2, 3, 4, 5, 6]; // Convert to 1-7 format
  if (!schedule.daysOfWeek.includes(dayMap[day])) {
    return false;
  }
  
  // Check time window
  const currentTime = now.toTimeString().slice(0, 5);
  return currentTime >= schedule.callWindowStart && currentTime <= schedule.callWindowEnd;
}

function mapCallStatus(exotelStatus) {
  const statusMap = {
    'completed': CALL_OUTCOMES.ANSWERED,
    'in-progress': CALL_OUTCOMES.ANSWERED,
    'answered': CALL_OUTCOMES.ANSWERED,
    'busy': CALL_OUTCOMES.BUSY,
    'no-answer': CALL_OUTCOMES.NO_ANSWER,
    'failed': CALL_OUTCOMES.FAILED,
    'canceled': CALL_OUTCOMES.FAILED
  };
  return statusMap[exotelStatus?.toLowerCase()] || CALL_OUTCOMES.FAILED;
}

function getCallReason(campaignType) {
  const reasonMap = {
    [CAMPAIGN_TYPES.ORDER_CONFIRMATION]: CALL_REASONS.ORDER_CONFIRMATION,
    [CAMPAIGN_TYPES.DELIVERY_NOTIFICATION]: CALL_REASONS.DELIVERY_ARRIVING,
    [CAMPAIGN_TYPES.FEEDBACK_COLLECTION]: CALL_REASONS.FEEDBACK_REQUEST,
    [CAMPAIGN_TYPES.PROMOTIONAL]: CALL_REASONS.PROMOTIONAL,
    [CAMPAIGN_TYPES.PAYMENT_REMINDER]: CALL_REASONS.PAYMENT_REMINDER
  };
  return reasonMap[campaignType] || CALL_REASONS.ORDER_UPDATE;
}

export default {
  DIALER_MODES,
  CAMPAIGN_TYPES,
  CALL_OUTCOMES,
  createCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  stopCampaign,
  getCampaign,
  getAllCampaigns,
  addContactsToCampaign,
  handleCallStatus
};
