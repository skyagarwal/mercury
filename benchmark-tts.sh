#!/bin/bash
# Benchmark TTS Providers and Configure Optimal Settings
# Run this to find the fastest TTS option for your network

set -e
cd /home/ubuntu/mangwale-voice
source .env

echo "=============================================="
echo "  TTS Provider Benchmark for Mangwale Voice"
echo "=============================================="
echo ""

TEST_TEXT="Hello, this is a test of the text to speech system."

# Function to benchmark TTS
benchmark_tts() {
    local name=$1
    local cmd=$2
    local output=/tmp/tts_bench_$name.audio
    
    START=$(date +%s.%3N)
    eval "$cmd" -o $output 2>/dev/null
    END=$(date +%s.%3N)
    
    if [ -f "$output" ] && [ $(stat -c%s "$output") -gt 1000 ]; then
        echo "$name: $(echo "$END - $START" | bc)s ✅"
        rm -f $output
        return 0
    else
        echo "$name: FAILED ❌"
        rm -f $output
        return 1
    fi
}

echo "1. Testing Local Orpheus TTS (Mercury)..."
ORPHEUS_TIME=$(
    START=$(date +%s.%3N)
    curl -s --max-time 30 -X POST "http://localhost:8010/synthesize" \
        -H "Content-Type: application/json" \
        -d '{"text":"'$TEST_TEXT'", "language":"en", "emotion":"neutral"}' \
        -o /tmp/orpheus_bench.wav 2>/dev/null
    END=$(date +%s.%3N)
    echo "$END - $START" | bc
)
if [ -f /tmp/orpheus_bench.wav ] && [ $(stat -c%s /tmp/orpheus_bench.wav 2>/dev/null || echo 0) -gt 1000 ]; then
    echo "   Orpheus: ${ORPHEUS_TIME}s ✅"
    ORPHEUS_OK=1
else
    echo "   Orpheus: FAILED ❌"
    ORPHEUS_OK=0
fi
rm -f /tmp/orpheus_bench.wav

echo ""
echo "2. Testing ElevenLabs TTS (Cloud)..."
if [ -n "$ELEVENLABS_API_KEY" ]; then
    ELEVEN_TIME=$(
        START=$(date +%s.%3N)
        curl -s --max-time 30 --request POST \
            --url "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream" \
            --header "xi-api-key: $ELEVENLABS_API_KEY" \
            --header "Content-Type: application/json" \
            --data '{"text":"'$TEST_TEXT'", "model_id":"eleven_turbo_v2"}' \
            -o /tmp/eleven_bench.mp3 2>/dev/null
        END=$(date +%s.%3N)
        echo "$END - $START" | bc
    )
    if [ -f /tmp/eleven_bench.mp3 ] && [ $(stat -c%s /tmp/eleven_bench.mp3 2>/dev/null || echo 0) -gt 1000 ]; then
        echo "   ElevenLabs: ${ELEVEN_TIME}s ✅"
        ELEVEN_OK=1
    else
        echo "   ElevenLabs: FAILED ❌"
        ELEVEN_OK=0
    fi
    rm -f /tmp/eleven_bench.mp3
else
    echo "   ElevenLabs: No API key ⚠️"
    ELEVEN_OK=0
fi

echo ""
echo "3. Testing Deepgram TTS (Cloud)..."
if [ -n "$DEEPGRAM_API_KEY" ]; then
    DG_TIME=$(
        START=$(date +%s.%3N)
        curl -s --max-time 30 -X POST "https://api.deepgram.com/v1/speak?model=aura-asteria-en" \
            -H "Authorization: Token $DEEPGRAM_API_KEY" \
            -H "Content-Type: application/json" \
            -d '{"text":"'$TEST_TEXT'"}' \
            -o /tmp/dg_bench.wav 2>/dev/null
        END=$(date +%s.%3N)
        echo "$END - $START" | bc
    )
    if [ -f /tmp/dg_bench.wav ] && [ $(stat -c%s /tmp/dg_bench.wav 2>/dev/null || echo 0) -gt 1000 ]; then
        echo "   Deepgram: ${DG_TIME}s ✅"
        DG_OK=1
    else
        echo "   Deepgram: FAILED ❌"
        DG_OK=0
    fi
    rm -f /tmp/dg_bench.wav
else
    echo "   Deepgram: No API key ⚠️"
    DG_OK=0
fi

echo ""
echo "=============================================="
echo "  Results"
echo "=============================================="
echo ""

# Determine fastest
FASTEST="local"
FASTEST_TIME=${ORPHEUS_TIME:-999}

if [ "$ELEVEN_OK" = "1" ]; then
    if (( $(echo "$ELEVEN_TIME < $FASTEST_TIME" | bc -l) )); then
        FASTEST="elevenlabs"
        FASTEST_TIME=$ELEVEN_TIME
    fi
fi

if [ "$DG_OK" = "1" ]; then
    if (( $(echo "$DG_TIME < $FASTEST_TIME" | bc -l) )); then
        FASTEST="deepgram"
        FASTEST_TIME=$DG_TIME
    fi
fi

echo "Fastest Provider: $FASTEST (${FASTEST_TIME}s)"
echo ""

# Recommendation based on results
if (( $(echo "$FASTEST_TIME > 3" | bc -l) )); then
    echo "⚠️  WARNING: All TTS providers are slow (>3s)"
    echo ""
    echo "Recommendations:"
    echo "1. For realtime voice: Consider chunking responses"
    echo "2. For lower latency: Use streaming audio (WebSocket)"
    echo "3. Network issue: Check internet connection to US servers"
    echo ""
else
    echo "✅ TTS latency acceptable"
fi

echo ""
echo "To update provider priority, run:"
echo "  sed -i 's/TTS_PROVIDER_PRIORITY=.*/TTS_PROVIDER_PRIORITY=${FASTEST},local,elevenlabs,deepgram,google,azure/' .env"
echo ""
