import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { PlanController } from './plan.controller.js';
import { PlanService } from './plan.service.js';

@Module({
  imports: [ChatModule],
  controllers: [PlanController],
  providers: [PlanService],
  // The MCP server offers plans to outside AI apps.
  exports: [PlanService],
})
export class PlanModule {}
