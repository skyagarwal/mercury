"""
Faster-Whisper ASR Service
High-performance speech-to-text with GPU acceleration
Supports: large-v3-turbo, large-v3, distil-large-v3
"""

import os
import io
import tempfile
import subprocess
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import soundfile as sf
import numpy as np

def convert_audio_to_wav(input_path: str, output_path: str) -> bool:
    """Convert any audio format to WAV using ffmpeg"""
    try:
        # First, check file size
        file_size = os.path.getsize(input_path)
        print(f"📁 Input file size: {file_size} bytes")
        
        # Read first few bytes to check format
        with open(input_path, 'rb') as f:
            header = f.read(32)
            print(f"📁 File header (hex): {header[:16].hex()}")
        
        result = subprocess.run([
            'ffmpeg', '-y', 
            '-hide_banner',
            '-loglevel', 'warning',
            '-i', input_path,
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',      # Mono
            '-c:a', 'pcm_s16le',  # 16-bit PCM
            output_path
        ], capture_output=True, timeout=30, text=True)
        
        if result.returncode != 0:
            print(f"⚠️ FFmpeg stderr: {result.stderr}")
            return False
        
        # Verify output
        if os.path.exists(output_path):
            out_size = os.path.getsize(output_path)
            print(f"✅ FFmpeg converted: {file_size} → {out_size} bytes")
            return out_size > 100  # Valid WAV should be more than 100 bytes
        return False
    except Exception as e:
        print(f"FFmpeg conversion error: {e}")
        return False

# Configuration
MODEL_SIZE = os.getenv("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "float16")
LANGUAGE = os.getenv("WHISPER_LANGUAGE", "hi")  # Default to Hindi to avoid Urdu confusion
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
VAD_FILTER = os.getenv("WHISPER_VAD_FILTER", "true").lower() == "true"
INITIAL_PROMPT = os.getenv("WHISPER_INITIAL_PROMPT", "यह एक हिंदी वाक्य है।")  # Hindi prompt

# Urdu to Hindi transliteration map (common characters)
URDU_TO_DEVANAGARI = {
    'ا': 'अ', 'آ': 'आ', 'ب': 'ब', 'پ': 'प', 'ت': 'त', 'ٹ': 'ट',
    'ث': 'स', 'ج': 'ज', 'چ': 'च', 'ح': 'ह', 'خ': 'ख', 'د': 'द',
    'ڈ': 'ड', 'ذ': 'ज़', 'ر': 'र', 'ڑ': 'ड़', 'ز': 'ज़', 'ژ': 'झ',
    'س': 'स', 'ش': 'श', 'ص': 'स', 'ض': 'ज़', 'ط': 'त', 'ظ': 'ज़',
    'ع': 'अ', 'غ': 'ग़', 'ف': 'फ', 'ق': 'क़', 'ک': 'क', 'گ': 'ग',
    'ل': 'ल', 'م': 'म', 'ن': 'न', 'ں': 'ं', 'و': 'व', 'ہ': 'ह',
    'ھ': 'ह', 'ء': '', 'ی': 'य', 'ے': 'े', 'ئ': 'य', '۔': '।',
    'ي': 'ी', 'ں': 'ं', 'ے': 'े', 'ۓ': 'ए', 'ۃ': '', '۱': '१',
    '۲': '२', '۳': '३', '۴': '४', '۵': '५', '۶': '६', '۷': '७',
    '۸': '८', '۹': '९', '۰': '०', ' ': ' ',
}

def transliterate_urdu_to_hindi(text: str) -> str:
    """Convert Urdu script to Devanagari (approximate)"""
    # Check if text contains Urdu characters
    urdu_chars = set(URDU_TO_DEVANAGARI.keys())
    if not any(c in urdu_chars for c in text):
        return text
    
    result = []
    for char in text:
        result.append(URDU_TO_DEVANAGARI.get(char, char))
    return ''.join(result)

# Global model
model = None

def load_model():
    global model
    from faster_whisper import WhisperModel
    
    print(f"Loading Faster-Whisper model: {MODEL_SIZE}")
    print(f"  Device: {DEVICE}")
    print(f"  Compute type: {COMPUTE_TYPE}")
    print(f"  VAD filter: {VAD_FILTER}")
    
    model = WhisperModel(
        MODEL_SIZE,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
    )
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
    title="Faster-Whisper ASR",
    description="High-performance speech-to-text service",
    version="2.0.0",
    lifespan=lifespan
)

class TranscriptionResult(BaseModel):
    text: str
    language: str
    confidence: float
    segments: list = []
    duration: float = 0.0

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "model_loaded": model is not None
    }

@app.get("/")
async def root():
    return {"service": "faster-whisper-asr", "model": MODEL_SIZE}

@app.post("/transcribe", response_model=TranscriptionResult)
async def transcribe(
    audio: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),  # Accept both 'audio' and 'file' field names
    language: Optional[str] = Form(None),
    task: str = Form("transcribe"),
):
    """
    Transcribe audio file to text.
    
    - **audio** or **file**: Audio file (wav, mp3, etc.) - accepts either field name
    - **language**: Language code (hi, en, mr) or None for auto-detect
    - **task**: 'transcribe' or 'translate' (to English)
    """
    # Accept either 'audio' or 'file' field name for compatibility
    audio_file = audio or file
    if not audio_file:
        raise HTTPException(status_code=422, detail="No audio file provided. Use 'audio' or 'file' field.")
    
    print(f"📥 ASR Request: filename={audio_file.filename}, size={audio_file.size}, content_type={audio_file.content_type}, language={language}")
    
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    try:
        # Read audio file
        content = await audio_file.read()
        filename = audio_file.filename or "audio.webm"
        
        # Determine file extension from filename
        ext = os.path.splitext(filename)[1].lower() or '.webm'
        
        # Save to temp file with original extension
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        
        # Convert to WAV if not already WAV
        wav_path = tmp_path
        needs_conversion = ext not in ['.wav', '.wave']
        
        if needs_conversion:
            wav_path = tmp_path.replace(ext, '.wav')
            print(f"🔄 Converting {ext} to WAV: {filename}")
            if not convert_audio_to_wav(tmp_path, wav_path):
                # Try with pydub as fallback
                try:
                    from pydub import AudioSegment
                    audio_seg = AudioSegment.from_file(tmp_path)
                    audio_seg = audio_seg.set_frame_rate(16000).set_channels(1)
                    audio_seg.export(wav_path, format='wav')
                    print(f"✅ Converted with pydub")
                except Exception as e:
                    print(f"⚠️ Pydub conversion failed: {e}")
                    # Last resort: just rename and hope faster-whisper can handle it
                    wav_path = tmp_path
        
        try:
            # Determine language - support auto-detection properly
            lang = language.strip().lower() if language and language.strip() else 'auto'
            
            # Only force Hindi for Urdu (they sound the same, we want Devanagari output)
            # Let auto-detection work for English and other languages
            if lang == 'ur':
                lang = 'hi'
            
            # For auto mode, let Whisper detect the language
            # This allows English, Hindi, and other languages to be detected correctly
            transcribe_lang = None if lang == 'auto' else lang
            
            print(f"🎯 ASR: requested={language}, using={transcribe_lang or 'auto-detect'}")
            
            segments, info = model.transcribe(
                wav_path,
                language=transcribe_lang,  # None = auto-detect
                task=task,
                beam_size=BEAM_SIZE,
                vad_filter=VAD_FILTER,
                initial_prompt=None,  # Remove Hindi prompt for auto-detection
            )
            
            # Collect segments
            segment_list = []
            full_text = []
            detected_lang = info.language or 'en'  # Default to English if not detected
            
            for segment in segments:
                text = segment.text.strip()
                # Only transliterate Urdu to Hindi (same language, different script)
                if detected_lang == 'ur':
                    text = transliterate_urdu_to_hindi(text)
                segment_list.append({
                    "start": segment.start,
                    "end": segment.end,
                    "text": text,
                })
                full_text.append(text)
            
            # Final text
            final_text = " ".join(full_text)
            if detected_lang == 'ur':
                final_text = transliterate_urdu_to_hindi(final_text)
                detected_lang = 'hi'  # Report as Hindi since we converted script
            
            # Handle empty result (silence or no speech detected)
            confidence = info.language_probability if info.language_probability else 0.0
            
            print(f"✅ ASR Result: lang={detected_lang}, confidence={confidence:.2f}, text={final_text[:50] if final_text else '(empty)'}...")
            
            return TranscriptionResult(
                text=final_text,
                language=detected_lang,
                confidence=confidence,
                segments=segment_list,
                duration=info.duration,
            )
        finally:
            # Cleanup temp files
            try:
                os.unlink(tmp_path)
            except:
                pass
            if needs_conversion and wav_path != tmp_path:
                try:
                    os.unlink(wav_path)
                except:
                    pass
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/audio/transcriptions")
async def openai_compatible_transcribe(
    file: UploadFile = File(...),
    model: str = Form("whisper-1"),
    language: Optional[str] = Form(None),
    response_format: str = Form("json"),
):
    """
    OpenAI-compatible transcription endpoint.
    """
    result = await transcribe(audio=file, language=language)
    
    if response_format == "text":
        return result.text
    elif response_format == "verbose_json":
        return {
            "text": result.text,
            "language": result.language,
            "duration": result.duration,
            "segments": result.segments,
        }
    else:  # json
        return {"text": result.text}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
