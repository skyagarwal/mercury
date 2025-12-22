#!/bin/bash
#############################################################################
# Mangwale Voice Stack - Test & Startup Script
# 
# This script tests connectivity to Jupiter and starts the voice stack.
#############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=============================================="
echo "🎙️  Mangwale Voice Stack - Jupiter Connected"
echo "=============================================="

JUPITER_HOST="${JUPITER_HOST:-192.168.0.156}"

# Test Jupiter connectivity
echo -e "\n${YELLOW}Testing Jupiter connectivity...${NC}"

echo -n "  → Jupiter Backend (3200): "
if curl -s --connect-timeout 5 "http://${JUPITER_HOST}:3200/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Connected${NC}"
else
    echo -e "${RED}✗ Not reachable${NC}"
    echo "  WARNING: Backend not available, but continuing..."
fi

echo -n "  → Jupiter vLLM (8002): "
if curl -s --connect-timeout 5 "http://${JUPITER_HOST}:8002/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Connected${NC}"
else
    echo -e "${RED}✗ Not reachable${NC}"
    echo "  WARNING: vLLM not available"
fi

echo -n "  → Jupiter NLU (7010): "
if curl -s --connect-timeout 5 "http://${JUPITER_HOST}:7010/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Connected${NC}"
else
    echo -e "${RED}✗ Not reachable${NC}"
    echo "  WARNING: NLU not available"
fi

# Check NVIDIA GPU
echo -e "\n${YELLOW}Checking GPU...${NC}"
if command -v nvidia-smi &> /dev/null; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
    GPU_MEM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader | head -1)
    echo -e "  ${GREEN}✓ $GPU_NAME ($GPU_MEM)${NC}"
else
    echo -e "  ${RED}✗ NVIDIA driver not found${NC}"
fi

# Check Docker
echo -e "\n${YELLOW}Checking Docker...${NC}"
if command -v docker &> /dev/null; then
    DOCKER_VER=$(docker --version)
    echo -e "  ${GREEN}✓ $DOCKER_VER${NC}"
    
    if docker compose version &> /dev/null; then
        COMPOSE_VER=$(docker compose version --short)
        echo -e "  ${GREEN}✓ Docker Compose v$COMPOSE_VER${NC}"
    else
        echo -e "  ${RED}✗ Docker Compose not found${NC}"
        exit 1
    fi
else
    echo -e "  ${RED}✗ Docker not found${NC}"
    exit 1
fi

# Start the stack
echo -e "\n${YELLOW}Starting Voice Stack...${NC}"
echo "  This may take a few minutes on first run (downloading models)..."

cd "$(dirname "$0")"

case "$1" in
    up|start)
        docker compose -f docker-compose-jupiter.yml up -d
        echo -e "\n${GREEN}✓ Stack started!${NC}"
        echo ""
        echo "Services:"
        echo "  • Voice Gateway: http://localhost:8080"
        echo "  • Voice Agent:   http://localhost:8090"
        echo "  • ASR (Whisper): http://localhost:7000"
        echo "  • TTS (XTTS):    http://localhost:8010"
        echo "  • Web UI:        http://localhost:3000"
        echo ""
        echo "Test URL: http://localhost:8080/test"
        echo "API Docs: http://localhost:8090/docs"
        ;;
    down|stop)
        docker compose -f docker-compose-jupiter.yml down
        echo -e "${GREEN}✓ Stack stopped${NC}"
        ;;
    logs)
        docker compose -f docker-compose-jupiter.yml logs -f "${@:2}"
        ;;
    restart)
        docker compose -f docker-compose-jupiter.yml restart "${@:2}"
        ;;
    status)
        echo -e "\n${YELLOW}Container Status:${NC}"
        docker compose -f docker-compose-jupiter.yml ps
        ;;
    test-voice)
        # Quick voice test
        echo -e "\n${YELLOW}Testing Voice Pipeline...${NC}"
        
        # Test ASR
        echo -n "  → ASR: "
        if curl -s "http://localhost:7000/health" | grep -q "ok\|UP"; then
            echo -e "${GREEN}✓ Healthy${NC}"
        else
            echo -e "${RED}✗ Unhealthy${NC}"
        fi
        
        # Test Voice Agent
        echo -n "  → Voice Agent: "
        if curl -s "http://localhost:8090/health" | grep -q "healthy"; then
            echo -e "${GREEN}✓ Healthy${NC}"
        else
            echo -e "${RED}✗ Unhealthy${NC}"
        fi
        
        # Test TTS
        echo -n "  → TTS: "
        if curl -s "http://localhost:8010/health" 2>/dev/null | grep -q "ok\|UP"; then
            echo -e "${GREEN}✓ Healthy${NC}"
        else
            echo -e "${YELLOW}⚠ Check manually${NC}"
        fi
        
        # Test Gateway
        echo -n "  → Gateway: "
        if curl -s "http://localhost:8080/health" | grep -q "healthy"; then
            echo -e "${GREEN}✓ Healthy${NC}"
        else
            echo -e "${RED}✗ Unhealthy${NC}"
        fi
        
        # Test end-to-end
        echo -e "\n${YELLOW}Testing Voice Agent API...${NC}"
        RESPONSE=$(curl -s -X POST "http://localhost:8090/api/voice/process" \
            -H "Content-Type: application/json" \
            -d '{"session_id":"test-123","text":"Hello, kaise ho?","language":"auto"}')
        
        if echo "$RESPONSE" | grep -q "text"; then
            echo -e "  ${GREEN}✓ Voice Agent Response:${NC}"
            echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
        else
            echo -e "  ${RED}✗ No response from Voice Agent${NC}"
        fi
        ;;
    *)
        echo ""
        echo "Usage: $0 {up|down|logs|restart|status|test-voice}"
        echo ""
        echo "Commands:"
        echo "  up|start     Start the voice stack"
        echo "  down|stop    Stop the voice stack"
        echo "  logs [svc]   View logs (optional: specify service)"
        echo "  restart      Restart services"
        echo "  status       Show container status"
        echo "  test-voice   Test the voice pipeline"
        echo ""
        ;;
esac
