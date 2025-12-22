"""
🎤 Next-Gen ASR Service - Enhanced Speech-to-Text
December 2025 - Mangwale Voice Stack

Models:
  - Faster-Whisper large-v3-turbo (Primary) - 4.5x faster, same accuracy
  - AI4Bharat Indic-Conformer (Specialist) - Better for Indian accents
  - Deepgram Nova-2 (Cloud Fallback) - Ultra-low latency

Features:
  - Streaming transcription via WebSocket
  - Language auto-detection
  - Code-switching support (Hindi-English)
  - VAD filtering for cleaner transcripts
  - Real-time partial results
"""

import os
import io
import time
import asyncio
import logging
from typing import Optional, AsyncGenerator, Dict, Any, List
from enum import Enum
from dataclasses import dataclass
import tempfile
import json

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, File, UploadFile, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import soundfile as sf

# Logging setup
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ASRConfig:
    # Model settings
    model_name: str = os.getenv("ASR_MODEL", "large-v3-turbo")
    model_path: str = os.getenv("ASR_MODEL_PATH", "")
    device: str = os.getenv("ASR_DEVICE", "cuda")
    compute_type: str = os.getenv("ASR_COMPUTE_TYPE", "int8_float16")
    
    # Language settings
    language: str = os.getenv("ASR_LANGUAGE", "auto")
    supported_languages: List[str] = os.getenv("ASR_SUPPORTED_LANGUAGES", "hi,en,mr").split(",")
    default_language: str = os.getenv("ASR_DEFAULT_LANGUAGE", "hi")
    
    # Processing settings
    beam_size: int = int(os.getenv("ASR_BEAM_SIZE", "5"))
    best_of: int = int(os.getenv("ASR_BEST_OF", "5"))
    vad_filter: bool = os.getenv("ASR_VAD_FILTER", "true").lower() == "true"
    
    # Streaming settings
    streaming_enabled: bool = os.getenv("ASR_STREAMING_ENABLED", "true").lower() == "true"
    chunk_size_ms: int = int(os.getenv("ASR_CHUNK_SIZE_MS", "100"))
    
    # Indic ASR (optional specialist)
    indic_asr_enabled: bool = os.getenv("INDIC_ASR_ENABLED", "false").lower() == "true"
    indic_asr_model: str = os.getenv("INDIC_ASR_MODEL", "ai4bharat/indic-conformer-600m-multilingual")
    
    # Cloud fallback
    deepgram_api_key: str = os.getenv("DEEPGRAM_API_KEY", "")
    enable_cloud_fallback: bool = os.getenv("ENABLE_CLOUD_FALLBACK", "true").lower() == "true"
    cloud_fallback_timeout_ms: int = int(os.getenv("CLOUD_FALLBACK_TIMEOUT_MS", "5000"))
    
    # Performance
    max_concurrent: int = int(os.getenv("MAX_CONCURRENT_TRANSCRIPTIONS", "4"))
    gpu_memory_fraction: float = float(os.getenv("GPU_MEMORY_FRACTION", "0.25"))

config = ASRConfig()

# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class TranscriptionRequest(BaseModel):
    language: Optional[str] = Field("auto", description="Language code or 'auto'")
    task: Optional[str] = Field("transcribe", description="transcribe or translate")
    beam_size: Optional[int] = Field(None, description="Beam size for decoding")
    vad_filter: Optional[bool] = Field(True, description="Apply VAD filtering")

class TranscriptionResult(BaseModel):
    text: str
    language: str
    confidence: float
    duration_seconds: float
    segments: Optional[List[Dict[str, Any]]] = None
    words: Optional[List[Dict[str, Any]]] = None
    model_used: str
    latency_ms: float

class StreamingSegment(BaseModel):
    type: str  # "partial" or "final"
    text: str
    start: float
    end: float
    language: str

# ═══════════════════════════════════════════════════════════════════════════════
# MODEL MANAGER
# ═══════════════════════════════════════════════════════════════════════════════

class ASRModelManager:
    """Manages ASR models with lazy loading."""
    
    def __init__(self):
        self.models: Dict[str, Any] = {}
        self.device = config.device
        logger.info(f"ASR ModelManager initialized, device: {self.device}")
    
    async def load_whisper(self) -> Any:
        """Load Faster-Whisper model."""
        if "whisper" in self.models:
            return self.models["whisper"]
        
        try:
            logger.info(f"Loading Faster-Whisper {config.model_name}...")
            from faster_whisper import WhisperModel
            
            model = WhisperModel(
                config.model_name,
                device=self.device,
                compute_type=config.compute_type,
                download_root=config.model_path if config.model_path else None,
                local_files_only=bool(config.model_path)
            )
            
            self.models["whisper"] = model
            logger.info(f"✅ Faster-Whisper {config.model_name} loaded")
            return model
            
        except Exception as e:
            logger.error(f"Failed to load Whisper: {e}")
            return None
    
    async def load_indic_asr(self) -> Any:
        """Load AI4Bharat IndicConformer ASR model."""
        if not config.indic_asr_enabled:
            return None
            
        if "indic" in self.models:
            return self.models["indic"]
        
        try:
            logger.info(f"Loading IndicConformer: {config.indic_asr_model}...")
            from transformers import AutoModel
            import torchaudio
            
            # Load IndicConformer - supports all 22 Indian languages
            model = AutoModel.from_pretrained(
                config.indic_asr_model,
                trust_remote_code=True
            )
            
            self.models["indic"] = model
            self.models["torchaudio"] = torchaudio
            logger.info("✅ IndicConformer loaded successfully")
            return model
            
        except Exception as e:
            logger.error(f"Failed to load IndicConformer: {e}")
            return None
    
    async def transcribe_indic(
        self, 
        audio_path: str, 
        language: str = "hi",
        decode_type: str = "ctc"  # "ctc" or "rnnt"
    ) -> TranscriptionResult:
        """Transcribe using IndicConformer - specialized for Indian languages."""
        import time
        start_time = time.time()
        
        model = self.models.get("indic")
        torchaudio = self.models.get("torchaudio")
        
        if model is None:
            raise RuntimeError("IndicConformer not loaded")
        
        # Load and preprocess audio
        wav, sr = torchaudio.load(audio_path)
        wav = torch.mean(wav, dim=0, keepdim=True)  # Convert to mono
        
        # Resample to 16kHz if needed
        target_sr = 16000
        if sr != target_sr:
            resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=target_sr)
            wav = resampler(wav)
            sr = target_sr
        
        # Map language codes
        lang_map = {
            "hi": "hi", "hindi": "hi",
            "mr": "mr", "marathi": "mr", 
            "en": "en", "english": "en",
            "bn": "bn", "bengali": "bn",
            "ta": "ta", "tamil": "ta",
            "te": "te", "telugu": "te",
            "gu": "gu", "gujarati": "gu",
            "kn": "kn", "kannada": "kn",
            "ml": "ml", "malayalam": "ml",
            "pa": "pa", "punjabi": "pa",
            "or": "or", "odia": "or",
            "as": "as", "assamese": "as",
            "ur": "ur", "urdu": "ur",
        }
        lang_code = lang_map.get(language.lower(), "hi")
        
        # Transcribe with IndicConformer
        transcription = model(wav, lang_code, decode_type)
        
        duration = wav.shape[1] / sr
        latency_ms = (time.time() - start_time) * 1000
        
        return TranscriptionResult(
            text=transcription,
            language=lang_code,
            confidence=0.95,  # IndicConformer doesn't return confidence
            duration_seconds=duration,
            segments=None,
            words=None,
            model_used=f"indicconformer-{decode_type}",
            latency_ms=latency_ms
        )
    
    def get_gpu_memory_usage(self) -> Dict[str, float]:
        """Get current GPU memory usage."""
        if torch.cuda.is_available():
            allocated = torch.cuda.memory_allocated() / 1024**3
            reserved = torch.cuda.memory_reserved() / 1024**3
            return {"allocated_gb": round(allocated, 2), "reserved_gb": round(reserved, 2)}
        return {"allocated_gb": 0, "reserved_gb": 0}

model_manager = ASRModelManager()

# ═══════════════════════════════════════════════════════════════════════════════
# TRANSCRIPTION FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

async def transcribe_whisper(
    audio_path: str,
    language: Optional[str] = None,
    beam_size: int = 5,
    vad_filter: bool = True
) -> TranscriptionResult:
    """Transcribe audio using Faster-Whisper."""
    start_time = time.time()
    
    model = await model_manager.load_whisper()
    if model is None:
        raise RuntimeError("Whisper model not available")
    
    # Transcribe
    segments, info = model.transcribe(
        audio_path,
        language=language if language != "auto" else None,
        beam_size=beam_size,
        vad_filter=vad_filter,
        word_timestamps=True
    )
    
    # Collect results
    all_segments = []
    all_words = []
    full_text = []
    
    for segment in segments:
        seg_dict = {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
            "avg_logprob": segment.avg_logprob
        }
        all_segments.append(seg_dict)
        full_text.append(segment.text.strip())
        
        if segment.words:
            for word in segment.words:
                all_words.append({
                    "word": word.word,
                    "start": word.start,
                    "end": word.end,
                    "probability": word.probability
                })
    
    latency_ms = (time.time() - start_time) * 1000
    
    return TranscriptionResult(
        text=" ".join(full_text),
        language=info.language,
        confidence=1 - info.language_probability if info.language_probability else 0.9,
        duration_seconds=info.duration,
        segments=all_segments,
        words=all_words,
        model_used=f"faster-whisper-{config.model_name}",
        latency_ms=latency_ms
    )

async def transcribe_deepgram(
    audio_bytes: bytes,
    language: str = "hi"
) -> TranscriptionResult:
    """Fallback transcription using Deepgram API."""
    if not config.deepgram_api_key:
        raise RuntimeError("Deepgram API key not configured")
    
    import httpx
    
    start_time = time.time()
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.deepgram.com/v1/listen",
            params={
                "model": "nova-2",
                "language": language,
                "punctuate": "true",
                "diarize": "false"
            },
            headers={
                "Authorization": f"Token {config.deepgram_api_key}",
                "Content-Type": "audio/wav"
            },
            content=audio_bytes,
            timeout=config.cloud_fallback_timeout_ms / 1000
        )
        
        if response.status_code != 200:
            raise RuntimeError(f"Deepgram API error: {response.text}")
        
        result = response.json()
        transcript = result["results"]["channels"][0]["alternatives"][0]
        
        latency_ms = (time.time() - start_time) * 1000
        
        return TranscriptionResult(
            text=transcript["transcript"],
            language=language,
            confidence=transcript.get("confidence", 0.9),
            duration_seconds=result.get("metadata", {}).get("duration", 0),
            segments=None,
            words=transcript.get("words"),
            model_used="deepgram-nova-2",
            latency_ms=latency_ms
        )

async def transcribe_with_fallback(
    audio_path: str,
    audio_bytes: Optional[bytes] = None,
    language: str = "auto",
    model_preference: str = "auto",  # auto, whisper, indic
    **kwargs
) -> TranscriptionResult:
    """
    Smart transcription with model selection.
    
    Model selection logic:
    - 'auto': Use IndicConformer for Indian languages, Whisper for others
    - 'whisper': Force Whisper model
    - 'indic': Force IndicConformer (better for Indian accents)
    """
    # Determine which model to use
    indic_languages = {"hi", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa", "or", "as", "ur"}
    
    use_indic = (
        config.indic_asr_enabled and 
        "indic" in model_manager.models and
        (model_preference == "indic" or (model_preference == "auto" and language in indic_languages))
    )
    
    try:
        if use_indic:
            logger.info(f"Using IndicConformer for {language}")
            return await model_manager.transcribe_indic(
                audio_path,
                language=language if language != "auto" else "hi",
                decode_type=kwargs.get("decode_type", "ctc")
            )
        else:
            return await transcribe_whisper(
                audio_path,
                language=language if language != "auto" else None,
                beam_size=kwargs.get("beam_size", config.beam_size),
                vad_filter=kwargs.get("vad_filter", config.vad_filter)
            )
    except Exception as e:
        logger.warning(f"Primary ASR failed: {e}")
        
        # Try fallback to other local model first
        if use_indic:
            try:
                logger.info("Falling back to Whisper...")
                return await transcribe_whisper(
                    audio_path,
                    language=language if language != "auto" else None,
                    beam_size=kwargs.get("beam_size", config.beam_size),
                    vad_filter=kwargs.get("vad_filter", config.vad_filter)
                )
            except Exception as e2:
                logger.warning(f"Whisper also failed: {e2}")
        
        # Finally try cloud
        if config.enable_cloud_fallback and audio_bytes:
            logger.info("Falling back to Deepgram...")
            return await transcribe_deepgram(
                audio_bytes,
                language=language if language != "auto" else config.default_language
            )
        raise

# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Mangwale Next-Gen ASR Service",
    description="GPU-optimized speech-to-text with Whisper-turbo and Indic support",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Semaphore for concurrent transcription limiting
transcription_semaphore = asyncio.Semaphore(config.max_concurrent)

@app.on_event("startup")
async def startup():
    """Pre-load models on startup."""
    logger.info("🚀 Starting ASR Service...")
    
    # Load Whisper model
    asyncio.create_task(model_manager.load_whisper())
    
    # Load Indic model if enabled
    if config.indic_asr_enabled:
        asyncio.create_task(model_manager.load_indic_asr())
    
    logger.info("✅ ASR Service startup complete")

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "mangwale-asr-enhanced",
        "models_loaded": list(model_manager.models.keys()),
        "gpu_memory": model_manager.get_gpu_memory_usage(),
        "config": {
            "model": config.model_name,
            "device": config.device,
            "compute_type": config.compute_type
        }
    }

@app.post("/v1/audio/transcriptions")
async def transcribe_audio(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    beam_size: int = Form(5),
    vad_filter: bool = Form(True)
) -> TranscriptionResult:
    """
    OpenAI-compatible transcription endpoint.
    
    Supports audio formats: wav, mp3, m4a, webm, ogg
    Languages: hi (Hindi), en (English), mr (Marathi), auto
    """
    async with transcription_semaphore:
        start_time = time.time()
        
        # Save uploaded file temporarily
        audio_bytes = await file.read()
        
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            # Convert to WAV if needed
            if file.filename.endswith(('.mp3', '.m4a', '.webm', '.ogg')):
                import subprocess
                with tempfile.NamedTemporaryFile(suffix=f".{file.filename.split('.')[-1]}", delete=False) as src:
                    src.write(audio_bytes)
                    src_path = src.name
                subprocess.run([
                    'ffmpeg', '-i', src_path, '-ar', '16000', '-ac', '1',
                    '-f', 'wav', tmp.name, '-y'
                ], capture_output=True)
                os.unlink(src_path)
            else:
                tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        try:
            result = await transcribe_with_fallback(
                audio_path=tmp_path,
                audio_bytes=audio_bytes,
                language=language,
                beam_size=beam_size,
                vad_filter=vad_filter
            )
            
            logger.info(f"Transcription complete: lang={result.language}, len={len(result.text)}, latency={result.latency_ms:.0f}ms")
            return result
            
        finally:
            os.unlink(tmp_path)

@app.post("/v1/audio/detect-language")
async def detect_language(file: UploadFile = File(...)) -> Dict[str, Any]:
    """
    Detect the language of audio without full transcription.
    """
    audio_bytes = await file.read()
    
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    
    try:
        model = await model_manager.load_whisper()
        if model is None:
            raise HTTPException(status_code=500, detail="ASR model not loaded")
        
        # Just detect language from first segment
        segments, info = model.transcribe(
            tmp_path,
            beam_size=1,
            vad_filter=True
        )
        
        # Consume first segment to get language
        for _ in segments:
            break
        
        return {
            "language": info.language,
            "confidence": info.language_probability,
            "all_probabilities": getattr(info, 'all_language_probs', None)
        }
        
    finally:
        os.unlink(tmp_path)

@app.websocket("/ws/stream")
async def websocket_streaming_asr(websocket: WebSocket):
    """
    Real-time streaming ASR via WebSocket.
    
    Protocol:
    1. Client sends audio chunks as binary
    2. Server sends JSON with partial/final transcripts
    3. Client sends {"type": "end"} to finish
    """
    await websocket.accept()
    logger.info("WebSocket ASR session started")
    
    model = await model_manager.load_whisper()
    if model is None:
        await websocket.send_json({"error": "Model not loaded"})
        await websocket.close()
        return
    
    audio_buffer = io.BytesIO()
    
    try:
        while True:
            data = await websocket.receive()
            
            if data.get("type") == "websocket.receive":
                if "bytes" in data:
                    # Audio chunk received
                    audio_buffer.write(data["bytes"])
                    
                    # Process if buffer is large enough
                    if audio_buffer.tell() > 16000 * 2 * 0.5:  # 0.5 seconds at 16kHz mono
                        audio_buffer.seek(0)
                        audio_data = audio_buffer.read()
                        audio_buffer = io.BytesIO()  # Reset buffer
                        
                        # Save to temp file for processing
                        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                            sf.write(tmp.name, np.frombuffer(audio_data, dtype=np.int16), 16000)
                            
                            try:
                                segments, info = model.transcribe(
                                    tmp.name,
                                    beam_size=3,  # Lower for speed
                                    vad_filter=True
                                )
                                
                                for segment in segments:
                                    await websocket.send_json({
                                        "type": "partial",
                                        "text": segment.text.strip(),
                                        "start": segment.start,
                                        "end": segment.end,
                                        "language": info.language
                                    })
                            finally:
                                os.unlink(tmp.name)
                
                elif "text" in data:
                    msg = json.loads(data["text"]) if isinstance(data["text"], str) else data["text"]
                    if msg.get("type") == "end":
                        await websocket.send_json({"type": "done"})
                        break
                        
    except WebSocketDisconnect:
        logger.info("WebSocket ASR session ended")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.send_json({"error": str(e)})
    finally:
        await websocket.close()

@app.get("/v1/models")
async def list_models():
    """List available ASR models."""
    return {
        "models": {
            "faster-whisper": {
                "variant": config.model_name,
                "loaded": "whisper" in model_manager.models,
                "device": config.device,
                "compute_type": config.compute_type
            },
            "indic-conformer": {
                "enabled": config.indic_asr_enabled,
                "loaded": "indic" in model_manager.models,
                "model": config.indic_asr_model if config.indic_asr_enabled else None
            },
            "deepgram": {
                "enabled": config.enable_cloud_fallback and bool(config.deepgram_api_key),
                "type": "cloud-fallback"
            }
        },
        "gpu_memory": model_manager.get_gpu_memory_usage()
    }

@app.get("/metrics")
async def get_metrics():
    """Prometheus-compatible metrics endpoint."""
    gpu_mem = model_manager.get_gpu_memory_usage()
    metrics = [
        f'asr_gpu_memory_allocated_gb {gpu_mem["allocated_gb"]}',
        f'asr_gpu_memory_reserved_gb {gpu_mem["reserved_gb"]}',
        f'asr_models_loaded_count {len(model_manager.models)}',
    ]
    return "\n".join(metrics)

@app.post("/v1/audio/transcriptions/indic")
async def transcribe_with_indic(
    file: UploadFile = File(...),
    language: str = Form("hi"),
    decode_type: str = Form("ctc")  # ctc or rnnt
) -> TranscriptionResult:
    """
    Force transcription with IndicConformer model.
    Better for Indian language accents and dialects.
    
    Supported languages:
    - hi (Hindi), mr (Marathi), bn (Bengali), ta (Tamil), te (Telugu)
    - gu (Gujarati), kn (Kannada), ml (Malayalam), pa (Punjabi)
    - or (Odia), as (Assamese), ur (Urdu), and more (22 total)
    """
    if not config.indic_asr_enabled:
        raise HTTPException(status_code=400, detail="IndicConformer is not enabled")
    
    async with transcription_semaphore:
        audio_bytes = await file.read()
        
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        try:
            result = await model_manager.transcribe_indic(
                tmp_path,
                language=language,
                decode_type=decode_type
            )
            return result
        finally:
            os.unlink(tmp_path)

@app.post("/v1/audio/compare")
async def compare_models(
    file: UploadFile = File(...),
    language: str = Form("hi")
) -> Dict[str, Any]:
    """
    Compare transcription results from multiple models.
    Useful for testing and quality assessment.
    """
    audio_bytes = await file.read()
    
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    
    results = {}
    
    try:
        # Whisper result
        try:
            whisper_result = await transcribe_whisper(
                tmp_path,
                language=language if language != "auto" else None,
                beam_size=5,
                vad_filter=True
            )
            results["whisper"] = {
                "text": whisper_result.text,
                "language": whisper_result.language,
                "confidence": whisper_result.confidence,
                "latency_ms": whisper_result.latency_ms,
                "model": whisper_result.model_used
            }
        except Exception as e:
            results["whisper"] = {"error": str(e)}
        
        # IndicConformer result (if enabled)
        if config.indic_asr_enabled and "indic" in model_manager.models:
            try:
                indic_result = await model_manager.transcribe_indic(
                    tmp_path,
                    language=language if language != "auto" else "hi",
                    decode_type="ctc"
                )
                results["indic_conformer"] = {
                    "text": indic_result.text,
                    "language": indic_result.language,
                    "confidence": indic_result.confidence,
                    "latency_ms": indic_result.latency_ms,
                    "model": indic_result.model_used
                }
            except Exception as e:
                results["indic_conformer"] = {"error": str(e)}
        else:
            results["indic_conformer"] = {"status": "not_enabled"}
        
        return {
            "comparison": results,
            "recommendation": "indic_conformer" if language in {"hi", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa", "or"} else "whisper"
        }
        
    finally:
        os.unlink(tmp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7001)
