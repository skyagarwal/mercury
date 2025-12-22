FROM nvidia/cuda:12.1-cudnn8-runtime-ubuntu22.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev \
    ffmpeg curl git libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip3 install --no-cache-dir \
    torch>=2.0 \
    torchaudio>=2.0 \
    transformers>=4.40 \
    accelerate>=0.25 \
    fastapi>=0.115 \
    uvicorn[standard]>=0.30 \
    python-multipart>=0.0.9 \
    soundfile>=0.12 \
    scipy>=1.10 \
    numpy>=1.24

# Install parler-tts
RUN pip3 install --no-cache-dir git+https://github.com/huggingface/parler-tts.git

# Copy application
COPY main.py .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD curl -f http://localhost:5501/health || exit 1

EXPOSE 5501

# Pre-download model on build (optional, uncomment to bake into image)
# RUN python3 -c "from parler_tts import ParlerTTSForConditionalGeneration; ParlerTTSForConditionalGeneration.from_pretrained('ai4bharat/indic-parler-tts')"

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5501"]
