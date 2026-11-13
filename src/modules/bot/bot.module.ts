import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { BotController } from './bot.controller.js';
import { BotService } from './bot.service.js';

@Module({
  imports: [ChatModule, IntegrationModule],
  controllers: [BotController],
  providers: [BotService],
})
export class BotModule {}
