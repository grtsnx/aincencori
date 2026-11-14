import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  // Paid bots: Bachs's payment webhook hands hires to the marketplace.
  imports: [MarketplaceModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
