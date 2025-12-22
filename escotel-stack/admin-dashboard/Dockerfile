# Mangwale Admin Dashboard
# Real-time monitoring & control

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV ASR_SERVICE_URL=http://asr:7001
ENV TTS_SERVICE_URL=http://tts:7002
ENV ORCHESTRATOR_URL=http://orchestrator:7000
ENV GATEWAY_URL=http://voice-gateway:8080
ENV PROMETHEUS_URL=http://prometheus:9090
ENV ENABLE_GPU_MONITORING=true

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
