"""
Voice Gateway - WebSocket Bridge for Real-time Voice

This gateway connects:
- Browser/App (WebSocket) → Audio Stream
- ASR (Whisper) → Text Transcription  
- Voice Agent (Jupiter Connected) → Enhanced Response
- TTS (XTTS/Orpheus) → Audio Response

Flow:
1. Client sends audio chunks via WebSocket
2. Gateway streams to ASR for transcription
3. Transcription sent to Voice Agent (which calls Jupiter)
4. Response sent to TTS for synthesis
5. Audio streamed back to client
"""

import asyncio
import json
import logging
import time
import base64
import wave
import io
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum

import aiohttp
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import uvicorn

# Configuration
ASR_URL = "http://localhost:7000"  # Whisper ASR
VOICE_AGENT_URL = "http://localhost:8090"  # Jupiter Voice Agent
TTS_URL = "http://localhost:8010"  # XTTS (or 8020 for Orpheus)

SAMPLE_RATE = 16000
TTS_SAMPLE_RATE = 24000

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-gateway")


class SessionState(Enum):
    IDLE = "idle"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"


@dataclass
class VoiceSession:
    session_id: str
    state: SessionState = SessionState.IDLE
    audio_buffer: bytes = b""
    last_activity: float = 0
    is_vad_speech: bool = False
    silence_start: float = 0


app = FastAPI(title="Mangwale Voice Gateway", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active sessions
sessions: Dict[str, VoiceSession] = {}


@app.get("/")
async def root():
    return {"service": "Voice Gateway", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "healthy", "asr": ASR_URL, "voice_agent": VOICE_AGENT_URL, "tts": TTS_URL}


async def transcribe_audio(audio_data: bytes) -> Optional[str]:
    """Send audio to Whisper ASR and get transcription"""
    try:
        # Create WAV file in memory
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio_data)
        wav_buffer.seek(0)
        
        # Send to Whisper
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            form = aiohttp.FormData()
            form.add_field('file', wav_buffer.read(), 
                          filename='audio.wav', 
                          content_type='audio/wav')
            form.add_field('language', 'auto')
            
            async with session.post(f"{ASR_URL}/v1/audio/transcriptions", data=form) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    text = result.get("text", "").strip()
                    logger.info(f"📝 ASR: '{text}'")
                    return text
                else:
                    logger.error(f"ASR error: {resp.status}")
                    return None
    except Exception as e:
        logger.error(f"ASR exception: {e}")
        return None


async def process_with_voice_agent(session_id: str, text: str) -> Dict[str, Any]:
    """Send text to Voice Agent (Jupiter connected) and get response"""
    try:
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            payload = {
                "session_id": session_id,
                "text": text,
                "language": "auto"
            }
            
            async with session.post(
                f"{VOICE_AGENT_URL}/api/voice/process-with-audio",
                json=payload
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    logger.info(f"🤖 Agent: '{result.get('text', '')[:50]}...'")
                    return result
                else:
                    logger.error(f"Voice Agent error: {resp.status}")
                    return {"text": "Sorry, kuch problem hai.", "enhanced_text": "Sorry, kuch problem hai."}
    except Exception as e:
        logger.error(f"Voice Agent exception: {e}")
        return {"text": "Connection problem hai.", "enhanced_text": "Connection problem hai."}


async def synthesize_speech(text: str, language: str = "hi") -> Optional[bytes]:
    """Send text to TTS and get audio"""
    try:
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            # XTTS API
            params = {
                "text": text,
                "language": language,
                "speaker_wav": "female"
            }
            
            async with session.get(f"{TTS_URL}/tts", params=params) as resp:
                if resp.status == 200:
                    audio = await resp.read()
                    logger.info(f"🔊 TTS: {len(audio)} bytes")
                    return audio
                else:
                    logger.error(f"TTS error: {resp.status}")
                    return None
    except Exception as e:
        logger.error(f"TTS exception: {e}")
        return None


@app.websocket("/ws/voice/{session_id}")
async def voice_websocket(websocket: WebSocket, session_id: str):
    """
    Main WebSocket endpoint for real-time voice.
    
    Client messages:
    - {"type": "audio", "data": "<base64 audio>"}
    - {"type": "end_turn"} - User finished speaking
    - {"type": "interrupt"} - User wants to interrupt
    - {"type": "ping"}
    
    Server messages:
    - {"type": "transcript", "text": "...", "is_final": bool}
    - {"type": "response", "text": "...", "audio": "<base64>"}
    - {"type": "speaking_start"} / {"type": "speaking_end"}
    - {"type": "pong"}
    """
    await websocket.accept()
    logger.info(f"🔌 Connected: {session_id}")
    
    session = VoiceSession(session_id=session_id, last_activity=time.time())
    sessions[session_id] = session
    
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            session.last_activity = time.time()
            
            if msg_type == "audio":
                # Receive audio chunk
                audio_b64 = data.get("data", "")
                if audio_b64:
                    audio_chunk = base64.b64decode(audio_b64)
                    session.audio_buffer += audio_chunk
                    session.state = SessionState.LISTENING
            
            elif msg_type == "end_turn":
                # User finished speaking, process the audio
                if len(session.audio_buffer) > 1000:  # Minimum audio
                    session.state = SessionState.PROCESSING
                    
                    # 1. Transcribe
                    transcript = await transcribe_audio(session.audio_buffer)
                    session.audio_buffer = b""
                    
                    if transcript:
                        # Send transcript to client
                        await websocket.send_json({
                            "type": "transcript",
                            "text": transcript,
                            "is_final": True
                        })
                        
                        # 2. Process with Voice Agent (connects to Jupiter)
                        await websocket.send_json({"type": "processing"})
                        response = await process_with_voice_agent(session_id, transcript)
                        
                        # 3. Send response
                        session.state = SessionState.SPEAKING
                        await websocket.send_json({"type": "speaking_start"})
                        
                        response_msg = {
                            "type": "response",
                            "text": response.get("text", ""),
                            "enhanced_text": response.get("enhanced_text", ""),
                            "emotion": response.get("emotion", "neutral"),
                        }
                        
                        # Include audio if available
                        audio_b64 = response.get("audio_base64")
                        if audio_b64:
                            response_msg["audio"] = audio_b64
                        
                        await websocket.send_json(response_msg)
                        await websocket.send_json({"type": "speaking_end"})
                        
                        session.state = SessionState.IDLE
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Could not transcribe audio"
                        })
                else:
                    session.audio_buffer = b""
            
            elif msg_type == "text":
                # Direct text input (skip ASR)
                text = data.get("text", "").strip()
                if text:
                    session.state = SessionState.PROCESSING
                    
                    await websocket.send_json({"type": "processing"})
                    response = await process_with_voice_agent(session_id, text)
                    
                    session.state = SessionState.SPEAKING
                    await websocket.send_json({"type": "speaking_start"})
                    
                    response_msg = {
                        "type": "response",
                        "text": response.get("text", ""),
                        "enhanced_text": response.get("enhanced_text", ""),
                        "emotion": response.get("emotion", "neutral"),
                    }
                    
                    audio_b64 = response.get("audio_base64")
                    if audio_b64:
                        response_msg["audio"] = audio_b64
                    
                    await websocket.send_json(response_msg)
                    await websocket.send_json({"type": "speaking_end"})
                    
                    session.state = SessionState.IDLE
            
            elif msg_type == "interrupt":
                # User interrupted
                session.state = SessionState.IDLE
                session.audio_buffer = b""
                await websocket.send_json({
                    "type": "interrupted",
                    "acknowledgment": "Haan, boliye?"
                })
            
            elif msg_type == "reset":
                # Reset session
                session.audio_buffer = b""
                session.state = SessionState.IDLE
                await websocket.send_json({"type": "reset", "success": True})
            
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        logger.info(f"🔌 Disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if session_id in sessions:
            del sessions[session_id]


# Simple HTML test client
TEST_CLIENT_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Voice Gateway Test</title>
    <style>
        body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
        button { padding: 15px 30px; font-size: 18px; margin: 10px; cursor: pointer; }
        #status { padding: 10px; margin: 10px 0; background: #eee; border-radius: 5px; }
        #transcript, #response { padding: 15px; margin: 10px 0; border: 1px solid #ccc; border-radius: 5px; min-height: 50px; }
        .recording { background: #ffcccc !important; }
        .speaking { background: #ccffcc !important; }
    </style>
</head>
<body>
    <h1>🎤 Mangwale Voice Gateway Test</h1>
    
    <div id="status">Status: Disconnected</div>
    
    <button id="connectBtn" onclick="connect()">Connect</button>
    <button id="recordBtn" onclick="toggleRecording()" disabled>🎤 Hold to Talk</button>
    <button id="stopBtn" onclick="stopRecording()" disabled>⏹ Stop</button>
    
    <h3>Your message:</h3>
    <div id="transcript">-</div>
    
    <h3>AI Response:</h3>
    <div id="response">-</div>
    
    <h3>Text Input (alternative):</h3>
    <input type="text" id="textInput" style="width: 70%; padding: 10px;">
    <button onclick="sendText()">Send</button>
    
    <script>
        let ws = null;
        let mediaRecorder = null;
        let audioChunks = [];
        let isRecording = false;
        
        const sessionId = 'test-' + Date.now();
        
        function connect() {
            const wsUrl = `ws://${location.host}/ws/voice/${sessionId}`;
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                document.getElementById('status').textContent = 'Status: Connected ✅';
                document.getElementById('recordBtn').disabled = false;
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('Received:', data);
                
                if (data.type === 'transcript') {
                    document.getElementById('transcript').textContent = data.text;
                } else if (data.type === 'response') {
                    document.getElementById('response').textContent = data.text;
                    document.getElementById('response').classList.add('speaking');
                    
                    // Play audio if available
                    if (data.audio) {
                        const audio = new Audio('data:audio/wav;base64,' + data.audio);
                        audio.play();
                    }
                } else if (data.type === 'speaking_end') {
                    document.getElementById('response').classList.remove('speaking');
                } else if (data.type === 'processing') {
                    document.getElementById('status').textContent = 'Status: Processing... 🤔';
                }
            };
            
            ws.onclose = () => {
                document.getElementById('status').textContent = 'Status: Disconnected ❌';
                document.getElementById('recordBtn').disabled = true;
            };
        }
        
        async function toggleRecording() {
            if (!isRecording) {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                
                mediaRecorder.ondataavailable = (e) => {
                    audioChunks.push(e.data);
                };
                
                mediaRecorder.onstop = async () => {
                    const blob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.onload = () => {
                        const base64 = reader.result.split(',')[1];
                        ws.send(JSON.stringify({ type: 'audio', data: base64 }));
                        ws.send(JSON.stringify({ type: 'end_turn' }));
                    };
                    reader.readAsDataURL(blob);
                    
                    document.getElementById('recordBtn').classList.remove('recording');
                };
                
                mediaRecorder.start(100);
                isRecording = true;
                document.getElementById('recordBtn').textContent = '🔴 Recording...';
                document.getElementById('recordBtn').classList.add('recording');
                document.getElementById('stopBtn').disabled = false;
            }
        }
        
        function stopRecording() {
            if (mediaRecorder && isRecording) {
                mediaRecorder.stop();
                isRecording = false;
                document.getElementById('recordBtn').textContent = '🎤 Hold to Talk';
                document.getElementById('stopBtn').disabled = true;
            }
        }
        
        function sendText() {
            const text = document.getElementById('textInput').value.trim();
            if (text && ws) {
                ws.send(JSON.stringify({ type: 'text', text: text }));
                document.getElementById('transcript').textContent = text;
                document.getElementById('textInput').value = '';
            }
        }
        
        document.getElementById('textInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendText();
        });
    </script>
</body>
</html>
"""


@app.get("/test", response_class=HTMLResponse)
async def test_client():
    """Simple test client"""
    return TEST_CLIENT_HTML


if __name__ == "__main__":
    uvicorn.run("gateway:app", host="0.0.0.0", port=8080, reload=True)
