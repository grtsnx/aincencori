import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { RoutineModule } from '../routine/routine.module.js';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';

@Module({
  imports: [ChatModule, RoutineModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
