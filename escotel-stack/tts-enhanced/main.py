"""
🔊 Next-Gen TTS Service - Multi-Model Text-to-Speech
December 2025 - Mangwale Voice Stack

Supported Models:
  - Chatterbox-Turbo (350M) - English with paralinguistic tags
  - Indic-Parler-TTS (900M) - 21 Indian languages
  - Kokoro-82M - Ultra-fast English
  - CosyVoice3 (0.5B) - Streaming multilingual
  - VibeVoice-Realtime (0.5B) - Long-form streaming

Features:
  - Language-aware routing
  - Streaming audio output
  - Paralinguistic tags ([laugh], [sigh], etc.)
  - Voice cloning support
  - Cloud fallback (ElevenLabs, Deepgram)
"""

import os
import io
import re
import time
import asyncio
import logging
import numpy as np
from typing import Optional, AsyncGenerator, Dict, Any, List
from enum import Enum
from dataclasses import dataclass

import torch
import torchaudio
from fastapi import FastAPI, HTTPException, Request, File, UploadFile, Form
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import soundfile as sf

# Logging setup
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

class TTSProvider(str, Enum):
    CHATTERBOX = "chatterbox"
    INDIC_PARLER = "indic-parler"
    KOKORO = "kokoro"
    COSYVOICE = "cosyvoice"
    VIBEVOICE = "vibevoice"
    ELEVENLABS = "elevenlabs"
    DEEPGRAM = "deepgram"

@dataclass
class TTSConfig:
    # Model enablement
    chatterbox_enabled: bool = os.getenv("CHATTERBOX_ENABLED", "true").lower() == "true"
    indic_parler_enabled: bool = os.getenv("INDIC_PARLER_ENABLED", "true").lower() == "true"
    kokoro_enabled: bool = os.getenv("KOKORO_ENABLED", "true").lower() == "true"
    cosyvoice_enabled: bool = os.getenv("COSYVOICE_ENABLED", "false").lower() == "true"
    vibevoice_enabled: bool = os.getenv("VIBEVOICE_ENABLED", "false").lower() == "true"
    
    # Language routing
    english_provider: str = os.getenv("TTS_ROUTING_ENGLISH", "chatterbox")
    hindi_provider: str = os.getenv("TTS_ROUTING_HINDI", "indic-parler")
    marathi_provider: str = os.getenv("TTS_ROUTING_MARATHI", "indic-parler")
    
    # Features
    streaming_enabled: bool = os.getenv("TTS_STREAMING_ENABLED", "true").lower() == "true"
    paralinguistic_enabled: bool = os.getenv("ENABLE_PARALINGUISTIC_TAGS", "true").lower() == "true"
    voice_cloning_enabled: bool = os.getenv("ENABLE_VOICE_CLONING", "false").lower() == "true"
    
    # Audio settings
    sample_rate: int = int(os.getenv("TTS_SAMPLE_RATE", "24000"))
    
    # Indic speaker names
    hindi_speaker: str = os.getenv("INDIC_SPEAKER_HINDI", "Rohit")
    marathi_speaker: str = os.getenv("INDIC_SPEAKER_MARATHI", "Sanjay")
    
    # Fallback
    fallback_provider: str = os.getenv("TTS_FALLBACK_PROVIDER", "elevenlabs")
    elevenlabs_api_key: str = os.getenv("ELEVENLABS_API_KEY", "")
    deepgram_api_key: str = os.getenv("DEEPGRAM_API_KEY", "")

config = TTSConfig()

# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class TTSRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize")
    voice: Optional[str] = Field(None, description="Voice/model to use")
    language: Optional[str] = Field("auto", description="Language code (hi, en, mr)")
    speed: Optional[float] = Field(1.0, description="Speaking speed (0.5-2.0)")
    emotion: Optional[str] = Field(None, description="Emotion: happy, sad, neutral, angry")
    stream: Optional[bool] = Field(False, description="Enable streaming response")
    reference_audio: Optional[str] = Field(None, description="Base64 reference audio for cloning")

class TTSResponse(BaseModel):
    audio_url: Optional[str] = None
    audio_base64: Optional[str] = None
    duration_seconds: float
    sample_rate: int
    model_used: str
    latency_ms: float

class VoiceInfo(BaseModel):
    id: str
    name: str
    language: str
    provider: str
    features: List[str]

# ═══════════════════════════════════════════════════════════════════════════════
# MODEL LOADERS
# ═══════════════════════════════════════════════════════════════════════════════

class ModelManager:
    """Manages loading and caching of TTS models."""
    
    def __init__(self):
        self.models: Dict[str, Any] = {}
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"TTS ModelManager initialized on device: {self.device}")
    
    async def load_chatterbox(self):
        """Load Chatterbox-Turbo model."""
        if "chatterbox" in self.models:
            return self.models["chatterbox"]
        
        try:
            logger.info("Loading Chatterbox-Turbo model...")
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            
            model = ChatterboxTurboTTS.from_pretrained(device=self.device)
            self.models["chatterbox"] = model
            logger.info("✅ Chatterbox-Turbo loaded successfully")
            return model
        except Exception as e:
            logger.error(f"Failed to load Chatterbox: {e}")
            return None
    
    async def load_indic_parler(self):
        """Load Indic-Parler-TTS model."""
        if "indic_parler" in self.models:
            return self.models["indic_parler"]
        
        try:
            logger.info("Loading Indic-Parler-TTS model...")
            from parler_tts import ParlerTTSForConditionalGeneration
            from transformers import AutoTokenizer
            
            model = ParlerTTSForConditionalGeneration.from_pretrained(
                "ai4bharat/indic-parler-tts"
            ).to(self.device)
            
            tokenizer = AutoTokenizer.from_pretrained("ai4bharat/indic-parler-tts")
            description_tokenizer = AutoTokenizer.from_pretrained(
                model.config.text_encoder._name_or_path
            )
            
            self.models["indic_parler"] = {
                "model": model,
                "tokenizer": tokenizer,
                "description_tokenizer": description_tokenizer,
                "sample_rate": model.config.sampling_rate
            }
            logger.info("✅ Indic-Parler-TTS loaded successfully")
            return self.models["indic_parler"]
        except Exception as e:
            logger.error(f"Failed to load Indic-Parler: {e}")
            return None
    
    async def load_kokoro(self):
        """Load Kokoro-82M model."""
        if "kokoro" in self.models:
            return self.models["kokoro"]
        
        try:
            logger.info("Loading Kokoro-82M model...")
            from kokoro import KPipeline
            
            pipeline = KPipeline(lang_code='a')
            self.models["kokoro"] = pipeline
            logger.info("✅ Kokoro-82M loaded successfully")
            return pipeline
        except Exception as e:
            logger.error(f"Failed to load Kokoro: {e}")
            return None
    
    async def load_cosyvoice(self):
        """Load CosyVoice3 model."""
        if "cosyvoice" in self.models:
            return self.models["cosyvoice"]
        
        try:
            logger.info("Loading CosyVoice3 model...")
            # CosyVoice requires specific setup
            import sys
            sys.path.append('/app/third_party/Matcha-TTS')
            from cosyvoice.cli.cosyvoice import AutoModel
            
            model = AutoModel(model_dir='/app/models/cosyvoice3')
            self.models["cosyvoice"] = model
            logger.info("✅ CosyVoice3 loaded successfully")
            return model
        except Exception as e:
            logger.error(f"Failed to load CosyVoice3: {e}")
            return None
    
    def get_gpu_memory_usage(self):
        """Get current GPU memory usage."""
        if torch.cuda.is_available():
            allocated = torch.cuda.memory_allocated() / 1024**3
            reserved = torch.cuda.memory_reserved() / 1024**3
            return {"allocated_gb": round(allocated, 2), "reserved_gb": round(reserved, 2)}
        return {"allocated_gb": 0, "reserved_gb": 0}

model_manager = ModelManager()

# ═══════════════════════════════════════════════════════════════════════════════
# TTS SYNTHESIS FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

PARALINGUISTIC_TAGS = {
    "[laugh]": "laughing",
    "[chuckle]": "chuckling lightly",
    "[sigh]": "sighing",
    "[cough]": "coughing",
    "[breath]": "taking a breath",
    "[gasp]": "gasping",
    "[hmm]": "thinking hmm sound"
}

def detect_language(text: str) -> str:
    """Detect language from text (simple heuristic)."""
    # Hindi characters
    if re.search(r'[\u0900-\u097F]', text):
        return "hi"
    # Marathi uses same Devanagari script - check for specific words
    marathi_words = ["आहे", "काय", "करा", "होता", "आणि", "पाहिजे"]
    if any(word in text for word in marathi_words):
        return "mr"
    # Default to English if no Devanagari
    return "en"

def get_provider_for_language(language: str) -> TTSProvider:
    """Get the appropriate TTS provider for a language."""
    routing = {
        "en": TTSProvider(config.english_provider),
        "hi": TTSProvider(config.hindi_provider),
        "mr": TTSProvider(config.marathi_provider),
    }
    return routing.get(language, TTSProvider.INDIC_PARLER)

async def synthesize_chatterbox(
    text: str,
    reference_audio_path: Optional[str] = None,
    **kwargs
) -> tuple[np.ndarray, int]:
    """Synthesize speech using Chatterbox-Turbo."""
    model = await model_manager.load_chatterbox()
    if model is None:
        raise RuntimeError("Chatterbox model not available")
    
    # Generate audio
    if reference_audio_path:
        wav = model.generate(text, audio_prompt_path=reference_audio_path)
    else:
        wav = model.generate(text)
    
    audio = wav.cpu().numpy().squeeze()
    return audio, model.sr

async def synthesize_indic_parler(
    text: str,
    language: str = "hi",
    speaker: Optional[str] = None,
    emotion: Optional[str] = None,
    **kwargs
) -> tuple[np.ndarray, int]:
    """Synthesize speech using Indic-Parler-TTS."""
    model_dict = await model_manager.load_indic_parler()
    if model_dict is None:
        raise RuntimeError("Indic-Parler model not available")
    
    model = model_dict["model"]
    tokenizer = model_dict["tokenizer"]
    desc_tokenizer = model_dict["description_tokenizer"]
    sample_rate = model_dict["sample_rate"]
    
    # Select speaker based on language
    if speaker is None:
        speaker = config.hindi_speaker if language == "hi" else config.marathi_speaker
    
    # Build description
    emotion_desc = emotion if emotion else "neutral"
    description = f"{speaker}'s voice is clear and {emotion_desc}, with a close recording and no background noise."
    
    # Tokenize
    desc_inputs = desc_tokenizer(description, return_tensors="pt").to(model.device)
    prompt_inputs = tokenizer(text, return_tensors="pt").to(model.device)
    
    # Generate
    with torch.no_grad():
        generation = model.generate(
            input_ids=desc_inputs.input_ids,
            attention_mask=desc_inputs.attention_mask,
            prompt_input_ids=prompt_inputs.input_ids,
            prompt_attention_mask=prompt_inputs.attention_mask
        )
    
    audio = generation.cpu().numpy().squeeze()
    return audio, sample_rate

async def synthesize_kokoro(
    text: str,
    voice: str = "af_heart",
    **kwargs
) -> tuple[np.ndarray, int]:
    """Synthesize speech using Kokoro-82M."""
    pipeline = await model_manager.load_kokoro()
    if pipeline is None:
        raise RuntimeError("Kokoro model not available")
    
    # Generate using pipeline
    audio_segments = []
    for i, (gs, ps, audio) in enumerate(pipeline(text, voice=voice)):
        audio_segments.append(audio)
    
    if audio_segments:
        audio = np.concatenate(audio_segments)
    else:
        raise RuntimeError("Kokoro generated no audio")
    
    return audio, 24000

async def synthesize_with_fallback(
    text: str,
    language: str,
    **kwargs
) -> tuple[np.ndarray, int, str]:
    """Try primary provider, fall back if needed."""
    provider = get_provider_for_language(language)
    
    try:
        if provider == TTSProvider.CHATTERBOX:
            audio, sr = await synthesize_chatterbox(text, **kwargs)
            return audio, sr, "chatterbox-turbo"
        
        elif provider == TTSProvider.INDIC_PARLER:
            audio, sr = await synthesize_indic_parler(text, language=language, **kwargs)
            return audio, sr, "indic-parler-tts"
        
        elif provider == TTSProvider.KOKORO:
            audio, sr = await synthesize_kokoro(text, **kwargs)
            return audio, sr, "kokoro-82m"
        
    except Exception as e:
        logger.warning(f"Primary TTS failed ({provider}): {e}, trying fallback...")
    
    # Fallback to Kokoro for English, Indic-Parler for Hindi
    if language == "en":
        try:
            audio, sr = await synthesize_kokoro(text, **kwargs)
            return audio, sr, "kokoro-82m-fallback"
        except:
            pass
    
    # Final fallback to Indic-Parler
    audio, sr = await synthesize_indic_parler(text, language=language, **kwargs)
    return audio, sr, "indic-parler-fallback"

# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Mangwale Next-Gen TTS Service",
    description="Multi-model TTS with Chatterbox, Indic-Parler, Kokoro, and more",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    """Pre-load primary models on startup."""
    logger.info("🚀 Starting TTS Service...")
    
    # Load models based on config
    if config.chatterbox_enabled:
        asyncio.create_task(model_manager.load_chatterbox())
    if config.indic_parler_enabled:
        asyncio.create_task(model_manager.load_indic_parler())
    if config.kokoro_enabled:
        asyncio.create_task(model_manager.load_kokoro())
    
    logger.info("✅ TTS Service startup complete")

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "mangwale-tts-enhanced",
        "models_loaded": list(model_manager.models.keys()),
        "gpu_memory": model_manager.get_gpu_memory_usage()
    }

@app.get("/v1/voices")
async def list_voices() -> List[VoiceInfo]:
    """List available voices."""
    voices = []
    
    if config.chatterbox_enabled:
        voices.append(VoiceInfo(
            id="chatterbox-turbo",
            name="Chatterbox Turbo",
            language="en",
            provider="chatterbox",
            features=["paralinguistic-tags", "voice-cloning", "fast"]
        ))
    
    if config.indic_parler_enabled:
        for speaker in ["Rohit", "Divya", "Aman", "Rani"]:
            voices.append(VoiceInfo(
                id=f"indic-parler-{speaker.lower()}",
                name=f"Indic Parler - {speaker}",
                language="hi",
                provider="indic-parler",
                features=["emotion-control", "high-quality"]
            ))
        for speaker in ["Sanjay", "Sunita"]:
            voices.append(VoiceInfo(
                id=f"indic-parler-{speaker.lower()}",
                name=f"Indic Parler - {speaker}",
                language="mr",
                provider="indic-parler",
                features=["emotion-control", "high-quality"]
            ))
    
    if config.kokoro_enabled:
        for voice in ["af_heart", "af_bella", "am_adam"]:
            voices.append(VoiceInfo(
                id=f"kokoro-{voice}",
                name=f"Kokoro - {voice}",
                language="en",
                provider="kokoro",
                features=["ultra-fast", "lightweight"]
            ))
    
    return voices

@app.post("/v1/audio/speech")
async def synthesize_speech(request: TTSRequest):
    """
    OpenAI-compatible TTS endpoint.
    
    Supports paralinguistic tags in text:
    - [laugh], [chuckle], [sigh], [cough], [breath]
    
    Example:
    {"text": "Hello [chuckle], how can I help you today?", "language": "en"}
    """
    start_time = time.time()
    
    # Detect language if auto
    language = request.language
    if language == "auto":
        language = detect_language(request.text)
    
    logger.info(f"TTS request: lang={language}, text_len={len(request.text)}")
    
    try:
        # Synthesize
        audio, sample_rate, model_used = await synthesize_with_fallback(
            text=request.text,
            language=language,
            speaker=request.voice,
            emotion=request.emotion
        )
        
        # Convert to bytes
        buffer = io.BytesIO()
        sf.write(buffer, audio, sample_rate, format='WAV')
        buffer.seek(0)
        
        latency_ms = (time.time() - start_time) * 1000
        duration = len(audio) / sample_rate
        
        logger.info(f"TTS complete: model={model_used}, duration={duration:.2f}s, latency={latency_ms:.0f}ms")
        
        if request.stream:
            return StreamingResponse(
                buffer,
                media_type="audio/wav",
                headers={
                    "X-Model-Used": model_used,
                    "X-Latency-Ms": str(int(latency_ms)),
                    "X-Duration-Seconds": str(round(duration, 2))
                }
            )
        
        # Return WAV file
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "X-Model-Used": model_used,
                "X-Latency-Ms": str(int(latency_ms)),
                "X-Duration-Seconds": str(round(duration, 2))
            }
        )
        
    except Exception as e:
        logger.error(f"TTS synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/audio/speech/with-emotion")
async def synthesize_with_emotion(
    text: str = Form(...),
    emotion: str = Form("neutral"),
    language: str = Form("auto"),
    voice: Optional[str] = Form(None)
):
    """
    TTS with explicit emotion control.
    
    Emotions: happy, sad, neutral, angry, excited, calm
    """
    return await synthesize_speech(TTSRequest(
        text=text,
        emotion=emotion,
        language=language,
        voice=voice
    ))

@app.post("/v1/audio/clone")
async def clone_voice(
    text: str = Form(...),
    reference_audio: UploadFile = File(...),
    language: str = Form("en")
):
    """
    Voice cloning endpoint.
    
    Requires a 5-10 second reference audio file.
    Currently uses Chatterbox-Turbo for cloning.
    """
    if not config.voice_cloning_enabled:
        raise HTTPException(status_code=400, detail="Voice cloning is disabled")
    
    start_time = time.time()
    
    # Save reference audio temporarily
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        content = await reference_audio.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        # Use Chatterbox for cloning
        audio, sample_rate = await synthesize_chatterbox(
            text=text,
            reference_audio_path=tmp_path
        )
        
        # Convert to bytes
        buffer = io.BytesIO()
        sf.write(buffer, audio, sample_rate, format='WAV')
        buffer.seek(0)
        
        latency_ms = (time.time() - start_time) * 1000
        
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "X-Model-Used": "chatterbox-turbo-clone",
                "X-Latency-Ms": str(int(latency_ms))
            }
        )
        
    finally:
        # Cleanup
        import os
        os.unlink(tmp_path)

@app.get("/v1/models")
async def list_models():
    """List loaded models and their status."""
    return {
        "models": {
            "chatterbox-turbo": {
                "enabled": config.chatterbox_enabled,
                "loaded": "chatterbox" in model_manager.models,
                "language": "en",
                "features": ["paralinguistic-tags", "voice-cloning"]
            },
            "indic-parler-tts": {
                "enabled": config.indic_parler_enabled,
                "loaded": "indic_parler" in model_manager.models,
                "language": "hi,mr,+19 more",
                "features": ["emotion-control", "speaker-selection"]
            },
            "kokoro-82m": {
                "enabled": config.kokoro_enabled,
                "loaded": "kokoro" in model_manager.models,
                "language": "en",
                "features": ["ultra-fast", "lightweight"]
            },
            "cosyvoice3": {
                "enabled": config.cosyvoice_enabled,
                "loaded": "cosyvoice" in model_manager.models,
                "language": "multilingual",
                "features": ["streaming", "instruct"]
            }
        },
        "gpu_memory": model_manager.get_gpu_memory_usage()
    }

@app.get("/metrics")
async def get_metrics():
    """Prometheus-compatible metrics endpoint."""
    gpu_mem = model_manager.get_gpu_memory_usage()
    metrics = [
        f'tts_gpu_memory_allocated_gb {gpu_mem["allocated_gb"]}',
        f'tts_gpu_memory_reserved_gb {gpu_mem["reserved_gb"]}',
        f'tts_models_loaded_count {len(model_manager.models)}',
    ]
    return "\n".join(metrics)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7002)
