FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.11 as default
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

WORKDIR /app

# Install PyTorch with CUDA support
RUN pip3 install --no-cache-dir \
    torch==2.1.0 \
    torchaudio==2.1.0 \
    --index-url https://download.pytorch.org/whl/cu121

# Install ChatterBox TTS
RUN pip3 install --no-cache-dir \
    chatterbox-tts \
    fastapi \
    uvicorn \
    python-multipart \
    soundfile \
    scipy

# Copy application code
COPY main.py /app/
COPY voices/ /app/voices/

# Expose port
EXPOSE 7003

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:7003/health || exit 1

# Run the service
CMD ["python3", "main.py"]
