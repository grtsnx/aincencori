import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth/better-auth.module.js';
import { HashModule } from './hash/hash.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, HashModule, BetterAuthModule],
  exports: [PrismaModule, HashModule, BetterAuthModule],
})
export class LibModule {}
