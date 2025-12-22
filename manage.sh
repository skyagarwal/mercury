#!/bin/bash
###############################################################################
# Mangwale Voice Services - Management Script
# Mercury Server (192.168.0.151)
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_help() {
    echo "Mangwale Voice Services Management"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  start       - Start all voice services"
    echo "  stop        - Stop all voice services"
    echo "  restart     - Restart all voice services"
    echo "  status      - Show service status"
    echo "  logs        - Show logs (use -f for follow)"
    echo "  build       - Build voice gateway"
    echo "  gpu         - Check GPU status"
    echo "  health      - Check service health"
    echo "  test-asr    - Test ASR service"
    echo "  test-tts    - Test TTS service"
    echo ""
}

check_gpu() {
    print_status "Checking GPU status..."
    nvidia-smi
    echo ""
    docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi 2>/dev/null || print_warning "Docker GPU test failed"
}

start_services() {
    print_status "Starting Mangwale Voice Services..."
    
    # Check GPU
    if ! nvidia-smi &>/dev/null; then
        print_error "NVIDIA GPU not available!"
        exit 1
    fi
    
    # Build gateway if needed
    if [ ! -d "voice-gateway/dist" ]; then
        print_status "Building voice gateway..."
        docker compose build voice-gateway
    fi
    
    # Start services
    docker compose up -d
    
    print_status "Waiting for services to be healthy..."
    sleep 10
    
    # Show status
    docker compose ps
    
    print_success "Voice services started!"
    echo ""
    echo "Service Endpoints:"
    echo "  ASR (HTTP):      http://192.168.0.151:7000"
    echo "  TTS (HTTP):      http://192.168.0.151:8010"
    echo "  Gateway (WS):    ws://192.168.0.151:7100"
    echo "  Gateway (HTTP):  http://192.168.0.151:7101"
    echo ""
    echo "Tailscale Endpoints:"
    echo "  ASR (HTTP):      http://100.117.131.56:7000"
    echo "  TTS (HTTP):      http://100.117.131.56:8010"
    echo "  Gateway (WS):    ws://100.117.131.56:7100"
    echo "  Gateway (HTTP):  http://100.117.131.56:7101"
}

stop_services() {
    print_status "Stopping Mangwale Voice Services..."
    docker compose down
    print_success "Voice services stopped!"
}

restart_services() {
    stop_services
    sleep 2
    start_services
}

show_status() {
    print_status "Service Status:"
    docker compose ps
    echo ""
    
    print_status "GPU Usage:"
    nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv
}

show_logs() {
    if [ "$1" == "-f" ]; then
        docker compose logs -f
    else
        docker compose logs --tail=100
    fi
}

build_gateway() {
    print_status "Building Voice Gateway..."
    docker compose build voice-gateway
    print_success "Build complete!"
}

check_health() {
    print_status "Checking service health..."
    echo ""
    
    # ASR Health
    echo -n "ASR Service: "
    if curl -sf http://localhost:7000/health >/dev/null 2>&1; then
        print_success "Healthy"
    else
        print_error "Unhealthy"
    fi
    
    # TTS Health
    echo -n "TTS Service: "
    if curl -sf http://localhost:8010/health >/dev/null 2>&1; then
        print_success "Healthy"
    else
        print_error "Unhealthy"
    fi
    
    # Gateway Health
    echo -n "Voice Gateway: "
    if curl -sf http://localhost:7101/health >/dev/null 2>&1; then
        print_success "Healthy"
        echo ""
        curl -s http://localhost:7101/health | python3 -m json.tool 2>/dev/null || cat
    else
        print_error "Unhealthy"
    fi
}

test_asr() {
    print_status "Testing ASR Service..."
    
    # Create a test audio file (silence for testing connectivity)
    if [ ! -f "/tmp/test_audio.wav" ]; then
        print_warning "Creating test audio file..."
        # Generate 1 second of silence
        ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 1 -f wav /tmp/test_audio.wav 2>/dev/null || \
        print_warning "ffmpeg not available, using curl test only"
    fi
    
    echo ""
    echo "ASR Health:"
    curl -s http://localhost:7000/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:7000/health
}

test_tts() {
    print_status "Testing TTS Service..."
    echo ""
    
    echo "TTS Health:"
    curl -s http://localhost:8010/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:8010/health
    
    echo ""
    print_status "Testing TTS synthesis (if available)..."
    
    # Test synthesis
    curl -X POST http://localhost:8010/tts \
        -H "Content-Type: application/json" \
        -d '{"text": "नमस्ते, यह एक परीक्षण है।", "language": "hi"}' \
        --output /tmp/test_output.wav \
        --silent --show-error 2>&1 && \
    print_success "TTS test audio saved to /tmp/test_output.wav" || \
    print_warning "TTS test failed (service may still be loading)"
}

# Main
case "${1:-help}" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    build)
        build_gateway
        ;;
    gpu)
        check_gpu
        ;;
    health)
        check_health
        ;;
    test-asr)
        test_asr
        ;;
    test-tts)
        test_tts
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
