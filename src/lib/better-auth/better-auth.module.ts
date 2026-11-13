import { Global, Module } from '@nestjs/common';
import { BetterAuthService } from './better-auth.service.js';
import { EmailModule } from '@/lib/email/email.module.js';
import { GravatarModule } from '@/lib/gravatar/gravatar.module.js';

@Global()
@Module({
  imports: [EmailModule, GravatarModule],
  providers: [BetterAuthService],
  exports: [BetterAuthService],
})
export class BetterAuthModule {}
