import os
import threading
import io
import wave
import tempfile
import base64
from typing import Optional, List, Dict, Any, Tuple
import numpy as np
import torch
import torchaudio
import webrtcvad
import soundfile as sf
from faster_whisper import WhisperModel
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from prometheus_client import make_asgi_app, Counter, Histogram
import uvicorn
import json
import subprocess
import requests as http

# Import Google Cloud Speech
try:
    from google.cloud import speech
    from google.oauth2 import service_account
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False

# Import Azure Speech
try:
    import azure.cognitiveservices.speech as speechsdk
    AZURE_AVAILABLE = True
except ImportError:
    AZURE_AVAILABLE = False

# Urdu to Hindi (Devanagari) transliteration map
URDU_TO_DEVANAGARI = {
    # Basic letters
    'ا': 'अ', 'آ': 'आ', 'ب': 'ब', 'پ': 'प', 'ت': 'त', 'ٹ': 'ट',
    'ث': 'स', 'ج': 'ज', 'چ': 'च', 'ح': 'ह', 'خ': 'ख', 'د': 'द',
    'ڈ': 'ड', 'ذ': 'ज़', 'ر': 'र', 'ڑ': 'ड़', 'ز': 'ज़', 'ژ': 'झ',
    'س': 'स', 'ش': 'श', 'ص': 'स', 'ض': 'ज़', 'ط': 'त', 'ظ': 'ज़',
    'ع': 'अ', 'غ': 'ग़', 'ف': 'फ़', 'ق': 'क़', 'ک': 'क', 'گ': 'ग',
    'ل': 'ल', 'م': 'म', 'ن': 'न', 'ں': 'ं', 'و': 'व', 'ہ': 'ह',
    'ھ': 'ह', 'ء': '', 'ی': 'य', 'ے': 'े', 'ئ': 'य',
    # Vowel marks
    'َ': 'ा', 'ِ': 'ि', 'ُ': 'ु', 'ً': 'ं', 'ٍ': 'ं', 'ٌ': 'ं',
    'ٰ': 'ा', 'ّ': '्',
    # Numbers
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    # Common word mappings
    'ہاں': 'हां', 'نہیں': 'नहीं', 'کیا': 'क्या', 'میں': 'में',
    'ہے': 'है', 'ہیں': 'हैं', 'کا': 'का', 'کی': 'की', 'کے': 'के',
    'سے': 'से', 'پر': 'पर', 'اور': 'और', 'یہ': 'यह', 'وہ': 'वह',
    'کر': 'कर', 'لیے': 'लिए', 'اپنا': 'अपना', 'ایک': 'एक',
    'مقصد': 'मकसद', 'چاہتا': 'चाहता', 'چاہتی': 'चाहती',
    'ہوں': 'हूं', 'آرڈر': 'ऑर्डर', 'پارسل': 'पार्सल',
    'پلیس': 'प्लेस', 'ابھی': 'अभी', 'کرنا': 'करना',
}

def transliterate_urdu_to_hindi(text: str) -> str:
    """Transliterate Urdu script to Hindi Devanagari."""
    if not text:
        return text
    
    # Check if text contains Urdu characters
    urdu_range = any('\u0600' <= char <= '\u06FF' for char in text)
    if not urdu_range:
        return text
    
    result = text
    
    # First apply common word mappings
    for urdu_word, hindi_word in sorted(URDU_TO_DEVANAGARI.items(), key=lambda x: len(x[0]), reverse=True):
        if len(urdu_word) > 1:  # Only words, not single chars
            result = result.replace(urdu_word, hindi_word)
    
    # Then apply character-level transliteration
    transliterated = []
    for char in result:
        if char in URDU_TO_DEVANAGARI:
            transliterated.append(URDU_TO_DEVANAGARI[char])
        else:
            transliterated.append(char)
    
    return ''.join(transliterated)

# Initialize VAD and Whisper
vad = webrtcvad.Vad(3)  # Aggressiveness from 0 to 3
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
# Allow overriding device/compute type via env; default to GPU if available
WHISPER_DEVICE_INIT = os.getenv("WHISPER_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
WHISPER_COMPUTE_TYPE_INIT = os.getenv("WHISPER_COMPUTE_TYPE") or ("float16" if (WHISPER_DEVICE_INIT == "cuda") else "int8")
# Runtime device/compute that can be changed at runtime on OOM
RUNTIME_DEVICE = WHISPER_DEVICE_INIT
RUNTIME_COMPUTE = WHISPER_COMPUTE_TYPE_INIT
# Optional overrides
WHISPER_FORCE_LANGUAGE = os.getenv("WHISPER_FORCE_LANGUAGE")  # e.g., "en", "hi", "mr"
WHISPER_TASK = os.getenv("WHISPER_TASK")  # "transcribe" (default) or "translate"
WHISPER_BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
WHISPER_BEST_OF = int(os.getenv("WHISPER_BEST_OF", "1"))
# CPU threading controls
WHISPER_CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "0"))  # 0 = library default
WHISPER_NUM_WORKERS = int(os.getenv("WHISPER_NUM_WORKERS", "1"))
model_lock = threading.Lock()
model = None  # Lazy init for faster startup

def _should_fallback_to_cpu(err: Exception) -> bool:
    msg = str(err).lower()
    return (
        "out of memory" in msg or
        "cublas_status_alloc_failed" in msg or
        "cuda error" in msg or
        "could not allocate" in msg
    )

def _reset_model(device: str, compute_type: str):
    global model, RUNTIME_DEVICE, RUNTIME_COMPUTE
    with model_lock:
        model = None
        RUNTIME_DEVICE = device
        RUNTIME_COMPUTE = compute_type
        print(f"[ASR] Resetting Whisper runtime to device={device} compute={compute_type}")

def get_model() -> WhisperModel:
    global model
    if model is None:
        with model_lock:
            if model is None:
                try:
                    print(f"Loading Whisper model '{WHISPER_MODEL}' on device={RUNTIME_DEVICE} compute={RUNTIME_COMPUTE}...")
                    _m = WhisperModel(
                        WHISPER_MODEL,
                        device=RUNTIME_DEVICE,
                        compute_type=RUNTIME_COMPUTE,
                        cpu_threads=WHISPER_CPU_THREADS if WHISPER_CPU_THREADS >= 0 else 0,
                        num_workers=max(1, WHISPER_NUM_WORKERS)
                    )
                    model = _m
                    print("Whisper model loaded")
                except Exception as e:
                    print(f"Whisper model load failed: {e}")
                    if _should_fallback_to_cpu(e) and RUNTIME_DEVICE != "cpu":
                        _reset_model("cpu", "int8")
                        print("Retrying Whisper model load on CPU int8...")
                        _m = WhisperModel(
                            WHISPER_MODEL,
                            device=RUNTIME_DEVICE,
                            compute_type=RUNTIME_COMPUTE,
                            cpu_threads=WHISPER_CPU_THREADS if WHISPER_CPU_THREADS >= 0 else 0,
                            num_workers=max(1, WHISPER_NUM_WORKERS)
                        )
                        model = _m
                        print("Whisper model loaded on CPU (int8) after CUDA OOM")
                    else:
                        raise
    return model

# Fallback configuration
FALLBACK_PRIMARY = os.getenv("FALLBACK_PRIMARY", "")  # gcloud or azure
FALLBACK_SECONDARY = os.getenv("FALLBACK_SECONDARY", "")  # gcloud or azure if different from primary

# Initialize Google Cloud Speech client
google_client = None
if GOOGLE_AVAILABLE and (FALLBACK_PRIMARY == "gcloud" or FALLBACK_SECONDARY == "gcloud"):
    GOOGLE_CREDENTIALS_JSON = os.getenv("GOOGLE_CREDENTIALS_JSON", "")
    if GOOGLE_CREDENTIALS_JSON:
        # If it's a base64 encoded string, decode it
        if GOOGLE_CREDENTIALS_JSON.startswith("ey"):
            try:
                creds_json = base64.b64decode(GOOGLE_CREDENTIALS_JSON).decode('utf-8')
                creds_dict = json.loads(creds_json)
                credentials = service_account.Credentials.from_service_account_info(creds_dict)
                google_client = speech.SpeechClient(credentials=credentials)
            except Exception as e:
                print(f"Failed to initialize Google Cloud Speech client with base64 credentials: {e}")
        else:
            try:
                # Try as a path to a JSON file
                if os.path.exists(GOOGLE_CREDENTIALS_JSON):
                    credentials = service_account.Credentials.from_service_account_file(GOOGLE_CREDENTIALS_JSON)
                    google_client = speech.SpeechClient(credentials=credentials)
                # Try as a JSON string
                else:
                    try:
                        creds_dict = json.loads(GOOGLE_CREDENTIALS_JSON)
                        credentials = service_account.Credentials.from_service_account_info(creds_dict)
                        google_client = speech.SpeechClient(credentials=credentials)
                    except json.JSONDecodeError:
                        print(f"Failed to parse GOOGLE_CREDENTIALS_JSON as JSON")
            except Exception as e:
                print(f"Failed to initialize Google Cloud Speech client: {e}")
    else:
        # Try to use default credentials
        try:
            google_client = speech.SpeechClient()
            print("Initialized Google Cloud Speech client with default credentials")
        except Exception as e:
            print(f"Failed to initialize Google Cloud Speech client with default credentials: {e}")

# Initialize Azure Speech client
azure_speech_key = os.getenv("AZURE_SPEECH_KEY", "")
azure_speech_region = os.getenv("AZURE_SPEECH_REGION", "eastus")
azure_config = None
if AZURE_AVAILABLE and (FALLBACK_PRIMARY == "azure" or FALLBACK_SECONDARY == "azure") and azure_speech_key:
    try:
        azure_config = speechsdk.SpeechConfig(subscription=azure_speech_key, region=azure_speech_region)
        print(f"Initialized Azure Speech client for region {azure_speech_region}")
    except Exception as e:
        print(f"Failed to initialize Azure Speech client: {e}")

app = FastAPI(title="ASR Proxy")

# Metrics
PROM_APP = make_asgi_app()
REQUESTS = Counter('asr_requests_total', 'Total ASR requests', ['path'])
LATENCY = Histogram('asr_latency_seconds', 'ASR request latency', ['path'])
FALLBACKS = Counter('asr_fallbacks_total', 'ASR fallback attempts', ['provider'])

app.mount("/metrics", PROM_APP)

# Print startup info
print(f"ASR Proxy starting with:")
print(f"  - Whisper model: {WHISPER_MODEL}")
print(f"  - Device: {RUNTIME_DEVICE}")
print(f"  - Compute type: {RUNTIME_COMPUTE}")
print(f"  - Force language: {WHISPER_FORCE_LANGUAGE or 'auto-detect'}")
print(f"  - Task: {WHISPER_TASK or 'transcribe'}")
print(f"  - Fallback primary: {FALLBACK_PRIMARY or 'none'}")
print(f"  - Fallback secondary: {FALLBACK_SECONDARY or 'none'}")
print(f"  - Google client: {'available' if google_client else 'not available'}")
print(f"  - Azure config: {'available' if azure_config else 'not available'}")
print(f"  - CPU threads: {WHISPER_CPU_THREADS}")
print(f"  - Num workers: {WHISPER_NUM_WORKERS}")

@app.on_event("startup")
def _warm_model_background():
    def _warm():
        try:
            get_model()
        except Exception as e:
            print(f"Background model warmup failed: {e}")
    threading.Thread(target=_warm, daemon=True).start()

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/status")
async def status():
    return {
        "whisper_model": WHISPER_MODEL,
        "device": RUNTIME_DEVICE,
        "compute_type": RUNTIME_COMPUTE,
        "force_language": WHISPER_FORCE_LANGUAGE or None,
        "task": WHISPER_TASK or "transcribe"
    }

@app.post("/test")
async def test_fallbacks(audio: UploadFile = File(...), fallback: str = "whisper"):
    """Test endpoint specifically for testing fallback mechanisms"""
    print(f"Test endpoint called with fallback={fallback}")
    
    if audio.content_type not in ('audio/wav', 'audio/ogg', 'audio/webm', 'audio/mpeg', 'audio/mp3', 'application/octet-stream'):
        raise HTTPException(status_code=400, detail="Unsupported audio content type")
    
    audio_bytes = await audio.read()
    
    if fallback == "whisper_fail":
        os.environ["TEST_WHISPER_FAILURE"] = "true"
        print("Setting TEST_WHISPER_FAILURE=true for testing")
    else:
        if "TEST_WHISPER_FAILURE" in os.environ:
            del os.environ["TEST_WHISPER_FAILURE"]
    
    result = transcribe_bytes(audio_bytes)
    return result

# Helper functions for audio processing
def read_audio(audio_bytes: bytes, sample_rate: int = 16000) -> np.ndarray:
    """Convert audio bytes to float32 mono numpy array with given sample rate.
    Tries libsndfile first; if that fails (e.g., WebM/Opus), falls back to ffmpeg decode to WAV.
    """
    def _read_with_soundfile(data: bytes):
        with io.BytesIO(data) as buf:
            audio, sr = sf.read(buf, always_2d=False)
        return audio, sr

    def _decode_with_ffmpeg(data: bytes) -> bytes:
        with tempfile.NamedTemporaryFile(suffix='.in', delete=True) as fin, \
             tempfile.NamedTemporaryFile(suffix='.wav', delete=True) as fout:
            fin.write(data)
            fin.flush()
            cmd = [
                'ffmpeg','-hide_banner','-loglevel','error','-y',
                '-i', fin.name,
                '-ac','1','-ar','16000',
                '-f','wav', fout.name
            ]
            subprocess.run(cmd, check=True)
            fout.flush()
            return fout.read()

    try:
        audio, sr = _read_with_soundfile(audio_bytes)
    except Exception:
        # Fallback: use ffmpeg to decode arbitrary container (e.g., WebM/Opus) to WAV
        wav_bytes = _decode_with_ffmpeg(audio_bytes)
        audio, sr = _read_with_soundfile(wav_bytes)

    # audio can be shape (n,) mono or (n, ch) stereo
    if isinstance(audio, np.ndarray) and audio.ndim == 2:
        # average to mono
        audio = audio.mean(axis=1)
    # ensure float32
    if isinstance(audio, np.ndarray) and audio.dtype != np.float32:
        audio = audio.astype(np.float32, copy=False)
    if sr != sample_rate:
        # Resample using torchaudio
        t = torch.from_numpy(audio)
        if t.ndim == 1:
            t = t.unsqueeze(0)  # [1, n]
        resampled = torchaudio.functional.resample(t, orig_freq=sr, new_freq=sample_rate)
        audio = resampled.squeeze(0).contiguous().numpy()
    return audio

def has_voice_activity(audio: np.ndarray, sample_rate: int = 16000) -> bool:
    """Check if audio chunk contains voice using WebRTC VAD with relaxed thresholds."""
    if audio.dtype != np.int16:
        audio = (audio * 32768).astype(np.int16)
    # Try multiple frame sizes for robustness
    frame_sizes = [10, 20, 30]
    total_frames = 0
    total_voiced = 0
    for frame_ms in frame_sizes:
        frame_len = int(sample_rate * frame_ms / 1000)
        if frame_len <= 0:
            continue
        frames = len(audio) // frame_len
        if frames <= 0:
            continue
        for i in range(frames):
            frame = audio[i*frame_len:(i+1)*frame_len]
            if vad.is_speech(frame.tobytes(), sample_rate):
                total_voiced += 1
        total_frames += frames
    ratio = (total_voiced / total_frames) if total_frames else 0.0
    # Lower threshold to 5% to avoid false negatives on synthesized/soft speech
    return ratio > 0.05

def _segments_to_list(segments) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for s in segments:
        out.append({
            "start": float(getattr(s, "start", 0.0) or 0.0),
            "end": float(getattr(s, "end", 0.0) or 0.0),
            "text": getattr(s, "text", "") or ""
        })
    return out

def transcribe_with_google(audio_bytes: bytes) -> Tuple[str, float, Optional[List[Dict[str, Any]]]]:
    """Transcribe audio with Google Cloud Speech-to-Text"""
    if not google_client:
        return "", 0.0, []
    
    try:
        # Convert to mono LINEAR16 (PCM 16-bit) at 16kHz, which is what Google expects
        with io.BytesIO(audio_bytes) as input_audio:
            audio_data = read_audio(audio_bytes)
            sample_rate = 16000
            # Convert to mono PCM 16-bit
            audio_int16 = (audio_data * 32768).astype(np.int16)
            
            # Create RecognitionAudio from bytes
            audio = speech.RecognitionAudio(content=audio_int16.tobytes())
            
            # Configure request with enhanced model
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=sample_rate,
                language_code="en-US",
                model="latest_long",  # Use enhanced model
                enable_automatic_punctuation=True,
                use_enhanced=True
            )
            
            response = google_client.recognize(config=config, audio=audio)
            
            # Process results
            text = ""
            confidence = 0.0
            segments = []
            
            for i, result in enumerate(response.results):
                best_alt = result.alternatives[0]
                text += best_alt.transcript + " "
                confidence += best_alt.confidence
                
                # If word timing info is available (only in some models)
                if hasattr(best_alt, 'words') and best_alt.words:
                    segment_start = best_alt.words[0].start_time.total_seconds()
                    segment_end = best_alt.words[-1].end_time.total_seconds()
                    segments.append({
                        "start": segment_start,
                        "end": segment_end,
                        "text": best_alt.transcript
                    })
                else:
                    # Approximate timing
                    segments.append({
                        "start": float(i),  # Placeholder
                        "end": float(i + 1),  # Placeholder
                        "text": best_alt.transcript
                    })
            
            avg_confidence = confidence / len(response.results) if response.results else 0
            text = text.strip()
            
            return text, avg_confidence, segments
    except Exception as e:
        print(f"Google Cloud Speech transcription error: {e}")
        return "", 0.0, []

def transcribe_with_azure(audio_bytes: bytes) -> Tuple[str, float, Optional[List[Dict[str, Any]]]]:
    """Transcribe audio with Azure Speech-to-Text"""
    if not azure_config:
        return "", 0.0, []
    
    try:
        # Create a temporary WAV file as Azure client works with files
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=True) as temp_wav:
            # Convert audio bytes to WAV
            audio_data = read_audio(audio_bytes)
            sample_rate = 16000
            # Convert to mono PCM 16-bit
            audio_int16 = (audio_data * 32768).astype(np.int16)
            
            # Write to WAV file
            with wave.open(temp_wav.name, 'wb') as wf:
                wf.setnchannels(1)  # Mono
                wf.setsampwidth(2)  # 16-bit
                wf.setframerate(sample_rate)
                wf.writeframes(audio_int16.tobytes())
            
            # Create audio config and speech recognizer
            audio_config = speechsdk.audio.AudioConfig(filename=temp_wav.name)
            speech_recognizer = speechsdk.SpeechRecognizer(
                speech_config=azure_config,
                audio_config=audio_config
            )
            
            # Start recognition
            result_future = speech_recognizer.recognize_once_async()
            result = result_future.get()
            
            if result.reason == speechsdk.ResultReason.RecognizedSpeech:
                # Success
                text = result.text
                confidence = 0.8  # Azure doesn't provide confidence scores easily
                
                # Azure doesn't provide timing info in the basic API
                segments = [{
                    "start": 0.0,
                    "end": 1.0,  # Placeholder
                    "text": text
                }]
                
                return text, confidence, segments
            else:
                # No speech or error
                return "", 0.0, []
    except Exception as e:
        print(f"Azure Speech transcription error: {e}")
        return "", 0.0, []

def transcribe_bytes(audio_bytes: bytes, *, language_hint: Optional[str] = None, task: Optional[str] = None):
    """Transcribe audio bytes using the configured fallback chain"""
    try:
        audio_data = read_audio(audio_bytes)
    except Exception as e:
        print(f"Failed to read audio: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to read audio: {str(e)}")
    
    vad_ok = has_voice_activity(audio_data)
    
    # If VAD says no voice activity, allow override when a language hint is provided
    if not vad_ok and language_hint:
        print("VAD check: No voice detected, but proceeding due to language hint")
        vad_ok = True
    
    # If still no voice activity, return early
    if not vad_ok:
        print("VAD check: No voice activity detected")
        return {"text": "", "provider": "vad", "confidence": 1.0, "duration": 0.0}
    
    print("VAD check: Voice activity detected")
    
    # Try Whisper first (local)
    try:
        print("Attempting transcription with local Whisper model")
        # For testing purposes, let's force a failure for Whisper
        force_fail = os.environ.get("TEST_WHISPER_FAILURE") == "true" or "test_whisper_fail=true" in audio_bytes.decode('utf-8', errors='ignore')
        if force_fail:
            print("Simulating Whisper failure for testing")
            raise Exception("Simulated Whisper failure for testing fallbacks")
        
        # Optionally force language or task; otherwise rely on auto-detect
        # Use small beam/best_of for lower VRAM usage
        try:
            segments, info = get_model().transcribe(
                audio_data,
                language=(language_hint or WHISPER_FORCE_LANGUAGE or None),
                task=(task or WHISPER_TASK or "transcribe"),
                beam_size=WHISPER_BEAM_SIZE,
                best_of=WHISPER_BEST_OF,
                temperature=0.0
            )
        except Exception as e:
            if _should_fallback_to_cpu(e) and RUNTIME_DEVICE != "cpu":
                print(f"Whisper transcribe encountered CUDA OOM, falling back to CPU int8: {e}")
                _reset_model("cpu", "int8")
                segments, info = get_model().transcribe(
                    audio_data,
                    language=(language_hint or WHISPER_FORCE_LANGUAGE or None),
                    task=(task or WHISPER_TASK or "transcribe"),
                    beam_size=WHISPER_BEAM_SIZE,
                    best_of=WHISPER_BEST_OF,
                    temperature=0.0
                )
            else:
                raise
        # Convert segments generator to list to avoid "object has no len()" error
        segments_list = list(segments)
        text = " ".join(segment.text for segment in segments_list).strip()
        
        # Transliterate Urdu to Hindi if needed
        text = transliterate_urdu_to_hindi(text)
        
        confidence = 0.8  # Default confidence since we can't calculate from generator
        if segments_list:
            # Try to calculate confidence if possible
            try:
                confidence = sum(segment.avg_logprob for segment in segments_list) / len(segments_list)
            except (AttributeError, ZeroDivisionError):
                pass
        duration = float(getattr(info, "duration", 0.0) or 0.0)
        
        # If Whisper returned text, use it
        if text:
            print(f"Whisper success: '{text}'")
            # Determine reported language - if we transliterated from Urdu, report as Hindi
            detected_lang = getattr(info, "language", None) or "unknown"
            if detected_lang == "ur":
                detected_lang = "hi"
            return {
                "text": text,
                "provider": "faster-whisper",
                "confidence": confidence,
                "duration": duration,
                "segments": _segments_to_list(segments_list),
                # expose language autodetection details from Whisper
                "language": detected_lang,
                "language_probability": float(getattr(info, "language_probability", 0.0) or 0.0)
            }
        print("Whisper returned empty text, trying fallbacks")
    except Exception as e:
        print(f"Whisper transcription error: {e}")
    
    # Try primary fallback
    if FALLBACK_PRIMARY == "gcloud" and google_client:
        print("Attempting transcription with Google Cloud Speech (primary fallback)")
        FALLBACKS.labels(provider="google").inc()
        text, confidence, segments = transcribe_with_google(audio_bytes)
        if text:
            print(f"Google Cloud Speech success: '{text}'")
            return {
                "text": text,
                "provider": "google",
                "confidence": confidence,
                "duration": 0.0,  # Google doesn't return duration
                "segments": segments,
                "language": "en",  # configured language_code above
                "language_probability": 0.0
            }
        print("Google Cloud Speech returned empty text")
    elif FALLBACK_PRIMARY == "azure" and azure_config:
        print("Attempting transcription with Azure Speech (primary fallback)")
        FALLBACKS.labels(provider="azure").inc()
        text, confidence, segments = transcribe_with_azure(audio_bytes)
        if text:
            print(f"Azure Speech success: '{text}'")
            return {
                "text": text,
                "provider": "azure",
                "confidence": confidence,
                "duration": 0.0,  # Azure doesn't return duration
                "segments": segments,
                "language": "en",  # default assumption
                "language_probability": 0.0
            }
        print("Azure Speech returned empty text")
    
    # Try secondary fallback
    if FALLBACK_SECONDARY == "gcloud" and FALLBACK_PRIMARY != "gcloud" and google_client:
        print("Attempting transcription with Google Cloud Speech (secondary fallback)")
        FALLBACKS.labels(provider="google").inc()
        text, confidence, segments = transcribe_with_google(audio_bytes)
        if text:
            print(f"Google Cloud Speech success: '{text}'")
            return {
                "text": text,
                "provider": "google",
                "confidence": confidence,
                "duration": 0.0,
                "segments": segments,
                "language": "en",
                "language_probability": 0.0
            }
        print("Google Cloud Speech returned empty text")
    elif FALLBACK_SECONDARY == "azure" and FALLBACK_PRIMARY != "azure" and azure_config:
        print("Attempting transcription with Azure Speech (secondary fallback)")
        FALLBACKS.labels(provider="azure").inc()
        text, confidence, segments = transcribe_with_azure(audio_bytes)
        if text:
            print(f"Azure Speech success: '{text}'")
            return {
                "text": text,
                "provider": "azure",
                "confidence": confidence,
                "duration": 0.0,
                "segments": segments,
                "language": "en",
                "language_probability": 0.0
            }
        print("Azure Speech returned empty text")
    
    # All methods failed or no fallbacks configured
    print("All transcription methods failed or no fallbacks configured")
    return {
        "text": "",
        "provider": "fallback_failed",
        "confidence": 0.0,
        "duration": 0.0,
        "error": "no_text_or_no_fallbacks"
    }

@app.post("/transcribe")
async def transcribe(
    audio: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),
    test_mode: Optional[str] = Form(None),
    language: Optional[str] = Form(None)
):
    """Transcribe uploaded audio file (multipart)."""
    REQUESTS.labels(path='/transcribe').inc()
    print(f"Received transcribe request with test_mode={test_mode}")
    with LATENCY.labels(path='/transcribe').time():
        upload = audio or file
        if upload is None:
            raise HTTPException(status_code=400, detail="Missing file. Use form field 'audio' or 'file'.")
        # Some clients omit content-type; allow it if missing
        if upload.content_type and upload.content_type not in ('audio/wav', 'audio/ogg', 'audio/webm', 'audio/mpeg', 'audio/mp3', 'application/octet-stream'):
            raise HTTPException(status_code=400, detail="Unsupported audio content type")
        audio_bytes = await upload.read()
        
        # For testing failures
        if test_mode == "whisper_fail":
            print(f"Setting TEST_WHISPER_FAILURE=true for testing")
            os.environ["TEST_WHISPER_FAILURE"] = "true"
        else:
            # Make sure we reset it for other requests
            if "TEST_WHISPER_FAILURE" in os.environ:
                del os.environ["TEST_WHISPER_FAILURE"]
        
    # Pass language hint through (form overrides query fallback); FastAPI will fill 'language' from form above
    return transcribe_bytes(audio_bytes, language_hint=language)

@app.post("/asr")
async def asr_from_url(payload: dict):
    """Transcribe audio fetched from a URL (e.g., MinIO presigned URL)."""
    REQUESTS.labels(path='/asr').inc()
    url = payload.get('url')
    if not url:
        raise HTTPException(status_code=400, detail="Missing url")
    with LATENCY.labels(path='/asr').time():
        try:
            resp = http.get(url, timeout=30)
            resp.raise_for_status()
            audio_bytes = resp.content
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Fetch failed: {e}")
    return transcribe_bytes(audio_bytes, language_hint=payload.get('language'), task=payload.get('task'))

@app.websocket("/stream")
async def stream_ws(ws: WebSocket):
    """
    Simple WebSocket streaming endpoint.
    Client sends:
      - Binary frames: WebM/Opus chunks from MediaRecorder
      - Text frames: {"event":"start"}|{"event":"end"}
    Server replies JSON acks for chunks and a final transcript on end.
    """
    await ws.accept()
    buffer = bytearray()
    try:
        while True:
            msg = await ws.receive()
            if 'bytes' in msg and msg['bytes'] is not None:
                chunk = msg['bytes']
                buffer.extend(chunk)
                # lightweight ack
                await ws.send_json({"event":"chunk","size": len(chunk)})
            else:
                data = msg.get('text')
                if not data:
                    continue
                try:
                    evt = json.loads(data)
                except Exception:
                    await ws.send_json({"event":"error","detail":"invalid json"})
                    continue
                if evt.get('event') == 'start':
                    await ws.send_json({"event":"started"})
                elif evt.get('event') == 'end':
                    # Flush buffer to temp, decode to wav via ffmpeg, then transcribe
                    with tempfile.NamedTemporaryFile(suffix='.webm', delete=True) as fin, \
                         tempfile.NamedTemporaryFile(suffix='.wav', delete=True) as fout:
                        fin.write(buffer)
                        fin.flush()
                        cmd = [
                            'ffmpeg','-hide_banner','-loglevel','error','-y',
                            '-i', fin.name,
                            '-ac','1','-ar','16000',
                            '-f','wav', fout.name
                        ]
                        try:
                            subprocess.run(cmd, check=True)
                        except subprocess.CalledProcessError as e:
                            await ws.send_json({"event":"error","detail": f"decode failed: {e}"})
                            await ws.close()
                            return
                        # Read WAV and run VAD + Whisper
                        with open(fout.name, 'rb') as fb:
                            wav_bytes = fb.read()
                        try:
                            audio_data = read_audio(wav_bytes)
                        except Exception as e:
                            await ws.send_json({"event":"error","detail": f"read wav failed: {e}"})
                            await ws.close()
                            return
                        # Use the transcribe_bytes function that handles fallbacks
                        try:
                            result = transcribe_bytes(wav_bytes)
                            # Add the "event":"final" to the result
                            result["event"] = "final"
                            await ws.send_json(result)
                        except Exception as e:
                            await ws.send_json({"event":"error","detail": f"transcribe failed: {e}"})
                        await ws.close()
                        return
                else:
                    await ws.send_json({"event":"noop"})
    except WebSocketDisconnect:
        return

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
