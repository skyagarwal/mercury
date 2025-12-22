import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import {
  CallType,
  CallStatus,
  RejectionReason,
  VoiceCallResultDto,
  InitiateVendorCallDto,
  InitiateRiderCallDto,
  VoiceCallListQueryDto,
  VoiceCallStatsQueryDto,
} from '../dto/voice-call.dto';

/**
 * VoiceCallsService - Database operations for voice calls
 * 
 * Handles:
 * - Creating voice call records
 * - Updating call status on callbacks
 * - Querying call history
 * - Generating analytics
 */
@Injectable()
export class VoiceCallsService {
  private readonly logger = new Logger(VoiceCallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.logger.log('✅ VoiceCallsService initialized');
  }

  /**
   * Create a new voice call record when initiating a call
   */
  async createVoiceCall(data: {
    exotelCallSid: string;
    callType: CallType;
    fromNumber: string;
    toNumber: string;
    toName?: string;
    orderId?: number;
    vendorId?: number;
    riderId?: number;
    customerId?: number;
    orderDetails?: any;
    orderAmount?: number;
    callbackUrl?: string;
  }): Promise<any> {
    try {
      this.logger.log(`📞 Creating voice call record: ${data.callType} for order ${data.orderId}`);

      const voiceCall = await this.prisma.$executeRaw`
        INSERT INTO voice_calls (
          id, exotel_call_sid, call_type, status,
          from_number, to_number, to_name,
          order_id, vendor_id, rider_id, customer_id,
          order_details, order_amount,
          callback_url, attempt_number, max_attempts,
          tenant_id, created_at, updated_at
        ) VALUES (
          gen_random_uuid()::text,
          ${data.exotelCallSid},
          ${data.callType}::"CallType",
          'INITIATED'::"CallStatus",
          ${data.fromNumber},
          ${data.toNumber},
          ${data.toName || null},
          ${data.orderId || null},
          ${data.vendorId || null},
          ${data.riderId || null},
          ${data.customerId || null},
          ${JSON.stringify(data.orderDetails || {})}::jsonb,
          ${data.orderAmount || null},
          ${data.callbackUrl || null},
          1, 3, 'mangwale',
          NOW(), NOW()
        )
        RETURNING *
      `;

      this.logger.log(`✅ Voice call created: ${data.exotelCallSid}`);
      return { success: true, callSid: data.exotelCallSid };
    } catch (error: any) {
      this.logger.error(`❌ Failed to create voice call: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update voice call with result from Mercury callback
   */
  async updateCallResult(result: VoiceCallResultDto): Promise<any> {
    try {
      this.logger.log(`📝 Updating call result: ${result.callSid} -> ${result.status}`);

      // Map rejection digit to reason
      let rejectionReason: RejectionReason | null = null;
      if (result.status === CallStatus.REJECTED && result.rejectionReason) {
        rejectionReason = result.rejectionReason;
      } else if (result.status === CallStatus.REJECTED && result.digits) {
        const digitMap: Record<string, RejectionReason> = {
          '1': RejectionReason.ITEM_UNAVAILABLE,
          '2': RejectionReason.TOO_BUSY,
          '3': RejectionReason.SHOP_CLOSED,
          '4': RejectionReason.OTHER,
        };
        rejectionReason = digitMap[result.digits] || RejectionReason.OTHER;
      }

      // Build update query dynamically
      const updateData: any = {
        status: result.status,
        dtmf_digits: result.digits || null,
        exotel_status: result.exotelStatus || null,
        updated_at: new Date(),
      };

      if (result.prepTimeMinutes) {
        updateData.prep_time_minutes = result.prepTimeMinutes;
      }

      if (rejectionReason) {
        updateData.rejection_reason = rejectionReason;
      }

      if (result.answeredAt) {
        updateData.call_answered_at = new Date(result.answeredAt);
      }

      if (result.endedAt) {
        updateData.call_ended_at = new Date(result.endedAt);
      }

      if (result.duration) {
        updateData.duration = result.duration;
      }

      if (result.recordingUrl) {
        updateData.recording_url = result.recordingUrl;
      }

      if (result.attemptNumber) {
        updateData.attempt_number = result.attemptNumber;
      }

      if (result.errorMessage) {
        updateData.error_message = result.errorMessage;
      }

      // Execute update
      await this.prisma.$executeRaw`
        UPDATE voice_calls 
        SET 
          status = ${result.status}::"CallStatus",
          dtmf_digits = ${result.digits || null},
          exotel_status = ${result.exotelStatus || null},
          prep_time_minutes = ${result.prepTimeMinutes || null},
          rejection_reason = ${rejectionReason ? `${rejectionReason}::"RejectionReason"` : null},
          call_answered_at = ${result.answeredAt ? new Date(result.answeredAt) : null},
          call_ended_at = ${result.endedAt ? new Date(result.endedAt) : null},
          duration = ${result.duration || null},
          recording_url = ${result.recordingUrl || null},
          attempt_number = ${result.attemptNumber || 1},
          error_message = ${result.errorMessage || null},
          callback_sent = true,
          updated_at = NOW()
        WHERE exotel_call_sid = ${result.callSid}
      `;

      this.logger.log(`✅ Call result updated: ${result.callSid}`);

      return {
        success: true,
        callSid: result.callSid,
        status: result.status,
        orderId: result.orderId,
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to update call result: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get voice call by Exotel SID
   */
  async getCallBySid(callSid: string): Promise<any> {
    const result = await this.prisma.$queryRaw`
      SELECT * FROM voice_calls 
      WHERE exotel_call_sid = ${callSid}
      LIMIT 1
    `;
    return (result as any[])[0] || null;
  }

  /**
   * Get voice calls for an order
   */
  async getCallsByOrder(orderId: number): Promise<any[]> {
    const result = await this.prisma.$queryRaw`
      SELECT * FROM voice_calls 
      WHERE order_id = ${orderId}
      ORDER BY created_at DESC
    `;
    return result as any[];
  }

  /**
   * Get voice calls for a vendor
   */
  async getCallsByVendor(vendorId: number, limit: number = 50): Promise<any[]> {
    const result = await this.prisma.$queryRaw`
      SELECT * FROM voice_calls 
      WHERE vendor_id = ${vendorId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result as any[];
  }

  /**
   * Get voice calls list with pagination and filters
   */
  async getCallsList(query: VoiceCallListQueryDto): Promise<{
    calls: any[];
    total: number;
    page: number;
    limit: number;
    pages: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    // Build WHERE conditions
    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (query.callType) {
      conditions.push(`call_type = $${params.length + 1}::"CallType"`);
      params.push(query.callType);
    }

    if (query.status) {
      conditions.push(`status = $${params.length + 1}::"CallStatus"`);
      params.push(query.status);
    }

    if (query.orderId) {
      conditions.push(`order_id = $${params.length + 1}`);
      params.push(query.orderId);
    }

    if (query.vendorId) {
      conditions.push(`vendor_id = $${params.length + 1}`);
      params.push(query.vendorId);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await this.prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM voice_calls WHERE ${whereClause}
    `, ...params);
    const total = parseInt((countResult as any[])[0]?.count || '0');

    // Get calls
    const calls = await this.prisma.$queryRawUnsafe(`
      SELECT * FROM voice_calls 
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, ...params);

    return {
      calls: calls as any[],
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Get voice call statistics
   */
  async getCallStats(query: VoiceCallStatsQueryDto): Promise<{
    summary: any;
    byType: any[];
    byStatus: any[];
    byDay: any[];
    rejectionBreakdown: any;
    avgPrepTime: number;
    answerRate: number;
    acceptanceRate: number;
  }> {
    const startDate = query.startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = query.endDate || new Date().toISOString().split('T')[0];

    // Summary stats
    const summary = await this.prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE status = 'ANSWERED' OR status = 'ACCEPTED' OR status = 'REJECTED' OR status = 'PREP_TIME_SET') as answered_calls,
        COUNT(*) FILTER (WHERE status = 'ACCEPTED' OR status = 'PREP_TIME_SET') as accepted_calls,
        COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected_calls,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed_calls,
        COUNT(*) FILTER (WHERE status = 'NO_RESPONSE') as no_response_calls,
        AVG(duration) FILTER (WHERE duration IS NOT NULL) as avg_duration,
        AVG(prep_time_minutes) FILTER (WHERE prep_time_minutes IS NOT NULL) as avg_prep_time
      FROM voice_calls
      WHERE created_at >= ${startDate}::date 
        AND created_at <= ${endDate}::date + interval '1 day'
    `;

    // By call type
    const byType = await this.prisma.$queryRaw`
      SELECT 
        call_type,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE status = 'ACCEPTED' OR status = 'PREP_TIME_SET') as accepted,
        COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected
      FROM voice_calls
      WHERE created_at >= ${startDate}::date 
        AND created_at <= ${endDate}::date + interval '1 day'
      GROUP BY call_type
    `;

    // By status
    const byStatus = await this.prisma.$queryRaw`
      SELECT 
        status,
        COUNT(*) as count
      FROM voice_calls
      WHERE created_at >= ${startDate}::date 
        AND created_at <= ${endDate}::date + interval '1 day'
      GROUP BY status
    `;

    // By day
    const byDay = await this.prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'ACCEPTED' OR status = 'PREP_TIME_SET') as accepted,
        COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected
      FROM voice_calls
      WHERE created_at >= ${startDate}::date 
        AND created_at <= ${endDate}::date + interval '1 day'
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    // Rejection breakdown
    const rejectionBreakdown = await this.prisma.$queryRaw`
      SELECT 
        rejection_reason,
        COUNT(*) as count
      FROM voice_calls
      WHERE status = 'REJECTED'
        AND created_at >= ${startDate}::date 
        AND created_at <= ${endDate}::date + interval '1 day'
      GROUP BY rejection_reason
    `;

    const summaryData = (summary as any[])[0];
    const totalCalls = parseInt(summaryData?.total_calls || '0');
    const answeredCalls = parseInt(summaryData?.answered_calls || '0');
    const acceptedCalls = parseInt(summaryData?.accepted_calls || '0');

    return {
      summary: summaryData,
      byType: byType as any[],
      byStatus: byStatus as any[],
      byDay: byDay as any[],
      rejectionBreakdown: rejectionBreakdown as any[],
      avgPrepTime: parseFloat(summaryData?.avg_prep_time || '0'),
      answerRate: totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0,
      acceptanceRate: answeredCalls > 0 ? (acceptedCalls / answeredCalls) * 100 : 0,
    };
  }

  /**
   * Check if order needs retry (vendor not responding)
   */
  async checkRetryNeeded(orderId: number): Promise<{
    needsRetry: boolean;
    attemptNumber: number;
    lastCallSid?: string;
  }> {
    const lastCall = await this.prisma.$queryRaw`
      SELECT * FROM voice_calls
      WHERE order_id = ${orderId} 
        AND call_type = 'VENDOR_ORDER_CONFIRMATION'::"CallType"
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const call = (lastCall as any[])[0];

    if (!call) {
      return { needsRetry: false, attemptNumber: 0 };
    }

    const needsRetry = 
      (call.status === 'NO_RESPONSE' || call.status === 'FAILED' || call.status === 'BUSY') &&
      call.attempt_number < call.max_attempts;

    return {
      needsRetry,
      attemptNumber: call.attempt_number,
      lastCallSid: call.exotel_call_sid,
    };
  }

  /**
   * Mark call for retry
   */
  async markForRetry(callSid: string, retryAfter: Date): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE voice_calls 
      SET retry_after = ${retryAfter}, updated_at = NOW()
      WHERE exotel_call_sid = ${callSid}
    `;
  }

  /**
   * Get pending retries
   */
  async getPendingRetries(): Promise<any[]> {
    const result = await this.prisma.$queryRaw`
      SELECT * FROM voice_calls
      WHERE retry_after IS NOT NULL
        AND retry_after <= NOW()
        AND attempt_number < max_attempts
        AND status IN ('NO_RESPONSE', 'FAILED', 'BUSY')
      ORDER BY retry_after ASC
      LIMIT 10
    `;
    return result as any[];
  }
}
