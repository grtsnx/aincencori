import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';

// Tests run jobs straight away (no Redis) and never call Cencori.
describe('Routines (e2e)', () => {
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
    await request(app.getHttpServer()).get('/v1/routines').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-routine-${randomUUID()}@example.com`;
    let cookies: string[];

    beforeAll(async () => {
      const server = app.getHttpServer();
      await request(server)
        .post('/v1/auth/email-otp/send-verification-otp')
        .send({ email, type: 'sign-in' })
        .expect(200);
      const otp = app.get(EmailService).lastTestEmail(email)?.otpCode;
      const response = await request(server)
        .post('/v1/auth/sign-in/email-otp')
        .send({ email, otp })
        .expect(200);
      cookies = response.headers['set-cookie'] as unknown as string[];
    });

    afterAll(async () => {
      const db = app.get(PrismaService).db;
      const user = await db.user.findUnique({ where: { email } });
      if (user) await db.routine.deleteMany({ where: { userId: user.id } });
      await db.user.deleteMany({ where: { email } });
    });

    it('creates, schedules, runs, pauses and deletes a routine', async () => {
      const server = app.getHttpServer();
      const queue = app.get(BullmqService);

      const created = await request(server)
        .post('/v1/routines')
        .set('Cookie', cookies)
        .send({
          name: 'Morning news',
          prompt: 'Summarize the news.',
          cron: '0 8 * * *',
          timezone: 'Africa/Lagos',
        })
        .expect(200);
      const routine = created.body.data;
      expect(routine).toMatchObject({ enabled: true, lastStatus: null });
      expect(routine.nextRunAt).toMatch(/T07:00:00\.000Z$/); // 8:00 in Lagos
      expect(queue.testSchedule('routine-run', routine.id)).toEqual({
        cron: '0 8 * * *',
        timezone: 'Africa/Lagos',
      });

      // Cencori is not set up in tests, so the run is recorded as failed.
      const ran = await request(server)
        .post(`/v1/routines/${routine.id}/run`)
        .set('Cookie', cookies)
        .expect(200);
      expect(ran.body.data.lastStatus).toBe('failed');
      expect(ran.body.data.lastRunAt).not.toBeNull();

      const paused = await request(server)
        .patch(`/v1/routines/${routine.id}`)
        .set('Cookie', cookies)
        .send({ enabled: false })
        .expect(200);
      expect(paused.body.data.nextRunAt).toBeNull();
      expect(queue.testSchedule('routine-run', routine.id)).toBeUndefined();

      const list = await request(server)
        .get('/v1/routines')
        .set('Cookie', cookies)
        .expect(200);
      expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([
        routine.id,
      ]);

      await request(server)
        .get(`/v1/routines/${routine.id}/runs`)
        .set('Cookie', cookies)
        .expect(200);

      await request(server)
        .delete(`/v1/routines/${routine.id}`)
        .set('Cookie', cookies)
        .expect(204);
      await request(server)
        .get(`/v1/routines/${routine.id}`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('refuses bad or too-frequent schedules', async () => {
      const server = app.getHttpServer();
      const base = { name: 'x', prompt: 'y', timezone: 'UTC' };
      await request(server)
        .post('/v1/routines')
        .set('Cookie', cookies)
        .send({ ...base, cron: 'every day' })
        .expect(400);
      await request(server)
        .post('/v1/routines')
        .set('Cookie', cookies)
        .send({ ...base, cron: '* * * * *' })
        .expect(400);
    });

    it("hides other people's routines", async () => {
      const db = app.get(PrismaService).db;
      const id = randomUUID();
      await db.routine.create({
        data: {
          id,
          userId: 'someone-else',
          name: 'Theirs',
          prompt: 'x',
          cron: '0 8 * * *',
          timezone: 'UTC',
        },
      });
      try {
        await request(app.getHttpServer())
          .get(`/v1/routines/${id}`)
          .set('Cookie', cookies)
          .expect(404);
        await request(app.getHttpServer())
          .post(`/v1/routines/${id}/run`)
          .set('Cookie', cookies)
          .expect(404);
      } finally {
        await db.routine.delete({ where: { id } });
      }
    });
  });
});
