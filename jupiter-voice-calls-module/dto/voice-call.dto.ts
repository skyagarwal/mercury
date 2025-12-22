import { IsString, IsNumber, IsOptional, IsEnum, IsObject, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Call Types
 */
export enum CallType {
  VENDOR_ORDER_CONFIRMATION = 'VENDOR_ORDER_CONFIRMATION',
  VENDOR_PREP_TIME = 'VENDOR_PREP_TIME',
  RIDER_ASSIGNMENT = 'RIDER_ASSIGNMENT',
  RIDER_PICKUP_READY = 'RIDER_PICKUP_READY',
  CUSTOMER_DELIVERY_UPDATE = 'CUSTOMER_DELIVERY_UPDATE',
}

/**
 * Call Status
 */
export enum CallStatus {
  INITIATED = 'INITIATED',
  RINGING = 'RINGING',
  ANSWERED = 'ANSWERED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  PREP_TIME_SET = 'PREP_TIME_SET',
  NO_RESPONSE = 'NO_RESPONSE',
  FAILED = 'FAILED',
  BUSY = 'BUSY',
  CANCELLED = 'CANCELLED',
}

/**
 * Rejection Reasons
 */
export enum RejectionReason {
  ITEM_UNAVAILABLE = 'ITEM_UNAVAILABLE',  // 1
  TOO_BUSY = 'TOO_BUSY',                  // 2
  SHOP_CLOSED = 'SHOP_CLOSED',            // 3
  OTHER = 'OTHER',                        // 4
}

/**
 * Order Item for TTS
 */
export class OrderItemDto {
  @ApiProperty({ description: 'Item name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Quantity ordered' })
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({ description: 'Item price' })
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiPropertyOptional({ description: 'Special instructions' })
  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * Request to initiate vendor order confirmation call
 */
export class InitiateVendorCallDto {
  @ApiProperty({ description: 'PHP Order ID' })
  @IsNumber()
  orderId: number;

  @ApiProperty({ description: 'PHP Vendor/Restaurant ID' })
  @IsNumber()
  vendorId: number;

  @ApiProperty({ description: 'Vendor phone number with country code' })
  @IsString()
  vendorPhone: string;

  @ApiProperty({ description: 'Vendor/Restaurant name' })
  @IsString()
  vendorName: string;

  @ApiPropertyOptional({ description: 'Customer name for greeting' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiProperty({ description: 'Order items for TTS readout', type: [OrderItemDto] })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  orderItems: OrderItemDto[];

  @ApiProperty({ description: 'Total order amount' })
  @IsNumber()
  orderAmount: number;

  @ApiPropertyOptional({ description: 'Language for TTS (hi/en)' })
  @IsString()
  @IsOptional()
  language?: string;
}

/**
 * Request to initiate rider assignment call
 */
export class InitiateRiderCallDto {
  @ApiProperty({ description: 'PHP Order ID' })
  @IsNumber()
  orderId: number;

  @ApiProperty({ description: 'PHP Rider/Deliveryman ID' })
  @IsNumber()
  riderId: number;

  @ApiProperty({ description: 'Rider phone number with country code' })
  @IsString()
  riderPhone: string;

  @ApiProperty({ description: 'Rider name' })
  @IsString()
  riderName: string;

  @ApiProperty({ description: 'Restaurant name for pickup' })
  @IsString()
  restaurantName: string;

  @ApiProperty({ description: 'Restaurant address' })
  @IsString()
  restaurantAddress: string;

  @ApiProperty({ description: 'Estimated pickup time in minutes' })
  @IsNumber()
  pickupTimeMinutes: number;

  @ApiPropertyOptional({ description: 'Customer name' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional({ description: 'Delivery address' })
  @IsString()
  @IsOptional()
  deliveryAddress?: string;
}

/**
 * Voice call result callback from Mercury
 */
export class VoiceCallResultDto {
  @ApiProperty({ description: 'Exotel Call SID' })
  @IsString()
  callSid: string;

  @ApiProperty({ description: 'Call type', enum: CallType })
  @IsEnum(CallType)
  callType: CallType;

  @ApiProperty({ description: 'Call status', enum: CallStatus })
  @IsEnum(CallStatus)
  status: CallStatus;

  @ApiPropertyOptional({ description: 'PHP Order ID' })
  @IsNumber()
  @IsOptional()
  orderId?: number;

  @ApiPropertyOptional({ description: 'PHP Vendor ID' })
  @IsNumber()
  @IsOptional()
  vendorId?: number;

  @ApiPropertyOptional({ description: 'PHP Rider ID' })
  @IsNumber()
  @IsOptional()
  riderId?: number;

  @ApiPropertyOptional({ description: 'DTMF digits pressed' })
  @IsString()
  @IsOptional()
  digits?: string;

  @ApiPropertyOptional({ description: 'Prep time in minutes (for accepted orders)' })
  @IsNumber()
  @IsOptional()
  prepTimeMinutes?: number;

  @ApiPropertyOptional({ description: 'Rejection reason', enum: RejectionReason })
  @IsEnum(RejectionReason)
  @IsOptional()
  rejectionReason?: RejectionReason;

  @ApiPropertyOptional({ description: 'Call answered timestamp' })
  @IsString()
  @IsOptional()
  answeredAt?: string;

  @ApiPropertyOptional({ description: 'Call ended timestamp' })
  @IsString()
  @IsOptional()
  endedAt?: string;

  @ApiPropertyOptional({ description: 'Call duration in seconds' })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiPropertyOptional({ description: 'Recording URL' })
  @IsString()
  @IsOptional()
  recordingUrl?: string;

  @ApiPropertyOptional({ description: 'Attempt number (1-3)' })
  @IsNumber()
  @IsOptional()
  attemptNumber?: number;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  @IsString()
  @IsOptional()
  errorMessage?: string;

  @ApiPropertyOptional({ description: 'Exotel raw status' })
  @IsString()
  @IsOptional()
  exotelStatus?: string;
}

/**
 * Exotel call status webhook
 */
export class ExotelStatusWebhookDto {
  @ApiProperty({ description: 'Call SID' })
  @IsString()
  CallSid: string;

  @ApiProperty({ description: 'Call status' })
  @IsString()
  Status: string;

  @ApiPropertyOptional({ description: 'From number' })
  @IsString()
  @IsOptional()
  From?: string;

  @ApiPropertyOptional({ description: 'To number' })
  @IsString()
  @IsOptional()
  To?: string;

  @ApiPropertyOptional({ description: 'Recording URL' })
  @IsString()
  @IsOptional()
  RecordingUrl?: string;

  @ApiPropertyOptional({ description: 'Duration' })
  @IsNumber()
  @IsOptional()
  Duration?: number;

  @ApiPropertyOptional({ description: 'Start time' })
  @IsString()
  @IsOptional()
  StartTime?: string;

  @ApiPropertyOptional({ description: 'End time' })
  @IsString()
  @IsOptional()
  EndTime?: string;
}

/**
 * Response for call initiation
 */
export class CallInitiationResponseDto {
  @ApiProperty({ description: 'Success status' })
  success: boolean;

  @ApiPropertyOptional({ description: 'Internal call tracking ID' })
  callId?: string;

  @ApiPropertyOptional({ description: 'Exotel Call SID' })
  exotelCallSid?: string;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Call status' })
  status?: string;
}

/**
 * Voice call stats query
 */
export class VoiceCallStatsQueryDto {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Call type filter', enum: CallType })
  @IsEnum(CallType)
  @IsOptional()
  callType?: CallType;

  @ApiPropertyOptional({ description: 'Vendor ID filter' })
  @IsNumber()
  @IsOptional()
  vendorId?: number;
}

/**
 * Voice call list query
 */
export class VoiceCallListQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsNumber()
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsNumber()
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'Call type filter', enum: CallType })
  @IsEnum(CallType)
  @IsOptional()
  callType?: CallType;

  @ApiPropertyOptional({ description: 'Status filter', enum: CallStatus })
  @IsEnum(CallStatus)
  @IsOptional()
  status?: CallStatus;

  @ApiPropertyOptional({ description: 'Order ID filter' })
  @IsNumber()
  @IsOptional()
  orderId?: number;

  @ApiPropertyOptional({ description: 'Vendor ID filter' })
  @IsNumber()
  @IsOptional()
  vendorId?: number;
}
