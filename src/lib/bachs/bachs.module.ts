import { Global, Module } from '@nestjs/common';
import { BachsService } from './bachs.service.js';

// Payments (Bachs). Global: inject BachsService anywhere without importing
// this module.
@Global()
@Module({
  providers: [BachsService],
  exports: [BachsService],
})
export class BachsModule {}
