import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InMemoryMailTransport,
  type MailMessage,
  MailModule,
  MailTransport,
  type MailTransportResult,
  type MailTransportSendOptions,
  SmtpTransport,
} from '@nestjs/mail';
import { EmailService } from './email.service.js';

const sendByteUrl = 'https://api.sendbyte.africa/v1/emails';

const address = ({ name, address }: { name?: string; address: string }) =>
  name ? `${name} <${address}>` : address;

// Sends through SendByte's API (https://docs.sendbyte.africa). The outbox id
// goes along as idempotency_key, so a retried send is never delivered twice.
export class SendByteTransport extends MailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {
    super();
  }

  async send(
    message: MailMessage,
    { signal, idempotencyKey }: MailTransportSendOptions,
  ): Promise<MailTransportResult> {
    const response = await this.request(sendByteUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: address(message.from),
        to: message.to.map(address),
        ...(message.cc.length && { cc: message.cc.map(address) }),
        ...(message.bcc.length && { bcc: message.bcc.map(address) }),
        ...(message.replyTo.length && {
          reply_to: address(message.replyTo[0]),
        }),
        subject: message.subject,
        ...(message.html !== undefined && { html: message.html }),
        ...(message.text !== undefined && { text: message.text }),
        ...(idempotencyKey && { idempotency_key: idempotencyKey }),
      }),
      // Give up after 15 seconds; the outbox tries again later.
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      error?: { code?: string };
    };
    if (!response.ok) {
      throw new Error(
        `SendByte answered ${response.status} (${body.error?.code ?? 'unknown'})`,
      );
    }
    return {
      accepted: message.to.map((to) => to.address),
      providerMessageId: body.id,
    };
  }
}

// @nestjs/mail. SendByte when SENDBYTE_API_KEY is set, otherwise SMTP
// (SMTP_HOST, SMTP_PORT, SMTP_USER, ...; locally Mailpit from compose.yaml).
// Tests use an in-memory box.
@Global()
@Module({
  imports: [
    MailModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const sendByteApiKey = config.get<string>('SENDBYTE_API_KEY');
        const transport =
          config.get<string>('NODE_ENV') === 'test'
            ? new InMemoryMailTransport()
            : sendByteApiKey
              ? new SendByteTransport(sendByteApiKey)
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
