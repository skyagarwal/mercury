# Mangwale Orchestrator Enhanced
# Conversation Flow Controller with Jupiter LLM Integration

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
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
ENV LOG_LEVEL=INFO
ENV ASR_SERVICE_URL=http://asr:7001
ENV TTS_SERVICE_URL=http://tts:7002
ENV GATEWAY_URL=http://voice-gateway:8080
ENV JUPITER_URL=http://192.168.0.156:3200
ENV JUPITER_LLM_URL=http://192.168.0.156:8002
ENV LLM_PROVIDER=jupiter
ENV LLM_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ
ENV CONTEXT_WINDOW_SIZE=10
ENV ENABLE_FUNCTION_CALLING=true

# Expose port
EXPOSE 7000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:7000/health || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7000"]
