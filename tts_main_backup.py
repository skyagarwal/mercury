"""
Mangwale Voice Stack v2 - TTS Service
=====================================
Multi-provider Text-to-Speech with language-aware routing.

Features:
- Kokoro-82M for ultra-fast English (~50ms)
- Indic Parler-TTS for Hindi/Marathi (~300ms)
- ElevenLabs/Deepgram cloud fallback
- Streaming audio output
- Voice customization per language
"""

import os
import io
import time
import asyncio
import logging
from typing import Optional, AsyncGenerator
from contextlib import asynccontextmanager

import torch
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG_MODE", "false").lower() == "true" else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("tts-service")

# Global providers
kokoro_provider = None
indic_parler_provider = None
chatterbox_provider = None
elevenlabs_provider = None
deepgram_provider = None


class SynthesizeRequest(BaseModel):
    """Request model for speech synthesis"""
    text: str
    language: Optional[str] = "auto"  # auto, en, hi, mr
    voice: Optional[str] = None
    speed: float = 1.0
    provider: Optional[str] = None  # Force specific provider


class SynthesizeResponse(BaseModel):
    """Response model for synthesis info"""
    text: str
    language: str
    provider: str
    latency_ms: float
    audio_duration_seconds: float


def detect_language(text: str) -> str:
    """
    Simple language detection based on script.
    Hindi/Marathi use Devanagari, English uses Latin.
    """
    # Check for Devanagari characters (Hindi/Marathi)
    devanagari_count = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    total_chars = len([c for c in text if c.isalpha()])
    
    if total_chars == 0:
        return "en"
    
    devanagari_ratio = devanagari_count / total_chars
    
    if devanagari_ratio > 0.3:
        # Could be Hindi or Marathi - default to Hindi
        # TODO: Add more sophisticated detection
        return "hi"
    else:
        return "en"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler - initialize and cleanup resources"""
    global kokoro_provider, indic_parler_provider, chatterbox_provider, elevenlabs_provider, deepgram_provider
    
    logger.info("🚀 Starting TTS Service...")
    
    # Initialize Kokoro (English)
    if os.getenv("TTS_ENGLISH_PROVIDER", "kokoro") == "kokoro":
        try:
            from providers.kokoro import KokoroProvider
            kokoro_provider = KokoroProvider()
            logger.info("✅ Kokoro TTS provider initialized (English)")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Kokoro: {e}")
    
    # Initialize Indic Parler (Hindi/Marathi) - kept for backward compatibility
    if os.getenv("TTS_INDIC_PROVIDER", "chatterbox") == "indic-parler":
        try:
            from providers.indic_parler import IndicParlerProvider
            indic_parler_provider = IndicParlerProvider()
            logger.info("✅ Indic Parler TTS provider initialized (Hindi/Marathi)")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Indic Parler: {e}")
    
    # Initialize ChatterBox (Hindi/Marathi - higher quality)
    if os.getenv("TTS_INDIC_PROVIDER", "chatterbox") == "chatterbox":
        try:
            from providers.chatterbox import ChatterboxProvider
            chatterbox_provider = ChatterboxProvider()
            logger.info("✅ ChatterBox TTS provider initialized (Hindi/Multilingual)")
        except Exception as e:
            logger.error(f"❌ Failed to initialize ChatterBox: {e}")
    
    # Initialize cloud fallbacks
    if os.getenv("ENABLE_CLOUD_FALLBACK", "true").lower() == "true":
        # ElevenLabs
        elevenlabs_key = os.getenv("ELEVENLABS_API_KEY")
        if elevenlabs_key and elevenlabs_key != "your_elevenlabs_api_key_here":
            try:
                from providers.elevenlabs import ElevenLabsProvider
                elevenlabs_provider = ElevenLabsProvider(api_key=elevenlabs_key)
                logger.info("✅ ElevenLabs TTS provider initialized")
            except Exception as e:
                logger.error(f"❌ Failed to initialize ElevenLabs: {e}")
        
        # Deepgram
        deepgram_key = os.getenv("DEEPGRAM_API_KEY")
        if deepgram_key and deepgram_key != "your_deepgram_api_key_here":
            try:
                from providers.deepgram_tts import DeepgramTTSProvider
                deepgram_provider = DeepgramTTSProvider(api_key=deepgram_key)
                logger.info("✅ Deepgram TTS provider initialized")
            except Exception as e:
                logger.error(f"❌ Failed to initialize Deepgram TTS: {e}")
    
    # Log available providers
    providers = []
    if kokoro_provider: providers.append("kokoro")
    if indic_parler_provider: providers.append("indic-parler")
    if chatterbox_provider: providers.append("chatterbox")
    if elevenlabs_provider: providers.append("elevenlabs")
    if deepgram_provider: providers.append("deepgram")
    logger.info(f"Available TTS providers: {providers}")
    
    yield
    
    # Cleanup
    logger.info("🛑 Shutting down TTS Service...")


# Create FastAPI app
app = FastAPI(
    title="Mangwale TTS Service",
    description="Multi-provider Text-to-Speech with language-aware routing",
    version="2.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_provider_for_language(language: str, forced_provider: Optional[str] = None):
    """
    Get the best TTS provider for the given language.
    
    Returns (provider, provider_name)
    """
    if forced_provider:
        provider_map = {
            "kokoro": kokoro_provider,
            "indic-parler": indic_parler_provider,
            "chatterbox": chatterbox_provider,
            "elevenlabs": elevenlabs_provider,
            "deepgram": deepgram_provider
        }
        provider = provider_map.get(forced_provider)
        if provider:
            return provider, forced_provider
    
    # Language-based routing
    if language == "en":
        # English: Prefer Kokoro (ultra-fast)
        if kokoro_provider:
            return kokoro_provider, "kokoro"
        if elevenlabs_provider:
            return elevenlabs_provider, "elevenlabs"
        if deepgram_provider:
            return deepgram_provider, "deepgram"
    
    elif language in ["hi", "mr"]:
        # Hindi/Marathi: Prefer ChatterBox (higher quality)
        if chatterbox_provider:
            return chatterbox_provider, "chatterbox"
        if indic_parler_provider:
            return indic_parler_provider, "indic-parler"
        if elevenlabs_provider:
            return elevenlabs_provider, "elevenlabs"
    
    # Fallback to any available provider
    if kokoro_provider:
        return kokoro_provider, "kokoro"
    if chatterbox_provider:
        return chatterbox_provider, "chatterbox"
    if indic_parler_provider:
        return indic_parler_provider, "indic-parler"
    if elevenlabs_provider:
        return elevenlabs_provider, "elevenlabs"
    if deepgram_provider:
        return deepgram_provider, "deepgram"
    
    return None, None


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "tts",
        "providers": {
            "kokoro": kokoro_provider is not None,
            "indic_parler": indic_parler_provider is not None,
            "elevenlabs": elevenlabs_provider is not None,
            "deepgram": deepgram_provider is not None
        },
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    }


@app.get("/info")
async def service_info():
    """Get service information"""
    info = {
        "service": "Mangwale TTS v2",
        "supported_languages": ["en", "hi", "mr"],
        "providers": {
            "english": os.getenv("TTS_ENGLISH_PROVIDER", "kokoro"),
            "indic": os.getenv("TTS_INDIC_PROVIDER", "indic-parler"),
            "fallback": os.getenv("TTS_FALLBACK_PROVIDER", "elevenlabs")
        },
        "features": {
            "streaming": os.getenv("TTS_STREAMING_ENABLED", "true").lower() == "true",
            "cloud_fallback": os.getenv("ENABLE_CLOUD_FALLBACK", "true").lower() == "true"
        },
        "sample_rate": int(os.getenv("TTS_SAMPLE_RATE", 24000))
    }
    
    if torch.cuda.is_available():
        info["gpu"] = {
            "name": torch.cuda.get_device_name(0),
            "memory_total": f"{torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f}GB",
            "memory_allocated": f"{torch.cuda.memory_allocated(0) / 1024**3:.2f}GB"
        }
    
    return info


@app.get("/voices")
async def list_voices():
    """List available voices for each provider"""
    voices = {}
    
    if kokoro_provider:
        voices["kokoro"] = {
            "language": "en",
            "voices": kokoro_provider.get_available_voices()
        }
    
    if indic_parler_provider:
        voices["indic-parler"] = {
            "language": "hi, mr",
            "voices": indic_parler_provider.get_available_voices()
        }
    
    return voices


@app.post("/synthesize")
async def synthesize_speech(request: SynthesizeRequest):
    """
    Synthesize speech from text.
    
    Returns WAV audio file.
    """
    start_time = time.time()
    
    # ALWAYS detect actual text language to prevent mismatch
    # (e.g., LLM returns English but client requested Hindi)
    detected_language = detect_language(request.text)
    
    # Use detected language if it doesn't match requested
    # This prevents sending English text to Hindi TTS (causes muffled audio)
    language = request.language
    if language == "auto":
        language = detected_language
        logger.info(f"Auto-detected language: {language}")
    elif language in ["hi", "mr"] and detected_language == "en":
        # LLM responded in English but Hindi was requested - use English TTS
        logger.warning(f"Language mismatch: requested={language}, detected={detected_language}. Using detected language.")
        language = detected_language
    elif language == "en" and detected_language in ["hi", "mr"]:
        # LLM responded in Hindi but English was requested - use Hindi TTS
        logger.warning(f"Language mismatch: requested={language}, detected={detected_language}. Using detected language.")
        language = detected_language
    
    # Get appropriate provider
    provider, provider_name = get_provider_for_language(language, request.provider)
    
    if not provider:
        raise HTTPException(status_code=503, detail="No TTS provider available")
    
    logger.info(f"Synthesizing: '{request.text[:50]}...' with {provider_name} ({language})")
    
    try:
        # Synthesize
        audio_data, sample_rate = await provider.synthesize(
            text=request.text,
            language=language,
            voice=request.voice,
            speed=request.speed
        )
        
        latency_ms = (time.time() - start_time) * 1000
        audio_duration = len(audio_data) / sample_rate
        
        logger.info(f"Synthesis complete: provider={provider_name} latency={latency_ms:.0f}ms duration={audio_duration:.2f}s")
        
        # Convert to WAV bytes
        import soundfile as sf
        buffer = io.BytesIO()
        sf.write(buffer, audio_data, sample_rate, format='WAV')
        buffer.seek(0)
        
        # Return audio with metadata headers
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "X-TTS-Provider": provider_name,
                "X-TTS-Language": language,
                "X-TTS-Latency-Ms": str(int(latency_ms)),
                "X-TTS-Duration-Seconds": str(round(audio_duration, 2))
            }
        )
        
    except Exception as e:
        logger.error(f"Synthesis error with {provider_name}: {e}")
        
        # Try fallback
        if provider_name != "elevenlabs" and elevenlabs_provider:
            logger.info("Trying ElevenLabs fallback...")
            try:
                audio_data, sample_rate = await elevenlabs_provider.synthesize(
                    text=request.text,
                    language=language
                )
                
                buffer = io.BytesIO()
                import soundfile as sf
                sf.write(buffer, audio_data, sample_rate, format='WAV')
                buffer.seek(0)
                
                return StreamingResponse(
                    buffer,
                    media_type="audio/wav",
                    headers={"X-TTS-Provider": "elevenlabs-fallback"}
                )
            except Exception as fallback_error:
                logger.error(f"Fallback also failed: {fallback_error}")
        
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/synthesize/stream")
async def synthesize_speech_streaming(request: SynthesizeRequest):
    """
    Synthesize speech with streaming output.
    
    Returns audio chunks as they're generated for lower latency.
    """
    language = request.language
    if language == "auto":
        language = detect_language(request.text)
    
    provider, provider_name = get_provider_for_language(language, request.provider)
    
    if not provider:
        raise HTTPException(status_code=503, detail="No TTS provider available")
    
    if not hasattr(provider, 'synthesize_streaming'):
        # Fall back to non-streaming
        return await synthesize_speech(request)
    
    async def audio_stream():
        """Generator for streaming audio chunks"""
        try:
            async for chunk in provider.synthesize_streaming(
                text=request.text,
                language=language,
                voice=request.voice,
                speed=request.speed
            ):
                yield chunk
        except Exception as e:
            logger.error(f"Streaming synthesis error: {e}")
            raise
    
    return StreamingResponse(
        audio_stream(),
        media_type="audio/wav",
        headers={
            "X-TTS-Provider": provider_name,
            "X-TTS-Language": language,
            "X-TTS-Streaming": "true"
        }
    )


if __name__ == "__main__":
    port = int(os.getenv("TTS_PORT", 7002))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=os.getenv("DEBUG_MODE", "false").lower() == "true"
    )
