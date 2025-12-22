#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Mangwale Voice Stack Enhanced - Management Script
# December 2025
# ═══════════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose-enhanced.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║           🎙️  Mangwale Voice Stack Enhanced                  ║"
    echo "║           GPU-Accelerated AI Voice System                    ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check NVIDIA Docker
    if ! docker info 2>/dev/null | grep -q "nvidia"; then
        print_warning "NVIDIA Docker runtime not detected. GPU features may not work."
    fi
    
    # Check GPU
    if command -v nvidia-smi &> /dev/null; then
        print_status "GPU detected:"
        nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
    else
        print_warning "nvidia-smi not found. GPU acceleration may not be available."
    fi
    
    print_success "Prerequisites check completed"
}

# Build services
build() {
    print_banner
    print_status "Building all services..."
    
    docker compose -f "$COMPOSE_FILE" build --parallel
    
    print_success "Build completed!"
}

# Start services
start() {
    print_banner
    check_prerequisites
    
    print_status "Starting Mangwale Voice Stack Enhanced..."
    
    # Create necessary directories
    mkdir -p "$SCRIPT_DIR/logs"/{asr,tts,gateway,orchestrator,admin}
    mkdir -p "$SCRIPT_DIR/models"
    mkdir -p "$SCRIPT_DIR/cache"
    
    # Start services
    docker compose -f "$COMPOSE_FILE" up -d
    
    print_status "Waiting for services to be ready..."
    sleep 10
    
    # Health check
    health_check
    
    print_success "Stack started successfully!"
    print_urls
}

# Stop services
stop() {
    print_banner
    print_status "Stopping Mangwale Voice Stack Enhanced..."
    
    docker compose -f "$COMPOSE_FILE" down
    
    print_success "Stack stopped"
}

# Restart services
restart() {
    stop
    start
}

# View logs
logs() {
    local service=${1:-""}
    
    if [ -z "$service" ]; then
        docker compose -f "$COMPOSE_FILE" logs -f --tail=100
    else
        docker compose -f "$COMPOSE_FILE" logs -f --tail=100 "$service"
    fi
}

# Health check
health_check() {
    print_status "Running health checks..."
    
    local services=("voice-gateway:8080" "asr:7001" "tts:7002" "orchestrator:7000" "admin:8000")
    local all_healthy=true
    
    for service in "${services[@]}"; do
        local name="${service%%:*}"
        local port="${service##*:}"
        
        if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} $name (port $port)"
        else
            echo -e "  ${RED}✗${NC} $name (port $port)"
            all_healthy=false
        fi
    done
    
    if $all_healthy; then
        print_success "All services healthy"
    else
        print_warning "Some services are not healthy"
    fi
}

# Print service URLs
print_urls() {
    echo ""
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}Service URLs:${NC}"
    echo "  🎤 Voice Gateway:  http://localhost:8080"
    echo "  🧠 Orchestrator:   http://localhost:7000"
    echo "  🔊 TTS Service:    http://localhost:7002"
    echo "  🎧 ASR Service:    http://localhost:7001"
    echo "  📊 Admin Dashboard: http://localhost:8000"
    echo "  📈 Prometheus:     http://localhost:9090"
    echo "  📉 Grafana:        http://localhost:3000"
    echo ""
    echo -e "${CYAN}Quick Test:${NC}"
    echo "  curl http://localhost:7000/health"
    echo "  curl http://localhost:8000/"
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
}

# GPU status
gpu_status() {
    print_status "GPU Status:"
    if command -v nvidia-smi &> /dev/null; then
        nvidia-smi
    else
        print_error "nvidia-smi not available"
    fi
}

# Pull latest model weights
pull_models() {
    print_status "Pulling latest model weights..."
    
    # Create model directories
    mkdir -p "$SCRIPT_DIR/models"/{whisper,chatterbox,indic-parler,kokoro,silero-vad}
    
    print_status "Models will be downloaded on first container start"
    print_success "Model directories prepared"
}

# Clean up
clean() {
    print_banner
    print_warning "This will remove all containers, volumes, and cached data!"
    read -p "Are you sure? (y/N): " confirm
    
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
        rm -rf "$SCRIPT_DIR/logs"/*
        rm -rf "$SCRIPT_DIR/cache"/*
        print_success "Cleanup completed"
    else
        print_status "Cleanup cancelled"
    fi
}

# Show status
status() {
    print_banner
    print_status "Container Status:"
    docker compose -f "$COMPOSE_FILE" ps
    
    echo ""
    health_check
    
    echo ""
    gpu_status
}

# Test endpoints
test_endpoints() {
    print_banner
    print_status "Testing endpoints..."
    
    echo ""
    echo "Testing TTS..."
    curl -s -X POST http://localhost:7002/v1/audio/speech \
        -H "Content-Type: application/json" \
        -d '{"input": "नमस्ते", "language": "hi"}' \
        -o /tmp/test_tts.wav && \
        echo -e "  ${GREEN}✓${NC} TTS generated audio" || \
        echo -e "  ${RED}✗${NC} TTS failed"
    
    echo ""
    echo "Testing Chat..."
    curl -s -X POST http://localhost:7000/api/chat \
        -H "Content-Type: application/json" \
        -d '{"session_id": "test", "message": "नमस्ते", "language": "hi"}' | jq .
    
    echo ""
    print_success "Endpoint tests completed"
}

# Show help
help() {
    print_banner
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  start       Start all services"
    echo "  stop        Stop all services"
    echo "  restart     Restart all services"
    echo "  build       Build all Docker images"
    echo "  status      Show service status"
    echo "  logs [svc]  View logs (optionally for specific service)"
    echo "  health      Run health checks"
    echo "  gpu         Show GPU status"
    echo "  test        Test API endpoints"
    echo "  clean       Remove containers and data"
    echo "  models      Prepare model directories"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 start"
    echo "  $0 logs tts"
    echo "  $0 status"
}

# Main
case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    build)
        build
        ;;
    status)
        status
        ;;
    logs)
        logs "${2:-}"
        ;;
    health)
        health_check
        ;;
    gpu)
        gpu_status
        ;;
    test)
        test_endpoints
        ;;
    clean)
        clean
        ;;
    models)
        pull_models
        ;;
    help|--help|-h)
        help
        ;;
    *)
        help
        ;;
esac
