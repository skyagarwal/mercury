import { Module } from '@nestjs/common';
import { RedisModule } from '../redis.module.js';
import { WorkflowsService } from './workflows.service.js';
import { WorkflowsController } from './workflows.controller.js';

@Module({
	imports: [RedisModule],
	controllers: [WorkflowsController],
	providers: [WorkflowsService],
})
export class WorkflowsModule {}

