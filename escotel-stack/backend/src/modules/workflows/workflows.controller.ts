import { Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SaveWorkflowDto, WorkflowDto, WorkflowSummaryDto } from './dto.js';
import { WorkflowsService } from './workflows.service.js';

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowsController {
	constructor(private readonly svc: WorkflowsService) {}

	@Get()
		@ApiOperation({ summary: 'List workflow summaries' })
		@ApiOkResponse({ type: WorkflowSummaryDto as any, isArray: true })
	list() {
		return this.svc.list();
	}

	@Get(':id')
	@ApiOperation({ summary: 'Get a workflow by id' })
	@ApiOkResponse({ type: WorkflowDto as any })
	async get(@Param('id') id: string) {
		const wf = await this.svc.get(id);
		if (!wf) throw new NotFoundException('Workflow not found');
		return wf;
	}

	@Post()
	@ApiOperation({ summary: 'Create or update a workflow' })
	@ApiOkResponse({ type: WorkflowDto as any })
	save(@Body() dto: SaveWorkflowDto) {
		return this.svc.save(dto);
	}

	@Delete(':id')
	@ApiOperation({ summary: 'Delete a workflow' })
	remove(@Param('id') id: string) {
		return this.svc.remove(id);
	}
}

