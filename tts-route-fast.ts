import { NextRequest, NextResponse } from "next/server";

// ElevenLabs Configuration (fast cloud TTS)
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel - natural sounding
const ELEVENLABS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

// Local Orpheus TTS (fallback - slower but free)
const ORPHEUS_URL = process.env.VOICE_TTS_URL || "http://192.168.0.151:8010";

const TTS_TIMEOUT = 15000; // 15 seconds max

// ElevenLabs voice IDs for different styles
const ELEVENLABS_VOICES: Record<string, string> = {
  "rachel": "21m00Tcm4TlvDq8ikWAM",   // Female, calm, natural
  "adam": "pNInz6obpgDQGcFmaJgB",      // Male, deep, professional
  "bella": "EXAVITQu4vr4xnSDxMaL",     // Female, soft, friendly
  "josh": "TxGEqnHWrfWFTfGW9XjX",      // Male, deep, energetic
  "domi": "AZnzlk1XvdvUeBnXmlld",      // Female, strong, assertive
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { text, language = "en", voice = "rachel", useFallback = false } = body;

    if (!text) {
      return NextResponse.json(
        { success: false, error: "Text is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`🔊 TTS Request: "${text.substring(0, 50)}..." (voice=${voice})`);

    // Try ElevenLabs first (unless fallback is requested or no API key)
    if (ELEVENLABS_API_KEY && !useFallback) {
      try {
        const audio = await synthesizeWithElevenLabs(text, voice);
        const elapsed = Date.now() - startTime;
        console.log(`🔊 TTS ElevenLabs: ${audio.byteLength} bytes in ${elapsed}ms`);
        
        return NextResponse.json({
          success: true,
          audio: Buffer.from(audio).toString("base64"),
          contentType: "audio/mpeg",
          format: "mp3",
          provider: "elevenlabs",
          latencyMs: elapsed,
        }, { headers: corsHeaders });
      } catch (elevenError) {
        console.warn(`🔊 ElevenLabs failed, trying Orpheus:`, elevenError);
      }
    }

    // Fallback to local Orpheus TTS
    try {
      const audio = await synthesizeWithOrpheus(text, voice);
      const elapsed = Date.now() - startTime;
      console.log(`🔊 TTS Orpheus: ${audio.byteLength} bytes in ${elapsed}ms`);
      
      return NextResponse.json({
        success: true,
        audio: Buffer.from(audio).toString("base64"),
        contentType: "audio/wav",
        format: "wav",
        provider: "orpheus",
        latencyMs: elapsed,
      }, { headers: corsHeaders });
    } catch (orpheusError) {
      console.error(`🔊 Orpheus also failed:`, orpheusError);
      throw orpheusError;
    }
    
  } catch (error) {
    console.error("🔊 TTS error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to synthesize speech" },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function synthesizeWithElevenLabs(text: string, voice: string): Promise<ArrayBuffer> {
  const voiceId = ELEVENLABS_VOICES[voice] || ELEVENLABS_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT);
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2", // Fastest model with lowest latency
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs returned ${response.status}: ${errorText}`);
    }
    
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function synthesizeWithOrpheus(text: string, voice: string): Promise<ArrayBuffer> {
  // Map to Orpheus voices
  const orpheusVoice = voice === "male" ? "leo" : "tara";
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // Orpheus is slower
  
  try {
    const response = await fetch(`${ORPHEUS_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: orpheusVoice,
        temperature: 0.6,
        top_p: 0.8,
        repetition_penalty: 1.3,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Orpheus returned ${response.status}: ${errorText}`);
    }
    
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeoutId);
  }
}
