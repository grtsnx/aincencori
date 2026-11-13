import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { MarketplaceController } from './marketplace.controller.js';
import { MarketplaceService } from './marketplace.service.js';

@Module({
  imports: [BotModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  // The MCP server offers the marketplace to outside AI apps.
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
