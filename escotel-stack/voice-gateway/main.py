"""
🎯 Voice Gateway - WebRTC, SIP, and Session Management
December 2025 - Mangwale Voice Stack

Features:
  - WebRTC for browser/mobile clients
  - SIP bridge for Exotel phone calls
  - Silero VAD for accurate voice detection
  - Turn-taking and interruption handling
  - Session state management
  - Real-time audio streaming
"""

import os
import io
import time
import asyncio
import logging
import json
import uuid
from typing import Optional, Dict, Any, List, Callable
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx

# Logging setup
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class GatewayConfig:
    # Service URLs
    asr_url: str = os.getenv("ASR_SERVICE_URL", "http://asr:7001")
    tts_url: str = os.getenv("TTS_SERVICE_URL", "http://tts:7002")
    orchestrator_url: str = os.getenv("ORCHESTRATOR_URL", "http://orchestrator:7000")
    jupiter_url: str = os.getenv("JUPITER_URL", "http://192.168.0.156:3200")
    
    # Exotel
    exotel_sid: str = os.getenv("EXOTEL_SID", "")
    exotel_api_key: str = os.getenv("EXOTEL_API_KEY", "")
    exotel_api_token: str = os.getenv("EXOTEL_API_TOKEN", "")
    exotel_caller_id: str = os.getenv("EXOTEL_CALLER_ID", "02048556923")
    exotel_callback_url: str = os.getenv("EXOTEL_CALLBACK_URL", "https://exotel.mangwale.ai")
    
    # VAD
    vad_threshold: float = float(os.getenv("VAD_THRESHOLD", "0.5"))
    vad_min_speech_duration: float = float(os.getenv("VAD_MIN_SPEECH_DURATION", "0.25"))
    vad_min_silence_duration: float = float(os.getenv("VAD_MIN_SILENCE_DURATION", "0.5"))
    
    # Session
    max_concurrent_sessions: int = int(os.getenv("MAX_CONCURRENT_SESSIONS", "10"))
    session_timeout_seconds: int = int(os.getenv("SESSION_TIMEOUT_SECONDS", "300"))
    enable_recording: bool = os.getenv("ENABLE_RECORDING", "true").lower() == "true"

config = GatewayConfig()

# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS AND MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class SessionState(str, Enum):
    IDLE = "idle"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"
    INTERRUPTED = "interrupted"
    ENDED = "ended"

class CallType(str, Enum):
    WEBRTC = "webrtc"
    SIP = "sip"
    WEBSOCKET = "websocket"

@dataclass
class VoiceSession:
    id: str
    call_type: CallType
    phone_number: Optional[str] = None
    language: str = "hi"
    state: SessionState = SessionState.IDLE
    created_at: datetime = field(default_factory=datetime.now)
    last_activity: datetime = field(default_factory=datetime.now)
    conversation_history: List[Dict[str, str]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "call_type": self.call_type.value,
            "phone_number": self.phone_number,
            "language": self.language,
            "state": self.state.value,
            "created_at": self.created_at.isoformat(),
            "last_activity": self.last_activity.isoformat(),
            "turns": len(self.conversation_history)
        }

class OutboundCallRequest(BaseModel):
    phone: str = Field(..., description="Phone number to call")
    call_type: str = Field(..., description="Type of call: vendor_order_confirmation, etc")
    language: str = Field("hi", description="Language for TTS")
    data: Dict[str, Any] = Field(default_factory=dict, description="Call-specific data")
    callback_url: Optional[str] = None

class CallResponse(BaseModel):
    success: bool
    call_sid: Optional[str] = None
    session_id: str
    message: str

# ═══════════════════════════════════════════════════════════════════════════════
# SILERO VAD
# ═══════════════════════════════════════════════════════════════════════════════

class SileroVAD:
    """Voice Activity Detection using Silero VAD."""
    
    def __init__(self):
        self.model = None
        self.sample_rate = 16000
        self._loaded = False
    
    async def load(self):
        """Load Silero VAD model."""
        if self._loaded:
            return
        
        try:
            logger.info("Loading Silero VAD model...")
            self.model, utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False
            )
            self._loaded = True
            logger.info("✅ Silero VAD loaded")
        except Exception as e:
            logger.error(f"Failed to load Silero VAD: {e}")
    
    def detect_speech(self, audio_chunk: np.ndarray) -> float:
        """
        Detect voice activity in audio chunk.
        
        Args:
            audio_chunk: Audio samples (16kHz, mono, float32)
            
        Returns:
            Speech probability (0-1)
        """
        if not self._loaded or self.model is None:
            return 0.0
        
        try:
            # Convert to tensor
            audio_tensor = torch.from_numpy(audio_chunk).float()
            
            # Get speech probability
            speech_prob = self.model(audio_tensor, self.sample_rate).item()
            return speech_prob
        except Exception as e:
            logger.error(f"VAD detection error: {e}")
            return 0.0
    
    def is_speech(self, audio_chunk: np.ndarray) -> bool:
        """Check if chunk contains speech."""
        return self.detect_speech(audio_chunk) >= config.vad_threshold

vad = SileroVAD()

# ═══════════════════════════════════════════════════════════════════════════════
# SESSION MANAGER
# ═══════════════════════════════════════════════════════════════════════════════

class SessionManager:
    """Manages active voice sessions."""
    
    def __init__(self):
        self.sessions: Dict[str, VoiceSession] = {}
        self._lock = asyncio.Lock()
    
    async def create_session(
        self,
        call_type: CallType,
        phone_number: Optional[str] = None,
        language: str = "hi",
        metadata: Optional[Dict[str, Any]] = None
    ) -> VoiceSession:
        """Create a new voice session."""
        async with self._lock:
            if len(self.sessions) >= config.max_concurrent_sessions:
                raise RuntimeError("Maximum concurrent sessions reached")
            
            session_id = str(uuid.uuid4())[:8]
            session = VoiceSession(
                id=session_id,
                call_type=call_type,
                phone_number=phone_number,
                language=language,
                metadata=metadata or {}
            )
            self.sessions[session_id] = session
            logger.info(f"Created session {session_id}, type={call_type.value}")
            return session
    
    async def get_session(self, session_id: str) -> Optional[VoiceSession]:
        """Get session by ID."""
        return self.sessions.get(session_id)
    
    async def update_state(self, session_id: str, state: SessionState):
        """Update session state."""
        if session_id in self.sessions:
            self.sessions[session_id].state = state
            self.sessions[session_id].last_activity = datetime.now()
    
    async def add_turn(self, session_id: str, role: str, content: str):
        """Add conversation turn."""
        if session_id in self.sessions:
            self.sessions[session_id].conversation_history.append({
                "role": role,
                "content": content,
                "timestamp": datetime.now().isoformat()
            })
            self.sessions[session_id].last_activity = datetime.now()
    
    async def end_session(self, session_id: str):
        """End and cleanup session."""
        async with self._lock:
            if session_id in self.sessions:
                self.sessions[session_id].state = SessionState.ENDED
                logger.info(f"Ended session {session_id}")
                # Don't delete immediately, keep for a bit for cleanup
                asyncio.create_task(self._delayed_cleanup(session_id, delay=60))
    
    async def _delayed_cleanup(self, session_id: str, delay: int):
        """Remove session after delay."""
        await asyncio.sleep(delay)
        async with self._lock:
            if session_id in self.sessions:
                del self.sessions[session_id]
                logger.info(f"Cleaned up session {session_id}")
    
    async def get_active_sessions(self) -> List[Dict[str, Any]]:
        """Get all active sessions."""
        return [s.to_dict() for s in self.sessions.values() if s.state != SessionState.ENDED]

session_manager = SessionManager()

# ═══════════════════════════════════════════════════════════════════════════════
# EXOTEL INTEGRATION
# ═══════════════════════════════════════════════════════════════════════════════

class ExotelClient:
    """Client for Exotel outbound calls."""
    
    def __init__(self):
        self.base_url = f"https://api.exotel.com/v1/Accounts/{config.exotel_sid}"
        self.auth = (config.exotel_api_key, config.exotel_api_token)
    
    async def initiate_call(
        self,
        phone: str,
        session_id: str,
        app_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Initiate outbound call via Exotel."""
        if not config.exotel_sid:
            raise RuntimeError("Exotel not configured")
        
        callback_url = f"{config.exotel_callback_url}/api/voice/exotel-callback/{session_id}"
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/Calls/connect",
                auth=self.auth,
                data={
                    "From": phone,
                    "CallerId": config.exotel_caller_id,
                    "Url": callback_url,
                    "CallType": "trans",
                    "TimeLimit": "300",
                    "StatusCallback": f"{callback_url}/status"
                }
            )
            
            if response.status_code not in [200, 201]:
                raise RuntimeError(f"Exotel API error: {response.text}")
            
            result = response.json()
            return {
                "call_sid": result.get("Call", {}).get("Sid"),
                "status": result.get("Call", {}).get("Status"),
                "phone": phone
            }

exotel_client = ExotelClient()

# ═══════════════════════════════════════════════════════════════════════════════
# TURN-TAKING ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TurnTakingEngine:
    """Manages conversation turn-taking and interruptions."""
    
    def __init__(self):
        self.silence_start: Dict[str, float] = {}
        self.is_user_speaking: Dict[str, bool] = {}
        self.is_ai_speaking: Dict[str, bool] = {}
    
    async def process_audio_chunk(
        self,
        session_id: str,
        audio_chunk: np.ndarray,
        on_speech_start: Optional[Callable] = None,
        on_speech_end: Optional[Callable] = None,
        on_interruption: Optional[Callable] = None
    ):
        """
        Process audio chunk and detect turn events.
        
        Events:
        - speech_start: User started speaking
        - speech_end: User stopped speaking (ready for AI)
        - interruption: User interrupted AI
        """
        is_speech = vad.is_speech(audio_chunk)
        
        was_speaking = self.is_user_speaking.get(session_id, False)
        self.is_user_speaking[session_id] = is_speech
        
        # Check for interruption (user speaks while AI is speaking)
        if is_speech and self.is_ai_speaking.get(session_id, False):
            if on_interruption:
                await on_interruption(session_id)
            self.is_ai_speaking[session_id] = False
            return "interrupted"
        
        # Detect speech start
        if is_speech and not was_speaking:
            self.silence_start.pop(session_id, None)
            if on_speech_start:
                await on_speech_start(session_id)
            return "speech_start"
        
        # Detect speech end (after silence threshold)
        if not is_speech and was_speaking:
            self.silence_start[session_id] = time.time()
        
        if session_id in self.silence_start:
            silence_duration = time.time() - self.silence_start[session_id]
            if silence_duration >= config.vad_min_silence_duration:
                del self.silence_start[session_id]
                if on_speech_end:
                    await on_speech_end(session_id)
                return "speech_end"
        
        return "continue"
    
    def set_ai_speaking(self, session_id: str, is_speaking: bool):
        """Mark AI as speaking/not speaking."""
        self.is_ai_speaking[session_id] = is_speaking

turn_engine = TurnTakingEngine()

# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Mangwale Voice Gateway",
    description="WebRTC, SIP, and Voice Session Management",
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
    """Initialize services on startup."""
    logger.info("🚀 Starting Voice Gateway...")
    await vad.load()
    logger.info("✅ Voice Gateway started")

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "mangwale-voice-gateway",
        "active_sessions": len(session_manager.sessions),
        "vad_loaded": vad._loaded,
        "exotel_configured": bool(config.exotel_sid)
    }

# ═══════════════════════════════════════════════════════════════════════════════
# OUTBOUND CALL API
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/voice/outbound-call")
async def initiate_outbound_call(request: OutboundCallRequest) -> CallResponse:
    """
    Initiate an outbound AI voice call.
    
    Used by Jupiter to trigger vendor/rider calls.
    """
    try:
        # Create session
        session = await session_manager.create_session(
            call_type=CallType.SIP,
            phone_number=request.phone,
            language=request.language,
            metadata={
                "call_type": request.call_type,
                "data": request.data,
                "callback_url": request.callback_url
            }
        )
        
        # Initiate Exotel call
        call_result = await exotel_client.initiate_call(
            phone=request.phone,
            session_id=session.id
        )
        
        await session_manager.update_state(session.id, SessionState.LISTENING)
        
        return CallResponse(
            success=True,
            call_sid=call_result.get("call_sid"),
            session_id=session.id,
            message=f"Call initiated to {request.phone}"
        )
        
    except Exception as e:
        logger.error(f"Failed to initiate call: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/voice/exotel-callback/{session_id}")
async def exotel_callback(session_id: str, request: Request):
    """
    Handle Exotel callback when call connects.
    
    Returns ExoML to play TTS prompt and collect DTMF/speech.
    """
    session = await session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    form_data = await request.form()
    call_status = form_data.get("Status", "in-progress")
    
    if call_status in ["completed", "failed", "busy", "no-answer"]:
        await session_manager.end_session(session_id)
        return {"status": "session_ended"}
    
    # Generate TTS prompt based on call type
    call_type = session.metadata.get("call_type", "default")
    call_data = session.metadata.get("data", {})
    
    # Generate prompt
    prompt = await generate_call_prompt(call_type, call_data, session.language)
    
    # Return ExoML to play TTS
    exoml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="hi-IN-Standard-A">{prompt}</Say>
    <Gather input="dtmf speech" timeout="10" action="{config.exotel_callback_url}/api/voice/exotel-input/{session_id}">
        <Say voice="hi-IN-Standard-A">कृपया अपना उत्तर दें।</Say>
    </Gather>
</Response>"""
    
    return JSONResponse(content=exoml, media_type="application/xml")

@app.post("/api/voice/exotel-input/{session_id}")
async def exotel_input(session_id: str, request: Request):
    """Handle DTMF or speech input from Exotel call."""
    session = await session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    form_data = await request.form()
    dtmf = form_data.get("Digits")
    speech = form_data.get("SpeechResult")
    
    logger.info(f"Call input: session={session_id}, dtmf={dtmf}, speech={speech[:50] if speech else None}")
    
    # Process input and get response
    response_text = await process_call_input(session, dtmf, speech)
    
    # Check if call should end
    if response_text.startswith("[END]"):
        response_text = response_text.replace("[END]", "")
        exoml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="hi-IN-Standard-A">{response_text}</Say>
    <Hangup/>
</Response>"""
    else:
        exoml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="hi-IN-Standard-A">{response_text}</Say>
    <Gather input="dtmf speech" timeout="10" action="{config.exotel_callback_url}/api/voice/exotel-input/{session_id}">
    </Gather>
</Response>"""
    
    return JSONResponse(content=exoml, media_type="application/xml")

async def generate_call_prompt(call_type: str, data: Dict, language: str) -> str:
    """Generate TTS prompt for call type."""
    prompts = {
        "vendor_order_confirmation": f"""नमस्ते, यह मंगवाले से कॉल है। 
{data.get('storeName', 'आपकी दुकान')} के लिए एक नया ऑर्डर आया है।
ऑर्डर नंबर {data.get('orderId', '')}, {data.get('itemsCount', 0)} आइटम, कुल {data.get('orderAmount', 0)} रुपये।
स्वीकार करने के लिए 1 दबाएं, अस्वीकार करने के लिए 2 दबाएं।""",
        
        "rider_assignment": f"""नमस्ते, यह मंगवाले से कॉल है।
एक नई डिलीवरी आपके लिए है।
{data.get('pickupAddress', 'पिकअप')} से {data.get('dropAddress', 'ड्रॉप')} तक।
स्वीकार करने के लिए 1 दबाएं।""",
        
        "default": "नमस्ते, यह मंगवाले से कॉल है। कृपया बोलें।"
    }
    
    return prompts.get(call_type, prompts["default"])

async def process_call_input(session: VoiceSession, dtmf: Optional[str], speech: Optional[str]) -> str:
    """Process call input and return response."""
    call_type = session.metadata.get("call_type", "default")
    call_data = session.metadata.get("data", {})
    
    # Handle DTMF for vendor order confirmation
    if call_type == "vendor_order_confirmation":
        if dtmf == "1":
            # Accepted - ask for prep time
            return """धन्यवाद! ऑर्डर कितने मिनट में तैयार होगा?
15 मिनट के लिए 1, 30 मिनट के लिए 2, 45 मिनट के लिए 3 दबाएं।"""
        elif dtmf == "2":
            # Rejected
            await report_to_jupiter(session, {
                "action": "order_rejected",
                "orderId": call_data.get("orderId"),
                "reason": speech or "No reason provided"
            })
            return "[END]धन्यवाद, ऑर्डर अस्वीकार कर दिया गया है। शुभ दिन!"
        elif dtmf in ["1", "2", "3"] and "prep_time_asked" in session.metadata:
            prep_times = {"1": 15, "2": 30, "3": 45}
            prep_time = prep_times.get(dtmf, 30)
            await report_to_jupiter(session, {
                "action": "order_accepted",
                "orderId": call_data.get("orderId"),
                "prepTimeMinutes": prep_time
            })
            return f"[END]धन्यवाद! ऑर्डर {prep_time} मिनट में तैयार होगा। शुभ दिन!"
    
    # Handle rider assignment
    if call_type == "rider_assignment" and dtmf == "1":
        await report_to_jupiter(session, {
            "action": "delivery_accepted",
            "deliveryId": call_data.get("deliveryId")
        })
        return "[END]धन्यवाद! डिलीवरी स्वीकार कर ली गई है। शुभ यात्रा!"
    
    # Default response
    return "मुझे समझ नहीं आया। कृपया फिर से प्रयास करें।"

async def report_to_jupiter(session: VoiceSession, data: Dict):
    """Report call result to Jupiter."""
    callback_url = session.metadata.get("callback_url") or f"{config.jupiter_url}/api/voice/result"
    
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                callback_url,
                json={
                    "session_id": session.id,
                    "phone": session.phone_number,
                    **data
                },
                timeout=10
            )
            logger.info(f"Reported to Jupiter: {data}")
    except Exception as e:
        logger.error(f"Failed to report to Jupiter: {e}")

# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET VOICE STREAMING
# ═══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/voice/{session_id}")
async def websocket_voice_stream(websocket: WebSocket, session_id: Optional[str] = None):
    """
    Real-time voice streaming via WebSocket.
    
    Protocol:
    - Client sends audio chunks as binary (16kHz, mono, PCM16)
    - Server sends JSON for transcripts and audio for TTS
    """
    await websocket.accept()
    
    # Create or get session
    if session_id:
        session = await session_manager.get_session(session_id)
    else:
        session = await session_manager.create_session(CallType.WEBSOCKET)
        session_id = session.id
    
    if not session:
        session = await session_manager.create_session(CallType.WEBSOCKET)
        session_id = session.id
    
    await websocket.send_json({
        "type": "session_created",
        "session_id": session_id
    })
    
    logger.info(f"WebSocket voice session started: {session_id}")
    
    audio_buffer = io.BytesIO()
    
    try:
        while True:
            data = await websocket.receive()
            
            if "bytes" in data:
                # Audio chunk received
                audio_chunk = np.frombuffer(data["bytes"], dtype=np.int16).astype(np.float32) / 32768.0
                audio_buffer.write(data["bytes"])
                
                # Process VAD and turn-taking
                event = await turn_engine.process_audio_chunk(
                    session_id,
                    audio_chunk,
                    on_speech_start=lambda sid: websocket.send_json({"type": "speech_start"}),
                    on_speech_end=lambda sid: process_speech_end(websocket, audio_buffer, session),
                    on_interruption=lambda sid: websocket.send_json({"type": "interrupted"})
                )
                
            elif "text" in data:
                msg = json.loads(data["text"]) if isinstance(data["text"], str) else data["text"]
                
                if msg.get("type") == "end":
                    break
                elif msg.get("type") == "text":
                    # Process text input directly
                    await process_text_input(websocket, session, msg.get("text", ""))
                    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.send_json({"type": "error", "message": str(e)})
    finally:
        await session_manager.end_session(session_id)
        await websocket.close()

async def process_speech_end(websocket: WebSocket, audio_buffer: io.BytesIO, session: VoiceSession):
    """Process audio when user stops speaking."""
    audio_buffer.seek(0)
    audio_bytes = audio_buffer.read()
    audio_buffer.seek(0)
    audio_buffer.truncate(0)
    
    if len(audio_bytes) < 16000:  # Less than 0.5s
        return
    
    await session_manager.update_state(session.id, SessionState.PROCESSING)
    await websocket.send_json({"type": "processing"})
    
    # Send to ASR
    async with httpx.AsyncClient() as client:
        # Create WAV file in memory
        import wave
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(audio_bytes)
        wav_buffer.seek(0)
        
        response = await client.post(
            f"{config.asr_url}/v1/audio/transcriptions",
            files={"file": ("audio.wav", wav_buffer, "audio/wav")},
            data={"language": session.language},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            transcript = result.get("text", "")
            
            await websocket.send_json({
                "type": "transcript",
                "text": transcript,
                "language": result.get("language", session.language)
            })
            
            # Get AI response
            await session_manager.add_turn(session.id, "user", transcript)
            
            # Call LLM via orchestrator
            llm_response = await client.post(
                f"{config.orchestrator_url}/api/chat",
                json={
                    "session_id": session.id,
                    "message": transcript,
                    "language": session.language
                },
                timeout=30
            )
            
            if llm_response.status_code == 200:
                ai_text = llm_response.json().get("response", "")
                await session_manager.add_turn(session.id, "assistant", ai_text)
                
                await websocket.send_json({
                    "type": "ai_response",
                    "text": ai_text
                })
                
                # Generate TTS
                await session_manager.update_state(session.id, SessionState.SPEAKING)
                turn_engine.set_ai_speaking(session.id, True)
                
                tts_response = await client.post(
                    f"{config.tts_url}/v1/audio/speech",
                    json={
                        "text": ai_text,
                        "language": session.language
                    },
                    timeout=30
                )
                
                if tts_response.status_code == 200:
                    await websocket.send_bytes(tts_response.content)
                
                turn_engine.set_ai_speaking(session.id, False)
    
    await session_manager.update_state(session.id, SessionState.LISTENING)

async def process_text_input(websocket: WebSocket, session: VoiceSession, text: str):
    """Process text input directly."""
    await session_manager.update_state(session.id, SessionState.PROCESSING)
    await session_manager.add_turn(session.id, "user", text)
    
    async with httpx.AsyncClient() as client:
        # Get AI response
        response = await client.post(
            f"{config.orchestrator_url}/api/chat",
            json={
                "session_id": session.id,
                "message": text,
                "language": session.language
            },
            timeout=30
        )
        
        if response.status_code == 200:
            ai_text = response.json().get("response", "")
            await session_manager.add_turn(session.id, "assistant", ai_text)
            
            await websocket.send_json({
                "type": "ai_response",
                "text": ai_text
            })
            
            # Generate TTS
            tts_response = await client.post(
                f"{config.tts_url}/v1/audio/speech",
                json={
                    "text": ai_text,
                    "language": session.language
                },
                timeout=30
            )
            
            if tts_response.status_code == 200:
                await websocket.send_bytes(tts_response.content)
    
    await session_manager.update_state(session.id, SessionState.LISTENING)

# ═══════════════════════════════════════════════════════════════════════════════
# SESSION MANAGEMENT API
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/sessions/active")
async def get_active_sessions():
    """Get all active voice sessions."""
    sessions = await session_manager.get_active_sessions()
    return {"sessions": sessions, "count": len(sessions)}

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    """Get specific session details."""
    session = await session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.to_dict()

@app.delete("/api/sessions/{session_id}")
async def end_session(session_id: str):
    """End a voice session."""
    await session_manager.end_session(session_id)
    return {"status": "ended", "session_id": session_id}

@app.get("/metrics")
async def get_metrics():
    """Prometheus-compatible metrics."""
    metrics = [
        f'voice_gateway_active_sessions {len(session_manager.sessions)}',
        f'voice_gateway_vad_loaded {1 if vad._loaded else 0}',
    ]
    return "\n".join(metrics)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
