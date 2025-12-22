#!/bin/bash
# Mangwale Voice Gateway v2.0 - API Test Suite
# Tests all new admin endpoints

GATEWAY_URL="${GATEWAY_URL:-http://localhost:7101}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       MANGWALE VOICE GATEWAY v2.0 - API TEST SUITE           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Gateway URL: $GATEWAY_URL"
echo ""

# Test counter
PASSED=0
FAILED=0

test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local expected="$4"
    local data="$5"
    
    echo -n "  Testing $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$GATEWAY_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X POST "$GATEWAY_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "$expected" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $http_code)"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $http_code, expected $expected)"
        ((FAILED++))
        return 1
    fi
}

# ============================================================================
echo -e "${BLUE}━━━ Health & Status Endpoints ━━━${NC}"
# ============================================================================

test_endpoint "GET /health" "GET" "/health" "200"
test_endpoint "GET /api/providers/health" "GET" "/api/providers/health" "200"

# ============================================================================
echo ""
echo -e "${BLUE}━━━ Configuration Endpoints ━━━${NC}"
# ============================================================================

test_endpoint "GET /api/config" "GET" "/api/config" "200"
test_endpoint "GET /api/stats" "GET" "/api/stats" "200"

# ============================================================================
echo ""
echo -e "${BLUE}━━━ Voice & Model Endpoints ━━━${NC}"
# ============================================================================

test_endpoint "GET /api/voices" "GET" "/api/voices" "200"
test_endpoint "GET /api/voices?language=hi" "GET" "/api/voices?language=hi" "200"
test_endpoint "GET /api/emotions" "GET" "/api/emotions" "200"
test_endpoint "GET /api/models" "GET" "/api/models" "200"
test_endpoint "GET /api/capabilities" "GET" "/api/capabilities" "200"

# ============================================================================
echo ""
echo -e "${BLUE}━━━ TTS Endpoints ━━━${NC}"
# ============================================================================

echo -n "  Testing POST /api/speak (Hindi, neutral)... "
TTS_RESULT=$(curl -s -w "\n%{http_code}" -X POST "$GATEWAY_URL/api/speak" \
    -H "Content-Type: application/json" \
    -d '{"text": "नमस्ते", "language": "hi", "emotion": "neutral"}' \
    -o /tmp/test_neutral.mp3)
TTS_CODE=$(echo "$TTS_RESULT" | tail -n1)
if [ "$TTS_CODE" = "200" ] && [ -s /tmp/test_neutral.mp3 ]; then
    SIZE=$(ls -lh /tmp/test_neutral.mp3 | awk '{print $5}')
    echo -e "${GREEN}✓ PASS${NC} (HTTP 200, $SIZE)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (HTTP $TTS_CODE)"
    ((FAILED++))
fi

echo -n "  Testing POST /api/speak (Hindi, happy)... "
TTS_RESULT=$(curl -s -w "\n%{http_code}" -X POST "$GATEWAY_URL/api/speak" \
    -H "Content-Type: application/json" \
    -d '{"text": "बहुत अच्छा!", "language": "hi", "emotion": "happy"}' \
    -o /tmp/test_happy.mp3)
TTS_CODE=$(echo "$TTS_RESULT" | tail -n1)
if [ "$TTS_CODE" = "200" ] && [ -s /tmp/test_happy.mp3 ]; then
    SIZE=$(ls -lh /tmp/test_happy.mp3 | awk '{print $5}')
    echo -e "${GREEN}✓ PASS${NC} (HTTP 200, $SIZE)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (HTTP $TTS_CODE)"
    ((FAILED++))
fi

echo -n "  Testing POST /api/test/tts (with base64 response)... "
TTS_TEST=$(curl -s -X POST "$GATEWAY_URL/api/test/tts" \
    -H "Content-Type: application/json" \
    -d '{"text": "टेस्ट", "language": "hi", "emotion": "professional"}')
if echo "$TTS_TEST" | grep -q '"audio"'; then
    LATENCY=$(echo "$TTS_TEST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('latencyMs', 'N/A'))" 2>/dev/null || echo "N/A")
    echo -e "${GREEN}✓ PASS${NC} (Latency: ${LATENCY}ms)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# ============================================================================
echo ""
echo -e "${BLUE}━━━ Response Content Validation ━━━${NC}"
# ============================================================================

echo -n "  Validating /api/config structure... "
CONFIG=$(curl -s "$GATEWAY_URL/api/config")
if echo "$CONFIG" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'asr' in d and 'tts' in d and 'emotions' in d['tts']" 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo -n "  Validating /api/emotions structure... "
EMOTIONS=$(curl -s "$GATEWAY_URL/api/emotions")
if echo "$EMOTIONS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'happy' in d and 'sad' in d and 'professional' in d" 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo -n "  Validating /api/capabilities structure... "
CAPS=$(curl -s "$GATEWAY_URL/api/capabilities")
if echo "$CAPS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'features' in d and 'emotions' in d and 'voiceCount' in d" 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo -n "  Validating /api/stats structure... "
STATS=$(curl -s "$GATEWAY_URL/api/stats")
if echo "$STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'asr' in d and 'tts' in d and 'uptime' in d" 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# ============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                      TEST RESULTS                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${GREEN}Passed: $PASSED${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    echo -e "${YELLOW}⚠️  Some tests failed. Check gateway logs for details.${NC}"
fi

echo ""
echo "━━━ Generated Audio Files ━━━"
ls -lh /tmp/test_*.mp3 2>/dev/null || echo "  No audio files generated"
echo ""
echo "Play test audio: ffplay /tmp/test_happy.mp3"
echo ""
