import { Global, Module } from '@nestjs/common';
import { BetterAuthService } from './better-auth.service.js';
import { EmailModule } from '@/lib/email/email.module.js';

@Global()
@Module({
  imports: [EmailModule],
  providers: [BetterAuthService],
  exports: [BetterAuthService],
})
export class BetterAuthModule {}
