import { Global, Module } from '@nestjs/common';
import { R2Service } from './r2.service.js';

// File storage (Cloudflare R2, or any S3-compatible store). Global: inject
// R2Service anywhere without importing this module.
@Global()
@Module({
  providers: [R2Service],
  exports: [R2Service],
})
export class R2Module {}
