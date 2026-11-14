import { Global, Module } from '@nestjs/common';
import { FirecrawlService } from './firecrawl.service.js';

// Web search and page reading (Firecrawl). Global: inject it anywhere.
@Global()
@Module({
  providers: [FirecrawlService],
  exports: [FirecrawlService],
})
export class FirecrawlModule {}
