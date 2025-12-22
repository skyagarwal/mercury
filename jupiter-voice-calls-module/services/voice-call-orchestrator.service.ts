import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { VoiceCallsService } from './voice-calls.service';
import { ExotelService } from '../../exotel/services/exotel.service';
import {
  CallType,
  CallStatus,
  InitiateVendorCallDto,
  InitiateRiderCallDto,
  VoiceCallResultDto,
  CallInitiationResponseDto,
} from '../dto/voice-call.dto';

/**
 * VoiceCallOrchestratorService - Business logic for voice call automation
 * 
 * This service:
 * - Initiates calls via Mercury (Exotel service)
 * - Handles callbacks and triggers follow-up actions
 * - Manages retry logic
 * - Coordinates with order/vendor/rider systems
 * 
 * Flow:
 * 1. New order → initiateVendorCall()
 * 2. Vendor accepts → scheduleRiderCall() 
 * 3. Vendor rejects → findAlternateVendor()
 * 4. No response → retryCall()
 */
@Injectable()
export class VoiceCallOrchestratorService {
  private readonly logger = new Logger(VoiceCallOrchestratorService.name);
  
  // Mercury voice server URL
  private readonly mercuryUrl: string;
  
  // Exotel caller ID
  private readonly callerId: string;
  
  // Retry configuration
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 30000; // 30 seconds
  private readonly busyRetryDelayMs = 60000; // 1 minute

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly voiceCallsService: VoiceCallsService,
    private readonly exotelService: ExotelService,
  ) {
    this.mercuryUrl = this.configService.get('MERCURY_URL', 'http://192.168.0.151:3100');
    this.callerId = this.configService.get('EXOTEL_CALLER_ID', '02048556923');
    
    this.logger.log(`✅ VoiceCallOrchestratorService initialized`);
    this.logger.log(`   Mercury URL: ${this.mercuryUrl}`);
    this.logger.log(`   Caller ID: ${this.callerId}`);
  }

  /**
   * Initiate vendor order confirmation call
   * 
   * Called when:
   * - New order is placed and assigned to vendor
   * - Retry after no response
   * 
   * @param data - Vendor and order details
   */
  async initiateVendorCall(data: InitiateVendorCallDto): Promise<CallInitiationResponseDto> {
    try {
      this.logger.log(`📞 Initiating vendor call: Order #${data.orderId} → ${data.vendorName}`);
      this.logger.log(`   Phone: ${data.vendorPhone}`);
      this.logger.log(`   Items: ${data.orderItems.length}`);
      this.logger.log(`   Amount: ₹${data.orderAmount}`);

      // Call Mercury's AI Voice Call API
      const response = await firstValueFrom(
        this.httpService.post(`${this.mercuryUrl}/api/ai-voice/vendor-order-confirmation`, {
          orderId: data.orderId,
          vendorId: data.vendorId,
          vendorPhone: data.vendorPhone,
          vendorName: data.vendorName,
          customerName: data.customerName || 'Customer',
          orderItems: data.orderItems,
          orderAmount: data.orderAmount,
          language: data.language || 'hi',
          callbackUrl: `${this.configService.get('BASE_URL', 'http://localhost:3200')}/api/voice-calls/result`,
        }, {
          timeout: 30000,
        }),
      );

      const result = response.data;

      if (result.success && result.callSid) {
        // Create tracking record in our database
        await this.voiceCallsService.createVoiceCall({
          exotelCallSid: result.callSid,
          callType: CallType.VENDOR_ORDER_CONFIRMATION,
          fromNumber: this.callerId,
          toNumber: data.vendorPhone,
          toName: data.vendorName,
          orderId: data.orderId,
          vendorId: data.vendorId,
          orderDetails: { items: data.orderItems },
          orderAmount: data.orderAmount,
        });

        this.logger.log(`✅ Vendor call initiated: ${result.callSid}`);

        return {
          success: true,
          callId: result.callSid,
          exotelCallSid: result.callSid,
          status: 'initiated',
        };
      } else {
        this.logger.warn(`⚠️ Mercury returned failure: ${result.error}`);
        return {
          success: false,
          error: result.error || 'Failed to initiate call',
        };
      }
    } catch (error: any) {
      this.logger.error(`❌ Failed to initiate vendor call: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Initiate rider assignment call
   * 
   * Called when:
   * - Vendor accepts order
   * - Need to assign delivery rider
   */
  async initiateRiderCall(data: InitiateRiderCallDto): Promise<CallInitiationResponseDto> {
    try {
      this.logger.log(`🏍️ Initiating rider call: Order #${data.orderId} → ${data.riderName}`);

      const response = await firstValueFrom(
        this.httpService.post(`${this.mercuryUrl}/api/ai-voice/rider-assignment`, {
          orderId: data.orderId,
          riderId: data.riderId,
          riderPhone: data.riderPhone,
          riderName: data.riderName,
          restaurantName: data.restaurantName,
          restaurantAddress: data.restaurantAddress,
          pickupTimeMinutes: data.pickupTimeMinutes,
          customerName: data.customerName,
          deliveryAddress: data.deliveryAddress,
          callbackUrl: `${this.configService.get('BASE_URL')}/api/voice-calls/result`,
        }),
      );

      const result = response.data;

      if (result.success && result.callSid) {
        await this.voiceCallsService.createVoiceCall({
          exotelCallSid: result.callSid,
          callType: CallType.RIDER_ASSIGNMENT,
          fromNumber: this.callerId,
          toNumber: data.riderPhone,
          toName: data.riderName,
          orderId: data.orderId,
          riderId: data.riderId,
          orderDetails: {
            restaurantName: data.restaurantName,
            restaurantAddress: data.restaurantAddress,
            pickupTimeMinutes: data.pickupTimeMinutes,
          },
        });

        return {
          success: true,
          callId: result.callSid,
          exotelCallSid: result.callSid,
          status: 'initiated',
        };
      }

      return { success: false, error: result.error };
    } catch (error: any) {
      this.logger.error(`❌ Failed to initiate rider call: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle call result callback from Mercury
   * 
   * This is called when:
   * - Vendor accepts (digit 1)
   * - Vendor rejects (digit 0)
   * - Prep time entered (digits + #)
   * - Call fails/no response
   */
  async handleCallResult(result: VoiceCallResultDto): Promise<{
    success: boolean;
    action?: string;
    nextStep?: string;
  }> {
    try {
      this.logger.log(`📥 Processing call result: ${result.callSid}`);
      this.logger.log(`   Type: ${result.callType}`);
      this.logger.log(`   Status: ${result.status}`);
      this.logger.log(`   Digits: ${result.digits || 'none'}`);

      // Update database record
      await this.voiceCallsService.updateCallResult(result);

      // Determine next action based on result
      let action: string;
      let nextStep: string | undefined;

      switch (result.status) {
        case CallStatus.ACCEPTED:
          action = 'ORDER_ACCEPTED';
          nextStep = 'COLLECT_PREP_TIME';
          this.logger.log(`✅ Order ${result.orderId} ACCEPTED by vendor`);
          await this.onVendorAccepted(result);
          break;

        case CallStatus.PREP_TIME_SET:
          action = 'PREP_TIME_COLLECTED';
          nextStep = 'ASSIGN_RIDER';
          this.logger.log(`✅ Prep time set: ${result.prepTimeMinutes} mins for order ${result.orderId}`);
          await this.onPrepTimeSet(result);
          break;

        case CallStatus.REJECTED:
          action = 'ORDER_REJECTED';
          nextStep = 'FIND_ALTERNATE_VENDOR';
          this.logger.log(`❌ Order ${result.orderId} REJECTED: ${result.rejectionReason}`);
          await this.onVendorRejected(result);
          break;

        case CallStatus.NO_RESPONSE:
          action = 'NO_RESPONSE';
          nextStep = await this.handleNoResponse(result);
          break;

        case CallStatus.BUSY:
          action = 'LINE_BUSY';
          nextStep = await this.handleBusy(result);
          break;

        case CallStatus.FAILED:
          action = 'CALL_FAILED';
          nextStep = 'NOTIFY_SUPPORT';
          this.logger.error(`❌ Call failed for order ${result.orderId}: ${result.errorMessage}`);
          await this.onCallFailed(result);
          break;

        default:
          action = 'UNKNOWN';
          this.logger.warn(`Unknown call status: ${result.status}`);
      }

      return {
        success: true,
        action,
        nextStep,
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to handle call result: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Called when vendor accepts order
   */
  private async onVendorAccepted(result: VoiceCallResultDto): Promise<void> {
    // If we don't have prep time yet, the IVR will collect it
    // If prep time is already set, proceed to rider assignment
    if (result.prepTimeMinutes) {
      await this.scheduleRiderAssignment(result.orderId!, result.prepTimeMinutes);
    }
    
    // TODO: Update order status in PHP backend
    // await this.updateOrderStatus(result.orderId, 'confirmed');
    
    // TODO: Send WhatsApp notification to customer
    // await this.notifyCustomer(result.orderId, 'Your order has been accepted!');
  }

  /**
   * Called when prep time is collected
   */
  private async onPrepTimeSet(result: VoiceCallResultDto): Promise<void> {
    const prepTime = result.prepTimeMinutes || 30;
    
    // Schedule rider assignment
    await this.scheduleRiderAssignment(result.orderId!, prepTime);
    
    // TODO: Update PHP backend with prep time
    // await this.updateOrderPrepTime(result.orderId, prepTime);
    
    this.logger.log(`🏍️ Rider assignment scheduled for ${prepTime} mins`);
  }

  /**
   * Called when vendor rejects order
   */
  private async onVendorRejected(result: VoiceCallResultDto): Promise<void> {
    // TODO: Find alternate vendor
    // const alternateVendor = await this.findAlternateVendor(result.orderId);
    
    // TODO: If found, call alternate vendor
    // if (alternateVendor) {
    //   await this.initiateVendorCall(alternateVendorData);
    // } else {
    //   await this.notifyCustomer(result.orderId, 'Sorry, no vendors available');
    //   await this.cancelOrder(result.orderId);
    // }
    
    this.logger.log(`🔄 Finding alternate vendor for order ${result.orderId}`);
  }

  /**
   * Handle no response from vendor
   */
  private async handleNoResponse(result: VoiceCallResultDto): Promise<string> {
    const retryStatus = await this.voiceCallsService.checkRetryNeeded(result.orderId!);
    
    if (retryStatus.needsRetry) {
      // Schedule retry
      const retryAfter = new Date(Date.now() + this.retryDelayMs);
      await this.voiceCallsService.markForRetry(result.callSid, retryAfter);
      this.logger.log(`🔄 Retry scheduled for order ${result.orderId} at ${retryAfter}`);
      return 'RETRY_SCHEDULED';
    } else {
      // Max retries exceeded - escalate
      this.logger.warn(`⚠️ Max retries exceeded for order ${result.orderId}`);
      // TODO: Notify support or find alternate vendor
      return 'ESCALATE_TO_SUPPORT';
    }
  }

  /**
   * Handle busy signal
   */
  private async handleBusy(result: VoiceCallResultDto): Promise<string> {
    // Wait longer before retrying busy
    const retryAfter = new Date(Date.now() + this.busyRetryDelayMs);
    await this.voiceCallsService.markForRetry(result.callSid, retryAfter);
    this.logger.log(`🔄 Busy retry scheduled for order ${result.orderId} at ${retryAfter}`);
    return 'RETRY_SCHEDULED_BUSY';
  }

  /**
   * Handle call failure
   */
  private async onCallFailed(result: VoiceCallResultDto): Promise<void> {
    // TODO: Send WhatsApp fallback
    // await this.sendWhatsAppFallback(result.orderId);
    
    // TODO: Notify support
    // await this.notifySupport(`Call failed for order ${result.orderId}: ${result.errorMessage}`);
    
    this.logger.error(`💥 Call failed for order ${result.orderId}, falling back to WhatsApp`);
  }

  /**
   * Schedule rider assignment call
   */
  private async scheduleRiderAssignment(orderId: number, prepTimeMinutes: number): Promise<void> {
    // Calculate when to call rider (e.g., prepTime - 10 mins, minimum 5 mins)
    const callDelay = Math.max((prepTimeMinutes - 10) * 60 * 1000, 5 * 60 * 1000);
    
    this.logger.log(`📅 Rider call scheduled in ${callDelay / 1000 / 60} minutes for order ${orderId}`);
    
    // TODO: Implement actual scheduling (Bull queue, cron, etc.)
    // For now, just log it
    // await this.riderQueue.add('assign-rider', { orderId }, { delay: callDelay });
  }

  /**
   * Process pending retries (called by scheduler)
   */
  async processRetries(): Promise<void> {
    const pendingRetries = await this.voiceCallsService.getPendingRetries();
    
    for (const call of pendingRetries) {
      this.logger.log(`🔄 Processing retry for call ${call.exotel_call_sid}`);
      
      // Get order details and re-initiate call
      // This would need to fetch fresh order data from PHP backend
      // await this.initiateVendorCall(orderData);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; mercury: boolean }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.mercuryUrl}/health`, { timeout: 5000 }),
      );
      return {
        status: 'ok',
        mercury: response.data?.status === 'ok',
      };
    } catch {
      return {
        status: 'degraded',
        mercury: false,
      };
    }
  }
}
