import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth/better-auth.module.js';
import { EmailModule } from './email/email.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, EmailModule, BetterAuthModule],
  exports: [PrismaModule, EmailModule, BetterAuthModule],
})
export class LibModule {}
