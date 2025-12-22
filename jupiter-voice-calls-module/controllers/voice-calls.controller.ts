import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Logger,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { VoiceCallsService } from '../services/voice-calls.service';
import { VoiceCallOrchestratorService } from '../services/voice-call-orchestrator.service';
import {
  InitiateVendorCallDto,
  InitiateRiderCallDto,
  VoiceCallResultDto,
  VoiceCallListQueryDto,
  VoiceCallStatsQueryDto,
  CallInitiationResponseDto,
} from '../dto/voice-call.dto';

/**
 * VoiceCallsController - API endpoints for AI Voice Call Management
 * 
 * Endpoints:
 * - POST /api/voice-calls/vendor - Initiate vendor confirmation call
 * - POST /api/voice-calls/rider - Initiate rider assignment call
 * - POST /api/voice-calls/result - Receive callback from Mercury
 * - GET /api/voice-calls - List voice calls
 * - GET /api/voice-calls/stats - Get call statistics
 * - GET /api/voice-calls/:id - Get call details
 * - GET /api/voice-calls/order/:orderId - Get calls for order
 */
@ApiTags('Voice Calls')
@Controller('api/voice-calls')
export class VoiceCallsController {
  private readonly logger = new Logger(VoiceCallsController.name);

  constructor(
    private readonly voiceCallsService: VoiceCallsService,
    private readonly orchestratorService: VoiceCallOrchestratorService,
  ) {
    this.logger.log('✅ VoiceCallsController initialized');
  }

  /**
   * Health check
   */
  @Get('health')
  @ApiOperation({ summary: 'Health check for voice calls service' })
  async health() {
    const health = await this.orchestratorService.healthCheck();
    return {
      service: 'voice-calls',
      ...health,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Initiate vendor order confirmation call
   * 
   * Called when a new order is placed and needs vendor confirmation.
   * Mercury will call the vendor and play order details via TTS.
   */
  @Post('vendor')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Initiate vendor order confirmation call' })
  @ApiBody({ type: InitiateVendorCallDto })
  @ApiResponse({ status: 200, type: CallInitiationResponseDto })
  async initiateVendorCall(
    @Body() data: InitiateVendorCallDto,
  ): Promise<CallInitiationResponseDto> {
    this.logger.log(`📞 API: Initiate vendor call for order ${data.orderId}`);
    return this.orchestratorService.initiateVendorCall(data);
  }

  /**
   * Initiate rider assignment call
   * 
   * Called when vendor accepts order and rider needs to be assigned.
   */
  @Post('rider')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Initiate rider assignment call' })
  @ApiBody({ type: InitiateRiderCallDto })
  @ApiResponse({ status: 200, type: CallInitiationResponseDto })
  async initiateRiderCall(
    @Body() data: InitiateRiderCallDto,
  ): Promise<CallInitiationResponseDto> {
    this.logger.log(`🏍️ API: Initiate rider call for order ${data.orderId}`);
    return this.orchestratorService.initiateRiderCall(data);
  }

  /**
   * Receive call result callback from Mercury
   * 
   * Mercury calls this endpoint after:
   * - Vendor accepts/rejects order (DTMF)
   * - Prep time is collected
   * - Call fails/no response
   */
  @Post('result')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Receive call result callback from Mercury' })
  @ApiBody({ type: VoiceCallResultDto })
  async handleCallResult(@Body() result: VoiceCallResultDto) {
    this.logger.log(`📥 API: Call result for ${result.callSid} - Status: ${result.status}`);
    
    const response = await this.orchestratorService.handleCallResult(result);
    
    return {
      received: true,
      callSid: result.callSid,
      status: result.status,
      action: response.action,
      nextStep: response.nextStep,
    };
  }

  /**
   * List voice calls with filters
   */
  @Get()
  @ApiOperation({ summary: 'List voice calls with pagination and filters' })
  @ApiQuery({ type: VoiceCallListQueryDto })
  async listCalls(@Query() query: VoiceCallListQueryDto) {
    return this.voiceCallsService.getCallsList(query);
  }

  /**
   * Get call statistics
   */
  @Get('stats')
  @ApiOperation({ summary: 'Get voice call statistics' })
  @ApiQuery({ type: VoiceCallStatsQueryDto })
  async getStats(@Query() query: VoiceCallStatsQueryDto) {
    return this.voiceCallsService.getCallStats(query);
  }

  /**
   * Get calls for a specific order
   */
  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get all voice calls for an order' })
  async getCallsByOrder(@Param('orderId') orderId: string) {
    return this.voiceCallsService.getCallsByOrder(parseInt(orderId, 10));
  }

  /**
   * Get call by Exotel SID
   */
  @Get('sid/:callSid')
  @ApiOperation({ summary: 'Get voice call by Exotel SID' })
  async getCallBySid(@Param('callSid') callSid: string) {
    const call = await this.voiceCallsService.getCallBySid(callSid);
    if (!call) {
      return { error: 'Call not found' };
    }
    return call;
  }

  /**
   * Get vendor call history
   */
  @Get('vendor/:vendorId')
  @ApiOperation({ summary: 'Get voice call history for a vendor' })
  async getVendorCalls(
    @Param('vendorId') vendorId: string,
    @Query('limit') limit?: string,
  ) {
    return this.voiceCallsService.getCallsByVendor(
      parseInt(vendorId, 10),
      limit ? parseInt(limit, 10) : 50,
    );
  }

  /**
   * Manual retry trigger (admin use)
   */
  @Post('retry/:callSid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger retry for a failed call' })
  async triggerRetry(@Param('callSid') callSid: string) {
    this.logger.log(`🔄 Manual retry triggered for ${callSid}`);
    
    // Get original call
    const call = await this.voiceCallsService.getCallBySid(callSid);
    if (!call) {
      return { success: false, error: 'Call not found' };
    }
    
    // TODO: Re-fetch order details from PHP and retry
    return {
      success: true,
      message: 'Retry scheduled',
      originalCallSid: callSid,
    };
  }

  /**
   * Process pending retries (called by scheduler or manually)
   */
  @Post('process-retries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process all pending call retries' })
  async processRetries() {
    this.logger.log('🔄 Processing pending retries...');
    await this.orchestratorService.processRetries();
    return { success: true, message: 'Retries processed' };
  }
}
