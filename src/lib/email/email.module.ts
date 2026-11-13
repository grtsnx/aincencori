import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InMemoryMailTransport,
  MailModule,
  ResendTransport,
  SmtpTransport,
} from '@nestjs/mail';
import { EmailService } from './email.service.js';

// @nestjs/mail. Resend when RESEND_API_KEY is set, otherwise SMTP (SMTP_URL;
// locally the Mailpit container from compose.yaml). Tests use an in-memory box.
@Global()
@Module({
  imports: [
    MailModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const resendApiKey = config.get<string>('RESEND_API_KEY');
        const transport =
          config.get<string>('NODE_ENV') === 'test'
            ? new InMemoryMailTransport()
            : resendApiKey
              ? new ResendTransport({ apiKey: resendApiKey })
              : new SmtpTransport({
                  url: config.getOrThrow<string>('SMTP_URL'),
                });
        return {
          transport,
          from: config.getOrThrow<string>('MAIL_FROM'),
          // The outbox in EmailService retries instead.
          retry: false,
        };
      },
    }),
  ],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
