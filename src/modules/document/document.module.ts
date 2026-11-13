import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { DocumentController } from './document.controller.js';
import { DocumentService } from './document.service.js';

@Module({
  imports: [ChatModule],
  controllers: [DocumentController],
  providers: [DocumentService],
  // Bots search the documents their owner picked; the MCP server offers them.
  exports: [DocumentService],
})
export class DocumentModule {}
