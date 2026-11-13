import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InMemoryMailTransport,
  MailModule,
  ResendTransport,
  SmtpTransport,
} from '@nestjs/mail';
import { EmailService } from './email.service.js';

// @nestjs/mail. Resend when RESEND_API_KEY is set, otherwise SMTP (SMTP_HOST,
// SMTP_PORT, SMTP_USER, ...; locally Mailpit from compose.yaml). Tests use an
// in-memory box.
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
                  host: config.getOrThrow<string>('SMTP_HOST'),
                  port: config.getOrThrow<number>('SMTP_PORT'),
                  secure: config.getOrThrow<boolean>('SMTP_SECURE'),
                  ...(config.get<string>('SMTP_USER') && {
                    auth: {
                      user: config.getOrThrow<string>('SMTP_USER'),
                      pass: config.getOrThrow<string>('SMTP_PASSWORD'),
                    },
                  }),
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
