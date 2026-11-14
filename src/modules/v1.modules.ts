import { Module } from '@nestjs/common';
import { ActivityModule } from './activity/activity.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ApprovalModule } from './approval/approval.module.js';
import { AgentAuthModule } from './agent-auth/agent-auth.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BotModule } from './bot/bot.module.js';
import { ChatModule } from './chat/chat.module.js';
import { AlertModule } from './alert/alert.module.js';
import { NotificationModule } from './notification/notification.module.js';
import { BillingModule } from './billing/billing.module.js';
import { ComputerModule } from './computer/computer.module.js';
import { DocumentModule } from './document/document.module.js';
import { GroupModule } from './group/group.module.js';
import { IntegrationModule } from './integration/integration.module.js';
import { MarketplaceModule } from './marketplace/marketplace.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { PlanModule } from './plan/plan.module.js';
import { RoutineModule } from './routine/routine.module.js';
import { UsageModule } from './usage/usage.module.js';
import { UserModule } from './user/user.module.js';
import { VoiceModule } from './voice/voice.module.js';

@Module({
  imports: [
    ActivityModule,
    UsageModule,
    ApprovalModule,
    AuthModule,
    AgentAuthModule,
    UserModule,
    OrganizationModule,
    AdminModule,
    ChatModule,
    RoutineModule,
    IntegrationModule,
    BotModule,
    GroupModule,
    DocumentModule,
    PlanModule,
    MarketplaceModule,
    ComputerModule,
    BillingModule,
    AlertModule,
    NotificationModule,
    McpModule,
    VoiceModule,
  ],
  exports: [],
})
export class V1Module {}
