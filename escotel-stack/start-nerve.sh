#!/bin/bash
# =============================================================================
# Mangwale Voice Nerve System - Quick Start
# =============================================================================
# Ultra-fast Python voice layer for Exotel IVR calls
#
# Usage:
#   ./start-nerve.sh           # Start all services
#   ./start-nerve.sh --nerve   # Start only nerve system (for testing)
#   ./start-nerve.sh --status  # Check status
#   ./start-nerve.sh --test    # Run test call
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo ""
    echo "=========================================="
    echo -e "${GREEN}$1${NC}"
    echo "=========================================="
}

print_status() {
    echo -e "${YELLOW}➤${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker not found. Please install Docker."
        exit 1
    fi
    print_success "Docker found"
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        if ! docker compose version &> /dev/null; then
            print_error "Docker Compose not found."
            exit 1
        fi
    fi
    print_success "Docker Compose found"
    
    # Check NVIDIA GPU
    if nvidia-smi &> /dev/null; then
        print_success "NVIDIA GPU detected"
        nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
    else
        print_error "No NVIDIA GPU detected - ASR/TTS may not work"
    fi
}

# Load environment variables
load_env() {
    if [ -f .env ]; then
        print_status "Loading environment variables from .env"
        source .env
    fi
    
    # Check required variables
    if [ -z "$EXOTEL_API_KEY" ] || [ -z "$EXOTEL_API_TOKEN" ]; then
        echo ""
        print_error "Missing Exotel credentials!"
        echo "Create .env file with:"
        echo "  EXOTEL_SID=sarvinsuppliesllp1"
        echo "  EXOTEL_API_KEY=your_key"
        echo "  EXOTEL_API_TOKEN=your_token"
        echo "  EXOTEL_CALLER_ID=02048556923"
        echo ""
        exit 1
    fi
    print_success "Exotel credentials loaded"
}

# Start services
start_all() {
    print_header "Starting Nerve System"
    
    print_status "Building containers..."
    docker-compose -f docker-compose-nerve.yml build
    
    print_status "Starting services..."
    docker-compose -f docker-compose-nerve.yml up -d
    
    echo ""
    print_status "Waiting for services to be ready..."
    sleep 10
    
    # Health checks
    check_health
}

# Start only nerve system (for local development)
start_nerve_only() {
    print_header "Starting Nerve System Only"
    
    print_status "Starting nerve-system container..."
    docker-compose -f docker-compose-nerve.yml up -d nerve-system
    
    sleep 5
    check_nerve_health
}

# Check health
check_health() {
    print_header "Health Checks"
    
    # Nerve System
    if curl -sf http://localhost:7100/health > /dev/null 2>&1; then
        print_success "Nerve System (7100) - HEALTHY"
        curl -s http://localhost:7100/health | python3 -m json.tool 2>/dev/null || true
    else
        print_error "Nerve System (7100) - UNHEALTHY"
    fi
    echo ""
    
    # ASR
    if curl -sf http://localhost:7001/health > /dev/null 2>&1; then
        print_success "ASR Service (7001) - HEALTHY"
    else
        print_error "ASR Service (7001) - UNHEALTHY"
    fi
    
    # TTS
    if curl -sf http://localhost:7002/health > /dev/null 2>&1; then
        print_success "TTS Service (7002) - HEALTHY"
    else
        print_error "TTS Service (7002) - UNHEALTHY"
    fi
    
    # Exotel JS (legacy)
    if curl -sf http://localhost:3100/health > /dev/null 2>&1; then
        print_success "Exotel JS (3100) - HEALTHY"
    else
        print_status "Exotel JS (3100) - Not running (OK if using Nerve)"
    fi
}

check_nerve_health() {
    if curl -sf http://localhost:7100/health > /dev/null 2>&1; then
        print_success "Nerve System (7100) - HEALTHY"
        curl -s http://localhost:7100/health | python3 -m json.tool 2>/dev/null || true
    else
        print_error "Nerve System (7100) - UNHEALTHY"
        docker-compose -f docker-compose-nerve.yml logs nerve-system --tail 50
    fi
}

# Test call
test_call() {
    print_header "Test Call"
    
    echo "Sending test vendor confirmation request..."
    echo ""
    
    curl -X POST http://localhost:7100/api/nerve/vendor-order-confirmation \
        -H "Content-Type: application/json" \
        -d '{
            "order_id": 12345,
            "vendor_id": 100,
            "vendor_phone": "+919876543210",
            "vendor_name": "Test Restaurant",
            "customer_name": "Test Customer",
            "order_items": [
                {"name": "Vada Pav", "quantity": 2},
                {"name": "Samosa", "quantity": 3}
            ],
            "order_amount": 250,
            "payment_method": "Cash on Delivery",
            "language": "hi"
        }' | python3 -m json.tool 2>/dev/null || cat
    
    echo ""
}

# Show status
show_status() {
    print_header "Service Status"
    docker-compose -f docker-compose-nerve.yml ps
    echo ""
    check_health
}

# Show logs
show_logs() {
    docker-compose -f docker-compose-nerve.yml logs -f --tail 100 nerve-system
}

# Stop services
stop_services() {
    print_header "Stopping Services"
    docker-compose -f docker-compose-nerve.yml down
    print_success "Services stopped"
}

# Main
main() {
    case "${1:-}" in
        --nerve)
            check_prerequisites
            load_env
            start_nerve_only
            ;;
        --status)
            show_status
            ;;
        --test)
            test_call
            ;;
        --logs)
            show_logs
            ;;
        --stop)
            stop_services
            ;;
        --help|-h)
            echo "Usage: $0 [option]"
            echo ""
            echo "Options:"
            echo "  (no args)   Start all services"
            echo "  --nerve     Start only nerve system"
            echo "  --status    Show status of all services"
            echo "  --test      Send test call request"
            echo "  --logs      Follow nerve system logs"
            echo "  --stop      Stop all services"
            echo ""
            ;;
        *)
            check_prerequisites
            load_env
            start_all
            ;;
    esac
}

main "$@"
