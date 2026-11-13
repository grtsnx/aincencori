import { Module } from '@nestjs/common';
import { AgentAuthController } from './agent-auth.controller.js';
import { AgentAuthService } from './agent-auth.service.js';

@Module({
  controllers: [AgentAuthController],
  providers: [AgentAuthService],
})
export class AgentAuthModule {}
