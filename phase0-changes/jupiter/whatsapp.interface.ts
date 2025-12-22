// File: src/whatsapp/interfaces/whatsapp.interface.ts
// PHASE 0 MODIFICATION: Add audio/voice message support

export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'location' | 'button' | 'image' | 'document' | 'audio' | 'voice';  // ADDED: audio, voice
  
  text?: {
    body: string;
  };
  
  interactive?: {
    type: 'list_reply' | 'button_reply';
    list_reply?: {
      id: string;
      title: string;
    };
    button_reply?: {
      id: string;
      title: string;
    };
  };
  
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  
  // ADDED: Audio message support
  audio?: {
    id: string;           // WhatsApp media ID
    mime_type: string;    // 'audio/ogg; codecs=opus'
  };
}

export interface WhatsAppWebhook {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages?: WhatsAppMessage[];
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

export interface Session {
  phoneNumber: string;
  currentStep: string;
  data: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}
