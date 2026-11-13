import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sendEmail, type EmailTemplateId } from '@better-auth/infra';
import { PrismaModule } from '@/lib/prisma/prisma.module.js';
import { EmailOutboxService } from './email-outbox.service.js';
import { EMAIL_SENDER, type EmailSender } from './email.tokens.js';

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmailSender => async (email) => {
        const result = await sendEmail(
          { ...email, variables: email.variables as never },
          { apiKey: config.getOrThrow<string>('BETTER_AUTH_API_KEY') },
        );
        if (!result.success) throw new Error('Email provider rejected delivery');
      },
    },
    EmailOutboxService,
  ],
  exports: [EmailOutboxService],
})
export class EmailModule {}
