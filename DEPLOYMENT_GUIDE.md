# AI Voice Call System - Deployment Guide

## Overview

This guide covers deploying the enhanced AI Voice Call System for Mangwale, enabling:
- **Vendor Order Confirmation** - AI calls vendor with order details, collects acceptance/rejection
- **Prep Time Collection** - Collects preparation time via DTMF after acceptance
- **Rejection Flow** - Captures rejection reason for analytics
- **Rider Assignment** - AI calls rider with pickup/delivery details

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                      AI VOICE CALL FLOW                               │
├───────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  NEW ORDER      ┌─────────────┐     ┌─────────────┐     ┌──────────┐ │
│  ──────────────►│   JUPITER   │────►│   MERCURY   │────►│  EXOTEL  │ │
│                 │   (Brain)   │     │   (Voice)   │     │  (Cloud) │ │
│                 │  :3200      │     │  :3100      │     │          │ │
│                 └──────┬──────┘     └──────┬──────┘     └────┬─────┘ │
│                        │                   │                  │      │
│                        │ Store result      │ Report result    │ Call │
│                        │◄──────────────────┤◄─────────────────┤      │
│                        │                   │                  │      │
│                        ▼                   │                  │      │
│                 ┌─────────────┐            │           ┌──────┴─────┐│
│                 │ PostgreSQL  │            │           │   VENDOR   ││
│                 │ VoiceCall   │            │           │   PHONE    ││
│                 └─────────────┘            │           └────────────┘│
│                                            │                         │
└───────────────────────────────────────────────────────────────────────┘
```

## Files Created

### Jupiter (Brain - 192.168.0.156)

| File | Purpose |
|------|---------|
| `prisma-voice-call-model.prisma` | Database schema for VoiceCall tracking |
| `jupiter-voice-calls-module/voice-calls.module.ts` | NestJS module configuration |
| `jupiter-voice-calls-module/dto/voice-call.dto.ts` | DTOs and enums |
| `jupiter-voice-calls-module/services/voice-calls.service.ts` | Database operations |
| `jupiter-voice-calls-module/services/voice-call-orchestrator.service.ts` | Business logic |
| `jupiter-voice-calls-module/controllers/voice-calls.controller.ts` | API endpoints |

### Mercury (Voice - 192.168.0.151)

| File | Purpose |
|------|---------|
| `escotel-stack/.../ai-voice.routes.enhanced.js` | Enhanced API routes with Jupiter integration |

### Documentation

| File | Purpose |
|------|---------|
| `AI_VOICE_CALL_ARCHITECTURE.md` | Complete architecture documentation |
| `EXOTEL_IVR_FLOW_CONFIG.md` | IVR flow configuration and TTS templates |
| `DEPLOYMENT_GUIDE.md` | This file |

## Deployment Steps

### Step 1: Deploy Jupiter Voice Calls Module

```bash
# SSH to Jupiter
ssh jupiter

# Navigate to MangwaleAI backend
cd /home/ubuntu/Devs/MangwaleAI/backend

# Copy new module files (from local machine or git)
mkdir -p src/voice-calls/{controllers,services,dto}

# Copy files:
# - voice-calls.module.ts → src/voice-calls/
# - voice-calls.controller.ts → src/voice-calls/controllers/
# - voice-calls.service.ts → src/voice-calls/services/
# - voice-call-orchestrator.service.ts → src/voice-calls/services/
# - voice-call.dto.ts → src/voice-calls/dto/

# Update app.module.ts to import VoiceCallsModule
# Add: import { VoiceCallsModule } from './voice-calls/voice-calls.module';
# Add VoiceCallsModule to imports array

# Update Prisma schema
cat >> prisma/schema.prisma << 'EOF'
// [Append VoiceCall model from prisma-voice-call-model.prisma]
EOF

# Generate Prisma client
npx prisma generate

# Run migration
npx prisma migrate dev --name add_voice_calls

# Restart service
pm2 restart mangwale-api
```

### Step 2: Update Mercury AI Voice Routes

```bash
# SSH to Mercury (or work locally since files are on same machine)
cd /home/ubuntu/mangwale-voice/escotel-stack/exotel-service

# Backup existing routes
cp src/routes/ai-voice.routes.js src/routes/ai-voice.routes.js.backup

# Copy enhanced routes
cp /home/ubuntu/mangwale-voice/escotel-stack/exotel-service/src/routes/ai-voice.routes.enhanced.js \
   src/routes/ai-voice.routes.js

# Set environment variables
export JUPITER_URL=http://192.168.0.156:3200

# Restart service
pm2 restart exotel-service
# OR if using Docker:
docker-compose restart exotel-service
```

### Step 3: Configure Exotel IVR Flow

1. **Login to Exotel Dashboard**: https://my.exotel.com

2. **Create New App Flow**: `VENDOR-ORDER-CONFIRMATION-V2`
   - Use configuration from `EXOTEL_IVR_FLOW_CONFIG.md`

3. **Configure Passthru Applet**:
   - URL: `https://exotel.mangwale.ai/api/ai-voice/ai-callback`
   - Method: GET

4. **Configure Status Callback**:
   - URL: `https://exotel.mangwale.ai/api/ai-voice/ai-callback/status`

5. **Note the App ID** for use in API calls

### Step 4: Test the System

```bash
# Test vendor confirmation call from Mercury
curl -X POST http://192.168.0.151:3100/api/ai-voice/vendor-order-confirmation \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": 99999,
    "vendorId": 1,
    "vendorPhone": "+919XXXXXXXXX",
    "vendorName": "Test Restaurant",
    "customerName": "Test Customer",
    "orderItems": [
      {"name": "Test Item", "quantity": 2, "price": 100}
    ],
    "orderAmount": 200,
    "language": "hi"
  }'

# Check active calls
curl http://192.168.0.151:3100/api/ai-voice/active-calls

# Check Jupiter voice calls
curl http://192.168.0.156:3200/api/voice-calls?limit=5

# Check voice call stats
curl http://192.168.0.156:3200/api/voice-calls/stats
```

## Environment Variables

### Mercury

```bash
# .env
JUPITER_URL=http://192.168.0.156:3200
EXOTEL_SID=sarvinsuppliesllp1
EXOTEL_API_KEY=your_api_key
EXOTEL_API_TOKEN=your_api_token
EXOTEL_CALLER_ID=02048556923
EXOTEL_CALLBACK_URL=https://exotel.mangwale.ai
```

### Jupiter

```bash
# .env
MERCURY_URL=http://192.168.0.151:3100
DATABASE_URL=postgresql://user:pass@localhost:5432/mangwale
```

## API Endpoints

### Jupiter (Brain)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/voice-calls/vendor` | Initiate vendor confirmation call |
| POST | `/api/voice-calls/rider` | Initiate rider assignment call |
| POST | `/api/voice-calls/result` | Receive callback from Mercury |
| GET | `/api/voice-calls` | List voice calls with filters |
| GET | `/api/voice-calls/stats` | Get call statistics |
| GET | `/api/voice-calls/order/:orderId` | Get calls for an order |
| GET | `/api/voice-calls/sid/:callSid` | Get call by Exotel SID |
| POST | `/api/voice-calls/retry/:callSid` | Manual retry trigger |

### Mercury (Voice)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai-voice/vendor-order-confirmation` | Initiate vendor call |
| POST | `/api/ai-voice/rider-assignment` | Initiate rider call |
| GET | `/api/ai-voice/ai-callback` | Exotel Passthru callback |
| POST | `/api/ai-voice/ai-callback/status` | Exotel status callback |
| GET | `/api/ai-voice/active-calls` | List active calls |
| GET | `/api/ai-voice/call/:callSid` | Get call details |

## Monitoring & Troubleshooting

### Check Logs

```bash
# Mercury logs
pm2 logs exotel-service
# OR
docker-compose logs -f exotel-service

# Jupiter logs
ssh jupiter "pm2 logs mangwale-api"
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Exotel callback not received | Check Traefik routing, ensure `exotel.mangwale.ai` resolves correctly |
| Jupiter not receiving results | Check `JUPITER_URL` env var on Mercury |
| Database errors | Run `npx prisma migrate dev` on Jupiter |
| TTS not working | Check TTS service at `:7002` on Mercury |

### Health Checks

```bash
# Mercury health
curl http://192.168.0.151:3100/health

# Jupiter voice-calls health
curl http://192.168.0.156:3200/api/voice-calls/health

# Check Exotel connectivity
curl http://192.168.0.151:3100/health/exotel
```

## Integration with Order Flow

### When New Order is Placed

```typescript
// In Jupiter's order service
async onNewOrder(order: Order) {
  // Get vendor details
  const vendor = await this.vendorService.getVendor(order.vendorId);
  
  // Initiate voice call
  await this.voiceCallOrchestratorService.initiateVendorCall({
    orderId: order.id,
    vendorId: vendor.id,
    vendorPhone: vendor.phone,
    vendorName: vendor.name,
    customerName: order.customerName,
    orderItems: order.items,
    orderAmount: order.totalAmount,
    language: vendor.preferredLanguage || 'hi',
  });
}
```

### When Vendor Accepts

```typescript
// In voice-call-orchestrator.service.ts
async onVendorAccepted(result: VoiceCallResultDto) {
  // Update order status in PHP backend
  await this.phpOrderService.updateOrderStatus(result.orderId, 'confirmed');
  
  // Schedule rider assignment
  await this.scheduleRiderAssignment(result.orderId, result.prepTimeMinutes);
  
  // Notify customer via WhatsApp
  await this.whatsappService.sendOrderConfirmation(result.orderId, result.prepTimeMinutes);
}
```

## Next Steps

1. **Configure Exotel IVR Flow** - Create the flow in Exotel dashboard
2. **Add WhatsApp Fallback** - Send WhatsApp if call fails 3 times
3. **Implement Retry Queue** - Use Bull queue for retry scheduling
4. **Add Analytics Dashboard** - Display call stats in admin UI
5. **Multi-language Support** - Add Marathi and English templates
6. **Rider Assignment Flow** - Implement similar flow for riders
