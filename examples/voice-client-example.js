/**
 * Mangwale Voice Client - Example WebSocket Voice Streaming
 * 
 * This example shows how to:
 * 1. Connect to the voice gateway via WebSocket
 * 2. Stream audio for real-time transcription (ASR)
 * 3. Request text-to-speech (TTS) and receive audio stream
 * 
 * Usage:
 *   npm install ws
 *   node voice-client-example.js
 */

const WebSocket = require('ws');

// Configuration
const VOICE_GATEWAY_URL = 'ws://192.168.0.151:7100';  // Mercury voice gateway
const LANGUAGE = 'hi';  // Hindi

class VoiceClient {
  constructor(options = {}) {
    this.url = options.url || VOICE_GATEWAY_URL;
    this.language = options.language || LANGUAGE;
    this.token = options.token;  // JWT token for authentication
    this.ws = null;
    this.sessionId = null;
    this.isConnected = false;
    this.audioBuffer = [];
  }

  /**
   * Connect to the voice gateway
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = new URL(this.url);
      wsUrl.searchParams.set('language', this.language);
      if (this.token) {
        wsUrl.searchParams.set('token', this.token);
      }

      console.log(`Connecting to ${wsUrl.href}...`);
      this.ws = new WebSocket(wsUrl.href);

      this.ws.on('open', () => {
        console.log('WebSocket connected');
        this.isConnected = true;
      });

      this.ws.on('message', (data) => {
        // Check if binary (audio data) or text (JSON message)
        if (Buffer.isBuffer(data)) {
          console.log(`Received audio chunk: ${data.length} bytes`);
          this.audioBuffer.push(data);
          this.onAudioReceived?.(data);
        } else {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
            
            if (message.type === 'connected') {
              this.sessionId = message.data.sessionId;
              resolve(this.sessionId);
            }
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`WebSocket closed: ${code} - ${reason}`);
        this.isConnected = false;
        this.onDisconnected?.(code, reason);
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });

      // Timeout for connection
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Handle incoming JSON messages
   */
  handleMessage(message) {
    const { type, data, timestamp } = message;
    console.log(`[${new Date(timestamp).toISOString()}] ${type}:`, JSON.stringify(data, null, 2));

    switch (type) {
      case 'connected':
        console.log('✅ Connected with capabilities:', data.capabilities);
        break;
      case 'asr_result':
        console.log(`📝 Transcription: "${data.text}" (confidence: ${data.confidence})`);
        this.onTranscription?.(data);
        break;
      case 'asr_partial':
        console.log(`📝 Partial: "${data.text}"`);
        this.onPartialTranscription?.(data);
        break;
      case 'asr_complete':
        console.log('✅ Transcription complete');
        break;
      case 'tts_start':
        console.log(`🔊 Generating speech for: "${data.text}"`);
        this.audioBuffer = [];
        break;
      case 'tts_complete':
        console.log(`✅ Speech generated (${this.audioBuffer.length} chunks)`);
        this.onSpeechGenerated?.(Buffer.concat(this.audioBuffer));
        break;
      case 'error':
        console.error(`❌ Error: ${data.message} (${data.code})`);
        this.onError?.(data);
        break;
      case 'recording_started':
        console.log('🎤 Recording started');
        break;
      case 'audio_received':
        console.log(`📦 Audio buffered: ${data.totalBuffered} bytes`);
        break;
    }
  }

  /**
   * Start recording (clears buffer on server)
   */
  startRecording() {
    this.send({ type: 'start_recording' });
  }

  /**
   * Stop recording and get transcription
   */
  stopRecording() {
    this.send({ type: 'stop_recording' });
  }

  /**
   * Send audio chunk for streaming
   */
  sendAudio(audioBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioBuffer);
    }
  }

  /**
   * Request immediate transcription with base64 audio
   */
  transcribe(base64Audio) {
    this.send({
      type: 'transcribe',
      audio: base64Audio,
    });
  }

  /**
   * Request text-to-speech
   */
  speak(text, options = {}) {
    this.send({
      type: 'speak',
      text,
      language: options.language || this.language,
      speaker_wav: options.speakerWav,
      speed: options.speed || 1.0,
      stream: options.stream !== false,  // Default to streaming
    });
  }

  /**
   * Change language
   */
  setLanguage(language) {
    this.language = language;
    this.send({ type: 'set_language', language });
  }

  /**
   * Send JSON message
   */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.error('WebSocket not connected');
    }
  }

  /**
   * Disconnect
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Example usage
async function main() {
  const client = new VoiceClient({
    language: 'hi',
    // token: 'your-jwt-token'  // Optional authentication
  });

  // Set up event handlers
  client.onTranscription = (result) => {
    console.log('\n🎯 Final transcription:', result.text);
  };

  client.onSpeechGenerated = (audioData) => {
    console.log(`\n🔊 Audio generated: ${audioData.length} bytes`);
    // Save or play audio
    const fs = require('fs');
    fs.writeFileSync('/tmp/tts_output.wav', audioData);
    console.log('Audio saved to /tmp/tts_output.wav');
  };

  try {
    // Connect
    const sessionId = await client.connect();
    console.log(`\n✅ Session ID: ${sessionId}\n`);

    // Test TTS - Generate Hindi speech
    console.log('\n--- Testing TTS (Text-to-Speech) ---');
    client.speak('नमस्ते, मैं मंगवाले का AI सहायक हूँ। मैं आपकी क्या मदद कर सकता हूँ?', {
      language: 'hi',
      stream: true,
    });

    // Wait for TTS to complete
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Test with English
    console.log('\n--- Testing English TTS ---');
    client.speak('Hello, I am the Mangwale AI assistant. How can I help you today?', {
      language: 'en',
    });

    await new Promise(resolve => setTimeout(resolve, 10000));

    // Disconnect
    client.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = VoiceClient;
