import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// Tests never call Cencori (no key), so the AI review doesn't run: shared
// bots wait for staff. The AI review is covered by
// test/unit/marketplace.service.spec.ts.
describe('Marketplace (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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

  it('lets anyone browse, but only signed-in users share', async () => {
    await request(app.getHttpServer()).get('/v1/marketplace').expect(200);
    await request(app.getHttpServer())
      .post('/v1/marketplace')
      .send({ botId: 'x', category: 'sales' })
      .expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const author = `e2e-market-a-${randomUUID()}@example.com`;
    const reader = `e2e-market-b-${randomUUID()}@example.com`;
    const cookies: Record<string, string[]> = {};
    const call = () => request(app.getHttpServer());
    const db = () => app.get(PrismaService).db;

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

    beforeAll(async () => {
      cookies.author = await signIn(author);
      cookies.reader = await signIn(reader);
    });

    afterAll(async () => {
      const users = await db().user.findMany({
        where: { email: { in: [author, reader] } },
      });
      const ids = users.map((user) => user.id);
      await db().bot.deleteMany({ where: { userId: { in: ids } } });
      await db().user.deleteMany({ where: { id: { in: ids } } });
    });

    it('shares a copy of a bot, reviewed before anyone sees it', async () => {
      const bot = await call()
        .post('/v1/bots')
        .set('Cookie', cookies.author)
        .send({ name: 'Cold Email Bot', instructions: 'Write cold emails.' })
        .expect(200);
      const botId = bot.body.data.id as string;

      // People need to know what it does.
      await call()
        .post('/v1/marketplace')
        .set('Cookie', cookies.author)
        .send({ botId, category: 'sales' })
        .expect(400);

      await call()
        .patch(`/v1/bots/${botId}`)
        .set('Cookie', cookies.author)
        .send({ description: 'Writes short cold emails that get replies.' })
        .expect(200);
      await call()
        .post(`/v1/bots/${botId}/skills`)
        .set('Cookie', cookies.author)
        .send({
          name: 'follow-up',
          description: 'A follow-up after no reply.',
          instructions: '1. Be brief.\n2. Add one new reason to reply.',
        })
        .expect(200);
      await call()
        .post(`/v1/bots/${botId}/memories`)
        .set('Cookie', cookies.author)
        .send({ text: 'My biggest client is Acme.' })
        .expect(200);

      const shared = await call()
        .post('/v1/marketplace')
        .set('Cookie', cookies.author)
        .send({ botId, category: 'sales', authorName: 'Ada' })
        .expect(200);
      const listing = shared.body.data;
      expect(listing).toMatchObject({
        botId,
        name: 'Cold Email Bot',
        authorName: 'Ada',
        status: 'reviewing',
        skills: [{ name: 'follow-up' }],
      });

      // Hidden from others while it is reviewed; its author still sees it.
      await call().get(`/v1/marketplace/${listing.id}`).expect(404);
      await call()
        .get(`/v1/marketplace/${listing.id}`)
        .set('Cookie', cookies.author)
        .expect(200);
      const mine = await call()
        .get('/v1/marketplace/mine')
        .set('Cookie', cookies.author)
        .expect(200);
      expect(mine.body.data).toHaveLength(1);

      // Only staff review.
      await call()
        .post(`/v1/admin/marketplace/${listing.id}/approve`)
        .set('Cookie', cookies.author)
        .expect(403);

      // Approved (as staff would): now everyone sees it and can copy it.
      await db().listing.update({
        where: { id: listing.id },
        data: { status: 'published', publishedAt: new Date() },
      });
      const browsed = await call()
        .get('/v1/marketplace')
        .query({ q: 'cold email', category: 'sales' })
        .expect(200);
      expect(browsed.body.data.map((l: { id: string }) => l.id)).toContain(
        listing.id,
      );
      const preview = await call()
        .get(`/v1/marketplace/${listing.id}`)
        .expect(200);
      expect(preview.body.data).not.toHaveProperty('status');
      expect(preview.body.data).not.toHaveProperty('botId');

      const copied = await call()
        .post(`/v1/marketplace/${listing.id}/import`)
        .set('Cookie', cookies.reader)
        .expect(200);
      const copy = copied.body.data;
      expect(copy).toMatchObject({
        name: 'Cold Email Bot',
        description: 'Writes short cold emails that get replies.',
        integrations: [],
        documents: [],
      });
      expect(copy.id).not.toBe(botId);
      // Skills come along; memories never do.
      const skills = await call()
        .get(`/v1/bots/${copy.id}/skills`)
        .set('Cookie', cookies.reader)
        .expect(200);
      expect(skills.body.data.map((s: { name: string }) => s.name)).toEqual([
        'follow-up',
      ]);
      const memories = await call()
        .get(`/v1/bots/${copy.id}/memories`)
        .set('Cookie', cookies.reader)
        .expect(200);
      expect(memories.body.data).toEqual([]);

      const counted = await call()
        .get(`/v1/marketplace/${listing.id}`)
        .expect(200);
      expect(counted.body.data.importCount).toBe(1);

      // Only its author can take it down; the copy stays.
      await call()
        .delete(`/v1/marketplace/${listing.id}`)
        .set('Cookie', cookies.reader)
        .expect(404);
      await call()
        .delete(`/v1/marketplace/${listing.id}`)
        .set('Cookie', cookies.author)
        .expect(204);
      await call().get(`/v1/marketplace/${listing.id}`).expect(404);
      await call()
        .get(`/v1/bots/${copy.id}`)
        .set('Cookie', cookies.reader)
        .expect(200);
    });

    it('rejects a bot that carries a key or password', async () => {
      const bot = await call()
        .post('/v1/bots')
        .set('Cookie', cookies.author)
        .send({
          name: 'Leaky Bot',
          description: 'Posts to our API.',
          instructions:
            'Use the key sk-abcdefghijklmnopqrstuvwxyz123456 for every call.',
        })
        .expect(200);
      const shared = await call()
        .post('/v1/marketplace')
        .set('Cookie', cookies.author)
        .send({ botId: bot.body.data.id, category: 'other' })
        .expect(200);
      expect(shared.body.data).toMatchObject({
        status: 'rejected',
        reviewNote: expect.stringContaining('key or password'),
      });
    });
  });
});
