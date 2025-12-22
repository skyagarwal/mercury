"""
📊 Mangwale Voice Admin Dashboard
December 2025 - Real-time monitoring & control

Features:
  - Real-time call monitoring
  - Model performance metrics
  - GPU resource tracking
  - Voice quality analytics
  - Session management
  - A/B testing controls
"""

import os
import time
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class AdminConfig:
    # Services
    asr_url: str = os.getenv("ASR_SERVICE_URL", "http://asr:7001")
    tts_url: str = os.getenv("TTS_SERVICE_URL", "http://tts:7002")
    orchestrator_url: str = os.getenv("ORCHESTRATOR_URL", "http://orchestrator:7000")
    gateway_url: str = os.getenv("GATEWAY_URL", "http://voice-gateway:8080")
    
    # Prometheus
    prometheus_url: str = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
    
    # GPU Monitoring
    enable_gpu_monitoring: bool = os.getenv("ENABLE_GPU_MONITORING", "true").lower() == "true"

config = AdminConfig()

# ═══════════════════════════════════════════════════════════════════════════════
# METRICS STORE
# ═══════════════════════════════════════════════════════════════════════════════

class MetricsStore:
    """In-memory metrics storage with rolling window."""
    
    def __init__(self):
        self.call_metrics: List[Dict] = []
        self.latency_metrics: List[Dict] = []
        self.gpu_metrics: List[Dict] = []
        self.model_usage: Dict[str, int] = {}
        self.language_usage: Dict[str, int] = {}
        self.error_counts: Dict[str, int] = {}
        
    def add_call_metric(self, metric: Dict):
        self.call_metrics.append({**metric, "timestamp": datetime.utcnow()})
        # Keep last 1000 metrics
        if len(self.call_metrics) > 1000:
            self.call_metrics = self.call_metrics[-1000:]
            
    def add_latency_metric(self, service: str, latency_ms: float):
        self.latency_metrics.append({
            "service": service,
            "latency_ms": latency_ms,
            "timestamp": datetime.utcnow()
        })
        if len(self.latency_metrics) > 10000:
            self.latency_metrics = self.latency_metrics[-10000:]
            
    def increment_model_usage(self, model: str):
        self.model_usage[model] = self.model_usage.get(model, 0) + 1
        
    def increment_language_usage(self, lang: str):
        self.language_usage[lang] = self.language_usage.get(lang, 0) + 1
        
    def increment_error(self, error_type: str):
        self.error_counts[error_type] = self.error_counts.get(error_type, 0) + 1
        
    def get_stats(self) -> Dict:
        now = datetime.utcnow()
        hour_ago = now - timedelta(hours=1)
        
        recent_calls = [c for c in self.call_metrics if c["timestamp"] > hour_ago]
        recent_latencies = [l for l in self.latency_metrics if l["timestamp"] > hour_ago]
        
        return {
            "total_calls": len(self.call_metrics),
            "calls_last_hour": len(recent_calls),
            "avg_latency_ms": sum(l["latency_ms"] for l in recent_latencies) / max(len(recent_latencies), 1),
            "model_usage": self.model_usage,
            "language_usage": self.language_usage,
            "error_counts": self.error_counts
        }

metrics_store = MetricsStore()

# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class ServiceStatus(BaseModel):
    name: str
    status: str  # "healthy", "unhealthy", "unknown"
    url: str
    latency_ms: Optional[float] = None
    version: Optional[str] = None
    details: Optional[Dict] = None

class ModelConfig(BaseModel):
    model_id: str
    enabled: bool
    priority: int
    languages: List[str]

class SystemHealth(BaseModel):
    overall: str
    services: List[ServiceStatus]
    gpu: Optional[Dict] = None
    timestamp: str

# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE HEALTH CHECKS
# ═══════════════════════════════════════════════════════════════════════════════

async def check_service_health(name: str, url: str) -> ServiceStatus:
    """Check health of a service."""
    try:
        start_time = time.time()
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{url}/health", timeout=5)
            latency_ms = (time.time() - start_time) * 1000
            
            if response.status_code == 200:
                data = response.json()
                return ServiceStatus(
                    name=name,
                    status="healthy",
                    url=url,
                    latency_ms=latency_ms,
                    version=data.get("version"),
                    details=data
                )
            else:
                return ServiceStatus(
                    name=name,
                    status="unhealthy",
                    url=url,
                    latency_ms=latency_ms,
                    details={"error": f"HTTP {response.status_code}"}
                )
    except Exception as e:
        return ServiceStatus(
            name=name,
            status="unhealthy",
            url=url,
            details={"error": str(e)}
        )

async def get_gpu_stats() -> Optional[Dict]:
    """Get GPU statistics using nvidia-smi."""
    try:
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            parts = result.stdout.strip().split(",")
            return {
                "utilization_percent": float(parts[0].strip()),
                "memory_used_mb": float(parts[1].strip()),
                "memory_total_mb": float(parts[2].strip()),
                "memory_used_percent": float(parts[1].strip()) / float(parts[2].strip()) * 100,
                "temperature_c": float(parts[3].strip())
            }
    except Exception as e:
        logger.warning(f"Failed to get GPU stats: {e}")
    
    return None

# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Mangwale Voice Admin Dashboard",
    description="Real-time monitoring & control for GPU Voice Stack",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ───────────────────────────────────────────────────────────────────────────────
# HEALTH ENDPOINTS
# ───────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "admin-dashboard", "version": "2.0.0"}

@app.get("/api/health/system", response_model=SystemHealth)
async def system_health():
    """Get overall system health."""
    services = await asyncio.gather(
        check_service_health("ASR", config.asr_url),
        check_service_health("TTS", config.tts_url),
        check_service_health("Orchestrator", config.orchestrator_url),
        check_service_health("Voice Gateway", config.gateway_url),
    )
    
    # Determine overall health
    healthy_count = sum(1 for s in services if s.status == "healthy")
    
    if healthy_count == len(services):
        overall = "healthy"
    elif healthy_count > 0:
        overall = "degraded"
    else:
        overall = "unhealthy"
    
    # Get GPU stats
    gpu = None
    if config.enable_gpu_monitoring:
        gpu = await get_gpu_stats()
    
    return SystemHealth(
        overall=overall,
        services=list(services),
        gpu=gpu,
        timestamp=datetime.utcnow().isoformat()
    )

# ───────────────────────────────────────────────────────────────────────────────
# METRICS ENDPOINTS
# ───────────────────────────────────────────────────────────────────────────────

@app.get("/api/metrics/overview")
async def metrics_overview():
    """Get metrics overview."""
    stats = metrics_store.get_stats()
    
    # Get service-specific metrics
    try:
        async with httpx.AsyncClient() as client:
            tts_resp = await client.get(f"{config.tts_url}/metrics", timeout=5)
            asr_resp = await client.get(f"{config.asr_url}/metrics", timeout=5)
            
            return {
                **stats,
                "tts_metrics": tts_resp.text if tts_resp.status_code == 200 else None,
                "asr_metrics": asr_resp.text if asr_resp.status_code == 200 else None
            }
    except Exception as e:
        return {**stats, "error": str(e)}

@app.get("/api/metrics/latency")
async def latency_metrics(minutes: int = 60):
    """Get latency metrics for the specified time window."""
    cutoff = datetime.utcnow() - timedelta(minutes=minutes)
    recent = [l for l in metrics_store.latency_metrics if l["timestamp"] > cutoff]
    
    # Group by service
    by_service = {}
    for m in recent:
        svc = m["service"]
        if svc not in by_service:
            by_service[svc] = []
        by_service[svc].append(m["latency_ms"])
    
    # Calculate stats
    result = {}
    for svc, latencies in by_service.items():
        result[svc] = {
            "count": len(latencies),
            "avg_ms": sum(latencies) / len(latencies),
            "min_ms": min(latencies),
            "max_ms": max(latencies),
            "p50_ms": sorted(latencies)[len(latencies) // 2],
            "p95_ms": sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) > 20 else max(latencies)
        }
    
    return result

@app.get("/api/metrics/gpu")
async def gpu_metrics():
    """Get current GPU metrics."""
    gpu = await get_gpu_stats()
    if gpu:
        return gpu
    raise HTTPException(status_code=503, detail="GPU metrics unavailable")

# ───────────────────────────────────────────────────────────────────────────────
# MODEL MANAGEMENT ENDPOINTS
# ───────────────────────────────────────────────────────────────────────────────

@app.get("/api/models/tts")
async def get_tts_models():
    """Get available TTS models."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{config.tts_url}/v1/models", timeout=10)
            if response.status_code == 200:
                return response.json()
    except Exception as e:
        logger.error(f"Failed to get TTS models: {e}")
    
    return {"models": []}

@app.get("/api/models/asr")
async def get_asr_models():
    """Get available ASR models."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{config.asr_url}/v1/models", timeout=10)
            if response.status_code == 200:
                return response.json()
    except Exception as e:
        logger.error(f"Failed to get ASR models: {e}")
    
    return {"models": []}

@app.post("/api/models/tts/switch")
async def switch_tts_model(model_id: str, language: str):
    """Switch TTS model for a language."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{config.tts_url}/v1/models/switch",
                json={"model_id": model_id, "language": language},
                timeout=30
            )
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ───────────────────────────────────────────────────────────────────────────────
# SESSION MANAGEMENT
# ───────────────────────────────────────────────────────────────────────────────

@app.get("/api/sessions")
async def get_active_sessions():
    """Get list of active voice sessions."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{config.gateway_url}/api/sessions", timeout=10)
            if response.status_code == 200:
                return response.json()
    except Exception as e:
        logger.error(f"Failed to get sessions: {e}")
    
    return {"sessions": []}

@app.get("/api/sessions/{session_id}")
async def get_session_details(session_id: str):
    """Get details for a specific session."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{config.gateway_url}/api/sessions/{session_id}", timeout=10)
            if response.status_code == 200:
                return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/sessions/{session_id}")
async def terminate_session(session_id: str):
    """Terminate a voice session."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.delete(f"{config.gateway_url}/api/sessions/{session_id}", timeout=10)
            return {"status": "terminated", "session_id": session_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ───────────────────────────────────────────────────────────────────────────────
# TEST ENDPOINTS
# ───────────────────────────────────────────────────────────────────────────────

@app.post("/api/test/tts")
async def test_tts(text: str, language: str = "hi", model: str = "auto"):
    """Test TTS synthesis."""
    try:
        start_time = time.time()
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{config.tts_url}/v1/audio/speech",
                json={"input": text, "language": language, "model": model},
                timeout=30
            )
            latency_ms = (time.time() - start_time) * 1000
            
            if response.status_code == 200:
                metrics_store.add_latency_metric("tts", latency_ms)
                metrics_store.increment_language_usage(language)
                
                return {
                    "status": "success",
                    "latency_ms": latency_ms,
                    "audio_size_bytes": len(response.content)
                }
            else:
                metrics_store.increment_error("tts_error")
                return {"status": "error", "detail": response.text}
    except Exception as e:
        metrics_store.increment_error("tts_error")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/test/asr")
async def test_asr(audio_url: str, language: str = "hi"):
    """Test ASR transcription."""
    try:
        start_time = time.time()
        async with httpx.AsyncClient() as client:
            # Download audio
            audio_resp = await client.get(audio_url, timeout=30)
            audio_data = audio_resp.content
            
            # Transcribe
            response = await client.post(
                f"{config.asr_url}/v1/audio/transcriptions",
                files={"file": ("audio.wav", audio_data, "audio/wav")},
                data={"language": language},
                timeout=30
            )
            latency_ms = (time.time() - start_time) * 1000
            
            if response.status_code == 200:
                metrics_store.add_latency_metric("asr", latency_ms)
                return {
                    "status": "success",
                    "latency_ms": latency_ms,
                    "transcription": response.json()
                }
            else:
                metrics_store.increment_error("asr_error")
                return {"status": "error", "detail": response.text}
    except Exception as e:
        metrics_store.increment_error("asr_error")
        raise HTTPException(status_code=500, detail=str(e))

# ───────────────────────────────────────────────────────────────────────────────
# WEBSOCKET FOR REAL-TIME UPDATES
# ───────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_live_updates(websocket: WebSocket):
    """WebSocket for real-time metric updates."""
    await websocket.accept()
    
    try:
        while True:
            # Send periodic updates
            gpu = await get_gpu_stats()
            stats = metrics_store.get_stats()
            
            await websocket.send_json({
                "type": "metrics_update",
                "timestamp": datetime.utcnow().isoformat(),
                "gpu": gpu,
                "stats": stats
            })
            
            await asyncio.sleep(2)  # Update every 2 seconds
            
    except Exception as e:
        logger.info(f"WebSocket disconnected: {e}")

# ───────────────────────────────────────────────────────────────────────────────
# ADMIN UI
# ───────────────────────────────────────────────────────────────────────────────

DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mangwale Voice Admin</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        .status-healthy { color: #10b981; }
        .status-degraded { color: #f59e0b; }
        .status-unhealthy { color: #ef4444; }
    </style>
</head>
<body class="bg-gray-900 text-white">
    <div class="container mx-auto px-4 py-8">
        <h1 class="text-3xl font-bold mb-8">🎙️ Mangwale Voice Admin</h1>
        
        <!-- System Health -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div class="bg-gray-800 rounded-lg p-4">
                <h3 class="text-lg font-semibold mb-2">System Status</h3>
                <p id="system-status" class="text-2xl font-bold">Loading...</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-4">
                <h3 class="text-lg font-semibold mb-2">GPU Usage</h3>
                <p id="gpu-usage" class="text-2xl font-bold">--</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-4">
                <h3 class="text-lg font-semibold mb-2">Active Sessions</h3>
                <p id="active-sessions" class="text-2xl font-bold">0</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-4">
                <h3 class="text-lg font-semibold mb-2">Calls/Hour</h3>
                <p id="calls-hour" class="text-2xl font-bold">0</p>
            </div>
        </div>
        
        <!-- Services -->
        <div class="bg-gray-800 rounded-lg p-6 mb-8">
            <h2 class="text-xl font-bold mb-4">Services</h2>
            <div id="services-list" class="grid grid-cols-1 md:grid-cols-2 gap-4">
                Loading...
            </div>
        </div>
        
        <!-- Test Tools -->
        <div class="bg-gray-800 rounded-lg p-6 mb-8">
            <h2 class="text-xl font-bold mb-4">Quick Test</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label class="block mb-2">TTS Test</label>
                    <input type="text" id="tts-input" value="नमस्ते, मैं मंगवाले AI हूँ" 
                           class="w-full bg-gray-700 rounded p-2 mb-2">
                    <button onclick="testTTS()" 
                            class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
                        Test TTS
                    </button>
                    <span id="tts-result" class="ml-2"></span>
                </div>
                <div>
                    <label class="block mb-2">ASR Test (Audio URL)</label>
                    <input type="text" id="asr-input" placeholder="https://..." 
                           class="w-full bg-gray-700 rounded p-2 mb-2">
                    <button onclick="testASR()" 
                            class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded">
                        Test ASR
                    </button>
                    <span id="asr-result" class="ml-2"></span>
                </div>
            </div>
        </div>
        
        <!-- Latency Chart -->
        <div class="bg-gray-800 rounded-lg p-6">
            <h2 class="text-xl font-bold mb-4">Latency (Last Hour)</h2>
            <canvas id="latency-chart" height="100"></canvas>
        </div>
    </div>
    
    <script>
        // WebSocket connection
        const ws = new WebSocket(`ws://${window.location.host}/ws/live`);
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.gpu) {
                document.getElementById('gpu-usage').textContent = 
                    `${data.gpu.memory_used_percent.toFixed(1)}% (${data.gpu.memory_used_mb.toFixed(0)}MB)`;
            }
            if (data.stats) {
                document.getElementById('calls-hour').textContent = data.stats.calls_last_hour;
            }
        };
        
        // Fetch system health
        async function fetchHealth() {
            try {
                const resp = await fetch('/api/health/system');
                const data = await resp.json();
                
                const statusEl = document.getElementById('system-status');
                statusEl.textContent = data.overall.toUpperCase();
                statusEl.className = `text-2xl font-bold status-${data.overall}`;
                
                // Update services list
                let servicesHtml = '';
                for (const svc of data.services) {
                    servicesHtml += `
                        <div class="bg-gray-700 rounded p-3 flex justify-between items-center">
                            <div>
                                <span class="font-semibold">${svc.name}</span>
                                <span class="text-sm text-gray-400 ml-2">${svc.url}</span>
                            </div>
                            <div>
                                <span class="status-${svc.status}">${svc.status}</span>
                                ${svc.latency_ms ? `<span class="text-gray-400 ml-2">${svc.latency_ms.toFixed(0)}ms</span>` : ''}
                            </div>
                        </div>
                    `;
                }
                document.getElementById('services-list').innerHTML = servicesHtml;
                
            } catch (e) {
                console.error('Failed to fetch health:', e);
            }
        }
        
        async function testTTS() {
            const text = document.getElementById('tts-input').value;
            document.getElementById('tts-result').textContent = 'Testing...';
            
            try {
                const resp = await fetch(`/api/test/tts?text=${encodeURIComponent(text)}&language=hi`, {method: 'POST'});
                const data = await resp.json();
                document.getElementById('tts-result').textContent = 
                    data.status === 'success' ? `✓ ${data.latency_ms.toFixed(0)}ms` : `✗ ${data.detail}`;
            } catch (e) {
                document.getElementById('tts-result').textContent = `✗ ${e.message}`;
            }
        }
        
        async function testASR() {
            const url = document.getElementById('asr-input').value;
            document.getElementById('asr-result').textContent = 'Testing...';
            
            try {
                const resp = await fetch(`/api/test/asr?audio_url=${encodeURIComponent(url)}&language=hi`, {method: 'POST'});
                const data = await resp.json();
                document.getElementById('asr-result').textContent = 
                    data.status === 'success' ? `✓ ${data.latency_ms.toFixed(0)}ms` : `✗ ${data.detail}`;
            } catch (e) {
                document.getElementById('asr-result').textContent = `✗ ${e.message}`;
            }
        }
        
        // Initial fetch
        fetchHealth();
        setInterval(fetchHealth, 10000);  // Refresh every 10 seconds
    </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    return DASHBOARD_HTML

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
