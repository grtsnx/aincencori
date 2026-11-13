import type { EmailTemplateId } from '@better-auth/infra';

export interface OutboundEmail {
  template: EmailTemplateId;
  to: string;
  variables: Record<string, string>;
}

export type EmailSender = (email: OutboundEmail) => Promise<void>;
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
