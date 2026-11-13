import { Global, Module } from '@nestjs/common';
import { ApprovalController } from './approval.controller.js';
import { ApprovalService } from './approval.service.js';

// Global: chats, integrations and bots all check the user's rules.
@Global()
@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
