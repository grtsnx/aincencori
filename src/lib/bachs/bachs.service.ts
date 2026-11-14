import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Bachs,
  type CreateCheckoutSessionRequest,
  type WebhookEvent,
  type WebhookHeaders,
} from '@bachs/sdk';

// Payments with Bachs (BACHS_API_KEY; sk_sandbox_ keys use Bachs's sandbox,
// sk_live_ keys take real money). Cards, bank transfers and mobile money, in
// dollars or naira. We stay the seller; Bachs takes the payment.
@Injectable()
export class BachsService {
  private readonly client: Bachs | null;
  private readonly webhookSecret?: string;
  // Our product ids at Bachs, by "plan:price", and plan names by product id.
  private readonly productIds = new Map<string, string>();
  private readonly planNames = new Map<string, string | null>();

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('BACHS_API_KEY');
    this.client = apiKey ? new Bachs({ apiKey }) : null;
    this.webhookSecret = config.get<string>('BACHS_WEBHOOK_SECRET');
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  // "sandbox" (test payments) or "production".
  get environment(): string | null {
    return this.client?.environment ?? null;
  }

  // The raw client, for anything not wrapped here.
  get sdk(): Bachs {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Payments are not set up: set BACHS_API_KEY.',
      );
    }
    return this.client;
  }

  // The monthly dollar-card product for a plan at this price, made at Bachs
  // the first time. A new price makes a new product; people already paying
  // keep their old price.
  async planProduct(
    plan: string,
    name: string,
    priceUsd: number,
  ): Promise<string> {
    const key = `${plan}:${priceUsd}`;
    const cached = this.productIds.get(key);
    if (cached) return cached;
    for await (const product of this.sdk.products.listAll()) {
      const meta = product.metadata ?? {};
      if (
        meta.app === 'agentic' &&
        meta.plan === plan &&
        Number(meta.priceUsd) === priceUsd &&
        product.status !== 'archived'
      ) {
        this.productIds.set(key, product.id);
        return product.id;
      }
    }
    const created = await this.sdk.products.create(
      {
        name: `Agentic ${name}`,
        description: `The ${name} plan, billed monthly.`,
        price: { currency: 'USD', amount: priceUsd.toFixed(2) },
        billing_cycle: { interval: 'month', frequency: 1 },
        metadata: { app: 'agentic', plan, priceUsd },
      },
      { idempotencyKey: `agentic-plan-${key}` },
    );
    this.productIds.set(key, created.id);
    return created.id;
  }

  // Which of our plans a Bachs product is, or null if it is not ours.
  async planOf(productId: string): Promise<string | null> {
    if (this.planNames.has(productId)) {
      return this.planNames.get(productId) ?? null;
    }
    const product = await this.sdk.products.get(productId);
    const meta = product.metadata ?? {};
    const plan =
      meta.app === 'agentic' && typeof meta.plan === 'string'
        ? meta.plan
        : null;
    this.planNames.set(productId, plan);
    return plan;
  }

  // Starts a hosted checkout and returns the page to send the user to.
  async checkout(
    input: CreateCheckoutSessionRequest,
    idempotencyKey: string,
  ): Promise<{ id: string; url: string; expiresAt: string }> {
    const session = await this.sdk.checkoutSessions.create(input, {
      idempotencyKey,
    });
    return {
      id: session.checkout_id,
      url: session.checkout_url,
      expiresAt: session.expires_at,
    };
  }

  // A short-lived link to Bachs's page where the user manages their card,
  // invoices and subscription.
  async portal(customerId: string): Promise<string> {
    const session = await this.sdk.customerPortal.createSession(customerId);
    return session.url;
  }

  // Cancels a card subscription at the end of the paid period.
  async cancelAtPeriodEnd(subscriptionId: string): Promise<void> {
    await this.sdk.subscriptions.cancel(subscriptionId, {
      cancel_at_period_end: true,
    });
  }

  // Checks a webhook really came from Bachs (signed, and recent). Null if not.
  event(rawBody: string, headers: WebhookHeaders): WebhookEvent | null {
    if (!this.client || !this.webhookSecret) {
      throw new ServiceUnavailableException(
        'Payment webhooks are not set up: set BACHS_WEBHOOK_SECRET.',
      );
    }
    try {
      return this.client.webhooks.constructEvent(
        rawBody,
        headers,
        this.webhookSecret,
      );
    } catch {
      return null;
    }
  }
}
