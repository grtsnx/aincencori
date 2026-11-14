import { Global, Module } from '@nestjs/common';
import { ContextDevService } from './context-dev.service.js';

// Web search and page reading (Context.dev). Global: inject it anywhere.
@Global()
@Module({
  providers: [ContextDevService],
  exports: [ContextDevService],
})
export class ContextDevModule {}
