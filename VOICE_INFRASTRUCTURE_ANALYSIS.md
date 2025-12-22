# Mangwale Voice Infrastructure - Deep Analysis & Recommendations
**Date:** December 19, 2025  
**System:** Mercury (192.168.0.151) + Jupiter (192.168.0.156)

---

## 🎯 Executive Summary

Your voice infrastructure is **well-architected** but has **gaps in configuration management, language-specific agent routing, and zero-latency optimization**. This document provides a comprehensive analysis and actionable recommendations.

---

## 📊 Current Architecture

### **Mercury (192.168.0.151) - Voice Processing**
| Service | Port | Purpose | Provider | GPU | Latency |
|---------|------|---------|----------|-----|---------|
| **ASR** | 7001 | Speech-to-Text | Faster-Whisper large-v3 | RTX 3060 | ~300ms |
| **TTS** | 7002 | Text-to-Speech | Kokoro + Indic-Parler | RTX 3060 | 50-300ms |
| **Orchestrator** | 7000 | Voice Agent | VAD + Turn Taking + LLM | ✓ | - |
| **Exotel Service** | 3100 | Telephony Integration | Exotel API v2.3.0 | - | - |

### **Jupiter (192.168.0.156) - AI Brain**
| Service | Port | Purpose | Details |
|---------|------|---------|---------|
| **NLU** | 7010 | Intent Classification | IndicBERT + fallback chain |
| **vLLM** | 8002 | LLM Inference | Qwen2.5-14B-Instruct-AWQ |
| **Backend** | 3200 | API + Database | NestJS + PostgreSQL |
| **Admin Frontend** | 80 | Management UI | React + Vite |

---

## 🔍 Database Analysis

### **Jupiter PostgreSQL (`headless_mangwale` database)**

#### **Existing Voice Tables:**
```sql
voice_calls              -- ✅ Call tracking (1,395 training samples)
voice_call_stats        -- ✅ Analytics
intent_definitions      -- ✅ NLU intents (15+ intents)
nlu_training_data       -- ✅ 1,395 samples (auto:977, en:252, hi:163, mr:3)
routing_decisions       -- ✅ Model routing logs
```

#### **Multi-Tenant Infrastructure:**
```sql
tenants                 -- ✅ tenant_id: 'mangwale'
tenant_llm_config       -- ✅ Per-tenant LLM settings
tenant_chat_config      -- ✅ Chat widget settings
system_settings         -- ✅ 82 global settings
```

#### **Current Voice Settings in `system_settings`:**
```
asr_provider      = whisper
asr_model         = large-v3
asr_language      = auto
asr-service-url   = http://192.168.0.151:7000

tts_provider      = google
tts_model         = xtts_v2
tts_language      = hi
tts_speed         = 1
tts-service-url   = http://192.168.0.151:8010
```

---

## 🚨 Critical Findings

### **1. No Language-Specific Agent Routing**
**Problem:** All languages use the same configuration. No language-aware agent selection.

**Current Flow:**
```
Customer speaks Hindi → Whisper (Roman script) → Generic LLM → TTS
```

**What's Missing:**
- No Devanagari script support in ASR output
- No Hindi-specific intent models
- No language-based voice selection
- No per-language conversation flows

### **2. Latency Bottlenecks**
**Measured Latencies:**
- ASR (Whisper large-v3): **~300ms**
- NLU (Jupiter): **~200ms** (network + inference)
- LLM (Qwen2.5-14B): **~800ms** (14B model on shared GPU)
- TTS (Kokoro): **~50ms** (English)
- TTS (Indic-Parler): **~300ms** (Hindi/Marathi)

**Total Round-Trip: 1.35-1.65 seconds** ❌

### **3. Missing Configuration Tables**
**No database table for:**
- ❌ `tenant_voice_config` (voice settings per tenant)
- ❌ `voice_agents` (language-specific agents)
- ❌ `voice_providers` (ASR/TTS provider management)
- ❌ `voice_language_config` (per-language routing rules)

### **4. IndicConformer Not Used**
**Issue:** IndicConformer is available but **disabled/not loaded**.
- Hindi/Marathi transcriptions come out in **Roman script** (Hinglish)
- Proper Devanagari output requires IndicConformer
- Current: "kya order karna hai" ❌
- Correct: "क्या ऑर्डर करना है" ✅

### **5. No Real-Time Settings Sync**
- Settings are hardcoded in environment variables
- No WebSocket notifications when settings change
- Services need restart to pick up new configs

---

## 🎯 Recommendations

### **1. Zero-Latency Optimization Strategy**

#### **A. Parallel Processing Pipeline**
```
┌─────────────────────────────────────────────────────┐
│  CURRENT (Sequential):  1.65s total                 │
│  ASR → NLU → LLM → TTS                              │
│  300ms  200ms 800ms 300ms                           │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  OPTIMIZED (Parallel):  ~600ms total               │
│  ┌──────┐                                           │
│  │ ASR  │───┐                                       │
│  │ 150ms│   │                                       │
│  └──────┘   ├──→ NLU ──→ LLM ──→ TTS              │
│              │    100ms   400ms  150ms              │
│  ┌──────┐   │                                       │
│  │ Cache│───┘  (Intent cache)                       │
│  └──────┘                                            │
└─────────────────────────────────────────────────────┘
```

**Actions:**
1. **Switch ASR to large-v3-turbo** (150ms vs 300ms)
2. **Cache common intents** (100ms NLU → <10ms cache hit)
3. **Use Qwen2.5-7B for simple queries** (400ms vs 800ms)
4. **Stream TTS audio** (start playing while generating)

#### **B. Language-Specific Model Selection**
```typescript
const LANGUAGE_MODELS = {
  hi: {
    asr: {
      primary: 'indicconformer_hi',     // Devanagari output
      fallback: 'whisper_large-v3-turbo',
      latency: 180
ms    },
    llm: {
      simple: 'qwen2.5-7b-instruct',     // Fast for ordering
      complex: 'qwen2.5-14b-instruct',   // Deep reasoning
      threshold: 0.7                      // Confidence cutoff
    },
    tts: {
      provider: 'indic-parler',
      voice: 'Divya',                     // Female Hindi voice
      latency: 250ms
    }
  },
  en: {
    asr: { primary: 'whisper_large-v3-turbo', latency: 150ms },
    llm: { simple: 'qwen2.5-7b-instruct', latency: 350ms },
    tts: { provider: 'kokoro', voice: 'af_bella', latency: 50ms }
  },
  mr: {
    asr: { primary: 'indicconformer_mr', latency: 180ms },
    llm: { simple: 'qwen2.5-7b-instruct', latency: 350ms },
    tts: { provider: 'indic-parler', voice: 'Sunita', latency: 250ms }
  }
};
```

#### **C. Intent-Based Agent Routing**
```typescript
// Current: One agent handles all
const agents = {
  'mangwale_assistant': {
    intents: ['*'],  // All intents
    model: 'qwen2.5-14b-instruct',
    latency: 800ms
  }
};

// Recommended: Intent-specific agents
const agents = {
  'order_fast_agent': {
    intents: ['order_food', 'add_to_cart', 'checkout'],
    model: 'qwen2.5-7b-instruct',     // Fast 7B model
    languages: ['hi', 'en', 'mr'],
    latency: 350ms,
    cache_ttl: 300                     // Cache for 5 min
  },
  'tracking_agent': {
    intents: ['track_order', 'order_status'],
    model: 'qwen2.5-7b-instruct',
    db_access: true,                   // Direct DB queries
    latency: 400ms
  },
  'complex_agent': {
    intents: ['complaint', 'refund', 'support_request'],
    model: 'qwen2.5-14b-instruct',    // Deep reasoning
    escalation: true,
    latency: 800ms
  }
};
```

---

### **2. Database Schema - Language-Aware Configuration**

#### **New Table: `tenant_voice_config`**
```sql
CREATE TABLE tenant_voice_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(50) NOT NULL REFERENCES tenants(id),
  
  -- Global voice settings
  default_language VARCHAR(10) DEFAULT 'auto',
  enable_language_detection BOOLEAN DEFAULT true,
  enable_parallel_asr BOOLEAN DEFAULT true,
  
  -- Latency optimization
  cache_intent_results BOOLEAN DEFAULT true,
  cache_ttl_seconds INTEGER DEFAULT 300,
  enable_streaming_tts BOOLEAN DEFAULT true,
  
  -- Quality vs Speed
  quality_preset VARCHAR(20) DEFAULT 'balanced', -- fast, balanced, quality
  
  -- Real-time settings
  enable_websocket_sync BOOLEAN DEFAULT true,
  settings_version INTEGER DEFAULT 1,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_tenant_voice_config UNIQUE(tenant_id)
);
```

#### **New Table: `voice_language_config`**
```sql
CREATE TABLE voice_language_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(50) NOT NULL REFERENCES tenants(id),
  language VARCHAR(10) NOT NULL, -- hi, en, mr, etc.
  
  -- ASR Settings
  asr_provider VARCHAR(50) NOT NULL DEFAULT 'whisper',
  asr_model VARCHAR(100) NOT NULL DEFAULT 'large-v3-turbo',
  asr_enable_diarization BOOLEAN DEFAULT false,
  asr_enable_punctuation BOOLEAN DEFAULT true,
  asr_output_script VARCHAR(20) DEFAULT 'auto', -- devanagari, roman, auto
  
  -- NLU Settings
  nlu_provider VARCHAR(50) DEFAULT 'indicbert',
  nlu_confidence_threshold NUMERIC(3,2) DEFAULT 0.70,
  nlu_fallback_provider VARCHAR(50) DEFAULT 'openai',
  
  -- TTS Settings
  tts_provider VARCHAR(50) NOT NULL DEFAULT 'indic-parler',
  tts_voice VARCHAR(50),
  tts_speed NUMERIC(3,2) DEFAULT 1.0,
  tts_emotion_tags BOOLEAN DEFAULT false,
  
  -- Agent routing
  default_agent_id UUID REFERENCES voice_agents(id),
  
  -- Metadata
  is_enabled BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_tenant_language UNIQUE(tenant_id, language)
);

CREATE INDEX idx_voice_lang_tenant ON voice_language_config(tenant_id);
CREATE INDEX idx_voice_lang_enabled ON voice_language_config(is_enabled);
```

#### **New Table: `voice_agents`**
```sql
CREATE TABLE voice_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(50) NOT NULL REFERENCES tenants(id),
  
  name VARCHAR(100) NOT NULL,
  description TEXT,
  agent_type VARCHAR(50) NOT NULL, -- fast, balanced, complex, specialized
  
  -- Language support
  supported_languages TEXT[] NOT NULL DEFAULT ARRAY['hi', 'en'],
  default_language VARCHAR(10) DEFAULT 'hi',
  
  -- Intent routing
  handled_intents TEXT[] NOT NULL,
  intent_match_mode VARCHAR(20) DEFAULT 'exact', -- exact, fuzzy, any
  
  -- LLM Configuration
  llm_provider VARCHAR(50) NOT NULL DEFAULT 'vllm',
  llm_model VARCHAR(100) NOT NULL,
  llm_temperature NUMERIC(3,2) DEFAULT 0.7,
  llm_max_tokens INTEGER DEFAULT 512,
  llm_system_prompt TEXT,
  
  -- Performance
  target_latency_ms INTEGER,
  enable_caching BOOLEAN DEFAULT true,
  cache_ttl_seconds INTEGER DEFAULT 300,
  
  -- Capabilities
  has_db_access BOOLEAN DEFAULT false,
  has_tool_calling BOOLEAN DEFAULT false,
  can_escalate BOOLEAN DEFAULT false,
  escalation_agent_id UUID REFERENCES voice_agents(id),
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 5,
  usage_count INTEGER DEFAULT 0,
  avg_latency_ms NUMERIC(8,2),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_tenant_agent_name UNIQUE(tenant_id, name)
);

CREATE INDEX idx_voice_agents_tenant ON voice_agents(tenant_id);
CREATE INDEX idx_voice_agents_active ON voice_agents(is_active);
CREATE INDEX idx_voice_agents_intents ON voice_agents USING GIN(handled_intents);
```

#### **New Table: `voice_provider_configs`**
```sql
CREATE TABLE voice_provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(50) NOT NULL REFERENCES tenants(id),
  
  provider_type VARCHAR(20) NOT NULL, -- asr, tts, nlu, llm
  provider_name VARCHAR(50) NOT NULL,
  
  -- Connection
  endpoint_url VARCHAR(500),
  api_key_encrypted TEXT,
  timeout_ms INTEGER DEFAULT 5000,
  
  -- Configuration
  config_json JSONB DEFAULT '{}'::jsonb,
  
  -- Health & Performance
  is_enabled BOOLEAN DEFAULT true,
  is_healthy BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 5,
  avg_latency_ms NUMERIC(8,2),
  error_rate NUMERIC(5,2) DEFAULT 0.0,
  last_health_check TIMESTAMP,
  
  -- Usage
  request_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_tenant_provider UNIQUE(tenant_id, provider_type, provider_name)
);

CREATE INDEX idx_voice_providers_tenant ON voice_provider_configs(tenant_id);
CREATE INDEX idx_voice_providers_type ON voice_provider_configs(provider_type);
CREATE INDEX idx_voice_providers_health ON voice_provider_configs(is_enabled, is_healthy);
```

---

### **3. Seed Data - Default Configuration**

```sql
-- Default tenant voice config
INSERT INTO tenant_voice_config (tenant_id, default_language, quality_preset)
VALUES ('mangwale', 'auto', 'balanced');

-- Hindi language config
INSERT INTO voice_language_config (
  tenant_id, language,
  asr_provider, asr_model, asr_output_script,
  tts_provider, tts_voice
) VALUES (
  'mangwale', 'hi',
  'indicconformer', 'ai4bharat/indicconformer_stt_hi_hybrid_rnnt_large', 'devanagari',
  'indic-parler', 'Divya'
);

-- English language config
INSERT INTO voice_language_config (
  tenant_id, language,
  asr_provider, asr_model,
  tts_provider, tts_voice
) VALUES (
  'mangwale', 'en',
  'whisper', 'large-v3-turbo',
  'kokoro', 'af_bella'
);

-- Fast ordering agent (7B model for speed)
INSERT INTO voice_agents (
  tenant_id, name, agent_type, supported_languages,
  handled_intents, llm_model, target_latency_ms
) VALUES (
  'mangwale', 'Fast Order Agent', 'fast', ARRAY['hi', 'en', 'mr'],
  ARRAY['order_food', 'add_to_cart', 'checkout', 'search_product'],
  'qwen2.5-7b-instruct-awq', 400
);

-- Complex reasoning agent (14B model)
INSERT INTO voice_agents (
  tenant_id, name, agent_type, supported_languages,
  handled_intents, llm_model, can_escalate
) VALUES (
  'mangwale', 'Complex Support Agent', 'complex', ARRAY['hi', 'en', 'mr'],
  ARRAY['complaint', 'refund', 'support_request', 'payment_issue'],
  'qwen2.5-14b-instruct-awq', true
);
```

---

## ❓ Critical Questions

### **1. Language Detection & Routing**
**Q:** Should we auto-detect language or rely on user selection?  
**Recommendation:** **Auto-detect with user override**
- First message: Auto-detect via Whisper
- Store detected language in session
- Allow user to switch: "Switch to English / हिंदी में बदलें"

### **2. Script Preference for Hindi**
**Q:** Devanagari (देवनागरी) or Roman (Hinglish) for Hindi transcripts?  
**Current:** Roman only  
**Recommendation:** **User preference with default Devanagari**
- Admin setting: `asr_output_script = 'devanagari'|'roman'|'auto'`
- Store in user profile
- Most Indians prefer **Hinglish for texting**, **Devanagari for formal**

### **3. Voice Selection Strategy**
**Q:** Fixed voices per language or user customization?  
**Recommendation:** **Default + User Preference**
```javascript
const DEFAULT_VOICES = {
  hi: { male: 'Rohit', female: 'Divya' },
  mr: { male: 'Sanjay', female: 'Sunita' },
  en: { male: 'am_michael', female: 'af_bella' }
};
```

### **4. Intent Confidence Threshold**
**Q:** When to escalate from simple agent to complex agent?  
**Current:** No threshold defined  
**Recommendation:**
- **≥ 0.85:** Fast agent (cached responses)
- **0.60-0.84:** Standard agent
- **< 0.60:** Complex agent OR ask for clarification

### **5. Caching Strategy**
**Q:** What to cache and for how long?  
**Recommendation:**
```typescript
CACHE_CONFIG = {
  intents: {
    enabled: true,
    ttl: 300,  // 5 minutes
    key_format: 'nlu:{tenant}:{text_hash}'
  },
  common_responses: {
    enabled: true,
    ttl: 3600,  // 1 hour
    patterns: ['greeting', 'farewell', 'help']
  },
  tts_audio: {
    enabled: true,
    ttl: 86400,  // 24 hours
    key_format: 'tts:{tenant}:{lang}:{voice}:{text_hash}'
  }
};
```

### **6. Fallback Chain Priority**
**Q:** When primary provider fails, what's the fallback order?  
**Recommendation:**
```
ASR: IndicConformer (Hi/Mr) → Whisper → Deepgram → Fail
TTS: Indic-Parler (Hi/Mr) → Kokoro (En) → ElevenLabs → Fail
NLU: IndicBERT → OpenAI → Heuristic Rules
LLM: vLLM Local → Groq → OpenAI → Error Message
```

---

## 🚀 Implementation Roadmap

### **Phase 1: Database Foundation (Week 1)**
- [ ] Create 4 new tables (voice_config, language_config, agents, providers)
- [ ] Migrate existing `system_settings` to new schema
- [ ] Seed default configurations for Hindi, English, Marathi
- [ ] Create migration scripts

### **Phase 2: Language-Aware Routing (Week 2)**
- [ ] Enable IndicConformer for Hindi/Marathi (Devanagari output)
- [ ] Implement language detection + routing logic
- [ ] Add voice selection per language
- [ ] Create language preference UI

### **Phase 3: Agent System (Week 2-3)**
- [ ] Implement 3 agent types: Fast, Balanced, Complex
- [ ] Intent-based routing with confidence thresholds
- [ ] Agent fallback chain
- [ ] Agent performance tracking

### **Phase 4: Zero-Latency Optimizations (Week 3-4)**
- [ ] Switch to large-v3-turbo (300ms → 150ms)
- [ ] Implement intent result caching (Redis)
- [ ] Add TTS audio streaming
- [ ] Parallel ASR+NLU processing
- [ ] Use 7B model for simple queries (800ms → 350ms)

### **Phase 5: Admin UI (Week 4)**
- [ ] Voice Settings admin page (unified)
- [ ] Language configuration per tenant
- [ ] Agent management interface
- [ ] Provider health monitoring
- [ ] Real-time latency dashboard

### **Phase 6: Real-Time Sync (Week 5)**
- [ ] WebSocket notifications for config changes
- [ ] Zero-downtime config reload
- [ ] A/B testing framework
- [ ] Performance analytics dashboard

---

## 📈 Expected Performance Improvements

| Metric | Current | Optimized | Improvement |
|--------|---------|-----------|-------------|
| **ASR Latency** | 300ms | 150ms | **50% faster** |
| **NLU Latency** | 200ms | 10ms (cached) | **95% faster** |
| **LLM Latency** | 800ms | 350ms (7B) | **56% faster** |
| **TTS Latency** | 300ms | 150ms (streaming) | **50% faster** |
| **Total Round-Trip** | **1.65s** | **0.66s** | **60% faster** |

---

## 🔥 Next Steps

1. **Review this document** - Provide feedback on recommendations
2. **Answer critical questions** - Your business/UX requirements
3. **Prioritize features** - Which optimizations are most critical?
4. **Approve database schema** - Review tables before implementation
5. **Start implementation** - I'll build the system based on your decisions

---

**Questions for you:**

1. **Language Priority:** Hindi first or equal support for all languages?
2. **Script Preference:** Devanagari or Hinglish for Hindi transcripts?
3. **Latency vs Quality:** Is 0.6s acceptable or need <500ms?
4. **Budget:** Can we use cloud APIs (Deepgram/ElevenLabs) for fallback?
5. **Multi-Tenancy:** Will you have multiple tenants or just Mangwale?
6. **Voice Branding:** Custom voices per language or use defaults?

Let me know your decisions and I'll start building! 🚀
