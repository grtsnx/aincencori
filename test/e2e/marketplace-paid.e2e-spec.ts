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

// A stand-in for Bachs (Connect): creators, their checks, and split checkouts.
const state = { canBePaid: false };
const splits: Record<string, unknown>[] = [];
let creatorAccountCreations = 0;
const fakeBachs = {
  isConfigured: true,
  createCreatorAccount: () => {
    creatorAccountCreations += 1;
    return Promise.resolve(`acct_${randomUUID()}`);
  },
  creatorOnboardingLink: () =>
    Promise.resolve('https://connect.bachs.io/onboarding/alnk_1'),
  creatorCanBePaid: () => Promise.resolve(state.canBePaid),
  splitCheckout: (input: Record<string, unknown>) => {
    splits.push(input);
    return Promise.resolve({
      id: 'chk_1',
      url: 'https://checkout.bachs.io/c/chk_1',
      expiresAt: '2026-11-14T10:00:00.000Z',
    });
  },
  event: (raw: string, headers: Record<string, string>) =>
    headers['x-bachs-signature-v2'] === 'ok' ? JSON.parse(raw) : null,
};

describe.skipIf(!process.env.DATABASE_URL)('Paid marketplace (e2e)', () => {
  let app: INestApplication;
  const call = () => request(app.getHttpServer());
  const db = () => app.get(PrismaService).db;
  const creatorEmail = `e2e-creator-${randomUUID()}@example.com`;
  const buyerEmail = `e2e-buyer-${randomUUID()}@example.com`;
  let creator: string[];
  let buyer: string[];
  let buyerId: string;
  let listingId: string;

  const signIn = async (email: string) => {
    await call()
      .post('/v1/auth/email-otp/send-verification-otp')
      .send({ email, type: 'sign-in' })
      .expect(200);
    const otp = app.get(EmailService).lastTestEmail(email)?.otpCode;
    const response = await call()
      .post('/v1/auth/sign-in/email-otp')
      .send({ email, otp })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  };
  const hook = (
    event: Record<string, unknown>,
    eventId = `evt_${randomUUID()}`,
  ) =>
    call()
      .post('/v1/billing/bachs')
      .set('content-type', 'application/json')
      .set('x-bachs-signature-v2', 'ok')
      .send(JSON.stringify({ id: eventId, ...event }))
      .expect(204);
  const paid = (checkoutId: string, eventId?: string) =>
    hook({
      type: 'checkout.completed',
      data: {
        checkout_id: checkoutId,
        payment_status: 'paid',
        amount: '15.00',
        currency: 'USD',
        metadata: { userId: buyerId, kind: 'hire', listingId },
      },
    }, eventId);

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
    creator = await signIn(creatorEmail);
    buyer = await signIn(buyerEmail);
    buyerId = (
      await db().user.findUniqueOrThrow({ where: { email: buyerEmail } })
    ).id;
  });

  afterAll(async () => {
    const users = await db().user.findMany({
      where: { email: { in: [creatorEmail, buyerEmail] } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    await db().hire.deleteMany({ where: { buyerId: { in: ids } } });
    await db().creatorAccount.deleteMany({ where: { userId: { in: ids } } });
    await db().listing.deleteMany({ where: { userId: { in: ids } } });
    await db().bot.deleteMany({ where: { userId: { in: ids } } });
    await db().activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db().billingEvent.deleteMany({ where: { userId: { in: ids } } });
    await db().user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('lets a creator sell a bot once payouts are set up and it is approved', async () => {
    const bot = await call()
      .post('/v1/bots')
      .set('Cookie', creator)
      .send({
        name: 'Proposal Bot',
        description: 'Writes winning proposals.',
        instructions: 'SECRET RECIPE: always open with the client’s goal.',
      })
      .expect(200);

    // Selling needs payouts first.
    await call()
      .post('/v1/marketplace')
      .set('Cookie', creator)
      .send({
        botId: bot.body.data.id,
        category: 'sales',
        priceType: 'monthly',
        priceUsd: 15,
      })
      .expect(400);
    const setups = await Promise.all([
      call()
        .post('/v1/marketplace/payouts')
        .set('Cookie', creator)
        .send({ country: 'ng' }),
      call()
        .post('/v1/marketplace/payouts')
        .set('Cookie', creator)
        .send({ country: 'ng' }),
    ]);
    expect(setups.map(({ status }) => status)).toEqual([200, 200]);
    const setup = setups[0];
    expect(setup.body.data).toMatchObject({
      connected: true,
      payoutsActive: false,
      setupUrl: 'https://connect.bachs.io/onboarding/alnk_1',
      feePercent: 20,
    });
    expect(creatorAccountCreations).toBe(1);
    // A paid price needs an amount.
    await call()
      .post('/v1/marketplace')
      .set('Cookie', creator)
      .send({
        botId: bot.body.data.id,
        category: 'sales',
        priceType: 'monthly',
      })
      .expect(400);
    const listed = await call()
      .post('/v1/marketplace')
      .set('Cookie', creator)
      .send({
        botId: bot.body.data.id,
        category: 'sales',
        priceType: 'monthly',
        priceUsd: 15,
      })
      .expect(200);
    listingId = listed.body.data.id;
    // Staff approve it (after the safety review).
    await db().listing.update({
      where: { id: listingId },
      data: { status: 'published', publishedAt: new Date() },
    });

    // Buyers see what it does, not its instructions.
    const seen = await call()
      .get(`/v1/marketplace/${listingId}`)
      .set('Cookie', buyer)
      .expect(200);
    expect(seen.body.data).toMatchObject({
      priceType: 'monthly',
      priceUsd: 15,
      locked: true,
      instructions: '',
    });
    await call()
      .post(`/v1/marketplace/${listingId}/import`)
      .set('Cookie', buyer)
      .expect(402);
    // Not until the creator can be paid.
    await call()
      .post(`/v1/marketplace/${listingId}/hire`)
      .set('Cookie', buyer)
      .send({ currency: 'USD' })
      .expect(409);

    state.canBePaid = true;
    const account = (
      await db().creatorAccount.findFirstOrThrow({
        where: { payoutsActive: false },
        orderBy: { createdAt: 'desc' },
      })
    ).bachsAccountId;
    await hook({ type: 'account.updated', data: { account } });

    const checkout = await call()
      .post(`/v1/marketplace/${listingId}/hire`)
      .set('Cookie', buyer)
      .send({ currency: 'USD' })
      .expect(200);
    expect(checkout.body.data).toMatchObject({ price: 15, currency: 'USD' });
    // We keep 20%; the rest goes to the creator's account.
    expect(splits.at(-1)).toMatchObject({
      amount: '15.00',
      platformFee: '3.00',
      destination: account,
      currency: 'USD',
    });
  });

  it('gives the buyer the bot when Bachs confirms, a month at a time', async () => {
    await Promise.all([
      paid('chk_hire_1', 'evt_hire_duplicate'),
      paid('chk_hire_1', 'evt_hire_duplicate'),
    ]);
    // Sent twice: counted once.
    await paid('chk_hire_1');
    const hires = await call()
      .get('/v1/marketplace/hires')
      .set('Cookie', buyer)
      .expect(200);
    expect(hires.body.data).toHaveLength(1);
    const botId = hires.body.data[0].botId as string;
    const bot = await db().bot.findUniqueOrThrow({ where: { id: botId } });
    expect(bot.userId).toBe(buyerId);
    expect(bot.instructions).toContain('SECRET RECIPE');
    const firstUntil = bot.hiredUntil!.getTime();

    // Paying again adds a month to the same copy.
    await paid('chk_hire_2');
    const renewed = await db().bot.findUniqueOrThrow({ where: { id: botId } });
    expect(renewed.hiredUntil!.getTime() - firstUntil).toBeGreaterThan(
      29 * 86_400_000,
    );
    expect(await db().bot.count({ where: { userId: buyerId } })).toBe(1);

    const earnings = await call()
      .get('/v1/marketplace/earnings')
      .set('Cookie', creator)
      .expect(200);
    expect(earnings.body.data.totals).toEqual([
      { currency: 'USD', sales: 2, gross: '30.00', yours: '24.00' },
    ]);

    // When the paid time runs out, the bot pauses.
    await db().bot.update({
      where: { id: botId },
      data: { hiredUntil: new Date(Date.now() - 1000) },
    });
    const stopped = await call()
      .post('/v1/chat')
      .set('Cookie', buyer)
      .send({ message: 'Write a proposal', botId });
    expect(stopped.status).toBe(402);
    expect(stopped.body.message).toContain('Renew it on the marketplace');
  });
});
