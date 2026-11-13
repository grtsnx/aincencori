import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// Tests never call Cencori (no key), so app sign-ins are not exercised here.
describe('Bots (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ logger: false });
    configureApplication(
      app,
      validateEnvironment({
        NODE_ENV: 'test',
        SWAGGER_ENABLED: true,
        CORS_ORIGINS: 'https://app.example.com',
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('needs a signed-in user', async () => {
    await request(app.getHttpServer()).get('/v1/bots').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-bot-${randomUUID()}@example.com`;
    let cookies: string[];
    const call = () => request(app.getHttpServer());

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
    });

    afterAll(async () => {
      const db = app.get(PrismaService).db;
      const user = await db.user.findUnique({ where: { email } });
      if (user) {
        await db.bot.deleteMany({ where: { userId: user.id } });
        await db.integration.deleteMany({ where: { userId: user.id } });
      }
      await db.user.deleteMany({ where: { email } });
    });

    it('creates a bot with no integrations at all', async () => {
      const created = await call()
        .post('/v1/bots')
        .set('Cookie', cookies)
        .send({ name: 'Family Bot', instructions: 'Be kind.' })
        .expect(200);
      expect(created.body.data).toMatchObject({
        name: 'Family Bot',
        enabled: true,
        integrations: [],
      });
    });

    it('gives different bots different integrations', async () => {
      const integration = async (name: string) =>
        (
          await call()
            .post('/v1/integrations')
            .set('Cookie', cookies)
            .send({ name, url: 'http://127.0.0.1:9/mcp' })
            .expect(200)
        ).body.data.id as string;
      const work = await integration('work-mail');
      const personal = await integration('personal-mail');

      const sales = await call()
        .post('/v1/bots')
        .set('Cookie', cookies)
        .send({
          name: 'Sales Bot',
          instructions: 'Answer sales emails.',
          integrationIds: [work],
        })
        .expect(200);
      expect(sales.body.data.integrations).toEqual([
        { id: work, name: 'work-mail', app: 'mcp' },
      ]);

      // Swap to the other one, then to none.
      const swapped = await call()
        .patch(`/v1/bots/${sales.body.data.id}`)
        .set('Cookie', cookies)
        .send({ integrationIds: [personal] })
        .expect(200);
      expect(
        swapped.body.data.integrations.map((i: { name: string }) => i.name),
      ).toEqual(['personal-mail']);
      const none = await call()
        .patch(`/v1/bots/${sales.body.data.id}`)
        .set('Cookie', cookies)
        .send({ integrationIds: [] })
        .expect(200);
      expect(none.body.data.integrations).toEqual([]);

      // Removing an integration takes it off the bots that used it.
      await call()
        .patch(`/v1/bots/${sales.body.data.id}`)
        .set('Cookie', cookies)
        .send({ integrationIds: [work, personal] })
        .expect(200);
      await call()
        .delete(`/v1/integrations/${work}`)
        .set('Cookie', cookies)
        .expect(204);
      const after = await call()
        .get(`/v1/bots/${sales.body.data.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(
        after.body.data.integrations.map((i: { name: string }) => i.name),
      ).toEqual(['personal-mail']);
    });

    it("refuses integrations that are not the user's", async () => {
      const db = app.get(PrismaService).db;
      const id = randomUUID();
      await db.integration.create({
        data: { id, userId: 'someone-else', name: `theirs-${id}`, url: 'x' },
      });
      try {
        await call()
          .post('/v1/bots')
          .set('Cookie', cookies)
          .send({ name: 'Sneaky', instructions: 'x', integrationIds: [id] })
          .expect(400);
      } finally {
        await db.integration.delete({ where: { id } });
      }
    });

    it("chats only with the user's own bots", async () => {
      const db = app.get(PrismaService).db;
      const theirs = randomUUID();
      await db.bot.create({
        data: {
          id: theirs,
          userId: 'someone-else',
          name: 'Theirs',
          instructions: 'x',
        },
      });
      try {
        await call()
          .post('/v1/chat')
          .set('Cookie', cookies)
          .send({ message: 'Hi', botId: theirs })
          .expect(404);
        await call()
          .get(`/v1/bots/${theirs}`)
          .set('Cookie', cookies)
          .expect(404);
      } finally {
        await db.bot.delete({ where: { id: theirs } });
      }

      // The user's own bot is found; the chat then stops at Cencori, which
      // is not set up in tests.
      const mine = await call()
        .post('/v1/bots')
        .set('Cookie', cookies)
        .send({ name: 'Mine', instructions: 'Be brief.' })
        .expect(200);
      await call()
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ message: 'Hi', botId: mine.body.data.id })
        .expect(503);

      await call()
        .delete(`/v1/bots/${mine.body.data.id}`)
        .set('Cookie', cookies)
        .expect(204);
    });
  });
});
