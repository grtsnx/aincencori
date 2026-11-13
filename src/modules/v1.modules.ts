import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationModule } from './organization/organization.module.js';

@Module({
  imports: [AuthModule, OrganizationModule, AdminModule],
  exports: [],
})
export class V1Module {}
