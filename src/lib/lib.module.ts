import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth/better-auth.module.js';
import { EmailModule } from './email/email.module.js';
import { GravatarModule } from './gravatar/gravatar.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, EmailModule, GravatarModule, BetterAuthModule],
  exports: [PrismaModule, EmailModule, GravatarModule, BetterAuthModule],
})
export class LibModule {}
