import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { GroupModule } from '../group/group.module.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { RoutineModule } from '../routine/routine.module.js';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';

@Module({
  imports: [
    ChatModule,
    RoutineModule,
    BotModule,
    GroupModule,
    IntegrationModule,
  ],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
