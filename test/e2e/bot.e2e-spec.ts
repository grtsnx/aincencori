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
        await db.routine.deleteMany({ where: { userId: user.id } });
        await db.bot.deleteMany({ where: { userId: user.id } });
        await db.integration.deleteMany({ where: { userId: user.id } });
      }
      await db.user.deleteMany({ where: { email } });
    });

    it('applies a change the bot suggested only when the user accepts it', async () => {
      const db = app.get(PrismaService).db;
      const bot = await call()
        .post('/v1/bots')
        .set('Cookie', cookies)
        .send({ name: 'Learning Bot', instructions: 'Write sales emails.' })
        .expect(200);
      const botId = bot.body.data.id as string;
      const userId = (await db.user.findUniqueOrThrow({ where: { email } })).id;
      // As the learner would leave them after reading a chat.
      await db.botSuggestion.createMany({
        data: [
          {
            id: `${botId}-s1`,
            botId,
            userId,
            kind: 'instructions',
            title: 'Ask Tola about big discounts',
            reason: 'You said Tola approves discounts above 10%.',
            instructions: 'Write sales emails. Discounts above 10% need Tola.',
          },
          {
            id: `${botId}-s2`,
            botId,
            userId,
            kind: 'skill',
            title: 'Weekly report',
            reason: 'You asked for it three times.',
            skill: {
              name: 'weekly-report',
              description: 'The Friday report.',
              instructions: '1. Pull this week’s deals.',
            },
          },
        ],
      });

      const listed = await call()
        .get(`/v1/bots/${botId}/suggestions`)
        .set('Cookie', cookies)
        .expect(200);
      expect(listed.body.data).toHaveLength(2);

      await call()
        .post(`/v1/bots/${botId}/suggestions/${botId}-s1/accept`)
        .set('Cookie', cookies)
        .expect(200);
      const after = await call()
        .get(`/v1/bots/${botId}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(after.body.data.instructions).toBe(
        'Write sales emails. Discounts above 10% need Tola.',
      );
      // Once decided, it can't be applied again.
      await call()
        .post(`/v1/bots/${botId}/suggestions/${botId}-s1/accept`)
        .set('Cookie', cookies)
        .expect(409);

      const dismissed = await call()
        .post(`/v1/bots/${botId}/suggestions/${botId}-s2/dismiss`)
        .set('Cookie', cookies)
        .expect(200);
      expect(dismissed.body.data.status).toBe('dismissed');
      const skills = await call()
        .get(`/v1/bots/${botId}/skills`)
        .set('Cookie', cookies)
        .expect(200);
      expect(skills.body.data).toEqual([]);
    });

    it('accepts a bot suggestion only once when requests race', async () => {
      const db = app.get(PrismaService).db;
      const bot = await call()
        .post('/v1/bots')
        .set('Cookie', cookies)
        .send({ name: 'Concurrent Bot', instructions: 'Be helpful.' })
        .expect(200);
      const botId = bot.body.data.id as string;
      const userId = (await db.user.findUniqueOrThrow({ where: { email } })).id;
      const suggestionId = `${botId}-race`;
      await db.botSuggestion.create({
        data: {
          id: suggestionId,
          botId,
          userId,
          kind: 'instructions',
          title: 'Be precise',
          reason: 'The user corrected an answer.',
          instructions: 'Be precise and concise.',
        },
      });

      const results = await Promise.all(
        Array.from({ length: 2 }, () =>
          call()
            .post(`/v1/bots/${botId}/suggestions/${suggestionId}/accept`)
            .set('Cookie', cookies),
        ),
      );

      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      const saved = await db.botSuggestion.findUniqueOrThrow({
        where: { id: suggestionId },
      });
      expect(saved.status).toBe('accepted');
      const updated = await call()
        .get(`/v1/bots/${botId}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(updated.body.data.instructions).toBe('Be precise and concise.');
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

    it('gives a bot memories, skills and routines, all optional', async () => {
      const bot = (
        await call()
          .post('/v1/bots')
          .set('Cookie', cookies)
          .send({
            name: 'Prospector',
            description: 'Finds and researches sales leads.',
            instructions: 'Find leads.',
          })
          .expect(200)
      ).body.data;
      expect(bot.description).toBe('Finds and researches sales leads.');
      const base = `/v1/bots/${bot.id}`;

      // Memories
      const memory = await call()
        .post(`${base}/memories`)
        .set('Cookie', cookies)
        .send({ text: 'My company is Acme.' })
        .expect(200);
      const memories = await call()
        .get(`${base}/memories`)
        .set('Cookie', cookies)
        .expect(200);
      expect(memories.body.data.map((m: { text: string }) => m.text)).toEqual([
        'My company is Acme.',
      ]);
      await call()
        .delete(`${base}/memories/${memory.body.data.id}`)
        .set('Cookie', cookies)
        .expect(204);

      // Skills: the same name twice is refused; a change is a new version.
      const skill = {
        name: 'follow-up',
        description: 'Follow up.',
        instructions: '1. Thank them.',
      };
      const created = await call()
        .post(`${base}/skills`)
        .set('Cookie', cookies)
        .send(skill)
        .expect(200);
      expect(created.body.data.version).toBe(1);
      await call()
        .post(`${base}/skills`)
        .set('Cookie', cookies)
        .send(skill)
        .expect(409);
      const changed = await call()
        .patch(`${base}/skills/${created.body.data.id}`)
        .set('Cookie', cookies)
        .send({ instructions: '1. Thank them.\n2. Ask for a call.' })
        .expect(200);
      expect(changed.body.data.version).toBe(2);

      // A routine run by this bot; another person's bot is refused.
      const routine = await call()
        .post('/v1/routines')
        .set('Cookie', cookies)
        .send({
          name: 'Daily leads',
          prompt: 'Find 5 new leads.',
          cron: '0 9 * * *',
          timezone: 'Africa/Lagos',
          botId: bot.id,
        })
        .expect(200);
      expect(routine.body.data.botId).toBe(bot.id);
      const mine = await call()
        .get(`/v1/routines?botId=${bot.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(mine.body.data).toHaveLength(1);
      await call()
        .post('/v1/routines')
        .set('Cookie', cookies)
        .send({
          name: 'x',
          prompt: 'y',
          cron: '0 9 * * *',
          timezone: 'UTC',
          botId: 'not-my-bot',
        })
        .expect(400);

      // Deleting the bot takes its memories, skills and routines with it.
      await call().delete(base).set('Cookie', cookies).expect(204);
      const db = app.get(PrismaService).db;
      expect(await db.botSkill.count({ where: { botId: bot.id } })).toBe(0);
      expect(await db.routine.count({ where: { botId: bot.id } })).toBe(0);
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
