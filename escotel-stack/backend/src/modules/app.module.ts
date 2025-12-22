import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { RedisModule } from './redis.module.js';
import { WorkflowsModule } from './workflows/workflows.module.js';

@Module({
  imports: [RedisModule, WorkflowsModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
