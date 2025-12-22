#!/usr/bin/env python3
"""
Mangwale Voice Streaming Service
Real-time bidirectional voice streaming with Exotel Voicebot Applet

Features:
- WebSocket server for Exotel streaming
- Real-time ASR (speech recognition)
- Real-time TTS (text-to-speech)
- DTMF handling
- State management per call
- Audio buffer management
- Conversation flow control
"""

import os
import json
import base64
import asyncio
import logging
import hashlib
from datetime import datetime
from typing import Dict, Optional, List
from dataclasses import dataclass, field
from enum import Enum
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import numpy as np

# Load environment
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG_MODE", "false").lower() == "true" else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("voice-streaming")

# ==============================================================================
# CONFIGURATION
# ==============================================================================

# Service URLs
ASR_URL = os.getenv("ASR_URL", "http://localhost:7001")
TTS_URL = os.getenv("TTS_URL", "http://localhost:7002")
JUPITER_URL = os.getenv("JUPITER_URL", "http://192.168.0.156:3200")

# Audio configuration (Exotel requirements)
SAMPLE_RATE = 8000  # 8kHz for PSTN quality
BIT_DEPTH = 16      # 16-bit PCM
CHANNELS = 1        # Mono
CHUNK_SIZE = 320    # Bytes per 20ms at 8kHz (must be multiple of 320)
MIN_CHUNK_SIZE = 3200  # 100ms minimum (3.2k bytes)
MAX_CHUNK_SIZE = 102400  # 100k maximum

# Conversation states
class ConversationState(str, Enum):
    GREETING = "greeting"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"
    PREP_TIME = "prep_time"
    COMPLETED = "completed"

# Call status
class CallStatus(str, Enum):
    CONNECTED = "connected"
    ACTIVE = "active"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    COMPLETED = "completed"
    FAILED = "failed"

# ==============================================================================
# DATA MODELS
# ==============================================================================

@dataclass
class AudioBuffer:
    """Buffer for incoming/outgoing audio chunks"""
    data: bytearray = field(default_factory=bytearray)
    timestamp: int = 0
    
    def append(self, chunk: bytes):
        """Add audio chunk to buffer"""
        self.data.extend(chunk)
    
    def get_and_clear(self) -> bytes:
        """Get buffered data and clear"""
        data = bytes(self.data)
        self.data.clear()
        return data
    
    def size(self) -> int:
        """Get buffer size in bytes"""
        return len(self.data)

@dataclass
class StreamState:
    """State for a streaming call"""
    stream_sid: str
    call_sid: str
    account_sid: str
    from_number: str
    to_number: str
    custom_parameters: Dict = field(default_factory=dict)
    
    # Conversation state
    conversation_state: ConversationState = ConversationState.GREETING
    call_status: CallStatus = CallStatus.CONNECTED
    
    # Audio buffers
    input_buffer: AudioBuffer = field(default_factory=AudioBuffer)
    output_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    
    # Conversation context
    transcribed_text: str = ""
    last_response: str = ""
    prep_time_minutes: Optional[int] = None
    
    # Sequence tracking
    sequence_number: int = 0
    last_mark: Optional[str] = None
    chunk_index: int = 0
    
    # Timing
    started_at: datetime = field(default_factory=datetime.now)
    last_activity: datetime = field(default_factory=datetime.now)
    
    def next_sequence(self) -> int:
        """Get next sequence number"""
        self.sequence_number += 1
        return self.sequence_number

# Global state management
active_streams: Dict[str, StreamState] = {}

# ==============================================================================
# ASR CLIENT (Speech Recognition)
# ==============================================================================

class ASRClient:
    """Client for real-time ASR service"""
    
    def __init__(self):
        self.asr_url = ASR_URL
        self._client: Optional[httpx.AsyncClient] = None
    
    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client
    
    async def transcribe(self, audio_data: bytes, language: str = "hi") -> Optional[str]:
        """Transcribe audio to text"""
        try:
            client = await self.get_client()
            
            # Convert PCM to WAV format for ASR
            wav_data = self._pcm_to_wav(audio_data)
            
            response = await client.post(
                f"{self.asr_url}/transcribe",
                files={"audio": ("audio.wav", wav_data, "audio/wav")},
                data={"language": language}
            )
            response.raise_for_status()
            
            result = response.json()
            text = result.get("text", "").strip()
            
            if text:
                logger.info(f"ASR transcribed: {text[:50]}...")
                return text
            
            return None
            
        except Exception as e:
            logger.error(f"ASR transcription failed: {e}")
            return None
    
    def _pcm_to_wav(self, pcm_data: bytes) -> bytes:
        """Convert raw PCM to WAV format"""
        import wave
        import io
        
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(CHANNELS)
            wav_file.setsampwidth(BIT_DEPTH // 8)
            wav_file.setframerate(SAMPLE_RATE)
            wav_file.writeframes(pcm_data)
        
        return wav_buffer.getvalue()

# ==============================================================================
# TTS CLIENT (Text-to-Speech)
# ==============================================================================

class TTSClient:
    """Client for real-time TTS service"""
    
    def __init__(self):
        self.tts_url = TTS_URL
        self._client: Optional[httpx.AsyncClient] = None
    
    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client
    
    async def synthesize(self, text: str, language: str = "hi") -> Optional[bytes]:
        """Synthesize text to speech, returns raw PCM data"""
        try:
            client = await self.get_client()
            
            start = datetime.now()
            response = await client.post(
                f"{self.tts_url}/synthesize",
                json={
                    "text": text,
                    "language": language,
                    "voice": "kokoro",
                    "format": "wav"
                }
            )
            response.raise_for_status()
            
            # Get WAV audio
            wav_data = response.content
            
            # Convert WAV to raw PCM 8kHz 16-bit mono for Exotel
            pcm_data = self._wav_to_pcm(wav_data)
            
            duration_ms = (datetime.now() - start).total_seconds() * 1000
            logger.info(f"TTS synthesized {len(pcm_data)} bytes in {duration_ms:.0f}ms: {text[:30]}...")
            
            return pcm_data
            
        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            return None
    
    def _wav_to_pcm(self, wav_data: bytes) -> bytes:
        """Convert WAV to raw PCM 8kHz 16-bit mono"""
        import wave
        import io
        
        wav_buffer = io.BytesIO(wav_data)
        with wave.open(wav_buffer, 'rb') as wav_file:
            # Get WAV properties
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            framerate = wav_file.getframerate()
            
            # Read audio data
            pcm_data = wav_file.readframes(wav_file.getnframes())
            
            # Convert to numpy array for resampling if needed
            if framerate != SAMPLE_RATE or channels != CHANNELS:
                audio_array = np.frombuffer(pcm_data, dtype=np.int16)
                
                # Resample to 8kHz if needed
                if framerate != SAMPLE_RATE:
                    from scipy import signal
                    num_samples = int(len(audio_array) * SAMPLE_RATE / framerate)
                    audio_array = signal.resample(audio_array, num_samples).astype(np.int16)
                
                # Convert to mono if stereo
                if channels == 2:
                    audio_array = audio_array.reshape(-1, 2).mean(axis=1).astype(np.int16)
                
                pcm_data = audio_array.tobytes()
            
            return pcm_data

# ==============================================================================
# CONVERSATION MANAGER
# ==============================================================================

class ConversationManager:
    """Manages conversation flow and responses"""
    
    def __init__(self, asr_client: ASRClient, tts_client: TTSClient):
        self.asr = asr_client
        self.tts = tts_client
    
    async def handle_greeting(self, state: StreamState) -> str:
        """Generate greeting message"""
        params = state.custom_parameters
        vendor_name = params.get("vendor_name", "")
        order_id = params.get("order_id", "")
        
        # Shorter greeting for faster TTS (~3-4s instead of ~20s)
        greeting = (
            f"नमस्ते {vendor_name}, ऑर्डर {order_id}। "
            f"स्वीकार 1, रद्द 0 दबाएं।"
        )
        
        return greeting
    
    async def handle_dtmf(self, state: StreamState, digit: str) -> Optional[str]:
        """Handle DTMF input"""
        logger.info(f"🔢 DTMF pressed: {digit} in state {state.conversation_state}")
        
        if state.conversation_state == ConversationState.GREETING:
            if digit == "1":
                # Accepted
                state.conversation_state = ConversationState.PREP_TIME
                state.call_status = CallStatus.ACCEPTED
                return (
                    "धन्यवाद! खाना तैयार करने में कितने मिनट लगेंगे? "
                    "15 मिनट के लिए 1, 30 मिनट के लिए 2, 45 मिनट के लिए 3 दबाएं।"
                )
            elif digit == "0":
                # Rejected
                state.conversation_state = ConversationState.COMPLETED
                state.call_status = CallStatus.REJECTED
                return "ठीक है, हम किसी और को यह ऑर्डर देंगे। धन्यवाद!"
        
        elif state.conversation_state == ConversationState.PREP_TIME:
            prep_time_map = {"1": 15, "2": 30, "3": 45}
            prep_time = prep_time_map.get(digit, 30)
            state.prep_time_minutes = prep_time
            state.conversation_state = ConversationState.COMPLETED
            state.call_status = CallStatus.COMPLETED
            return f"धन्यवाद! राइडर {prep_time} मिनट में पहुंचेगा। शुभ दिन!"
        
        return None
    
    async def process_audio(self, state: StreamState) -> Optional[str]:
        """Process accumulated audio buffer with ASR"""
        if state.input_buffer.size() < MIN_CHUNK_SIZE:
            return None  # Not enough audio yet
        
        audio_data = state.input_buffer.get_and_clear()
        
        # Transcribe
        language = state.custom_parameters.get("language", "hi")
        text = await self.asr.transcribe(audio_data, language)
        
        if text:
            state.transcribed_text = text
            logger.info(f"📝 Transcribed: {text}")
            
            # Generate response based on transcription
            # (For now, we rely mainly on DTMF)
            return None
        
        return None

# ==============================================================================
# WEBSOCKET HANDLER
# ==============================================================================

class VoicebotHandler:
    """Handles WebSocket communication with Exotel"""
    
    def __init__(self, conversation_manager: ConversationManager, tts_client: TTSClient):
        self.conversation = conversation_manager
        self.tts = tts_client
    
    async def handle_connection(self, websocket: WebSocket):
        """Handle WebSocket connection lifecycle"""
        await websocket.accept()
        logger.info("🔌 WebSocket connected")
        
        state: Optional[StreamState] = None
        
        try:
            # Start audio sender task
            sender_task = None
            
            async for message in websocket.iter_text():
                try:
                    data = json.loads(message)
                    event = data.get("event")
                    
                    if event == "connected":
                        logger.info("✅ Exotel connected")
                    
                    elif event == "start":
                        # Initialize stream state
                        start_data = data.get("start", {})
                        state = StreamState(
                            stream_sid=data.get("stream_sid", ""),
                            call_sid=start_data.get("call_sid", ""),
                            account_sid=start_data.get("account_sid", ""),
                            from_number=start_data.get("from", ""),
                            to_number=start_data.get("to", ""),
                            custom_parameters=start_data.get("custom_parameters", {})
                        )
                        active_streams[state.stream_sid] = state
                        
                        logger.info(f"📞 Call started: {state.call_sid} from {state.from_number}")
                        
                        # Start sender task for this stream
                        sender_task = asyncio.create_task(
                            self._audio_sender(websocket, state)
                        )
                        
                        # Send greeting in background so we don't block the message loop
                        asyncio.create_task(self._send_greeting(state))
                    
                    elif event == "media":
                        if state:
                            # Receive audio from caller
                            media = data.get("media", {})
                            payload = media.get("payload", "")
                            
                            if payload:
                                # Decode base64 PCM audio
                                audio_data = base64.b64decode(payload)
                                state.input_buffer.append(audio_data)
                                state.last_activity = datetime.now()
                                
                                # Process if buffer is large enough
                                if state.conversation_state == ConversationState.LISTENING:
                                    response_text = await self.conversation.process_audio(state)
                                    if response_text:
                                        await self._send_audio_response(state, response_text)
                    
                    elif event == "dtmf":
                        if state:
                            # Handle DTMF digit press
                            dtmf_data = data.get("dtmf", {})
                            digit = dtmf_data.get("digit", "")
                            
                            response_text = await self.conversation.handle_dtmf(state, digit)
                            if response_text:
                                await self._send_audio_response(state, response_text)
                    
                    elif event == "mark":
                        if state:
                            # Mark event - audio playback completed
                            mark_data = data.get("mark", {})
                            mark_name = mark_data.get("name", "")
                            logger.info(f"✓ Mark completed: {mark_name}")
                            state.last_mark = mark_name
                            
                            # If conversation completed, close stream
                            if state.conversation_state == ConversationState.COMPLETED:
                                logger.info("🏁 Conversation completed, closing stream")
                                break
                    
                    elif event == "stop":
                        # Stream stopped
                        stop_data = data.get("stop", {})
                        reason = stop_data.get("reason", "unknown")
                        logger.info(f"⏹️ Stream stopped: {reason}")
                        break
                
                except json.JSONDecodeError:
                    logger.error("Failed to parse WebSocket message")
                except Exception as e:
                    logger.error(f"Error handling message: {e}")
        
        except WebSocketDisconnect:
            logger.info("🔌 WebSocket disconnected")
        
        finally:
            # Cleanup
            if state and state.stream_sid in active_streams:
                del active_streams[state.stream_sid]
            
            if sender_task:
                sender_task.cancel()
                try:
                    await sender_task
                except asyncio.CancelledError:
                    pass
            
            logger.info("🧹 Cleaned up stream resources")
    
    async def _send_greeting(self, state: StreamState):
        """Send greeting in background"""
        try:
            greeting = await self.conversation.handle_greeting(state)
            await self._send_audio_response(state, greeting)
        except Exception as e:
            logger.error(f"Error sending greeting: {e}")

    async def _send_audio_response(self, state: StreamState, text: str):
        """Synthesize text and queue audio for sending"""
        language = state.custom_parameters.get("language", "hi")
        
        # Synthesize TTS
        pcm_data = await self.tts.synthesize(text, language)
        
        state.last_response = text

        # Clear any previously queued audio before sending new response
        try:
            while not state.output_queue.empty():
                _ = state.output_queue.get_nowait()
        except Exception:
            pass
        await state.output_queue.put({"type": "clear"})

        if pcm_data:
            # Split into chunks and queue
            chunks = self._split_audio_chunks(pcm_data)
            for chunk in chunks:
                await state.output_queue.put(chunk)
        else:
            # If TTS fails, still send a short silence so Exotel plays something
            # and then emit a mark to allow the flow to proceed.
            silence_ms = 200
            silence_samples = int(SAMPLE_RATE * (silence_ms / 1000.0))
            silence = (b"\x00\x00" * silence_samples)
            await state.output_queue.put(silence)

        # Add mark to track completion
        mark_id = f"response_{state.next_sequence()}"
        await state.output_queue.put({"type": "mark", "name": mark_id})
    
    def _split_audio_chunks(self, pcm_data: bytes) -> List[bytes]:
        """Split audio into proper chunk sizes (multiple of 320 bytes)"""
        chunks = []
        chunk_size = 6400  # 200ms chunks (6.4k bytes)
        
        for i in range(0, len(pcm_data), chunk_size):
            chunk = pcm_data[i:i + chunk_size]
            if len(chunk) > 0:
                chunks.append(chunk)
        
        return chunks
    
    async def _audio_sender(self, websocket: WebSocket, state: StreamState):
        """Background task to send audio chunks to Exotel"""
        logger.info("🎵 Audio sender started")
        timestamp = 0
        
        try:
            while True:
                # Get next item from queue
                item = await state.output_queue.get()
                
                if isinstance(item, dict) and item.get("type") == "mark":
                    # Send mark event
                    mark_msg = {
                        "event": "mark",
                        "stream_sid": state.stream_sid,
                        "sequence_number": state.next_sequence(),
                        "mark": {
                            "name": item.get("name", "")
                        }
                    }
                    await websocket.send_json(mark_msg)
                    logger.info(f"📌 Sent mark: {item.get('name')}")
                elif isinstance(item, dict) and item.get("type") == "clear":
                    # Send clear event to cancel queued audio at Exotel
                    clear_msg = {
                        "event": "clear",
                        "stream_sid": state.stream_sid
                    }
                    await websocket.send_json(clear_msg)
                    logger.info("🧽 Sent clear to cancel pending audio")
                
                elif isinstance(item, bytes):
                    # Send audio chunk
                    payload_b64 = base64.b64encode(item).decode('utf-8')
                    
                    media_msg = {
                        "event": "media",
                        "stream_sid": state.stream_sid,
                        "sequence_number": state.next_sequence(),
                        "media": {
                            "chunk": state.chunk_index,
                            "timestamp": timestamp,
                            "payload": payload_b64
                        }
                    }
                    
                    await websocket.send_json(media_msg)
                    state.chunk_index += 1
                    
                    # Update timestamp (in milliseconds)
                    # Each byte is 16-bit sample at 8kHz = 0.125ms
                    timestamp += int((len(item) / 2) * 1000 / SAMPLE_RATE)
                
                await asyncio.sleep(0.01)  # Small delay to avoid overwhelming
        
        except asyncio.CancelledError:
            logger.info("🎵 Audio sender stopped")
        except Exception as e:
            logger.error(f"Audio sender error: {e}")

# ==============================================================================
# FASTAPI APPLICATION
# ==============================================================================

app = FastAPI(
    title="Mangwale Voice Streaming Service",
    description="Real-time bidirectional voice streaming with Exotel",
    version="1.0.0"
)

# Initialize clients
asr_client = ASRClient()
tts_client = TTSClient()
conversation_manager = ConversationManager(asr_client, tts_client)
voicebot_handler = VoicebotHandler(conversation_manager, tts_client)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "voice-streaming",
        "active_streams": len(active_streams),
        "streams": [
            {
                "stream_sid": s.stream_sid,
                "call_sid": s.call_sid,
                "state": s.conversation_state,
                "duration": (datetime.now() - s.started_at).total_seconds()
            }
            for s in active_streams.values()
        ]
    }

@app.websocket("/ws/voicebot")
async def voicebot_websocket(websocket: WebSocket):
    """WebSocket endpoint for Exotel Voicebot streaming"""
    await voicebot_handler.handle_connection(websocket)

@app.get("/ws-url")
async def get_websocket_url(request: Request):
    """
    Dynamic WebSocket URL endpoint for Exotel.
    Exotel can call this HTTP endpoint to get the WebSocket URL dynamically.
    """
    # Extract custom parameters from query string
    custom_params = dict(request.query_params)
    
    # Build WebSocket URL
    base_url = os.getenv("WSS_BASE_URL", "wss://exotel.mangwale.ai")
    ws_url = f"{base_url}/ws/voicebot"
    
    # Ensure sample-rate param is present (default to current SAMPLE_RATE)
    if "sample-rate" not in custom_params:
        custom_params["sample-rate"] = str(SAMPLE_RATE)

    # Exotel limitation: max 3 custom params. Treat sample-rate as a separate
    # standardized parameter and allow up to 3 additional custom params.
    extra_keys = [k for k in custom_params.keys() if k != "sample-rate"]
    if len(extra_keys) > 3:
        for k in extra_keys[3:]:
            custom_params.pop(k, None)
        logger.warning("Dropped extra custom params beyond 3 (excluding sample-rate)")

    if custom_params:
        ws_url = f"{ws_url}?{urlencode(custom_params)}"
    
    return {"url": ws_url}

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "voice-streaming",
        "version": "1.0.0",
        "endpoints": {
            "websocket": "/ws/voicebot",
            "dynamic_url": "/ws-url",
            "health": "/health"
        }
    }

# ==============================================================================
# MAIN
# ==============================================================================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("STREAMING_PORT", "7200"))
    
    uvicorn.run(
        "voice_streaming_service:app",
        host="0.0.0.0",
        port=port,
        reload=os.getenv("DEBUG_MODE", "false").lower() == "true",
        log_level="debug" if os.getenv("DEBUG_MODE", "false").lower() == "true" else "info"
    )
