/**
 * AI Voice Call Result Controller (Jupiter)
 * 
 * Receives call results from Mercury's AI Voice Call system.
 * Updates orders, vendors, riders based on call outcomes.
 * 
 * Endpoints:
 * - POST /api/voice/call-result - Generic call result
 * - POST /api/orders/vendor-confirmed - Vendor accepted order
 * - POST /api/orders/vendor-rejected - Vendor rejected order  
 * - POST /api/orders/rider-accepted - Rider accepted delivery
 * - GET /api/voice/scripts - Get conversation scripts
 * - GET /api/voice/config - Get call configuration
 */

import { Controller, Post, Get, Body, Query, Logger, HttpCode, Param } from '@nestjs/common';
import { OrderOrchestratorService } from '../order-flow/services/order-orchestrator.service';
import { VendorNotificationService } from '../php-integration/services/vendor-notification.service';
import { SessionService } from '../session/session.service';
import { SystemSettingsService } from '../system/services/system-settings.service';

interface CallResultDto {
  callSid: string;
  orderId?: string;
  vendorId?: string;
  riderId?: string;
  callType: string;
  result: {
    accepted?: boolean;
    prepTimeMinutes?: number;
    rejectionReason?: string;
    completed?: boolean;
    status?: string;
    duration?: number;
  };
  duration: number;
  conversationHistory?: Array<{ role: string; content: string }>;
  timestamp: string;
  source: string;
}

interface VendorConfirmationDto {
  orderId: string;
  vendorId?: string;
  accepted: boolean;
  prepTimeMinutes?: number;
  rejectionReason?: string;
  callSid: string;
  duration: number;
  confirmedAt: string;
  source: string;
}

interface RiderAcceptanceDto {
  orderId: string;
  riderId: string;
  accepted: boolean;
  callSid: string;
  duration: number;
  acceptedAt: string;
  source: string;
}

@Controller()
export class AIVoiceCallResultController {
  private readonly logger = new Logger(AIVoiceCallResultController.name);

  constructor(
    private readonly orderOrchestrator: OrderOrchestratorService,
    private readonly vendorNotification: VendorNotificationService,
    private readonly sessionService: SessionService,
    private readonly systemSettings: SystemSettingsService,
  ) {
    this.logger.log('✅ AI Voice Call Result Controller initialized');
  }

  // ===========================================================================
  // CALL RESULT ENDPOINTS
  // ===========================================================================

  /**
   * Generic call result from Mercury
   */
  @Post('api/voice/call-result')
  @HttpCode(200)
  async handleCallResult(@Body() body: CallResultDto) {
    this.logger.log(`📞 Call result received: ${body.callSid}, type: ${body.callType}`);

    try {
      // Store call result in session for tracking
      await this.sessionService.setData(body.callSid, 'call_result', JSON.stringify(body.result));
      await this.sessionService.setData(body.callSid, 'call_duration', body.duration.toString());

      // Route to appropriate handler based on call type
      switch (body.callType) {
        case 'vendor_order_confirmation':
          if (body.orderId) {
            await this.handleVendorOrderResult(body);
          }
          break;

        case 'rider_assignment':
          if (body.orderId && body.riderId) {
            await this.handleRiderAssignmentResult(body);
          }
          break;

        case 'customer_support':
          await this.handleCustomerSupportResult(body);
          break;

        case 'payment_reminder':
          await this.handlePaymentReminderResult(body);
          break;

        case 'feedback_request':
          await this.handleFeedbackResult(body);
          break;

        default:
          this.logger.warn(`Unknown call type: ${body.callType}`);
      }

      return {
        success: true,
        message: 'Call result processed',
        callSid: body.callSid,
      };
    } catch (error: any) {
      this.logger.error(`Failed to process call result: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Vendor confirmed order (from voice call)
   */
  @Post('api/orders/vendor-confirmed')
  @HttpCode(200)
  async handleVendorConfirmed(@Body() body: VendorConfirmationDto) {
    this.logger.log(`✅ Vendor confirmed order ${body.orderId} via voice call`);

    try {
      // Update order status to confirmed
      await this.orderOrchestrator.updateOrderStatus(body.orderId, 'confirmed', {
        confirmedBy: 'voice_call',
        callSid: body.callSid,
        prepTimeMinutes: body.prepTimeMinutes || 30,
        confirmedAt: body.confirmedAt,
      });

      // Calculate expected ready time
      const prepTime = body.prepTimeMinutes || 30;
      const readyAt = new Date(Date.now() + prepTime * 60 * 1000);

      // Trigger next step: Find and assign rider
      await this.vendorNotification.triggerRiderAssignment(body.orderId, readyAt);

      this.logger.log(`Order ${body.orderId} confirmed, prep time: ${prepTime} min`);

      return {
        success: true,
        message: 'Order confirmed successfully',
        orderId: body.orderId,
        prepTimeMinutes: prepTime,
        expectedReadyAt: readyAt.toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`Failed to confirm order: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Vendor rejected order (from voice call)
   */
  @Post('api/orders/vendor-rejected')
  @HttpCode(200)
  async handleVendorRejected(@Body() body: VendorConfirmationDto) {
    this.logger.log(`❌ Vendor rejected order ${body.orderId} via voice call`);

    try {
      // Update order status to rejected
      await this.orderOrchestrator.updateOrderStatus(body.orderId, 'rejected', {
        rejectedBy: 'voice_call',
        callSid: body.callSid,
        rejectionReason: body.rejectionReason || 'Vendor rejected via call',
        rejectedAt: body.confirmedAt,
      });

      // Trigger order reassignment or customer notification
      await this.vendorNotification.handleOrderRejection(body.orderId, body.rejectionReason);

      this.logger.log(`Order ${body.orderId} rejected: ${body.rejectionReason}`);

      return {
        success: true,
        message: 'Order rejection processed',
        orderId: body.orderId,
        rejectionReason: body.rejectionReason,
      };
    } catch (error: any) {
      this.logger.error(`Failed to process rejection: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Rider accepted delivery assignment (from voice call)
   */
  @Post('api/orders/rider-accepted')
  @HttpCode(200)
  async handleRiderAccepted(@Body() body: RiderAcceptanceDto) {
    this.logger.log(`🏍️ Rider ${body.riderId} accepted order ${body.orderId} via voice call`);

    try {
      // Assign rider to order
      await this.orderOrchestrator.assignRider(body.orderId, body.riderId, {
        assignedBy: 'voice_call',
        callSid: body.callSid,
        acceptedAt: body.acceptedAt,
      });

      // Send pickup details to rider via WhatsApp
      await this.vendorNotification.sendRiderPickupDetails(body.orderId, body.riderId);

      this.logger.log(`Rider ${body.riderId} assigned to order ${body.orderId}`);

      return {
        success: true,
        message: 'Rider assigned successfully',
        orderId: body.orderId,
        riderId: body.riderId,
      };
    } catch (error: any) {
      this.logger.error(`Failed to assign rider: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ===========================================================================
  // SCRIPT & CONFIG ENDPOINTS
  // ===========================================================================

  /**
   * Get conversation scripts for Mercury
   */
  @Get('api/voice/scripts')
  async getScripts(
    @Query('callType') callType: string,
    @Query('language') language: string = 'hi',
  ) {
    this.logger.log(`📝 Getting scripts for ${callType} in ${language}`);

    try {
      // Get scripts from database
      const scripts = await this.systemSettings.get(`voice_scripts_${callType}_${language}`);
      
      if (scripts) {
        return {
          success: true,
          callType,
          language,
          scripts: JSON.parse(scripts),
        };
      }

      // Return default scripts if not in database
      return {
        success: true,
        callType,
        language,
        scripts: this.getDefaultScripts(callType, language),
        source: 'default',
      };
    } catch (error: any) {
      this.logger.error(`Failed to get scripts: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get call configuration from database
   */
  @Get('api/voice/config')
  async getCallConfig(@Query('key') key?: string) {
    try {
      if (key) {
        const value = await this.systemSettings.get(key);
        return { success: true, key, value };
      }

      // Return all voice-related settings
      const config = {
        max_call_duration: await this.systemSettings.get('voice_max_duration') || '300',
        retry_attempts: await this.systemSettings.get('voice_retry_attempts') || '3',
        retry_delay_seconds: await this.systemSettings.get('voice_retry_delay') || '120',
        business_hours_start: await this.systemSettings.get('voice_business_start') || '09:00',
        business_hours_end: await this.systemSettings.get('voice_business_end') || '22:00',
        dnd_start: await this.systemSettings.get('voice_dnd_start') || '22:00',
        dnd_end: await this.systemSettings.get('voice_dnd_end') || '08:00',
        default_language: await this.systemSettings.get('voice_default_language') || 'hi',
        enabled: await this.systemSettings.get('voice_enabled') || 'true',
      };

      return { success: true, config };
    } catch (error: any) {
      this.logger.error(`Failed to get config: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  private async handleVendorOrderResult(body: CallResultDto) {
    const { orderId, result, callSid, duration } = body;

    if (result.accepted) {
      await this.handleVendorConfirmed({
        orderId: orderId!,
        accepted: true,
        prepTimeMinutes: result.prepTimeMinutes,
        callSid,
        duration,
        confirmedAt: body.timestamp,
        source: body.source,
      });
    } else {
      await this.handleVendorRejected({
        orderId: orderId!,
        accepted: false,
        rejectionReason: result.rejectionReason,
        callSid,
        duration,
        confirmedAt: body.timestamp,
        source: body.source,
      });
    }
  }

  private async handleRiderAssignmentResult(body: CallResultDto) {
    const { orderId, riderId, result, callSid, duration } = body;

    if (result.accepted) {
      await this.handleRiderAccepted({
        orderId: orderId!,
        riderId: riderId!,
        accepted: true,
        callSid,
        duration,
        acceptedAt: body.timestamp,
        source: body.source,
      });
    } else {
      // Rider rejected, trigger reassignment
      await this.vendorNotification.reassignRider(orderId!, riderId!);
    }
  }

  private async handleCustomerSupportResult(body: CallResultDto) {
    this.logger.log(`Customer support call completed: ${body.callSid}`);
    // Store conversation history for analysis
  }

  private async handlePaymentReminderResult(body: CallResultDto) {
    this.logger.log(`Payment reminder call completed: ${body.callSid}`);
    // Track payment reminder outcome
  }

  private async handleFeedbackResult(body: CallResultDto) {
    this.logger.log(`Feedback call completed: ${body.callSid}`);
    // Store feedback from voice call
  }

  private getDefaultScripts(callType: string, language: string) {
    const defaults: Record<string, Record<string, Record<string, string>>> = {
      vendor_order_confirmation: {
        hi: {
          greeting: 'नमस्ते, यह मंगवाले से कॉल है।',
          order_details: 'आपकी दुकान के लिए एक नया ऑर्डर आया है।',
          confirmation_prompt: 'स्वीकार करने के लिए 1 दबाएं, अस्वीकार के लिए 2 दबाएं।',
          accepted: 'धन्यवाद! ऑर्डर स्वीकार हो गया।',
          rejected: 'ऑर्डर अस्वीकार हो गया।',
          goodbye: 'धन्यवाद। शुभ दिन!',
        },
        en: {
          greeting: 'Hello, this is Mangwale calling.',
          order_details: 'You have a new order for your store.',
          confirmation_prompt: 'Press 1 to accept, 2 to reject.',
          accepted: 'Thank you! Order accepted.',
          rejected: 'Order rejected.',
          goodbye: 'Thank you. Have a great day!',
        },
      },
      rider_assignment: {
        hi: {
          greeting: 'नमस्ते, आपके लिए नई डिलीवरी है।',
          details: 'पिकअप और डिलीवरी का पता व्हाट्सएप पर भेजा गया है।',
          confirmation_prompt: 'स्वीकार के लिए 1 दबाएं।',
          accepted: 'धन्यवाद! डिलीवरी स्वीकार हो गई।',
          goodbye: 'शुभ दिन!',
        },
        en: {
          greeting: 'Hello, you have a new delivery.',
          details: 'Pickup and delivery address sent to WhatsApp.',
          confirmation_prompt: 'Press 1 to accept.',
          accepted: 'Thank you! Delivery accepted.',
          goodbye: 'Have a good day!',
        },
      },
    };

    return defaults[callType]?.[language] || defaults[callType]?.['en'] || {};
  }
}
