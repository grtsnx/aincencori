import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth/better-auth.module.js';
import { CencoriModule } from './cencori/cencori.module.js';
import { EmailModule } from './email/email.module.js';
import { GravatarModule } from './gravatar/gravatar.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { BullmqModule } from './bullmq/bullmq.module.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BullmqModule,
    EmailModule,
    GravatarModule,
    BetterAuthModule,
    CencoriModule,
  ],
  exports: [
    PrismaModule,
    RedisModule,
    BullmqModule,
    EmailModule,
    GravatarModule,
    BetterAuthModule,
    CencoriModule,
  ],
})
export class LibModule {}
