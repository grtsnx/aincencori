import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { GroupController } from './group.controller.js';
import { GroupService } from './group.service.js';

@Module({
  imports: [ChatModule, BotModule],
  controllers: [GroupController],
  providers: [GroupService],
})
export class GroupModule {}
