import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller.js';
import { IntegrationService } from './integration.service.js';

@Module({
  controllers: [IntegrationController],
  providers: [IntegrationService],
  // Bots pick which integrations they may use.
  exports: [IntegrationService],
})
export class IntegrationModule {}
