import { Global, Module } from '@nestjs/common';
import { BullmqService } from './bullmq.service.js';

// Background jobs (BullMQ on Redis or Valkey). Global: inject BullmqService
// anywhere without importing this module.
@Global()
@Module({
  providers: [BullmqService],
  exports: [BullmqService],
})
export class BullmqModule {}
