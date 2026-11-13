import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { DocumentModule } from '../document/document.module.js';
import { PlanModule } from '../plan/plan.module.js';
import { AgentAuthController } from './agent-auth.controller.js';
import { AgentAuthService } from './agent-auth.service.js';

@Module({
  imports: [ChatModule, BotModule, DocumentModule, PlanModule],
  controllers: [AgentAuthController],
  providers: [AgentAuthService],
})
export class AgentAuthModule {}
