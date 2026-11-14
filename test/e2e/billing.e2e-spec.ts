import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { BachsService } from '@/lib/bachs/bachs.service.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { UsageService } from '@/modules/usage/usage.service.js';

// A stand-in for Bachs: records checkouts, and treats a webhook as signed
// when its signature header says "ok".
const checkouts: Record<string, unknown>[] = [];
const fakeBachs = {
  isConfigured: true,
  planProduct: (plan: string) => Promise.resolve(`prod_${plan}`),
  planOf: (productId: string) =>
    Promise.resolve(productId.startsWith('prod_') ? productId.slice(5) : null),
  checkout: (input: Record<string, unknown>) => {
    checkouts.push(input);
    return Promise.resolve({
      id: 'chk_1',
      url: 'https://checkout.bachs.io/c/chk_1',
      expiresAt: '2026-11-14T10:00:00.000Z',
    });
  },
  portal: () => Promise.resolve('https://portal.bachs.io/s/psn_1'),
  cancelAtPeriodEnd: () => Promise.resolve(),
  event: (raw: string, headers: Record<string, string>) =>
    headers['x-bachs-signature-v2'] === 'ok' ? JSON.parse(raw) : null,
};

describe('Billing (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BachsService)
      .useValue(fakeBachs)
      .compile();
    app = moduleFixture.createNestApplication({ logger: false });
    configureApplication(
      app,
      validateEnvironment({ NODE_ENV: 'test', SWAGGER_ENABLED: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const call = () => request(app.getHttpServer());

  it('shows prices to anyone, in naira for Nigeria and dollars elsewhere', async () => {
    const usd = await call().get('/v1/billing/plans').expect(200);
    expect(usd.body.data.currency).toBe('USD');
    expect(usd.body.data.trialDays).toBe(7);
    expect(usd.body.data.plans).toHaveLength(6);
    expect(usd.body.data.plans).toContainEqual(
      expect.objectContaining({
        plan: 'pro',
        audience: 'individual',
        price: 29,
        renews: true,
      }),
    );
    expect(
      usd.body.data.plans.filter(
        (p: { audience: string }) => p.audience === 'business',
      ),
    ).toHaveLength(3);

    const ngn = await call()
      .get('/v1/billing/plans')
      .set('cf-ipcountry', 'NG')
      .expect(200);
    expect(ngn.body.data.currency).toBe('NGN');
    expect(ngn.body.data.plans).toContainEqual(
      expect.objectContaining({ plan: 'pro', price: 46_500, renews: false }),
    );
    // Asked for dollars: dollars, wherever they are.
    const asked = await call()
      .get('/v1/billing/plans?currency=USD')
      .set('cf-ipcountry', 'NG')
      .expect(200);
    expect(asked.body.data.currency).toBe('USD');
  });

  it('refuses webhooks that Bachs did not sign', async () => {
    await call()
      .post('/v1/billing/bachs')
      .set('content-type', 'application/json')
      .set('x-bachs-signature-v2', 'forged')
      .send('{"id":"evt_x","type":"checkout.completed","data":{}}')
      .expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-billing-${randomUUID()}@example.com`;
    let cookies: string[];
    let userId: string;
    const customerId = `cust_${randomUUID()}`;
    const db = () => app.get(PrismaService).db;

    const hook = (event: Record<string, unknown>) =>
      call()
        .post('/v1/billing/bachs')
        .set('content-type', 'application/json')
        .set('x-bachs-signature-v2', 'ok')
        .send(JSON.stringify(event))
        .expect(204);

    beforeAll(async () => {
      await call()
        .post('/v1/auth/email-otp/send-verification-otp')
        .send({ email, type: 'sign-in' })
        .expect(200);
      const otp = app.get(EmailService).lastTestEmail(email)?.otpCode;
      const response = await call()
        .post('/v1/auth/sign-in/email-otp')
        .send({ email, otp })
        .expect(200);
      cookies = response.headers['set-cookie'] as unknown as string[];
      userId = (await db().user.findUniqueOrThrow({ where: { email } })).id;
    });

    afterAll(async () => {
      await db().billingEvent.deleteMany({ where: { userId } });
      await db().billingPlan.deleteMany({ where: { userId } });
      await db().usageDay.deleteMany({ where: { userId } });
      await db().activityLog.deleteMany({ where: { userId } });
      await db().user.deleteMany({ where: { email } });
    });

    it('gives one free trial of a paid plan', async () => {
      const fresh = await call()
        .get('/v1/billing')
        .set('Cookie', cookies)
        .expect(200);
      expect(fresh.body.data).toMatchObject({
        plan: 'free',
        trialAvailable: true,
        hasPortal: false,
      });

      const trial = await call()
        .post('/v1/billing/trial')
        .set('Cookie', cookies)
        .send({ plan: 'pro' })
        .expect(200);
      expect(trial.body.data).toMatchObject({
        plan: 'pro',
        source: 'trial',
        status: 'trialing',
        trialAvailable: false,
      });
      const usage = await call()
        .get('/v1/usage')
        .set('Cookie', cookies)
        .expect(200);
      expect(usage.body.data).toMatchObject({
        plan: 'pro',
        monthlyLimitUsd: 20,
      });

      await call()
        .post('/v1/billing/trial')
        .set('Cookie', cookies)
        .send({ plan: 'scale' })
        .expect(409);
      await call()
        .post('/v1/billing/trial')
        .set('Cookie', cookies)
        .send({ plan: 'free' })
        .expect(400);

      // When the trial ends, it is Free again.
      await db().billingPlan.update({
        where: { userId },
        data: { paidUntil: new Date(Date.now() - 1000) },
      });
      const ended = await call()
        .get('/v1/usage')
        .set('Cookie', cookies)
        .expect(200);
      expect(ended.body.data).toMatchObject({
        plan: 'free',
        monthlyLimitUsd: 2,
      });
    });

    it('pays in naira for a month, and buys credits that are used after the allowance', async () => {
      const checkout = await call()
        .post('/v1/billing/checkout')
        .set('Cookie', cookies)
        .set('cf-ipcountry', 'NG')
        .send({ plan: 'pro' })
        .expect(200);
      expect(checkout.body.data.url).toBe('https://checkout.bachs.io/c/chk_1');
      expect(checkouts.at(-1)).toMatchObject({
        pricing: { currency: 'NGN', amount: '46500.00' },
        customer: { email },
        metadata: { userId, kind: 'prepaid', plan: 'pro' },
      });

      // Bachs says it was paid: Pro for 30 days.
      await hook({
        id: `evt_${randomUUID()}`,
        type: 'checkout.completed',
        data: {
          payment_status: 'paid',
          metadata: { userId, kind: 'prepaid', plan: 'pro' },
          customer: { customer_id: customerId },
        },
      });
      const paid = await call()
        .get('/v1/billing')
        .set('Cookie', cookies)
        .expect(200);
      expect(paid.body.data).toMatchObject({
        plan: 'pro',
        source: 'prepaid',
        currency: 'NGN',
        hasPortal: true,
      });

      await call()
        .post('/v1/billing/credits')
        .set('Cookie', cookies)
        .send({ pack: 'small', currency: 'USD' })
        .expect(200);
      expect(checkouts.at(-1)).toMatchObject({
        pricing: { currency: 'USD', amount: '10.00' },
        customer: { customer_id: customerId },
        metadata: { kind: 'credits', pack: 'small' },
      });
      const credits = {
        id: `evt_${randomUUID()}`,
        type: 'checkout.completed',
        data: {
          payment_status: 'paid',
          metadata: { userId, kind: 'credits', pack: 'small' },
        },
      };
      await hook(credits);
      // Sent twice by Bachs: counted once.
      await hook(credits);
      const usage = await call()
        .get('/v1/usage')
        .set('Cookie', cookies)
        .expect(200);
      expect(usage.body.data.creditUsd).toBe(8);

      // Pro allows $20 a month. Spending $25 takes $5 from the credits; the
      // AI keeps working while credits are left, then stops.
      const meter = app.get(UsageService);
      await meter.record(userId, 'chat', {
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 25,
      });
      const after = await call()
        .get('/v1/usage')
        .set('Cookie', cookies)
        .expect(200);
      expect(after.body.data).toMatchObject({ remainingUsd: 0, creditUsd: 3 });
      await expect(meter.assertAllowance(userId)).resolves.toBeUndefined();
      await meter.record(userId, 'chat', {
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 5,
      });
      await expect(meter.assertAllowance(userId)).rejects.toThrow('credits');
      await db().usageDay.deleteMany({ where: { userId } });
      await db().billingPlan.update({
        where: { userId },
        data: { creditUsd: 8 },
      });

      const portal = await call()
        .post('/v1/billing/portal')
        .set('Cookie', cookies)
        .expect(200);
      expect(portal.body.data.url).toContain('portal.bachs.io');
    });

    it('follows a dollar card subscription from start to end', async () => {
      const subscriptionId = `sub_${randomUUID()}`;
      await db().billingPlan.update({
        where: { userId },
        data: { plan: 'free', source: 'free', paidUntil: null },
      });
      await call()
        .post('/v1/billing/checkout')
        .set('Cookie', cookies)
        .send({ plan: 'team', currency: 'USD' })
        .expect(200);
      expect(checkouts.at(-1)).toMatchObject({
        product_cart: [{ product_id: 'prod_team' }],
        payment_method_types: ['USD_CARD'],
      });

      const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
      await hook({
        id: `evt_${randomUUID()}`,
        type: 'customer.subscription.created',
        data: {
          subscription_id: subscriptionId,
          product_id: 'prod_team',
          status: 'active',
          current_period_end: periodEnd,
          cancel_at_period_end: false,
          customer: { customer_id: customerId },
          metadata: { userId, kind: 'subscription', plan: 'team' },
        },
      });
      const active = await call()
        .get('/v1/billing')
        .set('Cookie', cookies)
        .expect(200);
      expect(active.body.data).toMatchObject({
        plan: 'team',
        source: 'subscription',
        status: 'active',
      });
      // Already paying by card: change it in the portal instead.
      await call()
        .post('/v1/billing/checkout')
        .set('Cookie', cookies)
        .send({ plan: 'scale', currency: 'USD' })
        .expect(409);

      const canceled = await call()
        .post('/v1/billing/cancel')
        .set('Cookie', cookies)
        .expect(200);
      expect(canceled.body.data).toMatchObject({
        plan: 'team',
        cancelAtPeriodEnd: true,
      });

      // No user id in this one: found by the subscription.
      await hook({
        id: `evt_${randomUUID()}`,
        type: 'customer.subscription.deleted',
        data: {
          subscription_id: subscriptionId,
          product_id: 'prod_team',
          status: 'canceled',
          customer: { customer_id: customerId },
        },
      });
      const ended = await call()
        .get('/v1/billing')
        .set('Cookie', cookies)
        .expect(200);
      expect(ended.body.data).toMatchObject({ plan: 'free', creditUsd: 8 });
    });
  });
});
