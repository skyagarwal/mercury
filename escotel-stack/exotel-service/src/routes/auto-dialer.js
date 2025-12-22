/**
 * Auto Dialer Routes (PACE Enhancement)
 * 
 * Campaign management and predictive dialing endpoints:
 * - Create/manage campaigns
 * - Predictive, progressive, power, and AI-automated dialing
 * - Real-time campaign statistics
 * - Webhooks for call status
 */

import express from 'express';
import {
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
} from '../services/auto-dialer.service.js';

const router = express.Router();

// ============================================================================
// CONFIGURATION ENDPOINTS
// ============================================================================

/**
 * GET /auto-dialer/modes
 * Get available dialer modes
 */
router.get('/modes', (req, res) => {
  res.json({
    success: true,
    modes: DIALER_MODES,
    descriptions: {
      [DIALER_MODES.PREDICTIVE]: 'AI predicts agent availability for maximum efficiency',
      [DIALER_MODES.PROGRESSIVE]: 'One call per available agent - balanced approach',
      [DIALER_MODES.PREVIEW]: 'Agent reviews contact info before call is placed',
      [DIALER_MODES.POWER]: 'Multiple simultaneous calls per agent - high volume',
      [DIALER_MODES.AI_AUTOMATED]: 'Fully automated with Mangwale AI Voice Agent'
    }
  });
});

/**
 * GET /auto-dialer/types
 * Get available campaign types
 */
router.get('/types', (req, res) => {
  res.json({
    success: true,
    types: CAMPAIGN_TYPES
  });
});

/**
 * GET /auto-dialer/outcomes
 * Get possible call outcomes
 */
router.get('/outcomes', (req, res) => {
  res.json({
    success: true,
    outcomes: CALL_OUTCOMES
  });
});

// ============================================================================
// CAMPAIGN MANAGEMENT
// ============================================================================

/**
 * POST /auto-dialer/campaigns
 * Create a new campaign
 */
router.post('/campaigns', async (req, res) => {
  try {
    const {
      name,
      type,
      mode,
      contacts,
      schedule,
      settings,
      metadata
    } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Campaign name is required'
      });
    }
    
    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one contact is required'
      });
    }
    
    // Validate contacts have phone numbers
    const invalidContacts = contacts.filter(c => !c.phone);
    if (invalidContacts.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'All contacts must have phone numbers'
      });
    }
    
    const campaign = await createCampaign({
      name,
      type: type || CAMPAIGN_TYPES.PROMOTIONAL,
      mode: mode || DIALER_MODES.PROGRESSIVE,
      contacts,
      schedule,
      settings,
      metadata
    });
    
    res.json({
      success: true,
      campaign
    });
    
  } catch (error) {
    console.error('Create campaign error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create campaign',
      message: error.message
    });
  }
});

/**
 * GET /auto-dialer/campaigns
 * Get all campaigns
 */
router.get('/campaigns', (req, res) => {
  const campaigns = getAllCampaigns();
  
  // Return summary without full contact list
  const summaries = campaigns.map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    mode: c.mode,
    status: c.status,
    totalContacts: c.totalContacts,
    stats: c.stats,
    schedule: c.schedule,
    createdAt: c.createdAt,
    startedAt: c.startedAt,
    completedAt: c.completedAt
  }));
  
  res.json({
    success: true,
    count: campaigns.length,
    campaigns: summaries
  });
});

/**
 * GET /auto-dialer/campaigns/:campaignId
 * Get campaign details
 */
router.get('/campaigns/:campaignId', (req, res) => {
  const { campaignId } = req.params;
  const includeContacts = req.query.includeContacts === 'true';
  
  const campaign = getCampaign(campaignId);
  
  if (!campaign) {
    return res.status(404).json({
      success: false,
      error: 'Campaign not found'
    });
  }
  
  // Optionally exclude full contact list
  const response = { ...campaign };
  if (!includeContacts) {
    response.contacts = {
      total: campaign.contacts.length,
      pending: campaign.contacts.filter(c => c.status === 'pending').length,
      called: campaign.contacts.filter(c => c.status === 'called' || c.status === 'answered').length,
      failed: campaign.contacts.filter(c => c.status === 'failed').length
    };
  }
  
  res.json({
    success: true,
    campaign: response
  });
});

/**
 * POST /auto-dialer/campaigns/:campaignId/start
 * Start a campaign
 */
router.post('/campaigns/:campaignId/start', async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const campaign = await startCampaign(campaignId);
    
    res.json({
      success: true,
      message: 'Campaign started',
      campaign: {
        id: campaign.id,
        status: campaign.status,
        startedAt: campaign.startedAt
      }
    });
    
  } catch (error) {
    console.error('Start campaign error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to start campaign',
      message: error.message
    });
  }
});

/**
 * POST /auto-dialer/campaigns/:campaignId/pause
 * Pause a campaign
 */
router.post('/campaigns/:campaignId/pause', async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const campaign = await pauseCampaign(campaignId);
    
    res.json({
      success: true,
      message: 'Campaign paused',
      campaign: {
        id: campaign.id,
        status: campaign.status
      }
    });
    
  } catch (error) {
    console.error('Pause campaign error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to pause campaign',
      message: error.message
    });
  }
});

/**
 * POST /auto-dialer/campaigns/:campaignId/resume
 * Resume a paused campaign
 */
router.post('/campaigns/:campaignId/resume', async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const campaign = await resumeCampaign(campaignId);
    
    res.json({
      success: true,
      message: 'Campaign resumed',
      campaign: {
        id: campaign.id,
        status: campaign.status
      }
    });
    
  } catch (error) {
    console.error('Resume campaign error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to resume campaign',
      message: error.message
    });
  }
});

/**
 * POST /auto-dialer/campaigns/:campaignId/stop
 * Stop a campaign
 */
router.post('/campaigns/:campaignId/stop', async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const campaign = await stopCampaign(campaignId);
    
    res.json({
      success: true,
      message: 'Campaign stopped',
      campaign: {
        id: campaign.id,
        status: campaign.status,
        stoppedAt: campaign.stoppedAt,
        stats: campaign.stats
      }
    });
    
  } catch (error) {
    console.error('Stop campaign error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to stop campaign',
      message: error.message
    });
  }
});

/**
 * POST /auto-dialer/campaigns/:campaignId/contacts
 * Add contacts to existing campaign
 */
router.post('/campaigns/:campaignId/contacts', (req, res) => {
  try {
    const { campaignId } = req.params;
    const { contacts } = req.body;
    
    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'contacts array is required'
      });
    }
    
    const result = addContactsToCampaign(campaignId, contacts);
    
    res.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('Add contacts error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to add contacts',
      message: error.message
    });
  }
});

/**
 * GET /auto-dialer/campaigns/:campaignId/stats
 * Get campaign statistics
 */
router.get('/campaigns/:campaignId/stats', (req, res) => {
  const { campaignId } = req.params;
  
  const campaign = getCampaign(campaignId);
  
  if (!campaign) {
    return res.status(404).json({
      success: false,
      error: 'Campaign not found'
    });
  }
  
  const contactBreakdown = {
    total: campaign.contacts.length,
    pending: campaign.contacts.filter(c => c.status === 'pending').length,
    dialing: campaign.contacts.filter(c => c.status === 'dialing').length,
    answered: campaign.contacts.filter(c => c.status === 'answered' || c.status === 'success').length,
    noAnswer: campaign.contacts.filter(c => c.status === 'no_answer').length,
    busy: campaign.contacts.filter(c => c.status === 'busy').length,
    failed: campaign.contacts.filter(c => c.status === 'failed').length,
    aiHandling: campaign.contacts.filter(c => c.status === 'ai_handling').length
  };
  
  res.json({
    success: true,
    campaignId,
    status: campaign.status,
    stats: campaign.stats,
    contactBreakdown,
    progress: Math.round(((campaign.totalContacts - contactBreakdown.pending) / campaign.totalContacts) * 100)
  });
});

// ============================================================================
// QUICK CAMPAIGN ENDPOINTS
// ============================================================================

/**
 * POST /auto-dialer/quick/feedback
 * Quick campaign for collecting feedback
 */
router.post('/quick/feedback', async (req, res) => {
  try {
    const { contacts, orderIds } = req.body;
    
    if (!contacts || contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'contacts array is required'
      });
    }
    
    const campaign = await createCampaign({
      name: `Feedback Campaign ${new Date().toISOString().slice(0, 10)}`,
      type: CAMPAIGN_TYPES.FEEDBACK_COLLECTION,
      mode: DIALER_MODES.AI_AUTOMATED,
      contacts,
      settings: {
        useVerifiedCalls: true,
        useAIAgent: true,
        aiAgentScript: 'feedback_collection'
      }
    });
    
    // Auto-start
    await startCampaign(campaign.id);
    
    res.json({
      success: true,
      message: 'Feedback campaign started',
      campaignId: campaign.id
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to create feedback campaign',
      message: error.message
    });
  }
});

/**
 * POST /auto-dialer/quick/promotional
 * Quick promotional campaign
 */
router.post('/quick/promotional', async (req, res) => {
  try {
    const { contacts, offer, promoCode } = req.body;
    
    if (!contacts || contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'contacts array is required'
      });
    }
    
    const campaign = await createCampaign({
      name: `Promo: ${promoCode || 'General'} - ${new Date().toISOString().slice(0, 10)}`,
      type: CAMPAIGN_TYPES.PROMOTIONAL,
      mode: DIALER_MODES.AI_AUTOMATED,
      contacts,
      settings: {
        useVerifiedCalls: true,
        useAIAgent: true,
        aiAgentScript: 'promotional'
      },
      metadata: { offer, promoCode }
    });
    
    // Auto-start
    await startCampaign(campaign.id);
    
    res.json({
      success: true,
      message: 'Promotional campaign started',
      campaignId: campaign.id
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to create promotional campaign',
      message: error.message
    });
  }
});

/**
 * POST /auto-dialer/quick/reactivation
 * Quick reactivation campaign for inactive customers
 */
router.post('/quick/reactivation', async (req, res) => {
  try {
    const { contacts, offer } = req.body;
    
    if (!contacts || contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'contacts array is required'
      });
    }
    
    const campaign = await createCampaign({
      name: `Reactivation Campaign ${new Date().toISOString().slice(0, 10)}`,
      type: CAMPAIGN_TYPES.REACTIVATION,
      mode: DIALER_MODES.AI_AUTOMATED,
      contacts,
      settings: {
        useVerifiedCalls: true,
        useAIAgent: true,
        aiAgentScript: 'reactivation',
        maxAttempts: 2
      },
      metadata: { offer }
    });
    
    // Auto-start
    await startCampaign(campaign.id);
    
    res.json({
      success: true,
      message: 'Reactivation campaign started',
      campaignId: campaign.id
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to create reactivation campaign',
      message: error.message
    });
  }
});

// ============================================================================
// WEBHOOKS
// ============================================================================

/**
 * POST /auto-dialer/webhook/status
 * Handle call status updates from Exotel
 */
router.post('/webhook/status', (req, res) => {
  console.log('📞 Auto-dialer call status:', req.body);
  
  const result = handleCallStatus(req.body);
  
  res.json(result);
});

export default router;
