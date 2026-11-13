import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth/better-auth.module.js';
import { CencoriModule } from './cencori/cencori.module.js';
import { EmailModule } from './email/email.module.js';
import { GravatarModule } from './gravatar/gravatar.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    GravatarModule,
    BetterAuthModule,
    CencoriModule,
  ],
  exports: [
    PrismaModule,
    EmailModule,
    GravatarModule,
    BetterAuthModule,
    CencoriModule,
  ],
})
export class LibModule {}
