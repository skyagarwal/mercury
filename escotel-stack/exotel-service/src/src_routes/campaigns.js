/**
 * Mangwale Outbound Campaigns
 * 
 * Voice & SMS marketing campaigns:
 * - "Mangwale is live in your area"
 * - "Free delivery till Sunday"
 * - Festival campaigns (Diwali, Rakhi, etc.)
 * - Re-engagement for inactive users
 */

import express from 'express';
import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { publish } from '../utils/mq.js';
import { emitEvent } from '../utils/events.js';

const router = express.Router();

// ============================================================================
// CAMPAIGN TYPES
// ============================================================================

const CAMPAIGN_TEMPLATES = {
  // Launch campaign
  area_launch: {
    sms: {
      hi: 'Namaste! Mangwale ab aapke area mein live hai 🎉 Food, Parcel, Local Shopping - sab ek call pe! Call: {phone} ya app download karein.',
      en: 'Hello! Mangwale is now live in your area 🎉 Food, Parcel, Local Shopping - all in one call! Call: {phone} or download app.',
    },
    voice: {
      hi: 'नमस्ते! Mangwale ab aapke area mein live hai. Ab aap phone call karke bhi order kar sakte hain. Koi app download karne ki zaroorat nahi. Abhi try karein!',
      en: 'Hello! Mangwale is now live in your area. You can now order by phone call. No app needed. Try now!',
    },
  },
  
  // Promotional offers
  free_delivery: {
    sms: {
      hi: '🚚 FREE DELIVERY! Is Sunday tak Mangwale pe sabhi orders pe free delivery. Order karne ke liye call karein: {phone}',
      en: '🚚 FREE DELIVERY! Free delivery on all Mangwale orders till Sunday. Call to order: {phone}',
    },
    voice: {
      hi: 'Good news! Is Sunday tak Mangwale pe sabhi orders pe free delivery hai. Abhi call karke order karein!',
      en: 'Good news! Free delivery on all Mangwale orders till Sunday. Call now to order!',
    },
  },
  
  // Festival campaigns
  diwali: {
    sms: {
      hi: '🪔 Diwali ki hardik shubhkamnaye! Mangwale pe special Diwali offers - mithai, gifts, decorations sab available. Order: {phone}',
      en: '🪔 Happy Diwali! Special Diwali offers on Mangwale - sweets, gifts, decorations. Order: {phone}',
    },
    voice: {
      hi: 'Diwali ki hardik shubhkamnaye! Mangwale pe special Diwali offers chal rahe hain. Mithai, gifts, decorations - sab available hai. Abhi order karein!',
      en: 'Happy Diwali! Special Diwali offers on Mangwale. Sweets, gifts, decorations available. Order now!',
    },
  },
  
  rakhi: {
    sms: {
      hi: '🎀 Rakhi special! Door rehne wale bhai-behen ko Mangwale se rakhi aur gifts bhejein. Same day delivery. Order: {phone}',
      en: '🎀 Rakhi special! Send rakhi & gifts to siblings far away via Mangwale. Same day delivery. Order: {phone}',
    },
    voice: {
      hi: 'Rakhi special! Door rehne wale bhai ya behen ko Mangwale se rakhi aur gifts bhejein. Same day delivery available. Abhi call karein!',
      en: 'Rakhi special! Send rakhi and gifts to siblings far away via Mangwale. Same day delivery. Call now!',
    },
  },
  
  // Re-engagement
  inactive_user: {
    sms: {
      hi: 'Aapko miss kar rahe hain! 🥺 Mangwale pe vapas aayein - first order pe 20% OFF. Code: WEBACK. Order: {phone}',
      en: 'We miss you! 🥺 Come back to Mangwale - 20% OFF on first order. Code: WEBACK. Order: {phone}',
    },
    voice: {
      hi: 'Aapko bahut miss kar rahe hain! Mangwale pe vapas aayein. Aapke first order pe 20% discount mil raha hai. Abhi order karein!',
      en: 'We miss you a lot! Come back to Mangwale. Get 20% off on your first order. Order now!',
    },
  },
  
  // Vendor onboarding
  vendor_invite: {
    sms: {
      hi: '🏪 Apni dukaan Mangwale pe laayein! ZERO commission, instant payments, free listing. Register: {phone}',
      en: '🏪 List your shop on Mangwale! ZERO commission, instant payments, free listing. Register: {phone}',
    },
    voice: {
      hi: 'Namaste! Kya aap apni dukaan online laana chahte hain? Mangwale pe zero commission hai. Instant payments. Free listing. Abhi register karein!',
      en: 'Hello! Want to bring your shop online? Mangwale has zero commission. Instant payments. Free listing. Register now!',
    },
  },
};

// ============================================================================
// CAMPAIGN MANAGEMENT
// ============================================================================

// Active campaigns (in production, use database)
const campaigns = new Map();

/**
 * Create a new campaign
 */
router.post('/create', async (req, res) => {
  try {
    const {
      name,
      type,                   // 'area_launch' | 'free_delivery' | 'diwali' | etc.
      channel,                // 'sms' | 'voice' | 'both'
      target_audience,        // { city, area, user_type, filters }
      schedule,               // { start_at, end_at, daily_limit, time_window }
      phone_numbers,          // Array of phones (for manual campaigns)
      caller_id,
      language = 'hi',
    } = req.body;
    
    if (!name || !type || !channel) {
      return res.status(400).json({ error: 'name, type, channel required' });
    }
    
    const template = CAMPAIGN_TEMPLATES[type];
    if (!template) {
      return res.status(400).json({ 
        error: 'Invalid campaign type',
        validTypes: Object.keys(CAMPAIGN_TEMPLATES),
      });
    }
    
    const campaignId = `campaign_${Date.now()}`;
    const campaign = {
      id: campaignId,
      name,
      type,
      channel,
      targetAudience: target_audience,
      schedule,
      phoneNumbers: phone_numbers || [],
      callerId: caller_id || process.env.EXOTEL_CALLER_ID,
      language,
      template,
      status: 'created',
      stats: {
        total: 0,
        sent: 0,
        delivered: 0,
        answered: 0,
        failed: 0,
      },
      createdAt: new Date().toISOString(),
    };
    
    campaigns.set(campaignId, campaign);
    
    emitEvent({
      type: 'campaign.created',
      at: new Date().toISOString(),
      campaignId,
      name,
      campaignType: type,
    });
    
    return res.status(201).json({
      success: true,
      campaignId,
      campaign,
    });
    
  } catch (err) {
    console.error('Create campaign error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Start a campaign
 */
router.post('/:campaignId/start', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = campaigns.get(campaignId);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaign.status === 'running') {
      return res.status(400).json({ error: 'Campaign already running' });
    }
    
    campaign.status = 'running';
    campaign.startedAt = new Date().toISOString();
    campaign.stats.total = campaign.phoneNumbers.length;
    
    // Start sending in background
    processCampaign(campaign);
    
    emitEvent({
      type: 'campaign.started',
      at: new Date().toISOString(),
      campaignId,
    });
    
    return res.status(200).json({
      success: true,
      message: 'Campaign started',
      totalRecipients: campaign.stats.total,
    });
    
  } catch (err) {
    console.error('Start campaign error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Pause a campaign
 */
router.post('/:campaignId/pause', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = campaigns.get(campaignId);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    campaign.status = 'paused';
    campaign.pausedAt = new Date().toISOString();
    
    return res.status(200).json({
      success: true,
      message: 'Campaign paused',
    });
    
  } catch (err) {
    console.error('Pause campaign error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get campaign status
 */
router.get('/:campaignId', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = campaigns.get(campaignId);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    return res.json(campaign);
    
  } catch (err) {
    console.error('Get campaign error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * List all campaigns
 */
router.get('/', async (req, res) => {
  try {
    const { status, type } = req.query;
    
    let result = Array.from(campaigns.values());
    
    if (status) {
      result = result.filter(c => c.status === status);
    }
    if (type) {
      result = result.filter(c => c.type === type);
    }
    
    return res.json({
      campaigns: result,
      total: result.length,
    });
    
  } catch (err) {
    console.error('List campaigns error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get campaign templates
 */
router.get('/templates/list', async (req, res) => {
  return res.json({
    templates: Object.keys(CAMPAIGN_TEMPLATES).map(key => ({
      type: key,
      channels: Object.keys(CAMPAIGN_TEMPLATES[key]),
      languages: Object.keys(CAMPAIGN_TEMPLATES[key].sms || CAMPAIGN_TEMPLATES[key].voice),
    })),
  });
});

// ============================================================================
// SINGLE MESSAGE SENDING
// ============================================================================

/**
 * Send single promotional SMS
 */
router.post('/send/sms', async (req, res) => {
  try {
    const { phone, type, language = 'hi', custom_message } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }
    
    let message;
    if (custom_message) {
      message = custom_message;
    } else {
      const template = CAMPAIGN_TEMPLATES[type];
      if (!template?.sms?.[language]) {
        return res.status(400).json({ error: 'Invalid type or language' });
      }
      message = template.sms[language].replace('{phone}', process.env.MANGWALE_PHONE || '9999999999');
    }
    
    await sendSms(phone, message);
    
    return res.status(200).json({
      success: true,
      message: 'SMS sent',
    });
    
  } catch (err) {
    console.error('Send SMS error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Send single promotional voice call
 */
router.post('/send/voice', async (req, res) => {
  try {
    const { phone, type, language = 'hi', custom_message } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }
    
    let script;
    if (custom_message) {
      script = custom_message;
    } else {
      const template = CAMPAIGN_TEMPLATES[type];
      if (!template?.voice?.[language]) {
        return res.status(400).json({ error: 'Invalid type or language' });
      }
      script = template.voice[language];
    }
    
    await sendVoiceCall(phone, script, language);
    
    return res.status(200).json({
      success: true,
      message: 'Voice call initiated',
    });
    
  } catch (err) {
    console.error('Send voice error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// CAMPAIGN PROCESSOR
// ============================================================================

async function processCampaign(campaign) {
  const { channel, phoneNumbers, template, language, callerId } = campaign;
  
  // Rate limit: 1 message per second
  const RATE_LIMIT_MS = 1000;
  
  for (const phone of phoneNumbers) {
    // Check if campaign still running
    if (campaign.status !== 'running') {
      console.log(`Campaign ${campaign.id} paused/stopped`);
      break;
    }
    
    try {
      if (channel === 'sms' || channel === 'both') {
        const message = template.sms[language].replace('{phone}', process.env.MANGWALE_PHONE || '9999999999');
        await sendSms(phone, message);
        campaign.stats.sent++;
      }
      
      if (channel === 'voice' || channel === 'both') {
        const script = template.voice[language];
        await sendVoiceCall(phone, script, language, callerId);
        campaign.stats.sent++;
      }
      
      emitEvent({
        type: 'campaign.message.sent',
        at: new Date().toISOString(),
        campaignId: campaign.id,
        phone: phone.slice(-4),
        channel,
      });
      
    } catch (err) {
      console.error(`Campaign message failed for ${phone}:`, err.message);
      campaign.stats.failed++;
    }
    
    // Rate limiting
    await sleep(RATE_LIMIT_MS);
  }
  
  // Mark campaign complete
  if (campaign.status === 'running') {
    campaign.status = 'completed';
    campaign.completedAt = new Date().toISOString();
    
    emitEvent({
      type: 'campaign.completed',
      at: new Date().toISOString(),
      campaignId: campaign.id,
      stats: campaign.stats,
    });
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function exotelBaseUrl() {
  const cfg = getConfig();
  const { sid, region, subdomain } = cfg.exotel;
  if (region) return `https://${subdomain}.${region}.exotel.com/v1/Accounts/${sid}`;
  return `https://${subdomain}.exotel.com/v1/Accounts/${sid}`;
}

function auth() {
  const cfg = getConfig();
  return { username: cfg.exotel.apiKey, password: cfg.exotel.apiToken };
}

async function sendSms(to, message) {
  const url = `${exotelBaseUrl()}/Sms/send.json`;
  const params = new URLSearchParams({
    From: process.env.EXOTEL_SENDER_ID || 'MNGWLE',
    To: to,
    Body: message,
  });
  
  const { data } = await axios.post(url, params, { auth: auth() });
  return data;
}

async function sendVoiceCall(to, script, language, callerId) {
  // For TTS-based voice campaigns, we need to:
  // 1. Generate audio from script (via Mercury TTS)
  // 2. Host audio URL
  // 3. Call Exotel with audio URL
  
  // For now, use Exotel's basic call with custom greeting
  const url = `${exotelBaseUrl()}/Calls/connect.json`;
  const params = new URLSearchParams({
    From: to,
    To: to,
    CallerId: callerId || process.env.EXOTEL_CALLER_ID,
    TimeLimit: '60',
    // Exotel will play greeting and disconnect
  });
  
  const { data } = await axios.post(url, params, { auth: auth() });
  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default router;
