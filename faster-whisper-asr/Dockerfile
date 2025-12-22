FROM nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev \
    ffmpeg curl git \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies  
# Use ctranslate2 4.3.1 which is the last version compatible with cuDNN 8
RUN pip3 install --no-cache-dir \
    ctranslate2==4.3.1 \
    faster-whisper==1.0.3 \
    fastapi==0.115.0 \
    uvicorn[standard]==0.32.0 \
    python-multipart==0.0.9 \
    numpy>=1.24 \
    soundfile>=0.12 \
    pydantic>=2.0 \
    requests>=2.31 \
    pydub>=0.25.1

# Copy application
COPY main.py .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
