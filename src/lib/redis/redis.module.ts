import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';

// Shared fast storage (Redis or Valkey). Global: inject RedisService
// anywhere without importing this module.
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
