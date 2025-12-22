#!/bin/bash
###############################################################################
# Mangwale Next-Gen Voice Agent Stack - Management Script
# Optimized for RTX 3060 12GB
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Banner
print_banner() {
    echo -e "${PURPLE}"
    echo "╔═══════════════════════════════════════════════════════════════════╗"
    echo "║       🎙️  MANGWALE NEXT-GEN VOICE AGENT STACK 🎙️                  ║"
    echo "║                                                                   ║"
    echo "║   Real-time Voice AI with Orpheus TTS + Whisper ASR              ║"
    echo "║   Optimized for RTX 3060 12GB                                    ║"
    echo "╚═══════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Check GPU
check_gpu() {
    echo -e "${CYAN}🔍 Checking GPU...${NC}"
    if command -v nvidia-smi &> /dev/null; then
        nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
        echo ""
    else
        echo -e "${YELLOW}⚠️  nvidia-smi not found. GPU support may not work.${NC}"
    fi
}

# Check Ollama
check_ollama() {
    echo -e "${CYAN}🔍 Checking Ollama...${NC}"
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Ollama is running${NC}"
        echo "Available models:"
        curl -s http://localhost:11434/api/tags | jq -r '.models[].name' 2>/dev/null || echo "  (could not list models)"
    else
        echo -e "${YELLOW}⚠️  Ollama not running. Install with:${NC}"
        echo "    curl -fsSL https://ollama.com/install.sh | sh"
        echo "    ollama serve &"
        echo "    ollama pull llama3.2"
    fi
    echo ""
}

# Build services
build() {
    echo -e "${CYAN}🔨 Building services...${NC}"
    docker compose -f docker-compose-nextgen.yml build
    echo -e "${GREEN}✅ Build complete!${NC}"
}

# Start services
start() {
    local profile="${1:-}"
    
    echo -e "${CYAN}🚀 Starting voice agent stack...${NC}"
    
    if [ "$profile" == "full" ]; then
        echo "Starting with all services including XTTS (legacy)..."
        docker compose -f docker-compose-nextgen.yml --profile legacy up -d
    else
        docker compose -f docker-compose-nextgen.yml up -d
    fi
    
    echo ""
    echo -e "${GREEN}✅ Services starting!${NC}"
    echo ""
    echo -e "${BLUE}📊 Service URLs:${NC}"
    echo "   • Voice Agent UI:    http://localhost:3000"
    echo "   • Agent API:         http://localhost:8090"
    echo "   • Voice Gateway:     http://localhost:8080"
    echo "   • ASR Service:       http://localhost:7000"
    echo "   • Orpheus TTS:       http://localhost:8020"
    echo ""
    echo -e "${YELLOW}⏳ Note: First start may take 5-10 minutes to download models.${NC}"
}

# Stop services
stop() {
    echo -e "${CYAN}🛑 Stopping services...${NC}"
    docker compose -f docker-compose-nextgen.yml --profile legacy down
    echo -e "${GREEN}✅ Services stopped.${NC}"
}

# Show logs
logs() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        docker compose -f docker-compose-nextgen.yml logs -f "$service"
    else
        docker compose -f docker-compose-nextgen.yml logs -f
    fi
}

# Show status
status() {
    echo -e "${CYAN}📊 Service Status:${NC}"
    docker compose -f docker-compose-nextgen.yml ps
    echo ""
    
    echo -e "${CYAN}🔍 Health Checks:${NC}"
    
    # Check each service
    for service in "asr:7000" "orpheus-tts:8020" "voice-agent:8090" "voice-gateway:8080"; do
        name="${service%%:*}"
        port="${service##*:}"
        if curl -s "http://localhost:$port/health" > /dev/null 2>&1; then
            echo -e "   ${GREEN}✅ $name (port $port)${NC}"
        else
            echo -e "   ${RED}❌ $name (port $port)${NC}"
        fi
    done
    
    echo ""
    check_gpu
}

# Test TTS
test_tts() {
    local text="${1:-Hello! I am the Mangwale voice agent. How can I help you today?}"
    local voice="${2:-tara}"
    
    echo -e "${CYAN}🔊 Testing Orpheus TTS...${NC}"
    echo "   Text: $text"
    echo "   Voice: $voice"
    
    curl -X POST "http://localhost:8020/v1/audio/speech" \
        -H "Content-Type: application/json" \
        -d "{\"input\": \"$text\", \"voice\": \"$voice\"}" \
        --output /tmp/test_speech.wav
    
    if [ -f /tmp/test_speech.wav ]; then
        echo -e "${GREEN}✅ Audio saved to /tmp/test_speech.wav${NC}"
        if command -v aplay &> /dev/null; then
            aplay /tmp/test_speech.wav 2>/dev/null || echo "Could not play audio"
        fi
    else
        echo -e "${RED}❌ TTS test failed${NC}"
    fi
}

# Test ASR
test_asr() {
    local audio="${1:-}"
    
    if [ -z "$audio" ]; then
        echo -e "${YELLOW}Usage: $0 test-asr <audio_file>${NC}"
        return 1
    fi
    
    echo -e "${CYAN}🎤 Testing ASR...${NC}"
    echo "   File: $audio"
    
    result=$(curl -s -X POST "http://localhost:7000/v1/audio/transcriptions" \
        -F "file=@$audio" \
        -F "language=en")
    
    echo -e "${GREEN}Transcription:${NC}"
    echo "$result" | jq -r '.text' 2>/dev/null || echo "$result"
}

# Test agent
test_agent() {
    local message="${1:-Hello, what can you help me with?}"
    
    echo -e "${CYAN}🤖 Testing Voice Agent...${NC}"
    echo "   Message: $message"
    
    # Create session
    session=$(curl -s -X POST "http://localhost:8090/api/sessions" \
        -H "Content-Type: application/json" \
        -d '{"system_prompt": "You are a helpful assistant.", "tools": ["get_current_time"]}')
    
    session_id=$(echo "$session" | jq -r '.session_id')
    echo "   Session: $session_id"
    
    # Send message
    response=$(curl -s -X POST "http://localhost:8090/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$session_id\", \"messages\": [{\"role\": \"user\", \"content\": \"$message\"}]}")
    
    echo -e "${GREEN}Response:${NC}"
    echo "$response" | jq -r '.response' 2>/dev/null || echo "$response"
}

# Show GPU memory
gpu_mem() {
    echo -e "${CYAN}🎮 GPU Memory Usage:${NC}"
    nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv
}

# Main
case "${1:-help}" in
    build)
        print_banner
        build
        ;;
    start)
        print_banner
        check_gpu
        check_ollama
        start "${2:-}"
        ;;
    stop)
        print_banner
        stop
        ;;
    restart)
        print_banner
        stop
        start "${2:-}"
        ;;
    logs)
        logs "${2:-}"
        ;;
    status)
        print_banner
        status
        ;;
    test-tts)
        test_tts "${2:-}" "${3:-}"
        ;;
    test-asr)
        test_asr "${2:-}"
        ;;
    test-agent)
        test_agent "${2:-}"
        ;;
    gpu)
        gpu_mem
        ;;
    help|*)
        print_banner
        echo -e "${CYAN}Usage:${NC} $0 <command> [options]"
        echo ""
        echo -e "${CYAN}Commands:${NC}"
        echo "  build           Build all Docker images"
        echo "  start [full]    Start services (use 'full' to include XTTS)"
        echo "  stop            Stop all services"
        echo "  restart [full]  Restart services"
        echo "  logs [service]  Show logs (optionally for specific service)"
        echo "  status          Show service status and health"
        echo "  gpu             Show GPU memory usage"
        echo ""
        echo -e "${CYAN}Testing:${NC}"
        echo "  test-tts [text] [voice]   Test TTS synthesis"
        echo "  test-asr <file>           Test ASR transcription"
        echo "  test-agent [message]      Test agent chat"
        echo ""
        echo -e "${CYAN}Examples:${NC}"
        echo "  $0 start                  Start default stack"
        echo "  $0 test-tts \"Hello world\" leo"
        echo "  $0 logs orpheus-tts       Follow TTS logs"
        ;;
esac
