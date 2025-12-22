#!/bin/bash

# Quick test script for Exotel Voice Calls
# Usage: ./test-exotel-voice.sh

echo "🎯 Testing Exotel Voice Caller Service"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test phone number (default: 9923383838)
PHONE="${1:-919923383838}"
VENDOR_NAME="${2:-Test Vendor}"
ORDER_ID="${3:-$RANDOM}"
AMOUNT="${4:-500}"

echo -e "${YELLOW}Test Parameters:${NC}"
echo "• Phone: $PHONE"
echo "• Vendor: $VENDOR_NAME"
echo "• Order ID: $ORDER_ID"
echo "• Amount: ₹$AMOUNT"
echo ""

# Test 1: Health Check
echo "1️⃣  Testing service health..."
HEALTH=$(curl -s http://192.168.0.151:3151/health)
if echo "$HEALTH" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Service is healthy${NC}"
else
    echo -e "${RED}❌ Service is not healthy${NC}"
    echo "$HEALTH"
    exit 1
fi
echo ""

# Test 2: ExoML Endpoint
echo "2️⃣  Testing ExoML endpoint..."
EXOML=$(curl -s "http://192.168.0.151:3151/exoml/vendor-greeting?order_id=$ORDER_ID&vendor_name=$VENDOR_NAME&amount=$AMOUNT")
if echo "$EXOML" | grep -q "<Response>"; then
    echo -e "${GREEN}✅ ExoML endpoint working${NC}"
    echo "   Sample XML:"
    echo "$EXOML" | head -n 8
    echo "   ..."
else
    echo -e "${RED}❌ ExoML endpoint failed${NC}"
    echo "$EXOML"
    exit 1
fi
echo ""

# Test 3: Initiate Call
echo "3️⃣  Initiating voice call to $PHONE..."
CALL_RESPONSE=$(curl -s -X POST "http://192.168.0.151:3151/api/call/vendor-order?vendor_phone=$PHONE&vendor_name=$VENDOR_NAME&order_id=$ORDER_ID&order_amount=$AMOUNT&items=Test%20Order")

if echo "$CALL_RESPONSE" | grep -q '"success":true'; then
    CALL_SID=$(echo "$CALL_RESPONSE" | grep -o '"call_sid":"[^"]*"' | cut -d'"' -f4)
    echo -e "${GREEN}✅ Call initiated successfully!${NC}"
    echo "   CallSid: $CALL_SID"
    echo "   Order ID: $ORDER_ID"
    echo ""
    echo -e "${YELLOW}📞 PHONE SHOULD BE RINGING NOW!${NC}"
    echo ""
    echo "When you pick up, you should hear:"
    echo "  🔊 नमस्ते $VENDOR_NAME! Mangwale से बोल रहे हैं।"
    echo "  🔊 आपको नया ऑर्डर मिला है।"
    echo "  🔊 Order ID $ORDER_ID।"
    echo "  🔊 Amount $AMOUNT रुपये।"
    echo "  🔊 Order accept करने के लिए 1 दबाएं।"
    echo "  🔊 Cancel करने के लिए 2 दबाएं।"
    echo ""
    echo "Test Actions:"
    echo "  • Press 1: Accept order → Hear confirmation → End call"
    echo "  • Press 2: Cancel order → Hear cancellation → End call"
    echo "  • Press 3: Enter processing time → Enter digits → Confirm"
    echo "  • No press: Timeout → End call"
    echo ""
    echo -e "${GREEN}🎉 ALL TESTS PASSED!${NC}"
    echo ""
    echo "View logs:"
    echo "  sudo journalctl -u exotel-caller -f"
else
    echo -e "${RED}❌ Call failed${NC}"
    echo "$CALL_RESPONSE"
    exit 1
fi

# Test 4: Check service logs
echo ""
echo "4️⃣  Recent service logs:"
echo "----------------------------------------"
sudo journalctl -u exotel-caller -n 5 --no-pager | grep -v "HTTP Request"
echo "----------------------------------------"
echo ""

echo -e "${GREEN}✅ Testing complete!${NC}"
echo ""
echo "Useful commands:"
echo "  • Check status: sudo systemctl status exotel-caller"
echo "  • View logs: sudo journalctl -u exotel-caller -f"
echo "  • Restart: sudo systemctl restart exotel-caller"
echo ""
echo "Next steps:"
echo "  • Integrate with Jupiter backend"
echo "  • Add webhook handler for status updates"
echo "  • Implement rider delivery calls"
echo "  • Store recordings in database"
