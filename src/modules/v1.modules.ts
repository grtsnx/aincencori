import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { UserModule } from './user/user.module.js';

@Module({
  imports: [AuthModule, UserModule, OrganizationModule, AdminModule],
  exports: [],
})
export class V1Module {}
