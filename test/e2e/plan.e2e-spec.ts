import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// Tests never call Cencori (no key), so a plan stops at once with a clear
// reason. The step-by-step work is covered by test/unit/plan.service.spec.ts.
describe('Plans (e2e)', () => {
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

  it('needs a signed-in user', async () => {
    await request(app.getHttpServer()).get('/v1/plans').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-plan-${randomUUID()}@example.com`;
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
      if (user) await db.plan.deleteMany({ where: { userId: user.id } });
      await db.user.deleteMany({ where: { email } });
    });

    it('starts, lists, resumes and deletes a plan', async () => {
      const started = await call()
        .post('/v1/plans')
        .set('Cookie', cookies)
        .send({ goal: 'Compare three CRM tools and write a short report.' })
        .expect(200);
      const plan = started.body.data;
      expect(plan).toMatchObject({
        goal: 'Compare three CRM tools and write a short report.',
        botId: null,
        status: 'failed',
        summary: 'The AI service is not set up.',
        steps: [],
      });

      const listed = await call()
        .get('/v1/plans')
        .set('Cookie', cookies)
        .expect(200);
      expect(listed.body.data.map((p: { id: string }) => p.id)).toEqual([
        plan.id,
      ]);

      // A failed plan can't be stopped, but can be resumed.
      await call()
        .post(`/v1/plans/${plan.id}/stop`)
        .set('Cookie', cookies)
        .expect(400);
      const resumed = await call()
        .post(`/v1/plans/${plan.id}/resume`)
        .set('Cookie', cookies)
        .expect(200);
      expect(resumed.body.data.status).toBe('failed');

      await call()
        .delete(`/v1/plans/${plan.id}`)
        .set('Cookie', cookies)
        .expect(204);
      await call()
        .get(`/v1/plans/${plan.id}`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it("refuses a bot that isn't the user's", async () => {
      await call()
        .post('/v1/plans')
        .set('Cookie', cookies)
        .send({ goal: 'Plan my week.', botId: randomUUID() })
        .expect(404);
    });
  });
});
