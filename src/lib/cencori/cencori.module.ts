import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cencori } from 'cencori';
import { CENCORI_CLIENT, CencoriService } from './cencori.service.js';

// Cencori (AI models, agents, memory). Global: CencoriService can be injected
// anywhere without importing this module.
@Global()
@Module({
  providers: [
    {
      provide: CENCORI_CLIENT,
      inject: [ConfigService],
      // The SDK throws without a key, so the client exists only when
      // CENCORI_API_KEY is set. Without it the app still starts, and Cencori
      // calls answer 503. Tests never reach Cencori.
      useFactory: (config: ConfigService): Cencori | null => {
        const apiKey = config.get<string>('CENCORI_API_KEY');
        if (!apiKey || config.get<string>('NODE_ENV') === 'test') return null;
        return new Cencori({ apiKey });
      },
    },
    CencoriService,
  ],
  exports: [CencoriService],
})
export class CencoriModule {}
