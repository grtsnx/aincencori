import { Global, Module } from '@nestjs/common';
import { ExaService } from './exa.service.js';

// Web search (Exa). Global: inject ExaService anywhere.
@Global()
@Module({
  providers: [ExaService],
  exports: [ExaService],
})
export class ExaModule {}
