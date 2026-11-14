import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth/better-auth.module.js';
import { CencoriModule } from './cencori/cencori.module.js';
import { EmailModule } from './email/email.module.js';
import { GravatarModule } from './gravatar/gravatar.module.js';
import { BachsModule } from './bachs/bachs.module.js';
import { ExaModule } from './exa/exa.module.js';
import { SearxngModule } from './searxng/searxng.module.js';
import { InstaboxModule } from './instabox/instabox.module.js';
import { LivekitModule } from './livekit/livekit.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { R2Module } from './r2/r2.module.js';
import { RedisModule } from './redis/redis.module.js';
import { BullmqModule } from './bullmq/bullmq.module.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    R2Module,
    LivekitModule,
    InstaboxModule,
    BachsModule,
    ExaModule,
    SearxngModule,
    BullmqModule,
    EmailModule,
    GravatarModule,
    BetterAuthModule,
    CencoriModule,
  ],
  exports: [
    PrismaModule,
    RedisModule,
    R2Module,
    LivekitModule,
    InstaboxModule,
    BachsModule,
    ExaModule,
    SearxngModule,
    BullmqModule,
    EmailModule,
    GravatarModule,
    BetterAuthModule,
    CencoriModule,
  ],
})
export class LibModule {}
