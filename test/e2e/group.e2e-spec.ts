import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// Tests never call Cencori (no key); live group chats are tested by hand.
describe('Groups (e2e)', () => {
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
    await request(app.getHttpServer()).get('/v1/groups').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-group-${randomUUID()}@example.com`;
    let cookies: string[];
    const call = () => request(app.getHttpServer());
    const bot = async (name: string) =>
      (
        await call()
          .post('/v1/bots')
          .set('Cookie', cookies)
          .send({
            name,
            description: `${name} does things.`,
            instructions: 'Help.',
          })
          .expect(200)
      ).body.data.id as string;

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
        await db.botGroup.deleteMany({ where: { userId: user.id } });
        await db.bot.deleteMany({ where: { userId: user.id } });
      }
      await db.user.deleteMany({ where: { email } });
    });

    it('puts bots on a team, changes it, and keeps the bots when it goes', async () => {
      const [prospector, sales, writer] = [
        await bot('Prospector'),
        await bot('Sales Bot'),
        await bot('Writer Bot'),
      ];

      const created = await call()
        .post('/v1/groups')
        .set('Cookie', cookies)
        .send({ name: 'Sales team', botIds: [prospector, sales] })
        .expect(200);
      const group = created.body.data;
      expect(group.bots.map((b: { name: string }) => b.name).sort()).toEqual([
        'Prospector',
        'Sales Bot',
      ]);

      const changed = await call()
        .patch(`/v1/groups/${group.id}`)
        .set('Cookie', cookies)
        .send({ instructions: 'Prospector first.', botIds: [sales, writer] })
        .expect(200);
      expect(changed.body.data.instructions).toBe('Prospector first.');
      expect(
        changed.body.data.bots.map((b: { name: string }) => b.name).sort(),
      ).toEqual(['Sales Bot', 'Writer Bot']);

      // A deleted bot leaves the group by itself.
      await call()
        .delete(`/v1/bots/${writer}`)
        .set('Cookie', cookies)
        .expect(204);
      const after = await call()
        .get(`/v1/groups/${group.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(after.body.data.bots).toHaveLength(1);

      // The group is found for a chat; the chat then stops at Cencori,
      // which is not set up in tests.
      await call()
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ message: 'Hi team', groupId: group.id })
        .expect(503);

      await call()
        .delete(`/v1/groups/${group.id}`)
        .set('Cookie', cookies)
        .expect(204);
      await call().get(`/v1/bots/${sales}`).set('Cookie', cookies).expect(200);
    });

    it("needs 2 to 6 of the user's own bots, with different names", async () => {
      const one = await bot('Solo');
      await call()
        .post('/v1/groups')
        .set('Cookie', cookies)
        .send({ name: 'Too small', botIds: [one] })
        .expect(400);
      await call()
        .post('/v1/groups')
        .set('Cookie', cookies)
        .send({ name: 'Not mine', botIds: [one, 'someone-elses-bot'] })
        .expect(400);
      const twin = await bot('Solo');
      await call()
        .post('/v1/groups')
        .set('Cookie', cookies)
        .send({ name: 'Twins', botIds: [one, twin] })
        .expect(400);
    });

    it("hides other people's groups", async () => {
      const db = app.get(PrismaService).db;
      const id = randomUUID();
      await db.botGroup.create({
        data: { id, userId: 'someone-else', name: 'Theirs' },
      });
      try {
        await call().get(`/v1/groups/${id}`).set('Cookie', cookies).expect(404);
        await call()
          .post('/v1/chat')
          .set('Cookie', cookies)
          .send({ message: 'Hi', groupId: id })
          .expect(404);
      } finally {
        await db.botGroup.delete({ where: { id } });
      }
    });
  });
});
