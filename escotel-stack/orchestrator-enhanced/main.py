"""
🧠 Voice Orchestrator - Conversation Flow Controller
December 2025 - Mangwale Voice Stack

Features:
  - Jupiter LLM integration (vLLM Qwen2.5-7B-AWQ)
  - Streaming LLM responses
  - Function calling for order management
  - Conversation context & memory
  - Intent detection
  - Multi-turn conversation handling
"""

import os
import time
import asyncio
import logging
import json
from typing import Optional, Dict, Any, List, AsyncGenerator
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx

# Logging setup
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class OrchestratorConfig:
    # Internal Services
    asr_url: str = os.getenv("ASR_SERVICE_URL", "http://asr:7001")
    tts_url: str = os.getenv("TTS_SERVICE_URL", "http://tts:7002")
    gateway_url: str = os.getenv("GATEWAY_URL", "http://voice-gateway:8080")
    
    # Jupiter Brain - LLM
    jupiter_url: str = os.getenv("JUPITER_URL", "http://192.168.0.156:3200")
    jupiter_llm_url: str = os.getenv("JUPITER_LLM_URL", "http://192.168.0.156:8002")
    jupiter_nlu_url: str = os.getenv("JUPITER_NLU_URL", "http://192.168.0.156:7010")
    
    # LLM Configuration
    llm_provider: str = os.getenv("LLM_PROVIDER", "jupiter")
    llm_model: str = os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct-AWQ")
    llm_streaming: bool = os.getenv("LLM_STREAMING_ENABLED", "true").lower() == "true"
    llm_max_tokens: int = int(os.getenv("LLM_MAX_TOKENS", "512"))
    llm_temperature: float = float(os.getenv("LLM_TEMPERATURE", "0.7"))
    
    # Conversation
    context_window_size: int = int(os.getenv("CONTEXT_WINDOW_SIZE", "10"))
    enable_function_calling: bool = os.getenv("ENABLE_FUNCTION_CALLING", "true").lower() == "true"
    
    # Fallback
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    fallback_provider: str = os.getenv("LLM_FALLBACK_PROVIDER", "groq")

config = OrchestratorConfig()

# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    session_id: str
    message: str
    language: str = "hi"
    context: Optional[List[Dict[str, str]]] = None
    stream: bool = False

class ChatResponse(BaseModel):
    response: str
    session_id: str
    intent: Optional[str] = None
    entities: Optional[Dict[str, Any]] = None
    function_call: Optional[Dict[str, Any]] = None
    latency_ms: float

class IntentRequest(BaseModel):
    text: str
    language: str = "hi"
    context: Optional[str] = None

class IntentResponse(BaseModel):
    intent: str
    confidence: float
    entities: Dict[str, Any]
    latency_ms: float

# ═══════════════════════════════════════════════════════════════════════════════
# CONVERSATION CONTEXT
# ═══════════════════════════════════════════════════════════════════════════════

class ConversationContext:
    """Manages conversation history and context."""
    
    def __init__(self):
        self.sessions: Dict[str, List[Dict[str, str]]] = {}
    
    def get_context(self, session_id: str) -> List[Dict[str, str]]:
        """Get conversation history for session."""
        return self.sessions.get(session_id, [])
    
    def add_message(self, session_id: str, role: str, content: str):
        """Add message to conversation history."""
        if session_id not in self.sessions:
            self.sessions[session_id] = []
        
        self.sessions[session_id].append({
            "role": role,
            "content": content
        })
        
        # Trim to context window size
        if len(self.sessions[session_id]) > config.context_window_size * 2:
            self.sessions[session_id] = self.sessions[session_id][-config.context_window_size * 2:]
    
    def clear(self, session_id: str):
        """Clear conversation history."""
        if session_id in self.sessions:
            del self.sessions[session_id]

context_manager = ConversationContext()

# ═══════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPTS
# ═══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPTS = {
    "hi": """आप मंगवाले के लिए एक सहायक AI असिस्टेंट हैं। आप हिंदी में बात करते हैं।

आपके कार्य:
- ग्राहकों के ऑर्डर में मदद करना
- विक्रेताओं के साथ ऑर्डर कन्फर्म करना
- राइडर्स को डिलीवरी असाइन करना
- सामान्य पूछताछ का जवाब देना

महत्वपूर्ण निर्देश:
- संक्षिप्त और स्पष्ट उत्तर दें
- अत्यधिक विनम्र रहें
- यदि कुछ समझ न आए तो पूछें
- कभी भी गलत जानकारी न दें""",

    "en": """You are a helpful AI assistant for Mangwale. You speak in English.

Your tasks:
- Help customers with orders
- Confirm orders with vendors
- Assign deliveries to riders
- Answer general queries

Important guidelines:
- Keep responses brief and clear
- Be polite and professional
- Ask for clarification if needed
- Never provide incorrect information""",

    "mr": """तुम्ही मंगवाले साठी एक सहायक AI असिस्टंट आहात। तुम्ही मराठीत बोलता.

तुमची कार्ये:
- ग्राहकांच्या ऑर्डर्समध्ये मदत करणे
- विक्रेत्यांसोबत ऑर्डर कन्फर्म करणे
- रायडर्सना डिलिव्हरी असाइन करणे
- सामान्य प्रश्नांना उत्तर देणे"""
}

FUNCTION_DEFINITIONS = [
    {
        "name": "confirm_order",
        "description": "Confirm an order with the vendor",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string", "description": "Order ID"},
                "accepted": {"type": "boolean", "description": "Whether order is accepted"},
                "prep_time_minutes": {"type": "integer", "description": "Preparation time in minutes"}
            },
            "required": ["order_id", "accepted"]
        }
    },
    {
        "name": "assign_delivery",
        "description": "Assign a delivery to a rider",
        "parameters": {
            "type": "object",
            "properties": {
                "delivery_id": {"type": "string", "description": "Delivery ID"},
                "rider_id": {"type": "string", "description": "Rider ID"},
                "accepted": {"type": "boolean", "description": "Whether delivery is accepted"}
            },
            "required": ["delivery_id", "accepted"]
        }
    },
    {
        "name": "get_order_status",
        "description": "Get the status of an order",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string", "description": "Order ID"}
            },
            "required": ["order_id"]
        }
    }
]

# ═══════════════════════════════════════════════════════════════════════════════
# LLM PROVIDERS
# ═══════════════════════════════════════════════════════════════════════════════

async def call_jupiter_llm(
    messages: List[Dict[str, str]],
    stream: bool = False,
    functions: Optional[List[Dict]] = None
) -> str:
    """Call Jupiter vLLM for chat completion."""
    try:
        async with httpx.AsyncClient() as client:
            payload = {
                "model": config.llm_model,
                "messages": messages,
                "max_tokens": config.llm_max_tokens,
                "temperature": config.llm_temperature,
                "stream": stream
            }
            
            if functions and config.enable_function_calling:
                payload["functions"] = functions
                payload["function_call"] = "auto"
            
            response = await client.post(
                f"{config.jupiter_llm_url}/v1/chat/completions",
                json=payload,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                return result["choices"][0]["message"]["content"]
            else:
                logger.error(f"Jupiter LLM error: {response.text}")
                raise RuntimeError(f"Jupiter LLM error: {response.status_code}")
                
    except Exception as e:
        logger.error(f"Jupiter LLM call failed: {e}")
        raise

async def call_groq_llm(messages: List[Dict[str, str]]) -> str:
    """Fallback to Groq API."""
    if not config.groq_api_key:
        raise RuntimeError("Groq API key not configured")
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {config.groq_api_key}"},
            json={
                "model": "llama-3.1-70b-versatile",
                "messages": messages,
                "max_tokens": config.llm_max_tokens,
                "temperature": config.llm_temperature
            },
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            return result["choices"][0]["message"]["content"]
        else:
            raise RuntimeError(f"Groq API error: {response.text}")

async def generate_response(
    session_id: str,
    message: str,
    language: str,
    context: Optional[List[Dict[str, str]]] = None
) -> str:
    """Generate AI response using LLM."""
    # Build messages
    messages = [
        {"role": "system", "content": SYSTEM_PROMPTS.get(language, SYSTEM_PROMPTS["hi"])}
    ]
    
    # Add conversation context
    if context:
        messages.extend(context[-config.context_window_size:])
    else:
        ctx = context_manager.get_context(session_id)
        messages.extend(ctx[-config.context_window_size:])
    
    # Add current message
    messages.append({"role": "user", "content": message})
    
    # Try primary provider
    try:
        if config.llm_provider == "jupiter":
            response = await call_jupiter_llm(
                messages,
                functions=FUNCTION_DEFINITIONS if config.enable_function_calling else None
            )
        else:
            response = await call_groq_llm(messages)
        
        # Update context
        context_manager.add_message(session_id, "user", message)
        context_manager.add_message(session_id, "assistant", response)
        
        return response
        
    except Exception as e:
        logger.warning(f"Primary LLM failed: {e}, trying fallback...")
        
        # Try fallback
        try:
            response = await call_groq_llm(messages)
            context_manager.add_message(session_id, "user", message)
            context_manager.add_message(session_id, "assistant", response)
            return response
        except Exception as e2:
            logger.error(f"Fallback LLM also failed: {e2}")
            return "मुझे माफ कीजिए, मुझसे जवाब देने में कुछ समस्या हो रही है। कृपया थोड़ी देर बाद प्रयास करें।"

# ═══════════════════════════════════════════════════════════════════════════════
# INTENT DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

async def detect_intent(text: str, language: str) -> Dict[str, Any]:
    """Detect intent from user text."""
    # Simple rule-based intent detection (can be replaced with Jupiter NLU)
    intents = {
        "order_status": ["order status", "ऑर्डर स्टेटस", "कहाँ है", "where is"],
        "confirm_order": ["accept", "confirm", "स्वीकार", "कन्फर्म", "हाँ"],
        "reject_order": ["reject", "cancel", "अस्वीकार", "रद्द", "नहीं"],
        "help": ["help", "मदद", "सहायता", "क्या कर सकते"],
        "greeting": ["hello", "hi", "नमस्ते", "हैलो"],
    }
    
    text_lower = text.lower()
    
    for intent, keywords in intents.items():
        for keyword in keywords:
            if keyword in text_lower:
                return {
                    "intent": intent,
                    "confidence": 0.9,
                    "entities": {}
                }
    
    return {
        "intent": "general",
        "confidence": 0.5,
        "entities": {}
    }

# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION EXECUTION
# ═══════════════════════════════════════════════════════════════════════════════

async def execute_function(function_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a function call."""
    try:
        async with httpx.AsyncClient() as client:
            if function_name == "confirm_order":
                response = await client.post(
                    f"{config.jupiter_url}/api/orders/confirm",
                    json=arguments,
                    timeout=10
                )
            elif function_name == "assign_delivery":
                response = await client.post(
                    f"{config.jupiter_url}/api/deliveries/assign",
                    json=arguments,
                    timeout=10
                )
            elif function_name == "get_order_status":
                response = await client.get(
                    f"{config.jupiter_url}/api/orders/{arguments['order_id']}/status",
                    timeout=10
                )
            else:
                return {"error": f"Unknown function: {function_name}"}
            
            if response.status_code == 200:
                return response.json()
            else:
                return {"error": response.text}
                
    except Exception as e:
        logger.error(f"Function execution failed: {e}")
        return {"error": str(e)}

# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Mangwale Voice Orchestrator",
    description="Conversation Flow Controller with Jupiter LLM Integration",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "mangwale-orchestrator-enhanced",
        "llm_provider": config.llm_provider,
        "jupiter_url": config.jupiter_url,
        "active_sessions": len(context_manager.sessions)
    }

@app.post("/api/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    """
    Main chat endpoint for voice conversations.
    
    Receives user message, generates AI response.
    """
    start_time = time.time()
    
    logger.info(f"Chat request: session={request.session_id}, msg={request.message[:50]}...")
    
    try:
        # Detect intent
        intent_result = await detect_intent(request.message, request.language)
        
        # Generate response
        response_text = await generate_response(
            session_id=request.session_id,
            message=request.message,
            language=request.language,
            context=request.context
        )
        
        latency_ms = (time.time() - start_time) * 1000
        
        logger.info(f"Chat response: session={request.session_id}, latency={latency_ms:.0f}ms")
        
        return ChatResponse(
            response=response_text,
            session_id=request.session_id,
            intent=intent_result.get("intent"),
            entities=intent_result.get("entities"),
            latency_ms=latency_ms
        )
        
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """Streaming chat endpoint for faster first response."""
    # Build messages
    messages = [
        {"role": "system", "content": SYSTEM_PROMPTS.get(request.language, SYSTEM_PROMPTS["hi"])}
    ]
    
    ctx = context_manager.get_context(request.session_id)
    messages.extend(ctx[-config.context_window_size:])
    messages.append({"role": "user", "content": request.message})
    
    async def generate():
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{config.jupiter_llm_url}/v1/chat/completions",
                json={
                    "model": config.llm_model,
                    "messages": messages,
                    "max_tokens": config.llm_max_tokens,
                    "temperature": config.llm_temperature,
                    "stream": True
                },
                timeout=60
            ) as response:
                full_response = ""
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            content = chunk["choices"][0].get("delta", {}).get("content", "")
                            if content:
                                full_response += content
                                yield f"data: {json.dumps({'content': content})}\n\n"
                        except json.JSONDecodeError:
                            pass
                
                # Update context with full response
                context_manager.add_message(request.session_id, "user", request.message)
                context_manager.add_message(request.session_id, "assistant", full_response)
    
    return StreamingResponse(generate(), media_type="text/event-stream")

@app.post("/api/intent")
async def detect_intent_endpoint(request: IntentRequest) -> IntentResponse:
    """Detect intent from text."""
    start_time = time.time()
    
    result = await detect_intent(request.text, request.language)
    
    return IntentResponse(
        intent=result["intent"],
        confidence=result["confidence"],
        entities=result["entities"],
        latency_ms=(time.time() - start_time) * 1000
    )

@app.post("/api/function/{function_name}")
async def execute_function_endpoint(function_name: str, request: Request):
    """Execute a function call."""
    body = await request.json()
    result = await execute_function(function_name, body)
    return result

@app.delete("/api/sessions/{session_id}/context")
async def clear_context(session_id: str):
    """Clear conversation context for a session."""
    context_manager.clear(session_id)
    return {"status": "cleared", "session_id": session_id}

@app.get("/api/sessions/{session_id}/context")
async def get_context(session_id: str):
    """Get conversation context for a session."""
    ctx = context_manager.get_context(session_id)
    return {"session_id": session_id, "messages": ctx, "count": len(ctx)}

@app.get("/metrics")
async def get_metrics():
    """Prometheus-compatible metrics."""
    metrics = [
        f'orchestrator_active_sessions {len(context_manager.sessions)}',
    ]
    return "\n".join(metrics)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7000)
