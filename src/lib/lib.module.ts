import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth/better-auth.module.js';
import { HashModule } from './hash/hash.module.js';
import { EmailModule } from './email/email.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, HashModule, EmailModule, BetterAuthModule],
  exports: [PrismaModule, HashModule, EmailModule, BetterAuthModule],
})
export class LibModule {}
