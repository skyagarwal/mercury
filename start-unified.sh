#!/bin/bash
#############################################################################
# Mangwale Voice + Escotel Unified Stack - Startup Script
# 
# This script manages the complete voice stack with Exotel integration.
#############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=============================================="
echo "🎙️  Mangwale Voice + Escotel Unified Stack"
echo "=============================================="

JUPITER_HOST="${JUPITER_HOST:-192.168.0.156}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Test connectivity
test_connectivity() {
    echo -e "\n${YELLOW}Testing connectivity...${NC}"
    
    echo -n "  → Jupiter Backend (3200): "
    if curl -s --connect-timeout 3 "http://${JUPITER_HOST}:3200/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC} (voice will still work, fallback mode)"
    fi
    
    echo -n "  → Jupiter vLLM (8002): "
    if curl -s --connect-timeout 3 "http://${JUPITER_HOST}:8002/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
    
    echo -n "  → NVIDIA GPU: "
    if command -v nvidia-smi &> /dev/null; then
        GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
        echo -e "${GREEN}✓ $GPU${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
}

# Show services status
show_status() {
    echo -e "\n${YELLOW}Container Status:${NC}"
    docker compose -f "$SCRIPT_DIR/docker-compose-unified.yml" ps
    
    echo -e "\n${YELLOW}Service Health:${NC}"
    
    echo -n "  → Voice Gateway (8080): "
    if curl -s "http://localhost:8080/health" | grep -q "healthy"; then
        echo -e "${GREEN}✓ Healthy${NC}"
    else
        echo -e "${RED}✗ Unhealthy${NC}"
    fi
    
    echo -n "  → Voice Agent (8090): "
    if curl -s "http://localhost:8090/health" | grep -q "healthy"; then
        echo -e "${GREEN}✓ Healthy${NC}"
    else
        echo -e "${RED}✗ Unhealthy${NC}"
    fi
    
    echo -n "  → ASR (7000): "
    if curl -s "http://localhost:7000/health" 2>/dev/null | grep -q -i "ok\|UP\|status"; then
        echo -e "${GREEN}✓ Healthy${NC}"
    else
        echo -e "${YELLOW}⚠ Check manually${NC}"
    fi
    
    echo -n "  → TTS XTTS (8010): "
    if curl -s "http://localhost:8010/health" 2>/dev/null | grep -q -i "ok\|status"; then
        echo -e "${GREEN}✓ Healthy${NC}"
    else
        echo -e "${YELLOW}⚠ Check manually${NC}"
    fi
    
    echo -n "  → Exotel Service (3100): "
    if curl -s "http://localhost:3100/health" 2>/dev/null | grep -q "ok"; then
        echo -e "${GREEN}✓ Healthy${NC}"
    else
        echo -e "${RED}✗ Unhealthy${NC}"
    fi
    
    echo -n "  → RabbitMQ (15672): "
    if curl -s "http://localhost:15672" 2>/dev/null | grep -q -i "rabbit"; then
        echo -e "${GREEN}✓ Running${NC}"
    else
        echo -e "${YELLOW}⚠ Check manually${NC}"
    fi
}

# Test end-to-end
test_e2e() {
    echo -e "\n${YELLOW}Testing Voice Pipeline...${NC}"
    
    # Test Voice Agent
    echo -e "\n${BLUE}1. Testing Voice Agent → Jupiter...${NC}"
    RESPONSE=$(curl -s -X POST "http://localhost:8090/api/voice/process" \
        -H "Content-Type: application/json" \
        -d '{"session_id":"test-e2e","text":"Hello, kaise ho?","language":"auto"}' 2>/dev/null)
    
    if echo "$RESPONSE" | grep -q "enhanced_text"; then
        echo -e "  ${GREEN}✓ Voice Agent responding${NC}"
        TEXT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('text','')[:80])" 2>/dev/null || echo "")
        echo -e "  Response: ${TEXT}..."
    else
        echo -e "  ${RED}✗ Voice Agent not responding${NC}"
    fi
    
    # Test Exotel
    echo -e "\n${BLUE}2. Testing Exotel Auth...${NC}"
    EXOTEL=$(curl -s "http://localhost:8090/api/exotel/status" 2>/dev/null)
    
    if echo "$EXOTEL" | grep -q '"connected":true'; then
        echo -e "  ${GREEN}✓ Exotel connected${NC}"
    else
        echo -e "  ${YELLOW}⚠ Exotel not connected (check credentials)${NC}"
    fi
}

# Print service URLs
print_urls() {
    echo ""
    echo "=============================================="
    echo "📡 Service URLs"
    echo "=============================================="
    echo ""
    echo "Voice Services:"
    echo "  • Voice Gateway:  http://192.168.0.151:8080"
    echo "  • Voice Agent:    http://192.168.0.151:8090"
    echo "  • Voice UI:       http://192.168.0.151:3000"
    echo "  • Test Client:    http://192.168.0.151:8080/test"
    echo ""
    echo "ASR/TTS:"
    echo "  • ASR (Whisper):  http://192.168.0.151:7000"
    echo "  • TTS (XTTS):     http://192.168.0.151:8010"
    echo ""
    echo "Exotel/Comms:"
    echo "  • Exotel Service: http://192.168.0.151:3100"
    echo "  • Exotel UI:      http://192.168.0.151:3101"
    echo "  • RabbitMQ Mgmt:  http://192.168.0.151:15672"
    echo ""
    echo "API Docs:"
    echo "  • Voice Agent:    http://192.168.0.151:8090/docs"
    echo "  • Exotel:         http://192.168.0.151:3100/exotel/docs"
    echo ""
}

cd "$SCRIPT_DIR"

case "$1" in
    up|start)
        test_connectivity
        echo -e "\n${YELLOW}Starting unified stack...${NC}"
        docker compose -f docker-compose-unified.yml up -d --build
        echo -e "\n${GREEN}✓ Stack started!${NC}"
        print_urls
        ;;
        
    down|stop)
        echo -e "${YELLOW}Stopping stack...${NC}"
        docker compose -f docker-compose-unified.yml down
        echo -e "${GREEN}✓ Stack stopped${NC}"
        ;;
        
    restart)
        SERVICE="${2:-}"
        if [ -n "$SERVICE" ]; then
            echo -e "${YELLOW}Restarting $SERVICE...${NC}"
            docker compose -f docker-compose-unified.yml restart "$SERVICE"
        else
            echo -e "${YELLOW}Restarting all services...${NC}"
            docker compose -f docker-compose-unified.yml restart
        fi
        echo -e "${GREEN}✓ Restarted${NC}"
        ;;
        
    logs)
        SERVICE="${2:-}"
        if [ -n "$SERVICE" ]; then
            docker compose -f docker-compose-unified.yml logs -f "$SERVICE"
        else
            docker compose -f docker-compose-unified.yml logs -f
        fi
        ;;
        
    status)
        show_status
        ;;
        
    test)
        test_connectivity
        test_e2e
        ;;
        
    urls)
        print_urls
        ;;
        
    build)
        echo -e "${YELLOW}Rebuilding containers...${NC}"
        docker compose -f docker-compose-unified.yml build --no-cache
        echo -e "${GREEN}✓ Build complete${NC}"
        ;;
        
    voice-only)
        echo -e "${YELLOW}Starting voice-only stack (no Exotel)...${NC}"
        docker compose -f docker-compose-jupiter.yml up -d
        echo -e "${GREEN}✓ Voice stack started${NC}"
        ;;
        
    *)
        echo ""
        echo "Usage: $0 {command} [service]"
        echo ""
        echo "Commands:"
        echo "  up|start     Start the unified voice + Exotel stack"
        echo "  down|stop    Stop all services"
        echo "  restart      Restart services (optionally specify service name)"
        echo "  logs [svc]   View logs (optionally specify service)"
        echo "  status       Show container and health status"
        echo "  test         Run end-to-end tests"
        echo "  urls         Print service URLs"
        echo "  build        Rebuild all containers"
        echo "  voice-only   Start voice stack without Exotel"
        echo ""
        echo "Examples:"
        echo "  $0 up                    # Start everything"
        echo "  $0 restart voice-agent   # Restart voice agent only"
        echo "  $0 logs asr              # View ASR logs"
        echo "  $0 test                  # Test connectivity"
        echo ""
        ;;
esac
