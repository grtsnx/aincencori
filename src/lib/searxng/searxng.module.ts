import { Global, Module } from '@nestjs/common';
import { SearxngService } from './searxng.service.js';

// Web search on our own SearXNG. Global: inject SearxngService anywhere.
@Global()
@Module({
  providers: [SearxngService],
  exports: [SearxngService],
})
export class SearxngModule {}
