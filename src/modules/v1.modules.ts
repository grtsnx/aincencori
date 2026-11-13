import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AgentAuthModule } from './agent-auth/agent-auth.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ChatModule } from './chat/chat.module.js';
import { IntegrationModule } from './integration/integration.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { RoutineModule } from './routine/routine.module.js';
import { UserModule } from './user/user.module.js';

@Module({
  imports: [
    AuthModule,
    AgentAuthModule,
    UserModule,
    OrganizationModule,
    AdminModule,
    ChatModule,
    RoutineModule,
    IntegrationModule,
    McpModule,
  ],
  exports: [],
})
export class V1Module {}
