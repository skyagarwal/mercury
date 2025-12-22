"""
Indic Parler-TTS Service
High-quality Text-to-Speech for Indian languages
Supports: Hindi, Marathi, Bengali, Tamil, Telugu, and 16 more languages
"""

import os
import io
import tempfile
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import torch
import soundfile as sf
import numpy as np

# Configuration
MODEL_NAME = os.getenv("TTS_MODEL", "ai4bharat/indic-parler-tts")
DEVICE = os.getenv("TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DEFAULT_SPEAKER = os.getenv("DEFAULT_SPEAKER", "Divya")  # Recommended Hindi female
DEFAULT_DESCRIPTION = os.getenv("DEFAULT_DESCRIPTION", 
    "Divya speaks with a clear, pleasant voice. High quality recording with no background noise.")

# Global model
model = None
tokenizer = None
description_tokenizer = None

def load_model():
    global model, tokenizer, description_tokenizer
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer
    
    print(f"Loading Indic Parler-TTS model: {MODEL_NAME}")
    print(f"  Device: {DEVICE}")
    
    model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL_NAME).to(DEVICE)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    description_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)
    
    print("✅ Model loaded successfully!")
    return model

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    load_model()
    yield
    # Shutdown
    pass

app = FastAPI(
    title="Indic Parler-TTS",
    description="High-quality Indian language TTS with emotion control",
    version="1.0.0",
    lifespan=lifespan
)

# Available voices for reference
VOICES = {
    "hindi": ["Rohit", "Divya", "Aman", "Rani"],
    "marathi": ["Sanjay", "Sunita", "Nikhil", "Radha"],
    "bengali": ["Arjun", "Aditi", "Tapan", "Rashmi"],
    "english": ["Thoma", "Mary", "Priya", "Tarun"],
    "gujarati": ["Yash", "Neha"],
    "tamil": ["Kavitha", "Jaya"],
    "telugu": ["Prakash", "Lalitha"],
}

EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "command", "narration"]

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    description: Optional[str] = None
    emotion: Optional[str] = "neutral"
    speed: Optional[str] = "moderate"  # slow, moderate, fast
    
class TTSResponse(BaseModel):
    status: str
    audio_length: float
    voice: str
    sample_rate: int

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model": MODEL_NAME,
        "device": DEVICE,
        "model_loaded": model is not None,
        "languages": ["hi", "mr", "bn", "ta", "te", "gu", "ml", "kn", "pa", "en"]
    }

@app.get("/")
async def root():
    return {
        "service": "indic-parler-tts",
        "model": MODEL_NAME,
        "voices": VOICES,
        "emotions": EMOTIONS
    }

@app.get("/voices")
async def list_voices():
    return VOICES

def build_description(voice: str, emotion: str = "neutral", speed: str = "moderate"):
    """Build a natural description for voice generation."""
    
    emotion_map = {
        "neutral": "neutral tone",
        "happy": "happy, energetic tone",
        "sad": "soft, melancholic tone", 
        "angry": "firm, assertive tone",
        "surprised": "excited, surprised tone",
        "command": "authoritative, commanding tone",
        "narration": "calm, storytelling tone"
    }
    
    speed_map = {
        "slow": "slow pace",
        "moderate": "moderate pace",
        "fast": "fast pace"
    }
    
    emotion_text = emotion_map.get(emotion, "neutral tone")
    speed_text = speed_map.get(speed, "moderate pace")
    
    return f"{voice} speaks with a {emotion_text} at a {speed_text}. Clear, high-quality recording with no background noise."

@app.post("/tts")
async def generate_speech(request: TTSRequest):
    """
    Generate speech from text.
    
    - **text**: Text to synthesize
    - **voice**: Speaker name (Divya, Rohit, etc.)
    - **description**: Custom voice description (overrides voice/emotion)
    - **emotion**: Emotion style (neutral, happy, sad, angry)
    - **speed**: Speaking speed (slow, moderate, fast)
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    try:
        # Build description
        voice = request.voice or DEFAULT_SPEAKER
        if request.description:
            description = request.description
        else:
            description = build_description(voice, request.emotion or "neutral", request.speed or "moderate")
        
        # Tokenize
        description_input_ids = description_tokenizer(description, return_tensors="pt").to(DEVICE)
        prompt_input_ids = tokenizer(request.text, return_tensors="pt").to(DEVICE)
        
        # Generate audio
        with torch.no_grad():
            generation = model.generate(
                input_ids=description_input_ids.input_ids,
                attention_mask=description_input_ids.attention_mask,
                prompt_input_ids=prompt_input_ids.input_ids,
                prompt_attention_mask=prompt_input_ids.attention_mask
            )
        
        # Convert to numpy
        audio_arr = generation.cpu().numpy().squeeze()
        sample_rate = model.config.sampling_rate
        
        # Return as WAV
        buffer = io.BytesIO()
        sf.write(buffer, audio_arr, sample_rate, format='WAV')
        buffer.seek(0)
        
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "X-Voice": voice,
                "X-Sample-Rate": str(sample_rate),
                "X-Duration": str(len(audio_arr) / sample_rate)
            }
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts/stream")
async def generate_speech_stream(request: TTSRequest):
    """Stream audio generation (for lower latency)."""
    # For now, same as /tts - streaming requires model changes
    return await generate_speech(request)

# Legacy endpoint for compatibility with existing XTTS API
@app.post("/api/tts")
async def legacy_tts(
    text: str,
    language: str = "hi",
    speaker_wav: Optional[str] = None
):
    """Legacy endpoint compatible with XTTS API."""
    request = TTSRequest(text=text, voice=speaker_wav or DEFAULT_SPEAKER)
    return await generate_speech(request)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5501)
