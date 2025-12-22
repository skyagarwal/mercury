#!/bin/bash

TTS_URL="http://localhost:7002/synthesize"
VENDOR_DIR="/home/ubuntu/mangwale-voice/ivr-audio/vendor"
DRIVER_DIR="/home/ubuntu/mangwale-voice/ivr-audio/driver"

mkdir -p "$VENDOR_DIR" "$DRIVER_DIR"

generate() {
    local file="$1"
    local text="$2"
    echo "Generating: $(basename $file)"
    curl -s --max-time 120 -X POST "$TTS_URL" \
        -H "Content-Type: application/json" \
        -d "{\"text\": \"$text\", \"language\": \"hi\"}" \
        -o "$file"
    if [ -f "$file" ] && [ -s "$file" ]; then
        size=$(ls -lh "$file" | awk '{print $5}')
        echo "  ✓ Done - $size"
    else
        echo "  ✗ FAILED"
    fi
}

echo "=========================================="
echo "  VENDOR IVR AUDIO FILES"
echo "=========================================="

generate "$VENDOR_DIR/V01_greeting.wav" \
    "नमस्ते, आपके लिए नया ऑर्डर है। कन्फर्म के लिए 1। ऐप चेक के लिए 2। कैंसल के लिए 3। दोबारा सुनने के लिए 0 दबाएं।"

generate "$VENDOR_DIR/V02_prep_time.wav" \
    "धन्यवाद! खाना कितने मिनट में तैयार होगा? 15 मिनट के लिए 1। 30 मिनट के लिए 2। 45 मिनट के लिए 3 दबाएं।"

generate "$VENDOR_DIR/V03_confirm_15.wav" \
    "धन्यवाद! राइडर 15 मिनट में आएगा। शुभ दिन!"

generate "$VENDOR_DIR/V04_confirm_30.wav" \
    "धन्यवाद! राइडर 30 मिनट में आएगा। शुभ दिन!"

generate "$VENDOR_DIR/V05_confirm_45.wav" \
    "धन्यवाद! राइडर 45 मिनट में आएगा। शुभ दिन!"

generate "$VENDOR_DIR/V06_check_app.wav" \
    "ठीक है, ऐप चेक करें। 2 मिनट में दोबारा कॉल आएगी।"

generate "$VENDOR_DIR/V07_cancel.wav" \
    "ऑर्डर कैंसल हो गया। धन्यवाद!"

generate "$VENDOR_DIR/V08_no_input.wav" \
    "कोई इनपुट नहीं मिला। कृपया दोबारा कोशिश करें।"

generate "$VENDOR_DIR/V09_invalid.wav" \
    "गलत इनपुट। कृपया 1, 2, या 3 दबाएं।"

echo ""
echo "=========================================="
echo "  DRIVER IVR AUDIO FILES"
echo "=========================================="

generate "$DRIVER_DIR/D01_greeting.wav" \
    "नमस्ते, आपके लिए डिलीवरी है। एक्सेप्ट के लिए 1। रिजेक्ट के लिए 2। दोबारा सुनने के लिए 0 दबाएं।"

generate "$DRIVER_DIR/D02_accept.wav" \
    "धन्यवाद! पिकअप एड्रेस ऐप में है। जल्दी पहुंचें! शुभ दिन!"

generate "$DRIVER_DIR/D03_reject.wav" \
    "ठीक है, दूसरे राइडर को देंगे। धन्यवाद!"

generate "$DRIVER_DIR/D04_no_input.wav" \
    "कोई इनपुट नहीं मिला। दूसरे राइडर को देंगे।"

echo ""
echo "=========================================="
echo "  COMPLETE!"
echo "=========================================="
echo ""
echo "Vendor files:"
ls -lh $VENDOR_DIR/*.wav 2>/dev/null
echo ""
echo "Driver files:"
ls -lh $DRIVER_DIR/*.wav 2>/dev/null

