import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth/better-auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, BetterAuthModule],
  exports: [PrismaModule, BetterAuthModule],
})
export class LibModule {}
