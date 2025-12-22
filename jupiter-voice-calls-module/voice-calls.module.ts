import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VoiceCallsController } from './controllers/voice-calls.controller';
import { VoiceCallsService } from './services/voice-calls.service';
import { VoiceCallOrchestratorService } from './services/voice-call-orchestrator.service';
import { DatabaseModule } from '../database/database.module';
import { PhpIntegrationModule } from '../php-integration/php-integration.module';
import { ExotelModule } from '../exotel/exotel.module';

/**
 * VoiceCallsModule - AI Voice Call Management (Jupiter - Brain)
 * 
 * This module handles:
 * - Initiating AI voice calls to vendors/riders
 * - Receiving call results from Mercury (voice server)
 * - Storing call outcomes in PostgreSQL
 * - Triggering follow-up actions (assign rider, find alternate vendor)
 * 
 * Architecture:
 * ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
 * │   Jupiter    │◄────►│   Mercury    │◄────►│   Exotel     │
 * │   (Brain)    │      │   (Voice)    │      │   (Cloud)    │
 * │              │      │              │      │              │
 * │ - Initiate   │      │ - Call API   │      │ - IVR        │
 * │ - Track      │      │ - TTS        │      │ - Passthru   │
 * │ - Act        │      │ - Callbacks  │      │ - Recording  │
 * └──────────────┘      └──────────────┘      └──────────────┘
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 30000, // 30 second timeout
      maxRedirects: 5,
    }),
    DatabaseModule,
    PhpIntegrationModule, // For order/vendor/rider data
    ExotelModule,         // For calling Mercury
  ],
  controllers: [VoiceCallsController],
  providers: [
    VoiceCallsService,
    VoiceCallOrchestratorService,
  ],
  exports: [VoiceCallsService, VoiceCallOrchestratorService],
})
export class VoiceCallsModule {}
