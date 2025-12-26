# Exotel Callback JSON Response Format Guide

## Problem Found

Your current implementation returns **ExoML (XML)** which Exotel ignores.

**Exotel expects:**
- **Gather Applet** → JSON response
- **Connect Applet** → JSON response  
- **Passthru Applet** → HTTP status code (200, 302) only

---

## Gather Applet Response Format

### Full Response Example

```json
{
  "gather_prompt": {
    "text": "Press 1 to confirm order. Press 2 to cancel."
  },
  "max_input_digits": 1,
  "finish_on_key": "#",
  "input_timeout": 6,
  "repeat_menu": 1,
  "repeat_gather_prompt": {
    "text": "I didn't hear that. Press 1 or 2."
  }
}
```

### Parameter Definitions

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `gather_prompt` | Object | **Yes** | — | Text or audio to play |
| `gather_prompt.text` | String | (if not audio_url) | — | TTS text to play |
| `gather_prompt.audio_url` | String | (if not text) | — | Audio file URL (HTTP/HTTPS) |
| `max_input_digits` | Integer | No | 255 | Max digits before auto-finish |
| `finish_on_key` | String | No | "#" | Key to end input (#, *, 0-9, or "") |
| `input_timeout` | Integer | No | 5s | Seconds between keypresses |
| `repeat_menu` | Integer | No | 0 | Times to repeat if no input |
| `repeat_gather_prompt` | Object | No | (same as gather_prompt) | Text/audio for retry |

---

## Call Flow Examples

### Example 1: Simple Order Confirmation

**Step 1: Initial Gather** (User lands on app)
```json
{
  "gather_prompt": {
    "text": "Thank you for calling. Press 1 to confirm your order. Press 2 to cancel."
  },
  "max_input_digits": 1,
  "finish_on_key": "#",
  "input_timeout": 6
}
```

**Step 2: Process Digit 1** (User presses 1)
Exotel calls: `/api/nerve/callback?CallSid=ABC&digits="1"`

Your response (confirmation):
```json
{
  "gather_prompt": {
    "text": "Order confirmed. Thank you!"
  }
}
```

*(No max_input_digits = no more input, just play and hang up)*

---

### Example 2: Prep Time Selection

**Step 1: Initial Gather**
```json
{
  "gather_prompt": {
    "text": "Your order is ready. Press 1 for pickup now. Press 2 for 30 minutes. Press 3 for 1 hour."
  },
  "max_input_digits": 1,
  "finish_on_key": "",
  "input_timeout": 10
}
```

**Step 2: Process Digit 2** (User presses 2)
Exotel calls: `/api/nerve/callback?CallSid=ABC&digits="2"`

Your response:
```json
{
  "gather_prompt": {
    "text": "Prep time set to 30 minutes. Thank you!"
  }
}
```

---

### Example 3: Multiple Attempts (With Repeat)

```json
{
  "gather_prompt": {
    "text": "Press 1 to confirm. Press 2 to speak with an agent."
  },
  "max_input_digits": 1,
  "finish_on_key": "",
  "input_timeout": 5,
  "repeat_menu": 2,
  "repeat_gather_prompt": {
    "text": "I didn't hear that. Please press 1 or 2."
  }
}
```

**Flow:**
1. Plays: "Press 1 to confirm. Press 2 to speak with an agent."
2. Waits 5s for input
3. If no input: Plays: "I didn't hear that. Please press 1 or 2."
4. Waits 5s for input (repeat #1)
5. If no input: Plays: "I didn't hear that. Please press 1 or 2."
6. Waits 5s (repeat #2)
7. If still no input: Disconnects

---

## Exotel Request to Your Callback

When user presses a digit, Exotel calls your URL like:

```
GET https://exotel.mangwale.ai/api/nerve/callback?
  CallSid=abc123def456
  &CallFrom=919923383838
  &CallTo=02048556923
  &digits="1"
  &CustomField={"order_id":123}
  &CallStatus=in-progress
```

**Important:** The `digits` parameter comes with double quotes!

```python
# In your handler:
digits = request.query_params.get("digits", "").strip('"')  # Remove quotes!
```

---

## Exotel Timeout Behavior

| Scenario | Timeout | Exotel Action |
|----------|---------|---------------|
| URL doesn't respond | 5s | Fallback URL (if set), else disconnect |
| User doesn't press digit | `input_timeout` | Repeat gather_prompt (if repeat_menu > 0) |
| All retries exhausted | — | Disconnect call |
| User presses finish_on_key | Immediate | Call your URL with digit |
| User presses max_input_digits | Immediate | Call your URL with all digits |

---

## Python Implementation Template

```python
from fastapi import FastAPI, Request, Query
from fastapi.responses import JSONResponse

app = FastAPI()

@app.get("/api/nerve/callback")
async def gather_callback(
    request: Request,
    CallSid: str = Query(None),
    digits: str = Query(None),
    CustomField: str = Query(None),
    CallStatus: str = Query(None)
):
    # Remove quotes from digits
    digit = digits.strip('"') if digits else None
    
    # Log the callback
    print(f"CallSid={CallSid}, digit={digit}, status={CallStatus}")
    
    # Parse custom field
    call_context = {}
    if CustomField:
        import json
        call_context = json.loads(CustomField)
    
    # Decide next action based on digit
    if digit == "1":
        # User confirmed
        next_response = {
            "gather_prompt": {
                "text": "Order confirmed. Your delivery will arrive shortly."
            }
        }
    elif digit == "2":
        # User wants to set prep time
        next_response = {
            "gather_prompt": {
                "text": "Press 1 for 15 minutes. Press 2 for 30 minutes. Press 3 for 1 hour."
            },
            "max_input_digits": 1,
            "finish_on_key": "",
            "input_timeout": 10
        }
    else:
        # Invalid digit or no digit yet
        next_response = {
            "gather_prompt": {
                "text": "I didn't understand that. Press 1 to confirm or 2 for other options."
            },
            "max_input_digits": 1,
            "finish_on_key": "",
            "input_timeout": 6,
            "repeat_menu": 1
        }
    
    return JSONResponse(content=next_response)
```

---

## Testing Your Callback Manually

```bash
# Simulate initial call
curl "https://exotel.mangwale.ai/api/nerve/callback?CallSid=test123&CallFrom=919923383838&CallTo=02048556923" | jq .

# Simulate user pressing 1
curl "https://exotel.mangwale.ai/api/nerve/callback?CallSid=test123&digits=\"1\"&CustomField={\"order_id\":123}" | jq .

# Simulate user pressing 2
curl "https://exotel.mangwale.ai/api/nerve/callback?CallSid=test123&digits=\"2\"&CustomField={\"order_id\":123}" | jq .
```

---

## Validation Checklist

Before deploying:

- [ ] Response is valid JSON (not XML)
- [ ] `gather_prompt` contains either `text` or `audio_url` (not both)
- [ ] HTTP 200 OK returned
- [ ] Content-Type is `application/json`
- [ ] No ExoML/XML tags in response
- [ ] `finish_on_key` is empty string, single digit, "*", or "#"
- [ ] `input_timeout` is between 1-60 seconds
- [ ] `repeat_menu` is 0 or positive integer

---

## Exotel Applet → Response Mapping

| Applet Type | Calls Your URL | Response Format | Use Case |
|-------------|---|---|---|
| **Gather** | GET (before & after input) | JSON | Collect DTMF from user |
| **Connect** | GET (when connecting) | JSON | Decide destination number |
| **Passthru** | GET (async) | HTTP 200/302 | Logging only (no response used) |
| **Voicebot** | POST (stream metadata) | JSON | Voice AI flows |

---

## Common Mistakes

❌ **Returning ExoML (XML):**
```xml
<?xml version="1.0"?>
<Response>
  <Say voice="Aditi">Press 1</Say>
</Response>
```

✅ **Return JSON instead:**
```json
{
  "gather_prompt": {
    "text": "Press 1"
  }
}
```

---

❌ **Not handling digits parameter quotes:**
```python
digit = request.query_params.get("digits")  # Returns "1" with quotes!
```

✅ **Strip the quotes:**
```python
digit = request.query_params.get("digits", "").strip('"')  # Returns 1 cleanly
```

---

❌ **Setting both finish_on_key AND max_input_digits but expecting sequential input:**
```json
{
  "max_input_digits": 5,
  "finish_on_key": "#"
}
```

✅ **Whichever happens first wins:**
- User presses 5 digits → instant callback (max_input_digits reached)
- User presses "#" → instant callback (finish_on_key pressed)
- Timeout → repeat or disconnect
