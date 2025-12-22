# Chotu Chatbot Persona Integration

## Overview
Integrate Chotu voice character as the chatbot personality for all text-based interactions (WhatsApp, Telegram, Web Chat, SMS).

## Architecture Changes

### 1. Database Schema (Already Exists ✅)
- VoiceCharacter table has all persona data
- Chotu character already seeded with personality, traits

### 2. Backend Integration Points

#### A. Add Persona Field to Settings
**Table:** `system_settings`
**New Setting:**
```sql
INSERT INTO system_settings (key, value, description, category)
VALUES (
  'active_chatbot_persona',
  'chotu',
  'Active voice character persona for chatbot interactions',
  'ai'
);
```

#### B. Extend VoiceCharactersService
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/voice-characters/voice-characters.service.ts`

Add method to generate system prompt from character:
```typescript
async generateSystemPromptForCharacter(characterName: string): Promise<string> {
  const character = await this.findCharacterByName(characterName);
  
  if (!character) {
    return null;
  }
  
  const personality = character.personality as any;
  const traits = character.traits.join(', ');
  
  return `You are ${character.displayName}.

Personality:
- Background: ${personality.background}
- Style: ${personality.style}
- Traits: ${traits}

Description: ${character.description}

Voice and Tone:
- Speak as ${character.name} would speak
- Be ${traits.toLowerCase()}
- Match the personality described above
- Use simple, clear language appropriate for ${personality.background}

Remember: You ARE ${character.displayName}, not just an AI assistant. Respond in character.`;
}
```

#### C. Update AgentOrchestratorService
**File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/agents/services/agent-orchestrator.service.ts`

1. Inject VoiceCharactersService:
```typescript
constructor(
  // ... existing services
  @Inject(forwardRef(() => VoiceCharactersService))
  private readonly voiceCharactersService: VoiceCharactersService,
) {}
```

2. Update system prompt generation (around line 1195):
```typescript
// Fetch active persona
const activePersona = await this.settingsService.getSetting('active_chatbot_persona', 'chotu');

// Generate persona-based system prompt
let personaPrompt = '';
if (activePersona && activePersona !== 'none') {
  personaPrompt = await this.voiceCharactersService.generateSystemPromptForCharacter(activePersona);
}

// Fetch dynamic system prompt from settings (or use default)
let systemPrompt = await this.settingsService.getSetting('system-prompt', defaultSystemPrompt);

// Prepend persona if exists
if (personaPrompt) {
  systemPrompt = `${personaPrompt}\n\n---\n\n${systemPrompt}`;
}
```

#### D. Add Persona Formatting Service
**New File:** `/home/ubuntu/Devs/MangwaleAI/backend/src/voice-characters/services/persona-formatter.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';

interface VoiceCharacter {
  name: string;
  displayName: string;
  personality: any;
  traits: string[];
}

@Injectable()
export class PersonaFormatterService {
  private readonly logger = new Logger(PersonaFormatterService.name);

  /**
   * Format response to match character's speaking style
   */
  formatResponse(text: string, character: VoiceCharacter): string {
    const traits = character.traits;
    
    // Chotu-specific formatting
    if (character.name === 'chotu') {
      return this.formatChotuResponse(text);
    }
    
    // Meena-specific formatting
    if (character.name === 'meena') {
      return this.formatMeenaResponse(text);
    }
    
    return text;
  }
  
  private formatChotuResponse(text: string): string {
    // Add Hindi endearments occasionally
    const endearments = ['जी', 'भाई साहब', 'दीदी'];
    
    // Make more conversational and humble
    let formatted = text;
    
    // Add helpful phrases
    if (text.includes('?')) {
      // Questions become more polite
      formatted = formatted.replace('Can I', 'क्या मैं');
      formatted = formatted.replace('Do you', 'क्या आप');
    }
    
    return formatted;
  }
  
  private formatMeenaResponse(text: string): string {
    // Professional but warm tone
    return text;
  }
  
  /**
   * Suggest appropriate emotion for response
   */
  suggestEmotion(text: string, character: VoiceCharacter): string | null {
    const emotions = character.emotionPresets || [];
    
    // Simple emotion detection
    if (text.includes('sorry') || text.includes('apologize') || text.includes('माफ')) {
      return 'apologetic';
    }
    
    if (text.includes('!') || text.includes('great') || text.includes('wonderful')) {
      return 'excited';
    }
    
    if (text.includes('thank') || text.includes('धन्यवाद')) {
      return 'sweet';
    }
    
    return null; // Use default
  }
}
```

### 3. Admin UI Enhancement

#### A. Add Persona Selector to Settings Page
**File:** `/home/ubuntu/Devs/MangwaleAI/frontend/src/app/admin/settings/page.tsx`

Add section:
```tsx
<div className="setting-group">
  <h3>Chatbot Persona</h3>
  <select
    value={settings.active_chatbot_persona}
    onChange={(e) => updateSetting('active_chatbot_persona', e.target.value)}
  >
    <option value="none">No Persona (Generic AI)</option>
    <option value="chotu">Chotu - The Helpful Assistant</option>
    <option value="meena">Meena - The Friendly Guide</option>
  </select>
  <p>Active voice character persona for all chat interactions</p>
</div>
```

#### B. Add Persona Preview to Voice Characters Page
Show how character will behave in chat vs voice.

### 4. Testing Changes

#### Test Cases:

**Test 1: Chotu Persona in WhatsApp**
```
User: "मुझे चावल चाहिए"
Expected: Response should be in Chotu's style - helpful, innocent, polite
Actual Chotu: "जी, बिल्कुल! मैं आपके लिए चावल ढूंढता हूं। कितना किलो चाहिए?"
Generic AI: "Sure, I can help you find rice. How much do you need?"
```

**Test 2: Meena Persona in Web Chat**
```
User: "What are your delivery charges?"
Expected: Professional, clear, confident
Actual Meena: "Good question! Our delivery charges vary by distance. For orders under ₹500, it's ₹30. Free above ₹500. Would you like to place an order?"
Generic AI: "Delivery charges are ₹30 for orders under ₹500."
```

**Test 3: No Persona (Generic)**
```
Setting: active_chatbot_persona = "none"
Expected: Standard professional AI responses
```

### 5. Migration Plan

**Phase 1 (Today):**
- Add system_settings entry for active_chatbot_persona
- Add generateSystemPromptForCharacter() method
- Test with Chotu

**Phase 2 (Tomorrow):**
- Add PersonaFormatterService
- Integrate persona-based response formatting
- Test on multiple platforms

**Phase 3 (Next Week):**
- Add admin UI controls
- Analytics: Track persona engagement
- A/B testing: Persona vs No Persona

### 6. Benefits

**For Users:**
- Consistent personality across voice and text
- More engaging, human-like interactions
- Cultural familiarity (Chotu is relatable in Indian context)

**For Business:**
- Brand personality (Chotu becomes the face of Mangwale)
- Better user engagement (personas increase retention)
- Emotional connection (users remember Chotu)

**For Development:**
- Reuse existing voice character database
- Single source of truth for personality
- Easy to add new characters

### 7. Advanced Features (Future)

**A. Context-Aware Persona Switching**
```typescript
// Serious complaint → Switch to Meena (professional)
// Casual order → Chotu (friendly)
// Late night → Sleepy Chotu variant
```

**B. Persona Memory**
```typescript
// "Remember me? I ordered from you yesterday"
// Chotu: "हां भाई साहब! आपने कल चावल मंगवाया था ना? आज क्या चाहिए?"
```

**C. Voice + Text Consistency**
```typescript
// If user sends voice message, reply with Chotu voice
// If user sends text, reply with Chotu personality in text
// Seamless experience
```

---

## Implementation Files

See next sections for actual code to add.

