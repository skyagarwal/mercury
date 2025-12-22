"""
Exotel Recording Webhook Integration for Mangwale Voice Training Pipeline
===========================================================================

This module handles Exotel call recording webhooks and integrates them into
the training pipeline:
1. Download recording from Exotel
2. Upload to MinIO (permanent storage)
3. Transcribe with Faster-Whisper
4. Quality check
5. Create Label Studio annotation task
6. Save metadata to database

Author: Mangwale AI Team
Date: December 19, 2025
"""

import os
import io
import json
import hashlib
import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict, Any

import httpx
from fastapi import FastAPI, Request, BackgroundTasks, HTTPException
from pydantic import BaseModel
import numpy as np

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("exotel_webhook")

# ============================================================================
# CONFIGURATION
# ============================================================================

EXOTEL_API_KEY = os.getenv("EXOTEL_API_KEY", "")
EXOTEL_API_TOKEN = os.getenv("EXOTEL_API_TOKEN", "")
EXOTEL_SID = os.getenv("EXOTEL_SID", "")

# MinIO
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "192.168.0.156:9002")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minio_strong_password")
MINIO_BUCKET_RECORDINGS = os.getenv("MINIO_BUCKET_RECORDINGS", "call-recordings")

# Services
ASR_URL = os.getenv("ASR_URL", "http://192.168.0.151:7001")
LABEL_STUDIO_URL = os.getenv("LABEL_STUDIO_URL", "http://192.168.0.156:8080")
LABEL_STUDIO_API_KEY = os.getenv("LABEL_STUDIO_API_KEY", "")

# Database (Jupiter)
DB_HOST = os.getenv("DB_HOST", "192.168.0.156")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "headless_mangwale")
DB_USER = os.getenv("DB_USER", "headless")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

# Quality thresholds
MIN_AUDIO_QUALITY = float(os.getenv("MIN_AUDIO_QUALITY", "0.6"))
MIN_DURATION = int(os.getenv("MIN_RECORDING_DURATION", "5"))  # seconds
MAX_DURATION = int(os.getenv("MAX_RECORDING_DURATION", "600"))  # 10 minutes

# ============================================================================
# MODELS
# ============================================================================

class ExotelRecordingWebhook(BaseModel):
    """Exotel recording webhook payload"""
    CallSid: str
    RecordingUrl: str
    RecordingDuration: str
    CallFrom: str
    CallTo: str
    Status: str
    RecordingSid: Optional[str] = None
    StartTime: Optional[str] = None
    EndTime: Optional[str] = None

class RecordingMetadata(BaseModel):
    """Call recording metadata"""
    call_sid: str
    recording_url: str
    minio_url: str
    duration: int
    from_number: str
    to_number: str
    transcript: Optional[str] = None
    language: Optional[str] = None
    confidence: Optional[float] = None
    quality_score: Optional[float] = None
    label_studio_task_id: Optional[int] = None
    created_at: datetime

# ============================================================================
# UTILITIES
# ============================================================================

def calculate_audio_quality(audio_data: bytes) -> float:
    """
    Calculate audio quality score (0-1)
    Metrics: SNR, sample rate, clipping, silence ratio
    """
    try:
        # Convert to numpy array (assuming WAV)
        import soundfile as sf
        audio_array, sample_rate = sf.read(io.BytesIO(audio_data))
        
        # Normalize
        if audio_array.max() > 0:
            audio_array = audio_array / audio_array.max()
        
        # Calculate SNR (simple energy-based estimate)
        signal_power = np.mean(audio_array ** 2)
        
        # Check for clipping
        clipping_ratio = np.sum(np.abs(audio_array) > 0.95) / len(audio_array)
        
        # Check silence ratio
        silence_threshold = 0.01
        silence_ratio = np.sum(np.abs(audio_array) < silence_threshold) / len(audio_array)
        
        # Combined score
        quality = 1.0
        quality *= (1.0 - clipping_ratio * 0.5)  # Penalize clipping
        quality *= (1.0 - silence_ratio * 0.3)   # Penalize excessive silence
        quality *= min(1.0, signal_power * 10)   # Reward good signal
        
        return max(0.0, min(1.0, quality))
    
    except Exception as e:
        logger.warning(f"Quality calculation failed: {e}")
        return 0.5  # Default mid-quality

async def download_exotel_recording(recording_url: str) -> bytes:
    """Download recording from Exotel"""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                recording_url,
                auth=(EXOTEL_API_KEY, EXOTEL_API_TOKEN)
            )
            response.raise_for_status()
            return response.content
    except Exception as e:
        logger.error(f"Failed to download recording: {e}")
        raise

async def upload_to_minio(audio_data: bytes, call_sid: str) -> str:
    """Upload recording to MinIO"""
    try:
        from minio import Minio
        
        client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=False
        )
        
        # Create bucket if not exists
        if not client.bucket_exists(MINIO_BUCKET_RECORDINGS):
            client.make_bucket(MINIO_BUCKET_RECORDINGS)
        
        # Organize by date
        date_path = datetime.now().strftime('%Y/%m/%d')
        filename = f"recordings/{date_path}/{call_sid}.wav"
        
        # Upload
        client.put_object(
            MINIO_BUCKET_RECORDINGS,
            filename,
            io.BytesIO(audio_data),
            length=len(audio_data),
            content_type="audio/wav"
        )
        
        # Return public URL
        url = f"http://{MINIO_ENDPOINT}/{MINIO_BUCKET_RECORDINGS}/{filename}"
        return url
    
    except Exception as e:
        logger.error(f"MinIO upload failed: {e}")
        raise

async def transcribe_audio(audio_data: bytes) -> Dict[str, Any]:
    """Transcribe audio with Faster-Whisper"""
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            files = {"file": ("audio.wav", audio_data, "audio/wav")}
            response = await client.post(
                f"{ASR_URL}/transcribe",
                files=files
            )
            response.raise_for_status()
            result = response.json()
            
            return {
                "text": result.get("text", ""),
                "language": result.get("language", "en"),
                "confidence": result.get("confidence", 0.0)
            }
    
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        return {
            "text": "",
            "language": "unknown",
            "confidence": 0.0
        }

async def create_label_studio_task(
    call_sid: str,
    audio_url: str,
    transcript: str,
    language: str,
    metadata: Dict[str, Any]
) -> Optional[int]:
    """Create annotation task in Label Studio"""
    try:
        if not LABEL_STUDIO_API_KEY:
            logger.warning("Label Studio API key not configured")
            return None
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Get project ID (ASR Annotation project)
            # You'll need to create this project first and set PROJECT_ID
            project_id = os.getenv("LABEL_STUDIO_ASR_PROJECT_ID", "1")
            
            # Create task
            task_data = {
                "data": {
                    "audio": audio_url,
                    "text": transcript,
                    "language": language,
                    "call_sid": call_sid,
                    "duration": metadata.get("duration", 0),
                    "quality_score": metadata.get("quality_score", 0.0)
                }
            }
            
            response = await client.post(
                f"{LABEL_STUDIO_URL}/api/projects/{project_id}/tasks",
                headers={
                    "Authorization": f"Token {LABEL_STUDIO_API_KEY}",
                    "Content-Type": "application/json"
                },
                json=task_data
            )
            response.raise_for_status()
            result = response.json()
            
            task_id = result.get("id")
            logger.info(f"✅ Created Label Studio task #{task_id} for call {call_sid}")
            return task_id
    
    except Exception as e:
        logger.error(f"Label Studio task creation failed: {e}")
        return None

async def save_to_database(metadata: RecordingMetadata):
    """Save recording metadata to PostgreSQL"""
    try:
        import asyncpg
        
        conn = await asyncpg.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        
        # Create table if not exists
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS call_recordings (
                id SERIAL PRIMARY KEY,
                call_sid VARCHAR(255) UNIQUE NOT NULL,
                recording_url TEXT,
                minio_url TEXT,
                duration INTEGER,
                from_number VARCHAR(50),
                to_number VARCHAR(50),
                transcript TEXT,
                language VARCHAR(10),
                confidence FLOAT,
                quality_score FLOAT,
                label_studio_task_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                processed_at TIMESTAMP
            )
        """)
        
        # Insert or update
        await conn.execute("""
            INSERT INTO call_recordings 
            (call_sid, recording_url, minio_url, duration, from_number, to_number,
             transcript, language, confidence, quality_score, label_studio_task_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (call_sid) DO UPDATE SET
                minio_url = EXCLUDED.minio_url,
                transcript = EXCLUDED.transcript,
                language = EXCLUDED.language,
                confidence = EXCLUDED.confidence,
                quality_score = EXCLUDED.quality_score,
                label_studio_task_id = EXCLUDED.label_studio_task_id,
                processed_at = NOW()
        """, 
            metadata.call_sid,
            metadata.recording_url,
            metadata.minio_url,
            metadata.duration,
            metadata.from_number,
            metadata.to_number,
            metadata.transcript,
            metadata.language,
            metadata.confidence,
            metadata.quality_score,
            metadata.label_studio_task_id,
            metadata.created_at
        )
        
        await conn.close()
        logger.info(f"✅ Saved metadata to database for call {metadata.call_sid}")
    
    except Exception as e:
        logger.error(f"Database save failed: {e}")

# ============================================================================
# PROCESSING PIPELINE
# ============================================================================

async def process_recording(webhook_data: ExotelRecordingWebhook):
    """
    Main processing pipeline:
    1. Download from Exotel
    2. Upload to MinIO
    3. Transcribe
    4. Quality check
    5. Create Label Studio task
    6. Save to database
    """
    call_sid = webhook_data.CallSid
    logger.info(f"📞 Processing recording for call {call_sid}")
    
    try:
        # 1. Download from Exotel
        logger.info(f"⬇️  Downloading from Exotel...")
        audio_data = await download_exotel_recording(webhook_data.RecordingUrl)
        logger.info(f"✅ Downloaded {len(audio_data)} bytes")
        
        # 2. Upload to MinIO
        logger.info(f"⬆️  Uploading to MinIO...")
        minio_url = await upload_to_minio(audio_data, call_sid)
        logger.info(f"✅ Uploaded to {minio_url}")
        
        # 3. Calculate quality
        logger.info(f"📊 Calculating audio quality...")
        quality_score = calculate_audio_quality(audio_data)
        logger.info(f"✅ Quality score: {quality_score:.2f}")
        
        # 4. Transcribe
        logger.info(f"🎤 Transcribing...")
        transcript_result = await transcribe_audio(audio_data)
        logger.info(f"✅ Transcribed: '{transcript_result['text'][:100]}...'")
        
        # 5. Create Label Studio task (if quality is sufficient)
        label_studio_task_id = None
        duration = int(webhook_data.RecordingDuration)
        
        if (quality_score >= MIN_AUDIO_QUALITY and 
            MIN_DURATION <= duration <= MAX_DURATION and
            transcript_result['confidence'] < 0.95):  # Only annotate if uncertain
            
            logger.info(f"📝 Creating Label Studio annotation task...")
            label_studio_task_id = await create_label_studio_task(
                call_sid=call_sid,
                audio_url=minio_url,
                transcript=transcript_result['text'],
                language=transcript_result['language'],
                metadata={
                    "duration": duration,
                    "quality_score": quality_score,
                    "from": webhook_data.CallFrom,
                    "to": webhook_data.CallTo
                }
            )
        else:
            logger.info(f"⏭️  Skipping annotation (quality={quality_score:.2f}, confidence={transcript_result['confidence']:.2f})")
        
        # 6. Save metadata
        metadata = RecordingMetadata(
            call_sid=call_sid,
            recording_url=webhook_data.RecordingUrl,
            minio_url=minio_url,
            duration=duration,
            from_number=webhook_data.CallFrom,
            to_number=webhook_data.CallTo,
            transcript=transcript_result['text'],
            language=transcript_result['language'],
            confidence=transcript_result['confidence'],
            quality_score=quality_score,
            label_studio_task_id=label_studio_task_id,
            created_at=datetime.now()
        )
        
        await save_to_database(metadata)
        
        logger.info(f"✅ Processing complete for call {call_sid}")
        
    except Exception as e:
        logger.error(f"❌ Processing failed for call {call_sid}: {e}")
        raise

# ============================================================================
# FASTAPI ENDPOINTS
# ============================================================================

app = FastAPI(title="Exotel Recording Webhook Handler")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "exotel-webhook",
        "timestamp": datetime.now().isoformat()
    }

@app.post("/webhook/exotel/recording")
async def exotel_recording_webhook(
    request: Request,
    background_tasks: BackgroundTasks
):
    """
    Exotel calls this webhook when call recording is ready
    
    Example payload:
    {
        "CallSid": "abc123def456",
        "RecordingUrl": "https://s3.exotel.com/...",
        "RecordingDuration": "45",
        "CallFrom": "+919876543210",
        "CallTo": "+912048556923",
        "Status": "completed"
    }
    """
    try:
        # Parse webhook data
        body = await request.body()
        data = await request.form()  # Exotel sends form data
        
        webhook_data = ExotelRecordingWebhook(
            CallSid=data.get('CallSid', ''),
            RecordingUrl=data.get('RecordingUrl', ''),
            RecordingDuration=data.get('RecordingDuration', '0'),
            CallFrom=data.get('CallFrom', ''),
            CallTo=data.get('CallTo', ''),
            Status=data.get('Status', ''),
            RecordingSid=data.get('RecordingSid'),
            StartTime=data.get('StartTime'),
            EndTime=data.get('EndTime')
        )
        
        logger.info(f"📥 Webhook received for call {webhook_data.CallSid}")
        
        # Process in background
        background_tasks.add_task(process_recording, webhook_data)
        
        return {
            "status": "accepted",
            "call_sid": webhook_data.CallSid,
            "message": "Recording queued for processing"
        }
    
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/recordings/{call_sid}")
async def get_recording_status(call_sid: str):
    """Get processing status for a call recording"""
    try:
        import asyncpg
        
        conn = await asyncpg.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        
        row = await conn.fetchrow(
            "SELECT * FROM call_recordings WHERE call_sid = $1",
            call_sid
        )
        
        await conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail="Recording not found")
        
        return dict(row)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Database error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("WEBHOOK_PORT", "3150"))
    uvicorn.run(
        "exotel_webhook_handler:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )
