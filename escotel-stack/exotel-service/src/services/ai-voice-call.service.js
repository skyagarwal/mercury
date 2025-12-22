/**
 * AI Voice Call Service for Mangwale
 * 
 * Handles outbound AI-powered voice calls for:
 * - Vendor order confirmation
 * - Rider assignment/instructions
 * - Customer support callbacks
 * - Payment reminders
 * 
 * Architecture:
 * - Jupiter (192.168.0.156) = Brain (decides WHEN/WHO/WHAT)
 * - Mercury (192.168.0.151) = Voice (executes calls, ASR/TTS)
 * 
 * Flow:
 * 1. Jupiter triggers call via POST /api/voice/outbound-call
 * 2. Mercury calls via Exotel
 * 3. Real-time conversation: ASR → Jupiter LLM → TTS
 * 4. Mercury reports results back to Jupiter
 */

import axios from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { getConfig } from '../utils/config.js';
import { emitEvent } from '../utils/events.js';
import { publish } from '../utils/mq.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Jupiter - Brain
const JUPITER_URL = process.env.JUPITER_URL || 'http://192.168.0.156:3200';
const JUPITER_LLM_URL = process.env.JUPITER_LLM_URL || 'http://192.168.0.156:8002';

// Mercury - Voice Services (v2 stack)
const ORCHESTRATOR_URL = process.env.VOICE_AGENT_URL || 'http://192.168.0.151:7000';
const ASR_URL = process.env.ASR_HTTP_URL || 'http://192.168.0.151:7001';
const TTS_URL = process.env.TTS_URL || 'http://192.168.0.151:7002';

// Call Types
const CALL_TYPES = {
  VENDOR_ORDER_CONFIRMATION: 'vendor_order_confirmation',
  VENDOR_ORDER_READY: 'vendor_order_ready',
  RIDER_ASSIGNMENT: 'rider_assignment',
  RIDER_PICKUP_REMINDER: 'rider_pickup_reminder',
  CUSTOMER_SUPPORT: 'customer_support',
  PAYMENT_REMINDER: 'payment_reminder',
  FEEDBACK_REQUEST: 'feedback_request',
};

// Active call sessions
const activeCalls = new Map();

// ============================================================================
// CONVERSATION SCRIPTS (Fetched from Jupiter DB in production)
// ============================================================================

const CONVERSATION_SCRIPTS = {
  vendor_order_confirmation: {
    languages: {
      hi: {
        greeting: 'नमस्ते, यह मंगवाले से कॉल है। आपकी दुकान {storeName} के लिए एक नया ऑर्डर आया है।',
        order_details: 'ऑर्डर नंबर {orderId}, {itemsCount} आइटम, कुल {orderAmount} रुपये। {paymentMethod}।',
        confirmation_prompt: 'क्या आप यह ऑर्डर स्वीकार करते हैं? स्वीकार करने के लिए 1 दबाएं, अस्वीकार करने के लिए 2 दबाएं।',
        accepted: 'धन्यवाद! ऑर्डर स्वीकार हो गया। कृपया जल्द से जल्द तैयार करें।',
        rejected: 'ठीक है, ऑर्डर अस्वीकार हो गया। क्या आप कारण बता सकते हैं?',
        time_prompt: 'ऑर्डर कितने मिनट में तैयार होगा? 15 मिनट के लिए 1, 30 मिनट के लिए 2, 45 मिनट के लिए 3 दबाएं।',
        goodbye: 'धन्यवाद। शुभ दिन!',
        no_response: 'कोई जवाब नहीं मिला। कृपया ऐप चेक करें।',
      },
      en: {
        greeting: 'Hello, this is a call from Mangwale. You have a new order for {storeName}.',
        order_details: 'Order number {orderId}, {itemsCount} items, total {orderAmount} rupees. {paymentMethod}.',
        confirmation_prompt: 'Do you accept this order? Press 1 to accept, press 2 to reject.',
        accepted: 'Thank you! Order accepted. Please prepare it as soon as possible.',
        rejected: 'Okay, order rejected. Can you tell us the reason?',
        time_prompt: 'How many minutes to prepare? Press 1 for 15 minutes, 2 for 30 minutes, 3 for 45 minutes.',
        goodbye: 'Thank you. Have a great day!',
        no_response: 'No response received. Please check the app.',
      },
      mr: {
        greeting: 'नमस्कार, हा मंगवाले कडून कॉल आहे. {storeName} साठी नवीन ऑर्डर आली आहे.',
        order_details: 'ऑर्डर नंबर {orderId}, {itemsCount} आयटम, एकूण {orderAmount} रुपये. {paymentMethod}.',
        confirmation_prompt: 'तुम्ही ही ऑर्डर स्वीकारता का? स्वीकारण्यासाठी 1 दाबा, नाकारण्यासाठी 2 दाबा.',
        accepted: 'धन्यवाद! ऑर्डर स्वीकारली. कृपया लवकरात लवकर तयार करा.',
        rejected: 'ठीक आहे, ऑर्डर नाकारली. कारण सांगू शकता का?',
        time_prompt: 'ऑर्डर किती मिनिटांत तयार होईल? 15 मिनिटांसाठी 1, 30 मिनिटांसाठी 2, 45 मिनिटांसाठी 3 दाबा.',
        goodbye: 'धन्यवाद. शुभ दिन!',
        no_response: 'उत्तर मिळाले नाही. कृपया ॲप तपासा.',
      },
    },
  },
  rider_assignment: {
    languages: {
      hi: {
        greeting: 'नमस्ते, यह मंगवाले से कॉल है। आपके लिए एक नई डिलीवरी है।',
        pickup_details: 'पिकअप: {pickupAddress}। दुकान: {storeName}।',
        delivery_details: 'डिलीवरी: {deliveryAddress}। ग्राहक: {customerName}।',
        confirmation_prompt: 'क्या आप यह डिलीवरी स्वीकार करते हैं? स्वीकार करने के लिए 1 दबाएं।',
        accepted: 'धन्यवाद! पिकअप पता व्हाट्सएप पर भेज दिया गया है।',
        goodbye: 'शुभ दिन!',
      },
      en: {
        greeting: 'Hello, this is Mangwale. You have a new delivery assignment.',
        pickup_details: 'Pickup from: {pickupAddress}. Store: {storeName}.',
        delivery_details: 'Deliver to: {deliveryAddress}. Customer: {customerName}.',
        confirmation_prompt: 'Do you accept this delivery? Press 1 to accept.',
        accepted: 'Thank you! Pickup address sent to WhatsApp.',
        goodbye: 'Have a good day!',
      },
    },
  },
};

// ============================================================================
// AI VOICE CALL HANDLER
// ============================================================================

export class AIVoiceCallHandler extends EventEmitter {
  constructor(callSid, callData) {
    super();
    this.callSid = callSid;
    this.callData = callData;
    this.state = 'initializing';
    this.conversationHistory = [];
    this.dtmfBuffer = '';
    this.startTime = Date.now();
    this.language = callData.language || 'hi';
    this.callType = callData.callType || CALL_TYPES.VENDOR_ORDER_CONFIRMATION;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  /**
   * Get script for current call type and language
   */
  getScript(key) {
    const script = CONVERSATION_SCRIPTS[this.callType];
    if (!script) return key;
    
    const langScripts = script.languages[this.language] || script.languages['en'];
    let text = langScripts[key] || key;
    
    // Replace placeholders with actual data
    const data = this.callData.data || {};
    Object.keys(data).forEach(k => {
      text = text.replace(new RegExp(`{${k}}`, 'g'), data[k]);
    });
    
    return text;
  }

  /**
   * Generate TTS audio for text
   */
  async synthesizeSpeech(text) {
    try {
      console.log(`🔊 TTS: "${text.substring(0, 50)}..."`);
      
      const response = await axios.post(`${TTS_URL}/synthesize`, {
        text,
        language: this.language,
        voice: this.language === 'hi' ? 'hindi_female' : 'english_female',
        format: 'wav',
      }, {
        responseType: 'arraybuffer',
        timeout: 10000,
      });

      return Buffer.from(response.data);
    } catch (error) {
      console.error(`❌ TTS failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Transcribe audio using ASR
   */
  async transcribeAudio(audioBuffer) {
    try {
      const formData = new FormData();
      const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
      formData.append('audio_file', audioBlob, 'audio.wav');
      formData.append('language', this.language);

      const response = await axios.post(`${ASR_URL}/transcribe`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 15000,
      });

      return {
        text: response.data.text || response.data.transcription,
        confidence: response.data.confidence || 0.9,
      };
    } catch (error) {
      console.error(`❌ ASR failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get AI response from Jupiter LLM
   */
  async getAIResponse(userMessage) {
    try {
      const systemPrompt = this.buildSystemPrompt();
      
      const response = await axios.post(`${JUPITER_LLM_URL}/v1/chat/completions`, {
        model: 'Qwen/Qwen2.5-7B-Instruct-AWQ',
        messages: [
          { role: 'system', content: systemPrompt },
          ...this.conversationHistory,
          { role: 'user', content: userMessage },
        ],
        max_tokens: 150,
        temperature: 0.7,
      }, { timeout: 10000 });

      const aiResponse = response.data.choices[0].message.content;
      
      // Add to history
      this.conversationHistory.push({ role: 'user', content: userMessage });
      this.conversationHistory.push({ role: 'assistant', content: aiResponse });
      
      return aiResponse;
    } catch (error) {
      console.error(`❌ LLM failed: ${error.message}`);
      return this.getScript('no_response');
    }
  }

  /**
   * Build system prompt based on call type
   */
  buildSystemPrompt() {
    const data = this.callData.data || {};
    
    if (this.callType === CALL_TYPES.VENDOR_ORDER_CONFIRMATION) {
      return `You are Mangwale AI voice assistant calling a vendor about order #${data.orderId}.
Your goal: Get vendor to confirm/reject order and provide preparation time.
Context:
- Store: ${data.storeName}
- Items: ${data.itemsSummary || data.itemsCount + ' items'}
- Amount: ₹${data.orderAmount}
- Payment: ${data.paymentMethod}

Instructions:
- Be polite and concise
- Speak in ${this.language === 'hi' ? 'Hindi' : this.language === 'mr' ? 'Marathi' : 'English'}
- If vendor says yes/haan/ho, confirm acceptance and ask prep time
- If vendor says no/nahi/nako, ask reason politely
- Keep responses under 30 words`;
    }
    
    if (this.callType === CALL_TYPES.RIDER_ASSIGNMENT) {
      return `You are Mangwale AI voice assistant assigning delivery to a rider.
Context:
- Order: #${data.orderId}
- Pickup: ${data.pickupAddress}
- Delivery: ${data.deliveryAddress}
- Customer: ${data.customerName}

Instructions:
- Be clear about pickup and delivery locations
- Confirm rider understands the assignment
- Speak in ${this.language === 'hi' ? 'Hindi' : 'English'}`;
    }
    
    return `You are Mangwale AI voice assistant. Be helpful and concise. Speak in ${this.language === 'hi' ? 'Hindi' : 'English'}.`;
  }

  /**
   * Handle DTMF input
   */
  handleDTMF(digit) {
    console.log(`📱 DTMF received: ${digit}`);
    this.dtmfBuffer += digit;
    
    // Process based on current state
    if (this.state === 'awaiting_confirmation') {
      if (digit === '1') {
        this.state = 'awaiting_time';
        return {
          action: 'accepted',
          nextPrompt: this.getScript('accepted') + ' ' + this.getScript('time_prompt'),
        };
      } else if (digit === '2') {
        this.state = 'awaiting_rejection_reason';
        return {
          action: 'rejected',
          nextPrompt: this.getScript('rejected'),
        };
      }
    }
    
    if (this.state === 'awaiting_time') {
      const timeMap = { '1': 15, '2': 30, '3': 45 };
      if (timeMap[digit]) {
        this.state = 'completed';
        return {
          action: 'time_selected',
          prepTime: timeMap[digit],
          nextPrompt: this.getScript('goodbye'),
        };
      }
    }
    
    return { action: 'unknown_input' };
  }

  /**
   * Generate initial greeting and order details
   */
  getInitialPrompt() {
    const greeting = this.getScript('greeting');
    const details = this.getScript('order_details');
    const prompt = this.getScript('confirmation_prompt');
    
    this.state = 'awaiting_confirmation';
    
    return `${greeting} ${details} ${prompt}`;
  }

  /**
   * Update call result to Jupiter
   */
  async reportToJupiter(result) {
    try {
      const payload = {
        callSid: this.callSid,
        callType: this.callType,
        result,
        duration: Math.floor((Date.now() - this.startTime) / 1000),
        conversationHistory: this.conversationHistory,
        data: this.callData.data,
      };

      console.log(`📤 Reporting to Jupiter: ${JSON.stringify(result)}`);
      
      await axios.post(`${JUPITER_URL}/api/voice/call-result`, payload, {
        timeout: 10000,
      });

      emitEvent({
        type: 'ai_voice_call.completed',
        at: new Date().toISOString(),
        callSid: this.callSid,
        result,
      });

      // Publish to message queue for order updates
      await publish('voice.call.completed', payload);
      
    } catch (error) {
      console.error(`❌ Failed to report to Jupiter: ${error.message}`);
    }
  }

  /**
   * Clean up call resources
   */
  cleanup() {
    this.removeAllListeners();
    activeCalls.delete(this.callSid);
    console.log(`🧹 Cleaned up call ${this.callSid}`);
  }
}

// ============================================================================
// CALL MANAGER
// ============================================================================

/**
 * Initiate an outbound AI voice call
 */
export async function initiateAICall(callRequest) {
  const {
    phone,
    callType,
    data,
    language = 'hi',
    priority = 5,
  } = callRequest;

  console.log(`📞 Initiating AI call to ${phone} for ${callType}`);

  const config = getConfig();
  const { sid, apiKey, apiToken, subdomain, region } = config.exotel;

  // Build Exotel API URL
  const baseUrl = region 
    ? `https://${subdomain}.${region}.exotel.com/v1/Accounts/${sid}`
    : `https://${subdomain}.exotel.com/v1/Accounts/${sid}`;

  const callerId = config.exotel.callerId || process.env.EXOTEL_CALLER_ID || '02048556923';
  
  // Use public callback URL for Exotel to reach us
  const publicBaseUrl = process.env.EXOTEL_CALLBACK_URL || 'https://exotel.mangwale.ai';

  try {
    // Generate call with callback to our AI handler
    const callbackUrl = `${publicBaseUrl}/api/voice/ai-callback`;
    
    console.log(`📡 Callback URL: ${callbackUrl}`);
    
    const callParams = new URLSearchParams({
      From: callerId,
      To: phone,
      CallerId: callerId,
      CallType: 'trans',
      TimeLimit: 300, // 5 minutes max
      TimeOut: 30, // 30 seconds to answer
      Url: callbackUrl,
      StatusCallback: `${callbackUrl}/status`,
      CustomField: JSON.stringify({
        callType,
        data,
        language,
        priority,
        initiatedAt: new Date().toISOString(),
      }),
    });

    const response = await axios.post(
      `${baseUrl}/Calls/connect.json`,
      callParams.toString(),
      {
        auth: { username: apiKey, password: apiToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const callSid = response.data.Call?.Sid;
    
    if (callSid) {
      // Create call handler
      const handler = new AIVoiceCallHandler(callSid, {
        phone,
        callType,
        data,
        language,
        priority,
      });

      activeCalls.set(callSid, handler);

      console.log(`✅ Call initiated: ${callSid}`);

      emitEvent({
        type: 'ai_voice_call.initiated',
        at: new Date().toISOString(),
        callSid,
        phone,
        callType,
      });

      return {
        success: true,
        callSid,
        status: 'initiated',
      };
    }

    throw new Error('No call SID returned');

  } catch (error) {
    console.error(`❌ Failed to initiate call: ${error.message}`);
    if (error.response) {
      console.error(`❌ Exotel API Response: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Handle Exotel callback for AI call
 */
export async function handleAICallback(callSid, event, body) {
  const handler = activeCalls.get(callSid);
  
  if (!handler) {
    console.warn(`⚠️ No handler for call ${callSid}`);
    return generateDefaultTwiML();
  }

  console.log(`📥 AI Callback: ${callSid} - ${event}`);

  try {
    switch (event) {
      case 'answered':
      case 'gather_start':
        // Call answered, play initial prompt
        const initialPrompt = handler.getInitialPrompt();
        const audioBuffer = await handler.synthesizeSpeech(initialPrompt);
        
        return generateTwiMLWithAudio(audioBuffer, callSid);

      case 'dtmf':
        // DTMF input received
        const digit = body.Digits || body.digits;
        const dtmfResult = handler.handleDTMF(digit);
        
        if (dtmfResult.nextPrompt) {
          const promptAudio = await handler.synthesizeSpeech(dtmfResult.nextPrompt);
          
          // Report result to Jupiter
          if (dtmfResult.action === 'time_selected') {
            await handler.reportToJupiter({
              accepted: true,
              prepTime: dtmfResult.prepTime,
            });
            handler.cleanup();
          } else if (dtmfResult.action === 'rejected') {
            // Wait for reason via speech
          } else if (dtmfResult.action === 'accepted') {
            // Continue to time selection
          }
          
          return generateTwiMLWithAudio(promptAudio, callSid, dtmfResult.action !== 'time_selected');
        }
        break;

      case 'speech':
        // Speech input received
        const speechResult = body.SpeechResult || body.transcript;
        if (speechResult) {
          const aiResponse = await handler.getAIResponse(speechResult);
          const responseAudio = await handler.synthesizeSpeech(aiResponse);
          
          // Check if we should end call
          if (handler.state === 'completed') {
            await handler.reportToJupiter({ completed: true });
            handler.cleanup();
            return generateTwiMLWithAudio(responseAudio, callSid, false);
          }
          
          return generateTwiMLWithAudio(responseAudio, callSid);
        }
        break;

      case 'recording':
        // Recording ready, transcribe
        const recordingUrl = body.RecordingUrl;
        if (recordingUrl) {
          const audioData = await downloadRecording(recordingUrl);
          const transcription = await handler.transcribeAudio(audioData);
          
          if (transcription?.text) {
            const aiResponse = await handler.getAIResponse(transcription.text);
            const responseAudio = await handler.synthesizeSpeech(aiResponse);
            return generateTwiMLWithAudio(responseAudio, callSid);
          }
        }
        break;

      case 'completed':
      case 'no-answer':
      case 'busy':
      case 'failed':
        // Call ended
        await handler.reportToJupiter({
          completed: event === 'completed',
          status: event,
          duration: body.Duration,
        });
        handler.cleanup();
        break;

      default:
        console.log(`Unknown event: ${event}`);
    }

  } catch (error) {
    console.error(`❌ Callback error: ${error.message}`);
  }

  return generateDefaultTwiML();
}

/**
 * Get active call handler
 */
export function getCallHandler(callSid) {
  return activeCalls.get(callSid);
}

/**
 * Get all active calls
 */
export function getActiveCalls() {
  return Array.from(activeCalls.entries()).map(([callSid, handler]) => ({
    callSid,
    callType: handler.callType,
    state: handler.state,
    phone: handler.callData.phone,
    duration: Math.floor((Date.now() - handler.startTime) / 1000),
  }));
}

// ============================================================================
// TWIML GENERATION
// ============================================================================

function generateTwiMLWithAudio(audioBuffer, callSid, continueGathering = true) {
  // For Exotel, we'd typically use Play with a URL
  // In this case, we'll use streaming or base64
  
  const gatherConfig = continueGathering ? `
    <Gather input="dtmf speech" action="http://192.168.0.151:3100/api/voice/ai-callback/${callSid}/dtmf"
            numDigits="1" speechTimeout="3" timeout="10">
  ` : '';
  
  const gatherEnd = continueGathering ? '</Gather>' : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gatherConfig}
  <Say voice="alice">Audio response here</Say>
  ${gatherEnd}
</Response>`;
}

function generateDefaultTwiML() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling Mangwale.</Say>
</Response>`;
}

async function downloadRecording(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (error) {
    console.error(`Failed to download recording: ${error.message}`);
    return null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// All functions are already exported inline above via 'export function...'
// AIVoiceCallHandler is already exported via 'export class...'
// CALL_TYPES needs to be exported:
export { CALL_TYPES };

// Default export for compatibility
export default {
  initiateAICall,
  handleAICallback,
  getCallHandler,
  getActiveCalls,
  AIVoiceCallHandler,
  CALL_TYPES,
};
