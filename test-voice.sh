#!/bin/bash
# Mangwale Voice System - Quick Test Script

GATEWAY_URL="${GATEWAY_URL:-http://localhost:7101}"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          MANGWALE VOICE SYSTEM - TEST SUITE                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test 1: Health Check
echo "1️⃣  Health Check..."
HEALTH=$(curl -s "$GATEWAY_URL/health")
if echo "$HEALTH" | grep -q "healthy"; then
    echo -e "   ${GREEN}✅ Gateway is healthy${NC}"
else
    echo -e "   ${RED}❌ Gateway health check failed${NC}"
    exit 1
fi

# Test 2: Provider Health
echo ""
echo "2️⃣  Provider Status:"
curl -s "$GATEWAY_URL/api/providers/health" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for service, providers in data.items():
    print(f'   {service.upper()}:')
    for provider, available in providers.items():
        status = '✅' if available else '❌'
        print(f'      {status} {provider}')
"

# Test 3: TTS Tests
echo ""
echo "3️⃣  TTS Latency Tests:"

# ElevenLabs
echo -n "   ElevenLabs: "
TIME=$(curl -s -w "%{time_total}" -X POST "$GATEWAY_URL/api/speak" \
    -H "Content-Type: application/json" \
    -d '{"text": "Hello", "provider": "elevenlabs"}' -o /dev/null)
echo -e "${GREEN}${TIME}s${NC}"

# Local
echo -n "   Local XTTS: "
TIME=$(curl -s -w "%{time_total}" -X POST "$GATEWAY_URL/api/speak" \
    -H "Content-Type: application/json" \
    -d '{"text": "Hello", "provider": "local"}' -o /dev/null)
echo -e "${GREEN}${TIME}s${NC}"

# Deepgram TTS
echo -n "   Deepgram:   "
TIME=$(curl -s -w "%{time_total}" -X POST "$GATEWAY_URL/api/speak" \
    -H "Content-Type: application/json" \
    -d '{"text": "Hello", "provider": "deepgram"}' -o /dev/null)
echo -e "${GREEN}${TIME}s${NC}"

# Test 4: Generate Hindi Audio
echo ""
echo "4️⃣  Hindi TTS Generation:"
curl -s -X POST "$GATEWAY_URL/api/speak" \
    -H "Content-Type: application/json" \
    -d '{"text": "नमस्ते, मैं मंगवाले हूं। आप कैसे हैं?", "language": "hi", "provider": "elevenlabs"}' \
    -o /tmp/mangwale_hindi.mp3

if [ -f /tmp/mangwale_hindi.mp3 ]; then
    SIZE=$(ls -lh /tmp/mangwale_hindi.mp3 | awk '{print $5}')
    echo -e "   ${GREEN}✅ Generated: /tmp/mangwale_hindi.mp3 ($SIZE)${NC}"
else
    echo -e "   ${RED}❌ Failed to generate audio${NC}"
fi

# Summary
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                      TEST COMPLETE                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "🎧 Play test audio: ffplay /tmp/mangwale_hindi.mp3"
echo "📊 Monitor GPU:     watch nvidia-smi"
echo "📝 View logs:       docker logs -f mangwale_voice_gateway"
