#!/bin/bash
cd /home/ubuntu/mangwale-voice/escotel-stack/exotel-service

# Load environment from .env file
set -a
source /home/ubuntu/mangwale-voice/escotel-stack/.env
set +a

# Additional env vars
export ASR_URL=http://localhost:7001
export TTS_URL=http://localhost:7002
export JUPITER_URL=http://192.168.0.156:3200
export DEBUG_MODE=true

# Start nerve system
exec .venv/bin/python nerve_system.py
