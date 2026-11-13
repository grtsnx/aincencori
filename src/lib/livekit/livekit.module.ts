import { Global, Module } from '@nestjs/common';
import { LivekitService } from './livekit.service.js';

// Live voice calls (LiveKit). Global: inject LivekitService anywhere without
// importing this module.
@Global()
@Module({
  providers: [LivekitService],
  exports: [LivekitService],
})
export class LivekitModule {}
