import { Global, Module } from '@nestjs/common';
import { InstaboxService } from './instabox.service.js';

// Cloud computers for agents (InstaBox). Global: inject InstaboxService
// anywhere without importing this module.
@Global()
@Module({
  providers: [InstaboxService],
  exports: [InstaboxService],
})
export class InstaboxModule {}
