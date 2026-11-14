import { Global, Module } from '@nestjs/common';
import { AlertController } from './alert.controller.js';
import { AlertService } from './alert.service.js';

// Global: anything can raise an alert (or call reportProblem from
// @/middleware, which reaches this service).
@Global()
@Module({
  controllers: [AlertController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
