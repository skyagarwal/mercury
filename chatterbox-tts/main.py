"""
ChatterBox TTS Service for Mangwale Voice Stack
===============================================
High-quality multilingual TTS using ChatterBox by Resemble AI.
Supports 23 languages including Hindi.

Features:
- Zero-shot voice cloning
- Hindi/Marathi support via multilingual model
- Emotion/exaggeration control
- Fast inference on GPU
"""

import os
import io
import time
import logging
from typing import Optional
from contextlib import asynccontextmanager

import torch
import torchaudio
import numpy as np
from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG_MODE", "false").lower() == "true" else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("chatterbox-tts")

# Global models
english_model = None
multilingual_model = None


class SynthesizeRequest(BaseModel):
    """Request model for speech synthesis"""
    text: str
    language: str = "en"  # en, hi, mr, etc.
    voice_file: Optional[str] = None  # Path to reference audio for voice cloning
    exaggeration: float = 0.5  # 0.0-1.0, higher = more expressive
    cfg_weight: float = 0.5  # 0.0-1.0, lower = more natural pacing


# Language code mapping for ChatterBox
LANGUAGE_CODES = {
    "en": "en",
    "hi": "hi",
    "mr": "hi",  # Marathi uses Hindi model with similar script
    "bn": "bn",  # Bengali (if available)
    "ta": "ta",  # Tamil
    "te": "te",  # Telugu
    "gu": "gu",  # Gujarati
    "kn": "kn",  # Kannada
    "ml": "ml",  # Malayalam
    "pa": "pa",  # Punjabi
    "ar": "ar",
    "zh": "zh",
    "ja": "ja",
    "ko": "ko",
    "fr": "fr",
    "de": "de",
    "es": "es",
    "it": "it",
    "pt": "pt",
    "ru": "ru",
    "nl": "nl",
    "pl": "pl",
    "tr": "tr",
    "sv": "sv",
    "da": "da",
    "fi": "fi",
    "no": "no",
    "el": "el",
    "he": "he",
    "ms": "ms",
    "sw": "sw",
}


def load_models():
    """Load ChatterBox TTS models"""
    global english_model, multilingual_model
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Loading ChatterBox models on {device}...")
    
    try:
        from chatterbox.tts import ChatterboxTTS
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        
        # Load English model (faster, better for English)
        logger.info("Loading ChatterBox English model...")
        english_model = ChatterboxTTS.from_pretrained(device=device)
        logger.info("✅ ChatterBox English model loaded")
        
        # Load Multilingual model (supports Hindi and 22 other languages)
        logger.info("Loading ChatterBox Multilingual model...")
        multilingual_model = ChatterboxMultilingualTTS.from_pretrained(device=device)
        logger.info("✅ ChatterBox Multilingual model loaded")
        
        if torch.cuda.is_available():
            allocated = torch.cuda.memory_allocated(0) / 1024**3
            logger.info(f"GPU memory used: {allocated:.2f}GB")
            
    except Exception as e:
        logger.error(f"Failed to load ChatterBox models: {e}")
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - load models on startup"""
    logger.info("🚀 Starting ChatterBox TTS Service...")
    load_models()
    yield
    logger.info("🛑 Shutting down ChatterBox TTS Service...")


app = FastAPI(
    title="ChatterBox TTS Service",
    description="High-quality multilingual TTS with voice cloning",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "chatterbox-tts",
        "models": {
            "english": english_model is not None,
            "multilingual": multilingual_model is not None
        },
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    }


@app.get("/info")
async def service_info():
    """Get service information"""
    return {
        "service": "ChatterBox TTS",
        "supported_languages": list(LANGUAGE_CODES.keys()),
        "features": {
            "voice_cloning": True,
            "emotion_control": True,
            "streaming": False  # ChatterBox doesn't support streaming yet
        },
        "sample_rate": english_model.sr if english_model else 24000
    }


@app.get("/voices")
async def list_voices():
    """List available voice presets"""
    voice_dir = "/app/voices"
    voices = {}
    
    if os.path.exists(voice_dir):
        for lang_dir in os.listdir(voice_dir):
            lang_path = os.path.join(voice_dir, lang_dir)
            if os.path.isdir(lang_path):
                voices[lang_dir] = [f.replace(".wav", "") for f in os.listdir(lang_path) if f.endswith(".wav")]
    
    return {
        "voices": voices,
        "default_voice": "Use audio_prompt for voice cloning, or leave empty for model's default voice"
    }


def get_model_for_language(language: str):
    """Get the appropriate model for the given language"""
    lang_code = LANGUAGE_CODES.get(language, "en")
    
    if lang_code == "en" and english_model is not None:
        return english_model, "en"
    elif multilingual_model is not None:
        return multilingual_model, lang_code
    else:
        return english_model, "en"


@app.post("/synthesize")
async def synthesize_speech(request: SynthesizeRequest):
    """
    Synthesize speech from text.
    
    - **text**: Text to synthesize
    - **language**: Language code (en, hi, mr, etc.)
    - **voice_file**: Path to reference audio for voice cloning (optional)
    - **exaggeration**: Emotion intensity 0.0-1.0 (default 0.5)
    - **cfg_weight**: Classifier-free guidance weight 0.0-1.0 (default 0.5)
    """
    start_time = time.time()
    
    model, lang_code = get_model_for_language(request.language)
    
    if model is None:
        raise HTTPException(status_code=503, detail="TTS models not loaded")
    
    logger.info(f"Synthesizing: '{request.text[:50]}...' in language={lang_code}")
    
    try:
        # Prepare kwargs
        kwargs = {
            "exaggeration": request.exaggeration,
            "cfg_weight": request.cfg_weight
        }
        
        # Add voice reference if provided
        if request.voice_file and os.path.exists(request.voice_file):
            kwargs["audio_prompt_path"] = request.voice_file
        
        # Check if it's multilingual model
        if hasattr(model, 'generate') and request.language != "en":
            # Multilingual model needs language_id
            wav = model.generate(
                request.text,
                language_id=lang_code,
                **kwargs
            )
        else:
            # English model
            wav = model.generate(request.text, **kwargs)
        
        latency_ms = (time.time() - start_time) * 1000
        audio_duration = wav.shape[-1] / model.sr
        
        logger.info(f"Synthesis complete: latency={latency_ms:.0f}ms duration={audio_duration:.2f}s")
        
        # Convert to WAV bytes
        buffer = io.BytesIO()
        torchaudio.save(buffer, wav, model.sr, format="wav")
        buffer.seek(0)
        
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "X-Language": lang_code,
                "X-Sample-Rate": str(model.sr),
                "X-Duration": str(audio_duration),
                "X-Latency-Ms": str(int(latency_ms))
            }
        )
        
    except Exception as e:
        logger.error(f"Synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/synthesize/with-voice")
async def synthesize_with_voice(
    text: str = Form(...),
    language: str = Form("en"),
    exaggeration: float = Form(0.5),
    cfg_weight: float = Form(0.5),
    voice: UploadFile = File(None)
):
    """
    Synthesize speech with an uploaded voice reference for cloning.
    """
    start_time = time.time()
    
    model, lang_code = get_model_for_language(language)
    
    if model is None:
        raise HTTPException(status_code=503, detail="TTS models not loaded")
    
    logger.info(f"Synthesizing with voice clone: '{text[:50]}...' in language={lang_code}")
    
    try:
        kwargs = {
            "exaggeration": exaggeration,
            "cfg_weight": cfg_weight
        }
        
        # Save uploaded voice file temporarily
        voice_path = None
        if voice:
            voice_path = f"/tmp/voice_ref_{int(time.time())}.wav"
            with open(voice_path, "wb") as f:
                content = await voice.read()
                f.write(content)
            kwargs["audio_prompt_path"] = voice_path
        
        try:
            # Generate audio
            if hasattr(model, 'generate') and language != "en":
                wav = model.generate(text, language_id=lang_code, **kwargs)
            else:
                wav = model.generate(text, **kwargs)
        finally:
            # Clean up temp file
            if voice_path and os.path.exists(voice_path):
                os.remove(voice_path)
        
        latency_ms = (time.time() - start_time) * 1000
        audio_duration = wav.shape[-1] / model.sr
        
        logger.info(f"Synthesis complete: latency={latency_ms:.0f}ms duration={audio_duration:.2f}s")
        
        # Convert to WAV bytes
        buffer = io.BytesIO()
        torchaudio.save(buffer, wav, model.sr, format="wav")
        buffer.seek(0)
        
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "X-Language": lang_code,
                "X-Sample-Rate": str(model.sr),
                "X-Duration": str(audio_duration),
                "X-Latency-Ms": str(int(latency_ms))
            }
        )
        
    except Exception as e:
        logger.error(f"Synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 7003)),
        workers=1,
        log_level="info"
    )
