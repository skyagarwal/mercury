"""
Mangwale Voice Nerve System - Exotel IVR Orchestrator
=====================================================

Ultra-fast Python service for Exotel IVR voice calls.
Optimized for vendor order confirmation and rider assignment.

Key Optimizations:
1. Pre-cached TTS for common phrases (reduces latency by ~200ms)
2. Direct integration with ASR/TTS services (no JS middleware)
3. Async parallel processing
4. Connection pooling for downstream services
5. In-memory call state management

Architecture:
                    ┌─────────────────────────────────────────┐
                    │          NERVE SYSTEM (Python)          │
                    │              Port: 7100                  │
                    ├─────────────────────────────────────────┤
                    │                                          │
   Exotel ──────────►  Webhook Handler                        │
   Webhook           │  ├── Parse DTMF/CustomField            │
                    │  ├── Process call state                 │
                    │  └── Generate response                  │
                    │                                          │
   Jupiter ─────────►  Call Initiator                         │
   /api/voice       │  ├── Receive call request               │
                    │  ├── Pre-generate TTS audio             │
                    │  └── Initiate Exotel call               │
                    │                                          │
                    │  ┌──────────────────────────────────┐   │
                    │  │  TTS Cache (In-Memory)           │   │
                    │  │  - Greeting templates            │   │
                    │  │  - Common phrases                │   │
                    │  │  - Number pronunciations         │   │
                    │  └──────────────────────────────────┘   │
                    │                                          │
                    │  Downstream Services:                    │
                    │  ├── ASR: http://localhost:7001         │
                    │  ├── TTS: http://localhost:7002         │
                    │  └── Jupiter: http://192.168.0.156:3200 │
                    │                                          │
                    └─────────────────────────────────────────┘
"""

import os
import io
import time
import json
import asyncio
import logging
import hashlib
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, field
from functools import lru_cache
import base64

from fastapi import FastAPI, Request, Response, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
import httpx
import uvicorn
from minio import Minio
from minio.error import S3Error
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG_MODE", "false").lower() == "true" else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("nerve-system")

# ==============================================================================
# CONFIGURATION
# ==============================================================================

# Service URLs
ASR_URL = os.getenv("ASR_URL", "http://localhost:7001")
TTS_URL = os.getenv("TTS_URL", "http://localhost:7002")
JUPITER_URL = os.getenv("JUPITER_URL", "http://192.168.0.156:3200")
EXOTEL_CALLBACK_URL = os.getenv("EXOTEL_CALLBACK_URL", "https://exotel.mangwale.ai")

# Jupiter AI Integration (Phase 0)
JUPITER_AI_URL = os.getenv("JUPITER_AI_URL", "http://192.168.0.156:3200")
JUPITER_API_TIMEOUT = float(os.getenv("JUPITER_API_TIMEOUT", "30.0"))
USE_JUPITER_AI = os.getenv("USE_JUPITER_AI", "false").lower() == "true"

# Exotel credentials
EXOTEL_SID = os.getenv("EXOTEL_SID", "sarvinsuppliesllp1")
EXOTEL_API_KEY = os.getenv("EXOTEL_API_KEY", "")
EXOTEL_API_TOKEN = os.getenv("EXOTEL_API_TOKEN", "")
EXOTEL_CALLER_ID = os.getenv("EXOTEL_CALLER_ID", "02048556923")
EXOTEL_SUBDOMAIN = os.getenv("EXOTEL_SUBDOMAIN", "api")

# MinIO configuration (for audio storage, recordings, training data)
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "192.168.0.156:9002")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minio_strong_password")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"
MINIO_BUCKET_AUDIO = os.getenv("MINIO_BUCKET_AUDIO", "voice-audio")
MINIO_BUCKET_RECORDINGS = os.getenv("MINIO_BUCKET_RECORDINGS", "call-recordings")
MINIO_BUCKET_TRAINING = os.getenv("MINIO_BUCKET_TRAINING", "training-data")
MINIO_PUBLIC_URL = os.getenv("MINIO_PUBLIC_URL", "https://storage.mangwale.ai")

# ==============================================================================
# ENUMS AND MODELS
# ==============================================================================

class CallType(str, Enum):
    VENDOR_ORDER_CONFIRMATION = "vendor_order_confirmation"
    VENDOR_PREP_TIME = "vendor_prep_time"
    RIDER_ASSIGNMENT = "rider_assignment"
    RIDER_PICKUP_READY = "rider_pickup_ready"

class CallStatus(str, Enum):
    INITIATED = "INITIATED"
    RINGING = "RINGING"
    ANSWERED = "ANSWERED"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    PREP_TIME_SET = "PREP_TIME_SET"
    NO_RESPONSE = "NO_RESPONSE"
    FAILED = "FAILED"
    BUSY = "BUSY"
    COMPLETED = "COMPLETED"
    RETRY_REQUESTED = "RETRY_REQUESTED"  # Vendor wants to check app, retry in 2 min

class RejectionReason(str, Enum):
    ITEM_UNAVAILABLE = "ITEM_UNAVAILABLE"
    TOO_BUSY = "TOO_BUSY"
    SHOP_CLOSED = "SHOP_CLOSED"
    OTHER = "OTHER"

class OrderItem(BaseModel):
    name: str
    quantity: int = 1
    price: Optional[float] = None

class VendorCallRequest(BaseModel):
    order_id: int
    vendor_id: str  # Can be string or int (converted to string)
    vendor_phone: str
    vendor_name: str
    customer_name: Optional[str] = "Customer"
    order_items: List[OrderItem] = []
    order_amount: float
    payment_method: str = "Cash on Delivery"
    language: str = "hi"

class RiderCallRequest(BaseModel):
    order_id: int
    rider_id: int
    rider_phone: str
    rider_name: str
    restaurant_name: str
    restaurant_address: str
    pickup_time_minutes: int = 30
    customer_name: Optional[str] = None
    delivery_address: Optional[str] = None
    language: str = "hi"

class CallResult(BaseModel):
    call_sid: str
    call_type: CallType
    status: CallStatus
    order_id: Optional[int] = None
    vendor_id: Optional[str] = None  # Can be string or int
    rider_id: Optional[str] = None   # Can be string or int
    digits: Optional[str] = None
    prep_time_minutes: Optional[int] = None
    rejection_reason: Optional[RejectionReason] = None
    answered_at: Optional[str] = None
    ended_at: Optional[str] = None
    duration: Optional[int] = None
    recording_url: Optional[str] = None

# ==============================================================================
# IN-MEMORY CALL STATE
# ==============================================================================

@dataclass
class CallState:
    """Track state of an active call"""
    call_sid: str
    call_type: CallType
    order_id: int
    vendor_id: Optional[int] = None
    rider_id: Optional[int] = None
    vendor_name: str = ""
    order_items: List[OrderItem] = field(default_factory=list)
    order_amount: float = 0
    language: str = "hi"
    status: CallStatus = CallStatus.INITIATED
    current_state: str = "greeting"  # greeting, confirmation, prep_time, rejection_reason, goodbye
    dtmf_digits: str = ""
    prep_time_minutes: Optional[int] = None
    rejection_reason: Optional[RejectionReason] = None
    started_at: datetime = field(default_factory=datetime.now)
    answered_at: Optional[datetime] = None
    tts_cache: Dict[str, bytes] = field(default_factory=dict)

# Global call state storage
active_calls: Dict[str, CallState] = {}

# ==============================================================================
# MINIO CLIENT - For audio storage, recordings, training data
# ==============================================================================

class MinioAudioStorage:
    """MinIO client for storing and serving audio files"""
    
    def __init__(self):
        self.client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE
        )
        self.audio_bucket = MINIO_BUCKET_AUDIO
        self.recordings_bucket = MINIO_BUCKET_RECORDINGS
        self.training_bucket = MINIO_BUCKET_TRAINING
        self._ensure_buckets()
    
    def _ensure_buckets(self):
        """Ensure all required buckets exist"""
        for bucket in [self.audio_bucket, self.recordings_bucket, self.training_bucket]:
            try:
                if not self.client.bucket_exists(bucket):
                    self.client.make_bucket(bucket)
                    logger.info(f"Created MinIO bucket: {bucket}")
            except S3Error as e:
                logger.warning(f"MinIO bucket check failed for {bucket}: {e}")
    
    def upload_audio(self, audio_data: bytes, filename: str, bucket: str = None) -> str:
        """Upload audio to MinIO and return public URL"""
        bucket = bucket or self.audio_bucket
        try:
            self.client.put_object(
                bucket,
                filename,
                io.BytesIO(audio_data),
                length=len(audio_data),
                content_type="audio/wav"
            )
            # Return public URL (via storage.mangwale.ai)
            url = f"{MINIO_PUBLIC_URL}/{bucket}/{filename}"
            logger.info(f"📤 Uploaded audio to MinIO: {filename} -> {url}")
            return url
        except S3Error as e:
            logger.error(f"MinIO upload failed: {e}")
            return None
    
    def upload_recording(self, audio_data: bytes, call_sid: str, metadata: dict = None) -> str:
        """Upload call recording for audit/training purposes"""
        filename = f"recordings/{datetime.now().strftime('%Y/%m/%d')}/{call_sid}.wav"
        return self.upload_audio(audio_data, filename, self.recordings_bucket)
    
    def upload_training_data(self, audio_data: bytes, text: str, language: str) -> str:
        """Upload audio+text pair for model training"""
        # Generate unique filename based on content
        content_hash = hashlib.md5(f"{text}:{language}".encode()).hexdigest()[:12]
        filename = f"tts/{language}/{content_hash}.wav"
        
        # Also save the text transcript
        try:
            transcript_filename = f"tts/{language}/{content_hash}.txt"
            self.client.put_object(
                self.training_bucket,
                transcript_filename,
                io.BytesIO(text.encode()),
                length=len(text.encode()),
                content_type="text/plain"
            )
        except S3Error as e:
            logger.warning(f"Failed to save transcript: {e}")
        
        return self.upload_audio(audio_data, filename, self.training_bucket)

# Initialize MinIO client (lazy)
minio_storage: Optional[MinioAudioStorage] = None

def get_minio_storage() -> MinioAudioStorage:
    """Get or create MinIO storage client"""
    global minio_storage
    if minio_storage is None:
        try:
            minio_storage = MinioAudioStorage()
            logger.info("✅ MinIO storage initialized")
        except Exception as e:
            logger.error(f"Failed to initialize MinIO: {e}")
    return minio_storage

# ==============================================================================
# TTS CACHE - Pre-generate common phrases
# ==============================================================================

class TTSCache:
    """Cache for pre-generated TTS audio"""
    
    def __init__(self):
        self.cache: Dict[str, bytes] = {}
        self.tts_url = TTS_URL
        self._http_client: Optional[httpx.AsyncClient] = None
    
    async def get_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client
    
    def cache_key(self, text: str, language: str, voice: str) -> str:
        """Generate cache key for TTS request"""
        content = f"{text}:{language}:{voice}"
        return hashlib.md5(content.encode()).hexdigest()
    
    async def synthesize(self, text: str, language: str = "hi", voice: str = "hindi_female") -> bytes:
        """Synthesize text to speech with caching"""
        key = self.cache_key(text, language, voice)
        
        # Check cache
        if key in self.cache:
            logger.debug(f"TTS cache hit: {text[:30]}...")
            return self.cache[key]
        
        # Generate TTS
        start = time.time()
        client = await self.get_client()
        
        try:
            response = await client.post(
                f"{self.tts_url}/synthesize",
                json={
                    "text": text,
                    "language": language,
                    "voice": voice,
                    "format": "wav"
                }
            )
            response.raise_for_status()
            audio_data = response.content
            
            # Cache the result
            self.cache[key] = audio_data
            
            logger.info(f"TTS synthesized in {(time.time()-start)*1000:.0f}ms: {text[:30]}...")
            return audio_data
            
        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            raise
    
    async def preload_common_phrases(self, language: str = "hi"):
        """Pre-load common TTS phrases into cache"""
        phrases = HINDI_PHRASES if language == "hi" else ENGLISH_PHRASES
        
        logger.info(f"Pre-loading {len(phrases)} common TTS phrases...")
        
        for key, text in phrases.items():
            try:
                await self.synthesize(text, language)
            except Exception as e:
                logger.warning(f"Failed to preload '{key}': {e}")
        
        logger.info(f"TTS cache loaded with {len(self.cache)} phrases")

# Common phrases in Hindi
HINDI_PHRASES = {
    "greeting_prefix": "नमस्ते",
    "mangwale_intro": "यह मंगवाले से कॉल है",
    "new_order": "आपके लिए एक नया ऑर्डर आया है",
    "order_number": "ऑर्डर नंबर",
    "total_amount": "कुल राशि",
    "rupees": "रुपये",
    "accept_prompt": "ऑर्डर स्वीकार करने के लिए 1 दबाएं",
    "reject_prompt": "रद्द करने के लिए 0 दबाएं",
    "thank_you": "धन्यवाद",
    "order_accepted": "ऑर्डर स्वीकार हो गया",
    "prep_time_prompt": "खाना तैयार करने में कितने मिनट लगेंगे",
    "fifteen_minutes": "15 मिनट के लिए 1 दबाएं",
    "thirty_minutes": "30 मिनट के लिए 2 दबाएं",
    "fortyfive_minutes": "45 मिनट के लिए 3 दबाएं",
    "custom_time": "या अपना समय डालें और # दबाएं",
    "rider_arrive": "राइडर",
    "minutes_in": "मिनट में पहुंचेगा",
    "good_day": "शुभ दिन",
    "rejection_reason_prompt": "कृपया रद्द करने का कारण बताएं",
    "item_unavailable": "आइटम उपलब्ध नहीं है",
    "too_busy": "बहुत व्यस्त हैं",
    "shop_closed": "दुकान बंद है",
    "other_reason": "अन्य कारण",
    "rejection_ack": "हम किसी और को यह ऑर्डर देंगे",
    "pieces": "पीस",
    "payment_cod": "कैश ऑन डिलीवरी",
    "payment_online": "ऑनलाइन पेमेंट",
    "no_input": "कोई इनपुट नहीं मिला",
    "press": "दबाएं",
}

# Common phrases in English
ENGLISH_PHRASES = {
    "greeting_prefix": "Hello",
    "mangwale_intro": "This is a call from Mangwale",
    "new_order": "You have a new order",
    "order_number": "Order number",
    "total_amount": "Total amount",
    "rupees": "rupees",
    "accept_prompt": "Press 1 to accept the order",
    "reject_prompt": "Press 0 to reject",
    "thank_you": "Thank you",
    "order_accepted": "Order accepted",
    "prep_time_prompt": "How many minutes to prepare",
    "fifteen_minutes": "Press 1 for 15 minutes",
    "thirty_minutes": "Press 2 for 30 minutes",
    "fortyfive_minutes": "Press 3 for 45 minutes",
    "custom_time": "Or enter your time and press hash",
    "rider_arrive": "Rider will arrive in",
    "minutes_in": "minutes",
    "good_day": "Have a good day",
    "rejection_reason_prompt": "Please select rejection reason",
    "item_unavailable": "Item unavailable",
    "too_busy": "Too busy",
    "shop_closed": "Shop closed",
    "other_reason": "Other reason",
    "rejection_ack": "We will assign this order to another vendor",
    "no_input": "No input received",
    "press": "press",
}

# Global TTS cache
tts_cache: Optional[TTSCache] = None

# ==============================================================================
# SCRIPT GENERATORS
# ==============================================================================

def generate_vendor_greeting_script(call_state: CallState) -> str:
    """Generate Hindi/English greeting with order details"""
    lang = call_state.language
    phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
    
    # Build items list
    items_text = ""
    for item in call_state.order_items:
        if lang == "hi":
            qty_text = f" ({item.quantity} {phrases['pieces']})" if item.quantity > 1 else ""
            items_text += f"{item.name}{qty_text}, "
        else:
            qty_text = f" (quantity {item.quantity})" if item.quantity > 1 else ""
            items_text += f"{item.name}{qty_text}, "
    items_text = items_text.rstrip(", ")
    
    if lang == "hi":
        script = (
            f"{phrases['greeting_prefix']} {call_state.vendor_name}, "
            f"{phrases['mangwale_intro']}। "
            f"{phrases['new_order']}। "
            f"{phrases['order_number']} {call_state.order_id} में है: {items_text}। "
            f"{phrases['total_amount']}: {int(call_state.order_amount)} {phrases['rupees']}। "
            f"{phrases['accept_prompt']}। "
            f"{phrases['reject_prompt']}।"
        )
    else:
        script = (
            f"{phrases['greeting_prefix']} {call_state.vendor_name}, "
            f"{phrases['mangwale_intro']}. "
            f"{phrases['new_order']}. "
            f"{phrases['order_number']} {call_state.order_id} contains: {items_text}. "
            f"{phrases['total_amount']}: {int(call_state.order_amount)} {phrases['rupees']}. "
            f"{phrases['accept_prompt']}. "
            f"{phrases['reject_prompt']}."
        )
    
    return script

def generate_accepted_script(call_state: CallState) -> str:
    """Generate acceptance confirmation + prep time prompt"""
    lang = call_state.language
    phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
    
    if lang == "hi":
        return (
            f"{phrases['thank_you']}! {phrases['order_accepted']}। "
            f"{phrases['prep_time_prompt']}? "
            f"{phrases['fifteen_minutes']}, "
            f"{phrases['thirty_minutes']}, "
            f"{phrases['fortyfive_minutes']}, "
            f"{phrases['custom_time']}।"
        )
    else:
        return (
            f"{phrases['thank_you']}! {phrases['order_accepted']}. "
            f"{phrases['prep_time_prompt']}? "
            f"{phrases['fifteen_minutes']}, "
            f"{phrases['thirty_minutes']}, "
            f"{phrases['fortyfive_minutes']}, "
            f"{phrases['custom_time']}."
        )

def generate_prep_time_goodbye(call_state: CallState, prep_time: int) -> str:
    """Generate goodbye message with prep time"""
    lang = call_state.language
    phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
    
    if lang == "hi":
        return f"{phrases['thank_you']}! {phrases['rider_arrive']} {prep_time} {phrases['minutes_in']}। {phrases['good_day']}!"
    else:
        return f"{phrases['thank_you']}! {phrases['rider_arrive']} {prep_time} {phrases['minutes_in']}. {phrases['good_day']}!"

def generate_rejection_prompt(call_state: CallState) -> str:
    """Generate rejection reason prompt"""
    lang = call_state.language
    phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
    
    if lang == "hi":
        return (
            f"{phrases['rejection_reason_prompt']}: "
            f"1 - {phrases['item_unavailable']}, "
            f"2 - {phrases['too_busy']}, "
            f"3 - {phrases['shop_closed']}, "
            f"4 - {phrases['other_reason']}।"
        )
    else:
        return (
            f"{phrases['rejection_reason_prompt']}: "
            f"1 - {phrases['item_unavailable']}, "
            f"2 - {phrases['too_busy']}, "
            f"3 - {phrases['shop_closed']}, "
            f"4 - {phrases['other_reason']}."
        )

def generate_rejection_goodbye(call_state: CallState) -> str:
    """Generate rejection acknowledgement"""
    lang = call_state.language
    phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
    
    if lang == "hi":
        return f"{phrases['thank_you']}, {phrases['rejection_ack']}। {phrases['good_day']}!"
    else:
        return f"{phrases['thank_you']}, {phrases['rejection_ack']}. {phrases['good_day']}!"

# ==============================================================================
# HTTP CLIENT
# ==============================================================================

class ExotelClient:
    """Async Exotel API client"""
    
    def __init__(self):
        self.base_url = f"https://{EXOTEL_SUBDOMAIN}.exotel.com/v1/Accounts/{EXOTEL_SID}"
        self._client: Optional[httpx.AsyncClient] = None
    
    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                auth=(EXOTEL_API_KEY, EXOTEL_API_TOKEN),
                timeout=30.0
            )
        return self._client
    
    async def initiate_call(
        self,
        to_phone: str,
        custom_field: Dict[str, Any],
        ivr_app_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Initiate an outbound call via Exotel
        
        Exotel outbound call flow with Url:
        1. Exotel calls `From` number (vendor's phone)
        2. When vendor answers, Exotel fetches ExoML from `Url`
        3. ExoML controls what happens (TTS, DTMF gathering, etc.)
        """
        client = await self.get_client()
        
        # Build callback URLs - Exotel will call these and pass CustomField automatically
        callback_url = f"{EXOTEL_CALLBACK_URL}/api/nerve/callback"
        status_callback = f"{EXOTEL_CALLBACK_URL}/api/nerve/status"
        custom_field_json = json.dumps(custom_field)
        
        # IMPORTANT: Exotel's "Url" parameter ONLY accepts their internal app URLs!
        # Format: http://my.exotel.com/{account_sid}/exoml/start_voice/{app_id}
        # 
        # To use external URLs (like our callback), we MUST:
        # 1. Create a Passthru Applet in Exotel Dashboard
        # 2. Configure Passthru URL to: https://exotel.mangwale.ai/api/nerve/callback
        # 3. Use that App ID here
        #
        # The Passthru applet will forward to our URL and return our ExoML response
        
        IVR_APP_ID = ivr_app_id or os.getenv("IVR_APP_ID", "1145356")
        EXOTEL_ACCOUNT_SID = os.getenv("EXOTEL_SID", "sarvinsuppliesllp1")
        
        # Correct Exotel app URL format (REQUIRED for IVR calls)
        exoml_url = f"http://my.exotel.com/{EXOTEL_ACCOUNT_SID}/exoml/start_voice/{IVR_APP_ID}"
        logger.info(f"Using Exotel Passthru App: {IVR_APP_ID}")
        
        # Build request for outbound call
        data = {
            "From": to_phone,              # Phone number to call (vendor)
            "CallerId": EXOTEL_CALLER_ID,  # Caller ID to display (02048556923)
            "Url": exoml_url,              # ExoML URL (direct callback or IVR App)
            "CallType": "trans",           # Transactional call
            "TimeLimit": 300,              # 5 minutes max
            "TimeOut": 30,                 # 30 seconds to answer
            "StatusCallback": status_callback,
            "CustomField": custom_field_json,
        }
        
        logger.info(f"🔔 Initiating call to {to_phone}")
        logger.info(f"📞 Exotel API Parameters:")
        logger.info(f"   From: {to_phone}")
        logger.info(f"   CallerId: {EXOTEL_CALLER_ID}")
        logger.info(f"   Url: {exoml_url}")
        logger.info(f"   StatusCallback: {status_callback}")
        logger.info(f"📤 CustomField: {custom_field_json[:100]}...")
        
        try:
            response = await client.post(
                f"{self.base_url}/Calls/connect.json",
                data=data
            )
            response.raise_for_status()
            result = response.json()
            
            logger.info(f"📨 Exotel response: {json.dumps(result, indent=2)[:500]}")
            
            call_sid = result.get("Call", {}).get("Sid")
            logger.info(f"✅ Call initiated successfully: {call_sid}")
            
            # Store the call state immediately so callback can find it
            call_type = CallType(custom_field.get("call_type", "vendor_order_confirmation"))
            call_state = CallState(
                call_sid=call_sid,
                call_type=call_type,
                order_id=custom_field.get("order_id", 0),
                vendor_id=custom_field.get("vendor_id"),
                vendor_name=custom_field.get("vendor_name", ""),
                rider_id=custom_field.get("rider_id"),
                language=custom_field.get("language", "hi"),
                order_amount=custom_field.get("order_amount", 0),
                order_items=[OrderItem(**item) for item in custom_field.get("order_items", [])]
            )
            call_state.current_state = "greeting"  # Ready for first callback
            call_state.status = CallStatus.INITIATED
            active_calls[call_sid] = call_state
            
            logger.info(f"📋 Stored call_state for {call_sid}: {call_state.vendor_name} | Order #{call_state.order_id}")
            
            return {
                "success": True,
                "call_sid": call_sid,
                "status": "initiated"
            }
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Exotel API error: {e.response.status_code} - {e.response.text}")
            return {
                "success": False,
                "error": str(e),
                "response": e.response.text
            }
        except Exception as e:
            logger.error(f"Call initiation failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }

# Global Exotel client
exotel_client: Optional[ExotelClient] = None

# ==============================================================================
# JUPITER REPORTER
# ==============================================================================

class JupiterReporter:
    """Report call results to Jupiter's voice-calls module"""
    
    def __init__(self):
        self.jupiter_url = JUPITER_URL
        self._client: Optional[httpx.AsyncClient] = None
    
    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client
    
    async def report_result(self, result: CallResult) -> bool:
        """Report call result to Jupiter"""
        client = await self.get_client()
        
        url = f"{self.jupiter_url}/api/voice-calls/result"
        
        try:
            response = await client.post(
                url,
                json=result.model_dump(exclude_none=True)
            )
            response.raise_for_status()
            logger.info(f"Reported to Jupiter: {result.call_sid} -> {result.status}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to report to Jupiter: {e}")
            return False

# Global Jupiter reporter
jupiter_reporter: Optional[JupiterReporter] = None


# ==============================================================================
# JUPITER AI INTEGRATION (Phase 0)
# ==============================================================================

class JupiterAIClient:
    """Client for Jupiter AI Backend - Routes voice calls through FlowEngine + NLU + LLM"""
    
    def __init__(self):
        self.jupiter_url = JUPITER_AI_URL
        self.timeout = JUPITER_API_TIMEOUT
        self._client: Optional[httpx.AsyncClient] = None
    
    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client
    
    async def process_message(
        self,
        phone: str,
        message: str,
        session_id: str,
        context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Call Jupiter AI Backend for intelligent response.
        Routes through FlowEngine + NLU + LLM.
        """
        if not USE_JUPITER_AI:
            logger.debug("Jupiter AI disabled - using static scripts")
            return None
        
        client = await self.get_client()
        url = f"{self.jupiter_url}/webhook/voice/nerve-process"
        
        try:
            logger.info(f"🤖 Calling Jupiter AI: phone={phone}, message={message[:50]}...")
            
            response = await client.post(
                url,
                json={
                    "phone": phone,
                    "message": message,
                    "sessionId": session_id,
                    "platform": "voice",
                    "context": context or {}
                }
            )
            response.raise_for_status()
            result = response.json()
            
            logger.info(f"✅ Jupiter AI response: {result.get('text', '')[:50]}...")
            return result
            
        except Exception as e:
            logger.error(f"❌ Jupiter AI call failed: {e}")
            return None
    
    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None


# Global Jupiter AI client
jupiter_ai: Optional[JupiterAIClient] = None


def digits_to_text(digits: str) -> str:
    """Convert DTMF digits to natural language for AI processing"""
    mapping = {
        "1": "accept order",
        "2": "reject order", 
        "0": "need help",
        "*": "repeat",
        "#": "confirm",
    }
    return mapping.get(digits, f"pressed {digits}")


# ==============================================================================
# FASTAPI APPLICATION
# ==============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    global tts_cache, exotel_client, jupiter_reporter, jupiter_ai
    
    logger.info("🚀 Starting Nerve System...")
    
    # Initialize components
    tts_cache = TTSCache()
    exotel_client = ExotelClient()
    jupiter_reporter = JupiterReporter()
    jupiter_ai = JupiterAIClient()
    
    # Log Jupiter AI status
    if USE_JUPITER_AI:
        logger.info(f"🤖 Jupiter AI Integration ENABLED: {JUPITER_AI_URL}")
    else:
        logger.info("⚠️ Jupiter AI Integration DISABLED - using static scripts")
    
    # Pre-load TTS cache (async)
    asyncio.create_task(tts_cache.preload_common_phrases("hi"))
    
    logger.info("✅ Nerve System ready")
    
    yield
    
    # Cleanup
    logger.info("🛑 Shutting down Nerve System...")
    
    if tts_cache._http_client:
        await tts_cache._http_client.aclose()
    if exotel_client._client:
        await exotel_client._client.aclose()
    if jupiter_reporter._client:
        await jupiter_reporter._client.aclose()
    if jupiter_ai:
        await jupiter_ai.close()


app = FastAPI(
    title="Mangwale Voice Nerve System",
    description="Ultra-fast Exotel IVR orchestration for vendor/rider voice calls",
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

# ==============================================================================
# HEALTH ENDPOINTS
# ==============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "nerve-system",
        "active_calls": len(active_calls),
        "tts_cache_size": len(tts_cache.cache) if tts_cache else 0,
        "components": {
            "tts_cache": tts_cache is not None,
            "exotel_client": exotel_client is not None,
            "jupiter_reporter": jupiter_reporter is not None
        }
    }

@app.get("/api/nerve/audio/{audio_id}")
async def serve_audio(audio_id: str):
    """Serve cached audio file to Exotel"""
    if audio_id not in audio_storage:
        logger.warning(f"Audio not found: {audio_id}")
        return Response(content="Audio not found", status_code=404)
    
    audio_data = audio_storage[audio_id]
    logger.info(f"🔊 Serving audio: {audio_id} ({len(audio_data)} bytes)")
    
    return Response(
        content=audio_data,
        media_type="audio/wav",
        headers={
            "Content-Disposition": f'inline; filename="{audio_id}.wav"',
            "Cache-Control": "public, max-age=3600"
        }
    )

@app.get("/info")
async def service_info():
    """Get service information"""
    return {
        "service": "Mangwale Voice Nerve System",
        "version": "1.0.0",
        "features": [
            "vendor_order_confirmation",
            "prep_time_collection",
            "rejection_flow",
            "rider_assignment"
        ],
        "downstream": {
            "tts_url": TTS_URL,
            "asr_url": ASR_URL,
            "jupiter_url": JUPITER_URL
        },
        "exotel": {
            "sid": EXOTEL_SID,
            "caller_id": EXOTEL_CALLER_ID
        }
    }

# ==============================================================================
# CALL INITIATION ENDPOINTS (Jupiter → Nerve)
# ==============================================================================

@app.post("/api/nerve/vendor-order-confirmation")
async def initiate_vendor_call(request: VendorCallRequest, background_tasks: BackgroundTasks):
    """
    Initiate vendor order confirmation call.
    Called by Jupiter when a new order needs vendor confirmation.
    """
    logger.info(f"📞 Vendor call request: Order #{request.order_id} -> {request.vendor_name}")
    
    # Build custom field for Exotel (include full context for ExoML)
    custom_field = {
        "call_type": CallType.VENDOR_ORDER_CONFIRMATION.value,
        "order_id": request.order_id,
        "vendor_id": request.vendor_id,
        "vendor_name": request.vendor_name,
        "order_amount": request.order_amount,
        "order_items": [item.model_dump() for item in request.order_items],
        "language": request.language,
    }

    # Pre-generate critical TTS audio to ensure instant callback responses
    try:
        temp_state = CallState(
            call_sid="pre",
            call_type=CallType.VENDOR_ORDER_CONFIRMATION,
            order_id=request.order_id,
            vendor_id=request.vendor_id,
            vendor_name=request.vendor_name,
            order_items=request.order_items,
            order_amount=request.order_amount,
            language=request.language,
        )
        greeting_text = generate_vendor_greeting_script(temp_state)
        accepted_text = generate_accepted_script(temp_state)
        # Generate and upload audio (MinIO public URL)
        greeting_audio_url = await generate_and_store_audio(greeting_text, request.language)
        accepted_audio_url = await generate_and_store_audio(accepted_text, request.language)
        if greeting_audio_url:
            custom_field["greeting_audio_url"] = greeting_audio_url
        if accepted_audio_url:
            custom_field["accepted_audio_url"] = accepted_audio_url
        logger.info("🔊 Pre-generated audio URLs for greeting and prep-time prompts")
    except Exception as e:
        logger.warning(f"Pre-generation failed, will synthesize on callback: {e}")
    
    # Initiate call
    result = await exotel_client.initiate_call(
        to_phone=request.vendor_phone,
        custom_field=custom_field
    )
    
    if result["success"]:
        call_sid = result["call_sid"]
        
        # Create call state
        call_state = CallState(
            call_sid=call_sid,
            call_type=CallType.VENDOR_ORDER_CONFIRMATION,
            order_id=request.order_id,
            vendor_id=request.vendor_id,
            vendor_name=request.vendor_name,
            order_items=request.order_items,
            order_amount=request.order_amount,
            language=request.language,
            status=CallStatus.INITIATED
        )
        active_calls[call_sid] = call_state
        
        # Pre-generate TTS for this call (async)
        background_tasks.add_task(pregenerate_call_tts, call_state)
        
        return {
            "success": True,
            "call_sid": call_sid,
            "message": "Vendor confirmation call initiated",
            "status": "initiated"
        }
    else:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": result.get("error", "Failed to initiate call")}
        )

@app.post("/api/nerve/rider-assignment")
async def initiate_rider_call(request: RiderCallRequest, background_tasks: BackgroundTasks):
    """
    Initiate rider assignment call.
    Called by Jupiter when a rider needs to be assigned.
    """
    logger.info(f"🏍️ Rider call request: Order #{request.order_id} -> {request.rider_name}")
    
    custom_field = {
        "call_type": CallType.RIDER_ASSIGNMENT.value,
        "order_id": request.order_id,
        "rider_id": request.rider_id,
        "language": request.language,
    }
    
    result = await exotel_client.initiate_call(
        to_phone=request.rider_phone,
        custom_field=custom_field
    )
    
    if result["success"]:
        call_sid = result["call_sid"]
        
        call_state = CallState(
            call_sid=call_sid,
            call_type=CallType.RIDER_ASSIGNMENT,
            order_id=request.order_id,
            rider_id=request.rider_id,
            vendor_name=request.restaurant_name,  # Reuse for restaurant name
            language=request.language,
            status=CallStatus.INITIATED
        )
        active_calls[call_sid] = call_state
        
        return {
            "success": True,
            "call_sid": call_sid,
            "message": "Rider assignment call initiated",
            "status": "initiated"
        }
    else:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": result.get("error")}
        )

async def pregenerate_call_tts(call_state: CallState):
    """Pre-generate TTS audio for the call"""
    try:
        # Generate greeting script
        greeting = generate_vendor_greeting_script(call_state)
        call_state.tts_cache["greeting"] = await tts_cache.synthesize(greeting, call_state.language)
        
        # Generate accepted script
        accepted = generate_accepted_script(call_state)
        call_state.tts_cache["accepted"] = await tts_cache.synthesize(accepted, call_state.language)
        
        # Generate rejection prompt
        rejection = generate_rejection_prompt(call_state)
        call_state.tts_cache["rejection_prompt"] = await tts_cache.synthesize(rejection, call_state.language)
        
        logger.info(f"Pre-generated TTS for call {call_state.call_sid}")
        
    except Exception as e:
        logger.error(f"Failed to pre-generate TTS: {e}")

# ==============================================================================
# EXOTEL CALLBACK ENDPOINTS (Exotel → Nerve)
# ==============================================================================

# Audio storage for serving to Exotel
audio_storage: Dict[str, bytes] = {}

def store_audio(audio_data: bytes) -> str:
    """Store audio and return unique ID"""
    audio_id = hashlib.md5(audio_data).hexdigest()[:16]
    audio_storage[audio_id] = audio_data
    return audio_id

async def generate_and_store_audio(text: str, language: str = "hi", use_minio: bool = True) -> str:
    """Generate TTS audio, store it, and return public URL
    
    Args:
        text: Text to synthesize
        language: Language code (hi, en)
        use_minio: If True, upload to MinIO (public via storage.mangwale.ai)
                   If False, use in-memory storage served via our API endpoint
    """
    try:
        audio_data = await tts_cache.synthesize(text, language)
        
        if use_minio:
            # Upload to MinIO - returns public URL via storage.mangwale.ai
            storage = get_minio_storage()
            if storage:
                audio_hash = hashlib.md5(audio_data).hexdigest()[:16]
                filename = f"ivr/{language}/{audio_hash}.wav"
                audio_url = storage.upload_audio(audio_data, filename)
                if audio_url:
                    logger.info(f"🎵 MinIO audio URL: {audio_url}")
                    
                    # Also save for training
                    storage.upload_training_data(audio_data, text, language)
                    
                    return audio_url
        
        # Fallback to in-memory storage served via our API
        audio_id = store_audio(audio_data)
        audio_url = f"{EXOTEL_CALLBACK_URL}/api/nerve/audio/{audio_id}"
        logger.info(f"🎵 In-memory audio URL: {audio_url}")
        return audio_url
        
    except Exception as e:
        logger.error(f"Failed to generate audio: {e}")
        return None

def build_exoml_response(text: str, gather_action: str = None, timeout: int = 10, finish_on_key: str = "#", num_digits: int = None, audio_url: str = None) -> str:
    """Build ExoML response with audio URL (Play) or TTS (Say)"""
    
    # TEMPORARY: Skip audio_url due to storage.mangwale.ai 502 error
    # Force use of Exotel's <Say> TTS
    use_audio = False  # Change to True when storage is fixed
    
    if audio_url and use_audio:
        # Use Play with our own audio
        if gather_action:
            gather_attrs = f'action="{gather_action}" timeout="{timeout}" finishOnKey="{finish_on_key}"'
            if num_digits:
                gather_attrs += f' numDigits="{num_digits}"'
            
            exoml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather {gather_attrs}>
        <Play>{audio_url}</Play>
    </Gather>
    <Say voice="Aditi">No input received. Please call again.</Say>
</Response>'''
        else:
            exoml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>{audio_url}</Play>
</Response>'''
    else:
        # Fallback to Exotel's TTS (for English)
        voice = "Aditi"
        if gather_action:
            gather_attrs = f'action="{gather_action}" timeout="{timeout}" finishOnKey="{finish_on_key}"'
            if num_digits:
                gather_attrs += f' numDigits="{num_digits}"'
            
            exoml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather {gather_attrs}>
        <Say voice="{voice}">{text}</Say>
    </Gather>
    <Say voice="{voice}">No input received. Please call again.</Say>
</Response>'''
        else:
            exoml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="{voice}">{text}</Say>
</Response>'''
    
    return exoml


# ==============================================================================
# PROGRAMMABLE GATHER ENDPOINT - For Exotel's Programmable Gather Applet
# ==============================================================================

@app.api_route("/api/nerve/gather", methods=["GET", "HEAD", "POST"])
async def programmable_gather_handler(
    CallSid: str = Query(None),
    CallFrom: str = Query(None),
    CallTo: str = Query(None),
    digits: str = Query(None),
    Direction: str = Query(None),
    CustomField: str = Query(None),
    flow_id: str = Query(None),
    CurrentTime: str = Query(None)
):
    """
    Programmable Gather endpoint for Exotel's Programmable Gather Applet.
    
    This returns JSON that tells Exotel what to say (TTS) and what to gather.
    Exotel will convert our text to speech using their built-in TTS.
    
    Flow:
    1. First call (no digits) → Return greeting with DTMF options
    2. DTMF received → Process and return next prompt
    """
    logger.info(f"📥 Programmable Gather: CallSid={CallSid}, digits={digits}, CustomField={CustomField}")
    
    # Parse custom field
    call_context = {}
    if CustomField:
        try:
            call_context = json.loads(CustomField)
        except Exception as e:
            logger.warning(f"Failed to parse CustomField: {e}")
    
    # Get or create call state
    call_state = active_calls.get(CallSid)
    
    if not call_state:
        # Create from custom field
        call_type_str = call_context.get("call_type", "vendor_order_confirmation")
        try:
            call_type = CallType(call_type_str)
        except:
            call_type = CallType.VENDOR_ORDER_CONFIRMATION
        
        # Parse order items safely
        order_items = []
        for item in call_context.get("order_items", []):
            try:
                order_items.append(OrderItem(**item))
            except Exception as e:
                logger.warning(f"Failed to parse order item: {e}")
        
        call_state = CallState(
            call_sid=CallSid or f"temp_{datetime.now().timestamp()}",
            call_type=call_type,
            order_id=call_context.get("order_id", 0),
            vendor_id=call_context.get("vendor_id"),
            vendor_name=call_context.get("vendor_name", ""),
            rider_id=call_context.get("rider_id"),
            language=call_context.get("language", "hi"),
            order_amount=call_context.get("order_amount", 0),
            order_items=order_items
        )
        call_state.current_state = "greeting"
        call_state.status = CallStatus.ANSWERED
        call_state.answered_at = datetime.now()
        
        if CallSid:
            active_calls[CallSid] = call_state
        
        logger.info(f"📋 Created call_state for Programmable Gather: {CallSid}")
    
    # Process DTMF if provided
    dtmf = digits.replace('"', '').strip() if digits else None
    
    if dtmf:
        logger.info(f"📱 DTMF received: {dtmf} | State: {call_state.current_state}")
        
        if call_state.current_state == "greeting":
            if dtmf == "1":
                # Accepted - ask for prep time
                call_state.status = CallStatus.ACCEPTED
                call_state.current_state = "prep_time"
                logger.info(f"✅ Order {call_state.order_id} ACCEPTED via Programmable Gather")
                
                # Generate prep time prompt
                lang = call_state.language
                phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
                
                prompt_text = f"{phrases['thank_you']}! {phrases['prep_time_prompt']}: 15 {phrases['minutes_in']} - 1, 30 {phrases['minutes_in']} - 2, 45 {phrases['minutes_in']} - 3 {phrases['press']}।"
                
                return JSONResponse({
                    "gather_prompt": {"text": prompt_text},
                    "max_input_digits": 1,
                    "finish_on_key": "",
                    "input_timeout": 15,
                    "repeat_menu": 2,
                    "repeat_gather_prompt": {"text": f"{phrases['no_input']}। {prompt_text}"}
                })
                
            elif dtmf == "0":
                # Rejected
                call_state.status = CallStatus.REJECTED
                call_state.current_state = "completed"
                logger.info(f"❌ Order {call_state.order_id} REJECTED via Programmable Gather")
                
                lang = call_state.language
                phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
                goodbye_text = f"{phrases['rejection_ack']}। {phrases['thank_you']}! {phrases['good_day']}।"
                
                # Report result
                await report_call_result(call_state, CurrentTime)
                
                # Return final message (no gather - call will end)
                return JSONResponse({
                    "gather_prompt": {"text": goodbye_text},
                    "max_input_digits": 0,  # No gather
                    "input_timeout": 1
                })
        
        elif call_state.current_state == "prep_time":
            # Map digit to prep time
            prep_time_map = {"1": 15, "2": 30, "3": 45}
            prep_time = prep_time_map.get(dtmf, 30)
            
            call_state.prep_time_minutes = prep_time
            call_state.status = CallStatus.PREP_TIME_SET
            call_state.current_state = "completed"
            logger.info(f"⏱️ Prep time set to {prep_time} minutes for Order {call_state.order_id}")
            
            # Report result
            await report_call_result(call_state, CurrentTime)
            
            # Generate goodbye
            lang = call_state.language
            phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
            goodbye_text = f"{phrases['thank_you']}! {phrases['rider_arrive']} {prep_time} {phrases['minutes_in']}। {phrases['good_day']}!"
            
            return JSONResponse({
                "gather_prompt": {"text": goodbye_text},
                "max_input_digits": 0,
                "input_timeout": 1
            })
    
    # No DTMF - return initial greeting
    logger.info(f"📞 Programmable Gather - Initial greeting for {CallSid}")
    
    greeting_text = generate_vendor_greeting_script(call_state)
    
    # Prefer pre-generated audio URL from CustomField (our ChatterBox TTS)
    # Exotel's TTS doesn't handle Hindi well
    audio_url = call_context.get("greeting_audio_url")
    
    if audio_url:
        logger.info(f"🎵 Using pre-generated audio: {audio_url}")
        return JSONResponse({
            "gather_prompt": {"audio_url": audio_url},
            "max_input_digits": 1,
            "finish_on_key": "#",
            "input_timeout": 15,
            "repeat_menu": 2,
            "repeat_gather_prompt": {"audio_url": audio_url}
        })
    else:
        # Fallback to Exotel's TTS
        logger.info(f"📝 Using Exotel TTS (no audio_url)")
        return JSONResponse({
            "gather_prompt": {"text": greeting_text},
            "max_input_digits": 1,
            "finish_on_key": "#",
            "input_timeout": 15,
            "repeat_menu": 2,
            "repeat_gather_prompt": {"text": f"कोई इनपुट नहीं मिला। {greeting_text}"}
        })


@app.api_route("/api/nerve/callback", methods=["GET", "HEAD"])
async def exotel_passthru_callback(
    CallSid: str = Query(None),
    CallFrom: str = Query(None),
    CallTo: str = Query(None),
    digits: str = Query(None),
    Digits: str = Query(None),  # Exotel may send as Digits
    CustomField: str = Query(None),
    ExotelCallStatus: str = Query(None, alias="CallStatus"),  # Renamed to avoid shadowing enum
    CurrentTime: str = Query(None)
):
    """
    Exotel callback endpoint (GET request).
    
    Returns ExoML to control IVR flow:
    1. Initial call → Play greeting, gather accept/reject
    2. Accept (1) → Play confirmation, gather prep time
    3. Prep time → Play goodbye, hang up
    4. Reject (0) → Play rejection reason prompt, gather reason, hang up
    """
    # Handle both 'digits' and 'Digits' params
    dtmf = digits or Digits
    
    logger.info(f"📥 Exotel callback: CallSid={CallSid}, digits={dtmf}, CustomField={CustomField[:80] if CustomField else 'None'}...")
    
    # Validate CallSid
    if not CallSid or CallSid == "None":
        logger.error(f"❌ Invalid CallSid: {CallSid}")
        return Response(
            content=build_exoml_response("System error: Invalid call identifier. Please try again."),
            media_type="application/xml"
        )
    
    # Parse custom field
    call_context = {}
    if CustomField:
        try:
            call_context = json.loads(CustomField)
        except Exception as e:
            logger.warning(f"Failed to parse CustomField: {e}")
    
    # Get or create call state
    call_state = active_calls.get(CallSid)
    logger.info(f"📋 Looking up CallSid={CallSid}, found call_state={call_state is not None}")
    
    if not call_state:
        # Create from custom field
        call_type_str = call_context.get("call_type", "vendor_order_confirmation")
        try:
            call_type = CallType(call_type_str)
        except:
            call_type = CallType.VENDOR_ORDER_CONFIRMATION
        
        # Parse order items safely
        order_items = []
        for item in call_context.get("order_items", []):
            try:
                order_items.append(OrderItem(**item))
            except Exception as e:
                logger.warning(f"Failed to parse order item: {e}")
        
        try:
            call_state = CallState(
                call_sid=CallSid,
                call_type=call_type,
                order_id=call_context.get("order_id", 0),
                vendor_id=call_context.get("vendor_id"),
                vendor_name=call_context.get("vendor_name", ""),
                rider_id=call_context.get("rider_id"),
                language=call_context.get("language", "hi"),
                order_amount=call_context.get("order_amount", 0),
                order_items=order_items
            )
            # Set initial state
            call_state.current_state = "greeting"
            call_state.status = CallStatus.ANSWERED
            call_state.answered_at = datetime.now()
            active_calls[CallSid] = call_state
            logger.info(f"📋 Created new call_state for {CallSid} with current_state=greeting")
        except Exception as e:
            logger.error(f"Failed to create CallState: {e}")
            # Return a simple error response
            return Response(
                content=build_exoml_response("Sorry, there was an error processing your call. Please try again."),
                media_type="application/xml"
            )
        
        # First callback - play greeting
        logger.info(f"📞 New call: {CallSid} - Playing greeting")
        
        # Generate greeting script
        greeting = generate_vendor_greeting_script(call_state)
        callback_url = f"{EXOTEL_CALLBACK_URL}/api/nerve/callback?CallSid={CallSid}"
        
        # Prefer pre-generated audio URL from CustomField for instant response
        audio_url = call_context.get("greeting_audio_url")
        if not audio_url:
            audio_url = await generate_and_store_audio(greeting, call_state.language)
        
        return Response(
            content=build_exoml_response(greeting, gather_action=callback_url, timeout=15, num_digits=1, audio_url=audio_url),
            media_type="application/xml"
        )
    
    # At this point call_state MUST exist (from active_calls)
    if call_state is None:
        logger.error(f"❌ CRITICAL: call_state is None for {CallSid}")
        return Response(
            content=build_exoml_response("Sorry, system error. Please try again later."),
            media_type="application/xml"
        )
    
    # Process DTMF if provided
    if dtmf:
        clean_digits = dtmf.replace('"', '').strip()
        logger.info(f"📱 DTMF: {clean_digits} | State: {call_state.current_state}")
        
        callback_url = f"{EXOTEL_CALLBACK_URL}/api/nerve/callback?CallSid={CallSid}"
        
        # Handle IVR App passthru - when state is "ivr_menu", digits=1 means start our flow
        if call_state.current_state == "ivr_menu":
            if clean_digits == "1":
                # User pressed 1 in IVR menu - now play our Hindi greeting
                call_state.current_state = "greeting"
                call_state.status = CallStatus.ANSWERED
                call_state.answered_at = datetime.now()
                logger.info(f"📞 IVR passthru -> Playing Hindi greeting for {CallSid}")
                
                greeting = generate_vendor_greeting_script(call_state)
                audio_url = call_context.get("greeting_audio_url") or await generate_and_store_audio(greeting, call_state.language)
                return Response(
                    content=build_exoml_response(greeting, gather_action=callback_url, timeout=15, num_digits=1, audio_url=audio_url),
                    media_type="application/xml"
                )
            else:
                # User pressed something else (0?) - repeat IVR or play our greeting
                logger.info(f"📞 IVR other key {clean_digits} -> Playing greeting anyway")
                call_state.current_state = "greeting"
                greeting = generate_vendor_greeting_script(call_state)
                audio_url = call_context.get("greeting_audio_url") or await generate_and_store_audio(greeting, call_state.language)
                return Response(
                    content=build_exoml_response(greeting, gather_action=callback_url, timeout=15, num_digits=1, audio_url=audio_url),
                    media_type="application/xml"
                )
        
        if call_state.current_state == "greeting":
            if clean_digits == "1":
                # Accepted - ask for prep time
                call_state.status = CallStatus.ACCEPTED
                call_state.current_state = "prep_time"
                logger.info(f"✅ Order {call_state.order_id} ACCEPTED")
                
                prep_prompt = generate_accepted_script(call_state)
                audio_url = call_context.get("accepted_audio_url") or await generate_and_store_audio(prep_prompt, call_state.language)
                exoml = build_exoml_response(prep_prompt, gather_action=callback_url, timeout=15, finish_on_key="#", audio_url=audio_url)
                logger.info(f"📤 Returning ExoML for prep_time: {exoml[:200]}...")
                return Response(
                    content=exoml,
                    media_type="application/xml"
                )
                
            elif clean_digits == "0":
                # Rejected - play quick goodbye
                call_state.status = CallStatus.REJECTED
                call_state.current_state = "completed"
                logger.info(f"❌ Order {call_state.order_id} REJECTED")
                
                lang = call_state.language
                phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
                goodbye = f"{phrases['rejection_ack']}। {phrases['thank_you']}!"
                
                # Report result and say goodbye
                await report_call_result(call_state, CurrentTime)
                audio_url = await generate_and_store_audio(goodbye, call_state.language)
                
                return Response(
                    content=build_exoml_response(goodbye, audio_url=audio_url),
                    media_type="application/xml"
                )
        
        elif call_state.current_state == "prep_time":
            # Parse prep time
            prep_time = 30  # Default
            if clean_digits == "1":
                prep_time = 15
            elif clean_digits == "2":
                prep_time = 30
            elif clean_digits == "3":
                prep_time = 45
            else:
                try:
                    prep_time = int(clean_digits.replace("#", ""))
                    prep_time = max(5, min(90, prep_time))
                except:
                    pass
            
            call_state.prep_time_minutes = prep_time
            call_state.status = CallStatus.PREP_TIME_SET
            call_state.current_state = "goodbye"
            logger.info(f"⏱️ Prep time: {prep_time} mins for order {call_state.order_id}")
            
            # Report to Jupiter
            await report_call_result(call_state, CurrentTime)
            
            goodbye = generate_prep_time_goodbye(call_state, prep_time)
            audio_url = await generate_and_store_audio(goodbye, call_state.language)
            return Response(
                content=build_exoml_response(goodbye, audio_url=audio_url),  # No gather - just say and hang up
                media_type="application/xml"
            )
        
        elif call_state.current_state == "rejection_reason":
            reason_map = {
                "1": RejectionReason.ITEM_UNAVAILABLE,
                "2": RejectionReason.TOO_BUSY,
                "3": RejectionReason.SHOP_CLOSED,
                "4": RejectionReason.OTHER
            }
            call_state.rejection_reason = reason_map.get(clean_digits, RejectionReason.OTHER)
            call_state.current_state = "goodbye"
            logger.info(f"📋 Rejection reason: {call_state.rejection_reason}")
            
            # Report to Jupiter
            await report_call_result(call_state, CurrentTime)
            
            lang = call_state.language
            phrases = HINDI_PHRASES if lang == "hi" else ENGLISH_PHRASES
            goodbye = f"{phrases['rejection_ack']}। {phrases['thank_you']}!"
            audio_url = await generate_and_store_audio(goodbye, call_state.language)
            return Response(
                content=build_exoml_response(goodbye, audio_url=audio_url),
                media_type="application/xml"
            )
    
    # No DTMF and existing call - replay greeting
    logger.info(f"📞 Replay greeting for {CallSid}")
    greeting = generate_vendor_greeting_script(call_state)
    callback_url = f"{EXOTEL_CALLBACK_URL}/api/nerve/callback?CallSid={CallSid}"
    # Prefer pre-generated audio URL from CustomField if present
    audio_url = call_context.get("greeting_audio_url") or await generate_and_store_audio(greeting, call_state.language)
    return Response(
        content=build_exoml_response(greeting, gather_action=callback_url, timeout=15, num_digits=1, audio_url=audio_url),
        media_type="application/xml"
    )


# ==============================================================================
# AI-POWERED CALLBACK ENDPOINT (Phase 0)
# ==============================================================================

@app.api_route("/api/nerve/ai-callback", methods=["GET", "HEAD"])
async def ai_powered_callback(
    CallSid: str = Query(None),
    CallFrom: str = Query(None),
    CallTo: str = Query(None),
    digits: str = Query(None),
    Digits: str = Query(None),
    CustomField: str = Query(None),
    ExotelCallStatus: str = Query(None, alias="CallStatus"),
):
    """
    AI-Powered Exotel callback endpoint.
    Routes DTMF input through Jupiter AI for intelligent responses.
    
    Use this endpoint instead of /api/nerve/callback for AI-powered calls.
    """
    dtmf = digits or Digits
    
    logger.info(f"🤖 AI Callback: CallSid={CallSid}, digits={dtmf}")
    
    if not CallSid:
        return Response(
            content=build_exoml_response("System error. Please try again."),
            media_type="application/xml"
        )
    
    # Parse context
    call_context = {}
    if CustomField:
        try:
            call_context = json.loads(CustomField)
        except:
            pass
    
    vendor_phone = call_context.get("vendor_phone") or CallFrom or "unknown"
    
    # Convert DTMF to text for AI
    if dtmf:
        user_input = digits_to_text(dtmf.replace('"', '').strip())
    else:
        user_input = "start call"
    
    # Call Jupiter AI
    ai_response = await jupiter_ai.process_message(
        phone=vendor_phone,
        message=user_input,
        session_id=CallSid,
        context=call_context
    )
    
    # Build response
    callback_url = f"{EXOTEL_CALLBACK_URL}/api/nerve/ai-callback?CallSid={CallSid}"
    
    if ai_response:
        response_text = ai_response.get("text", "")
        language = ai_response.get("language", "hi-IN")
        should_continue = ai_response.get("continue", True)
        
        # Generate TTS audio
        audio_url = await generate_and_store_audio(response_text, language.split("-")[0])
        
        if should_continue:
            return Response(
                content=build_exoml_response(
                    response_text, 
                    gather_action=callback_url, 
                    timeout=15, 
                    num_digits=1, 
                    audio_url=audio_url
                ),
                media_type="application/xml"
            )
        else:
            return Response(
                content=build_exoml_response(response_text, audio_url=audio_url),
                media_type="application/xml"
            )
    else:
        # Fallback to static response
        fallback = "कृपया एक दबाएं ऑर्डर स्वीकार करने के लिए, शून्य दबाएं रद्द करने के लिए।"
        audio_url = await generate_and_store_audio(fallback, "hi")
        return Response(
            content=build_exoml_response(fallback, gather_action=callback_url, timeout=15, num_digits=1, audio_url=audio_url),
            media_type="application/xml"
        )


async def report_call_result(call_state: CallState, current_time: str = None):
    """Report call result to Jupiter"""
    call_result = CallResult(
        call_sid=call_state.call_sid,
        call_type=call_state.call_type,
        status=call_state.status,
        order_id=call_state.order_id,
        vendor_id=call_state.vendor_id,
        rider_id=call_state.rider_id,
        prep_time_minutes=call_state.prep_time_minutes,
        rejection_reason=call_state.rejection_reason,
        answered_at=current_time or datetime.now().isoformat()
    )
    await jupiter_reporter.report_result(call_result)


@app.post("/api/nerve/status")
async def exotel_status_callback(request: Request):
    """
    Exotel status callback endpoint (POST).
    Receives call completion events.
    """
    body = await request.form()
    body_dict = dict(body)
    
    logger.info(f"📊 Status callback: {body_dict}")
    
    call_sid = body_dict.get("CallSid") or body_dict.get("call_sid") or body_dict.get("Sid")
    status = body_dict.get("CallStatus") or body_dict.get("Status") or body_dict.get("status")
    duration = body_dict.get("Duration") or body_dict.get("duration")
    recording_url = body_dict.get("RecordingUrl") or body_dict.get("recording_url")
    
    # Map Exotel status
    status_map = {
        "completed": CallStatus.COMPLETED,
        "no-answer": CallStatus.NO_RESPONSE,
        "busy": CallStatus.BUSY,
        "failed": CallStatus.FAILED,
        "canceled": CallStatus.FAILED,
    }
    
    mapped_status = status_map.get(status.lower() if status else "", CallStatus.COMPLETED)
    
    # Get call state
    call_state = active_calls.get(call_sid)
    
    # Report to Jupiter
    call_result = CallResult(
        call_sid=call_sid,
        call_type=call_state.call_type if call_state else CallType.VENDOR_ORDER_CONFIRMATION,
        status=mapped_status,
        order_id=call_state.order_id if call_state else None,
        vendor_id=call_state.vendor_id if call_state else None,
        rider_id=call_state.rider_id if call_state else None,
        duration=int(duration) if duration else None,
        recording_url=recording_url,
        ended_at=datetime.now().isoformat()
    )
    await jupiter_reporter.report_result(call_result)
    
    # Cleanup
    if call_sid in active_calls:
        del active_calls[call_sid]
        logger.info(f"Cleaned up call state for {call_sid}")
    
    return {"received": True}


@app.api_route("/api/nerve/outcome", methods=["GET", "POST"])
async def ivr_outcome_callback(request: Request):
    """
    IVR Outcome callback - called by Exotel Passthru at end of static IVR flow.
    Used to capture what option the user selected in the IVR.
    
    URL format: /api/nerve/outcome?action=confirmed_15&CallSid=xxx
    
    Actions:
    - confirmed_15, confirmed_30, confirmed_45: Order confirmed with prep time
    - check_app: Vendor wants to check app (retry in 2 min)
    - cancelled: Order cancelled
    - accepted: Driver accepted delivery
    - rejected: Driver rejected delivery
    - no_input: No input received (timeout)
    """
    # Get params from query string or form data
    if request.method == "GET":
        params = dict(request.query_params)
    else:
        form = await request.form()
        params = dict(form)
        params.update(dict(request.query_params))
    
    call_sid = params.get("CallSid") or params.get("call_sid") or params.get("Sid")
    action = params.get("action", "unknown")
    custom_field = params.get("CustomField", "{}")
    
    logger.info(f"📊 IVR Outcome: CallSid={call_sid}, action={action}")
    
    # Parse custom field
    try:
        if isinstance(custom_field, str):
            call_context = json.loads(custom_field) if custom_field else {}
        else:
            call_context = custom_field or {}
    except json.JSONDecodeError:
        call_context = {}
    
    # Get or create call state
    call_state = active_calls.get(call_sid)
    if not call_state:
        # Create from context
        call_state = CallState(
            call_sid=call_sid,
            call_type=CallType(call_context.get("call_type", "vendor_order_confirmation")),
            order_id=call_context.get("order_id", 0),
            vendor_id=call_context.get("vendor_id"),
            vendor_name=call_context.get("vendor_name", ""),
            rider_id=call_context.get("rider_id"),
            language=call_context.get("language", "hi"),
        )
    
    # Map action to status and prep time
    if action.startswith("confirmed_"):
        call_state.status = CallStatus.ACCEPTED
        try:
            prep_time = int(action.split("_")[1])
            call_state.prep_time_minutes = prep_time
        except:
            call_state.prep_time_minutes = 30
        logger.info(f"✅ Order {call_state.order_id} CONFIRMED - prep time: {call_state.prep_time_minutes} min")
        
    elif action == "check_app":
        call_state.status = CallStatus.RETRY_REQUESTED
        logger.info(f"📱 Order {call_state.order_id} - vendor wants to check app, retry in 2 min")
        # TODO: Schedule retry call in 2 minutes
        
    elif action == "cancelled":
        call_state.status = CallStatus.REJECTED
        call_state.rejection_reason = "vendor_cancelled"
        logger.info(f"❌ Order {call_state.order_id} CANCELLED by vendor")
        
    elif action == "accepted":
        call_state.status = CallStatus.ACCEPTED
        logger.info(f"✅ Delivery ACCEPTED by rider for order {call_state.order_id}")
        
    elif action == "rejected":
        call_state.status = CallStatus.REJECTED
        call_state.rejection_reason = "driver_rejected"
        logger.info(f"❌ Delivery REJECTED by rider for order {call_state.order_id}")
        
    elif action == "no_input":
        call_state.status = CallStatus.NO_RESPONSE
        logger.info(f"⏰ No input received for order {call_state.order_id}")
        
    else:
        call_state.status = CallStatus.COMPLETED
        logger.info(f"❓ Unknown action '{action}' for order {call_state.order_id}")
    
    # Report to Jupiter
    call_result = CallResult(
        call_sid=call_sid,
        call_type=call_state.call_type,
        status=call_state.status,
        order_id=call_state.order_id,
        vendor_id=call_state.vendor_id,
        rider_id=call_state.rider_id,
        prep_time_minutes=call_state.prep_time_minutes,
        rejection_reason=call_state.rejection_reason,
        ended_at=datetime.now().isoformat()
    )
    await jupiter_reporter.report_result(call_result)
    
    # Return simple acknowledgment (Passthru expects quick response)
    return {"received": True, "action": action, "status": call_state.status.value}


# ==============================================================================
# MANAGEMENT ENDPOINTS
# ==============================================================================

@app.get("/api/nerve/active-calls")
async def get_active_calls():
    """List all active calls"""
    return {
        "count": len(active_calls),
        "calls": [
            {
                "call_sid": cs.call_sid,
                "call_type": cs.call_type.value,
                "order_id": cs.order_id,
                "status": cs.status.value,
                "current_state": cs.current_state,
                "duration": (datetime.now() - cs.started_at).total_seconds()
            }
            for cs in active_calls.values()
        ]
    }

@app.get("/api/nerve/tts-cache")
async def get_tts_cache_stats():
    """Get TTS cache statistics"""
    return {
        "size": len(tts_cache.cache) if tts_cache else 0,
        "keys": list(tts_cache.cache.keys())[:20] if tts_cache else []
    }

@app.post("/api/nerve/preload-tts")
async def preload_tts(language: str = "hi"):
    """Manually trigger TTS preloading"""
    if tts_cache:
        await tts_cache.preload_common_phrases(language)
        return {"status": "preloaded", "cache_size": len(tts_cache.cache)}
    return {"status": "tts_cache_not_initialized"}

# ==============================================================================
# MAIN ENTRY POINT
# ==============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "nerve_system:app",
        host="0.0.0.0",
        port=7100,
        reload=os.getenv("DEBUG_MODE", "false").lower() == "true",
        log_level="debug" if os.getenv("DEBUG_MODE", "false").lower() == "true" else "info"
    )
