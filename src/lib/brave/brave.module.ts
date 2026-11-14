import { Global, Module } from '@nestjs/common';
import { BraveService } from './brave.service.js';

// Web search (Brave Search). Global: inject BraveService anywhere.
@Global()
@Module({
  providers: [BraveService],
  exports: [BraveService],
})
export class BraveModule {}
