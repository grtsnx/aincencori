import { Global, Module } from '@nestjs/common';
import { GravatarService } from './gravatar.service.js';

@Global()
@Module({
  providers: [GravatarService],
  exports: [GravatarService],
})
export class GravatarModule {}
