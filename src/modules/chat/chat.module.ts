import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  controllers: [ChatController],
  providers: [ChatService],
  // Routines run the same agents and save their runs as chats.
  exports: [ChatService],
})
export class ChatModule {}
