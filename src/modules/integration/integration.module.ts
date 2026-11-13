import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { IntegrationController } from './integration.controller.js';
import { IntegrationService } from './integration.service.js';

@Module({
  imports: [ChatModule],
  controllers: [IntegrationController],
  providers: [IntegrationService],
})
export class IntegrationModule {}
