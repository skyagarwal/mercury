import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class SaveWorkflowDto {
	@ApiProperty({ description: 'Workflow ID (slug or UUID). If omitted on create, server may generate one in future; for now required.', example: 'order-status-v1' })
	@IsString()
	id!: string;

	@ApiProperty({ description: 'Human title', example: 'Order Status Orchestration' })
	@IsString()
	title!: string;

	@ApiProperty({ description: 'Optional description', required: false })
	@IsOptional()
	@IsString()
	description?: string;

	@ApiProperty({ description: 'Serialized graph schema (nodes, edges, metadata). This is opaque JSON saved as-is).', example: { nodes: [], edges: [] } })
	@IsObject()
	schema!: Record<string, any>;

	@ApiProperty({ description: 'Optional tags', required: false, example: ['orders','v1'] })
	@IsOptional()
	@IsArray()
	tags?: string[];
}

export class WorkflowSummaryDto {
	@ApiProperty()
	id!: string;
	@ApiProperty()
	title!: string;
	@ApiProperty({ required: false })
	description?: string;
	@ApiProperty({ required: false, type: [String] })
	tags?: string[];
	@ApiProperty()
	updatedAt!: string;
}

export class WorkflowDto extends WorkflowSummaryDto {
	@ApiProperty({ description: 'Raw schema JSON' })
	schema!: Record<string, any>;
}

