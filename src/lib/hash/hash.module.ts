import { Global, Module } from '@nestjs/common';
import { HashService } from './hash.service.js';

@Global()
@Module({
  providers: [HashService],
  exports: [HashService],
})
export class HashModule {}
