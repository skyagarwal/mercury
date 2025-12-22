import { NextRequest, NextResponse } from "next/server";

// Direct Mercury TTS URL - Orpheus TTS on Mercury
const TTS_URL = process.env.VOICE_TTS_URL || "http://192.168.0.151:8010";
const TTS_TIMEOUT = 60000;

// Language to Orpheus voice mapping
// Orpheus voices: tara, leah, jess, leo, dan, mia, zac, zoe
const VOICE_MAP: Record<string, string> = {
  "en": "tara",      // English - Tara sounds natural
  "en-US": "tara",
  "en-IN": "tara",
  "hi": "tara",      // Hindi - Tara also works well
  "hi-IN": "tara",
  "hinglish": "tara",
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
  try {
    const body = await request.json();
    const { text, language = "hi-IN", voice } = body;

    if (!text) {
      return NextResponse.json(
        { success: false, error: "Text is required" },
        { status: 400 }
      );
    }

    // Normalize language: hi-IN -> hi, en-US -> en
    const lang = language.includes("-") ? language.split("-")[0] : language;
    // Use provided voice or map from language
    const orpheusVoice = voice || VOICE_MAP[language] || VOICE_MAP[lang] || "tara";

    console.log(`🔊 TTS: "${text.substring(0, 50)}..." (lang=${lang}, voice=${orpheusVoice})`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT);

    try {
      // Direct call to Mercury Orpheus TTS
      const response = await fetch(`${TTS_URL}/synthesize`, {
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
        console.error(`🔊 TTS error: ${response.status} - ${errorText}`);
        throw new Error(`Orpheus TTS returned ${response.status}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString("base64");

      console.log(`🔊 TTS: Success - ${audioBuffer.byteLength} bytes`);

      return NextResponse.json({
        success: true,
        audio: audioBase64,
        contentType: "audio/wav",
        format: "wav",
        provider: "orpheus-tts",
      });
    } catch (ttsError) {
      clearTimeout(timeoutId);
      console.error("🔊 TTS failed:", ttsError);
      throw ttsError;
    }
  } catch (error) {
    console.error("🔊 TTS error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to synthesize speech" },
      { status: 500 }
    );
  }
}
