"""
Streaming ASR with Silero VAD
=============================
Features:
- Real-time voice activity detection
- Streaming transcription with interim results
- Automatic speech endpoint detection
- WebSocket streaming support
"""

import os
import sys
import asyncio
import numpy as np
import torch
import io
import time
from typing import Optional, AsyncGenerator
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Silero VAD
torch.set_num_threads(1)
vad_model = None
vad_utils = None

# Whisper
whisper_model = None
executor = ThreadPoolExecutor(max_workers=2)

# Config
SAMPLE_RATE = 16000
VAD_THRESHOLD = float(os.getenv("VAD_THRESHOLD", "0.5"))
SILENCE_DURATION_MS = int(os.getenv("SILENCE_DURATION_MS", "700"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "float16")

class TranscribeResponse(BaseModel):
    text: str
    language: str
    confidence: float
    duration_ms: int
    is_final: bool

@asynccontextmanager
async def lifespan(app: FastAPI):
    global vad_model, vad_utils, whisper_model
    
    logger.info("🎤 Initializing Streaming ASR with VAD...")
    
    # Load Silero VAD
    try:
        vad_model, vad_utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False
        )
        logger.info("✅ Silero VAD loaded")
    except Exception as e:
        logger.error(f"Failed to load VAD: {e}")
    
    # Load Faster-Whisper
    try:
        from faster_whisper import WhisperModel
        whisper_model = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
        )
        logger.info(f"✅ Whisper {WHISPER_MODEL} loaded on {WHISPER_DEVICE}")
    except Exception as e:
        logger.error(f"Failed to load Whisper: {e}")
    
    yield
    
    logger.info("🛑 Shutting down...")

app = FastAPI(
    title="Streaming ASR with VAD",
    description="Real-time speech recognition with voice activity detection",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def detect_speech(audio_chunk: np.ndarray) -> float:
    """Detect speech probability using Silero VAD"""
    global vad_model
    if vad_model is None:
        return 1.0  # Assume speech if no VAD
    
    try:
        # Convert to tensor
        audio_tensor = torch.from_numpy(audio_chunk).float()
        
        # Get speech probability
        speech_prob = vad_model(audio_tensor, SAMPLE_RATE).item()
        return speech_prob
    except Exception as e:
        logger.error(f"VAD error: {e}")
        return 1.0

def transcribe_sync(audio_data: bytes, language: str = "hi") -> dict:
    """Synchronous transcription"""
    global whisper_model
    
    if whisper_model is None:
        raise RuntimeError("Whisper model not loaded")
    
    # Convert bytes to numpy array
    import soundfile as sf
    audio_array, sr = sf.read(io.BytesIO(audio_data))
    
    # Resample if needed
    if sr != SAMPLE_RATE:
        import librosa
        audio_array = librosa.resample(audio_array, orig_sr=sr, target_sr=SAMPLE_RATE)
    
    # Transcribe
    start_time = time.time()
    segments, info = whisper_model.transcribe(
        audio_array,
        language=language if language != "auto" else None,
        task="transcribe",
        beam_size=1,
        best_of=1,
        vad_filter=True,
    )
    
    # Collect results
    text = " ".join(segment.text for segment in segments)
    duration_ms = int((time.time() - start_time) * 1000)
    
    return {
        "text": text.strip(),
        "language": info.language,
        "confidence": info.language_probability,
        "duration_ms": duration_ms,
        "is_final": True,
    }

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "vad": vad_model is not None,
        "whisper": whisper_model is not None,
        "model": WHISPER_MODEL,
        "device": WHISPER_DEVICE,
    }

@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = "hi",
):
    """Transcribe audio file"""
    if whisper_model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    audio_data = await audio.read()
    loop = asyncio.get_event_loop()
    
    result = await loop.run_in_executor(
        executor,
        transcribe_sync,
        audio_data,
        language,
    )
    
    return TranscribeResponse(**result)

@app.post("/asr")
async def asr(
    audio_file: UploadFile = File(...),
    language: str = "hi",
    output: str = "json",
):
    """ASR endpoint (compatibility with Whisper API)"""
    result = await transcribe(audio_file, language)
    
    if output == "txt":
        return result.text
    return result

@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """WebSocket for real-time streaming ASR with VAD"""
    await websocket.accept()
    
    logger.info("WebSocket ASR client connected")
    
    audio_buffer = []
    silence_frames = 0
    speech_started = False
    
    try:
        while True:
            # Receive audio chunk
            data = await websocket.receive_bytes()
            
            # Convert to numpy
            audio_chunk = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            
            # Check VAD
            speech_prob = detect_speech(audio_chunk)
            
            if speech_prob >= VAD_THRESHOLD:
                # Speech detected
                silence_frames = 0
                audio_buffer.append(audio_chunk)
                
                if not speech_started:
                    speech_started = True
                    await websocket.send_json({"type": "speech_start"})
                
            else:
                # Silence
                if speech_started:
                    silence_frames += 1
                    audio_buffer.append(audio_chunk)
                    
                    # Check if silence duration exceeded
                    silence_ms = (silence_frames * len(audio_chunk) / SAMPLE_RATE) * 1000
                    
                    if silence_ms >= SILENCE_DURATION_MS:
                        # End of speech, transcribe
                        await websocket.send_json({"type": "speech_end"})
                        
                        # Combine audio
                        full_audio = np.concatenate(audio_buffer)
                        
                        # Convert to wav bytes
                        import soundfile as sf
                        buffer = io.BytesIO()
                        sf.write(buffer, full_audio, SAMPLE_RATE, format='WAV')
                        buffer.seek(0)
                        
                        # Transcribe
                        try:
                            loop = asyncio.get_event_loop()
                            result = await loop.run_in_executor(
                                executor,
                                transcribe_sync,
                                buffer.read(),
                                "hi",
                            )
                            
                            await websocket.send_json({
                                "type": "transcription",
                                "text": result["text"],
                                "is_final": True,
                                "confidence": result["confidence"],
                            })
                        except Exception as e:
                            logger.error(f"Transcription error: {e}")
                        
                        # Reset
                        audio_buffer = []
                        silence_frames = 0
                        speech_started = False
            
            # Send VAD status periodically
            await websocket.send_json({
                "type": "vad",
                "speech_prob": speech_prob,
                "is_speech": speech_prob >= VAD_THRESHOLD,
            })
            
    except WebSocketDisconnect:
        logger.info("WebSocket ASR client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7002)
