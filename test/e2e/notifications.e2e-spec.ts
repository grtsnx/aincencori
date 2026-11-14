import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { ApprovalService } from '@/modules/approval/approval.service.js';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  const call = () => request(app.getHttpServer());

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
    await call().get('/v1/notifications').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-notify-${randomUUID()}@example.com`;
    let cookies: string[];
    let userId: string;
    const db = () => app.get(PrismaService).db;

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
      for (const table of [
        'notification',
        'notificationSetting',
        'pushDevice',
        'pendingApproval',
        'activityLog',
      ] as const) {
        await (
          db()[table] as { deleteMany: (args: object) => Promise<unknown> }
        ).deleteMany({ where: { userId } });
      }
      await db().user.deleteMany({ where: { email } });
    });

    const inbox = async () =>
      (await call().get('/v1/notifications').set('Cookie', cookies).expect(200))
        .body.data as {
        items: {
          id: string;
          type: string;
          title: string;
          readAt: string | null;
        }[];
        unread: number;
      };

    it('tells the user when a routine waits for approval: in the app and by email', async () => {
      await app.get(ApprovalService).recordPending({
        userId,
        chatId: `ses_${randomUUID()}`,
        source: 'routine',
        items: [
          {
            callId: 'c1',
            toolName: 'create_routine',
            arguments: '{"name":"Water","cron":"0 8 * * *"}',
          },
        ],
        state: `state-${randomUUID()}`,
      });

      // Delivered in the background.
      let found = await inbox();
      for (let i = 0; i < 20 && found.items.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        found = await inbox();
      }
      expect(found.unread).toBe(1);
      expect(found.items[0]).toMatchObject({
        type: 'approval',
        title: 'A step is waiting for your approval',
        readAt: null,
      });
      // Approvals are emailed by default.
      expect(app.get(EmailService).lastTestEmail(email)).toMatchObject({
        title: 'A step is waiting for your approval',
        body: expect.stringContaining('A routine wants to: Create a routine'),
      });

      const read = await call()
        .post('/v1/notifications/read')
        .set('Cookie', cookies)
        .send({})
        .expect(200);
      expect(read.body.data.unread).toBe(0);
    });

    it('keeps each person’s choices per type, and their push devices', async () => {
      const defaults = await call()
        .get('/v1/notifications/settings')
        .set('Cookie', cookies)
        .expect(200);
      expect(defaults.body.data).toContainEqual(
        expect.objectContaining({ type: 'routine', email: false, push: true }),
      );

      const changed = await call()
        .put('/v1/notifications/settings')
        .set('Cookie', cookies)
        .send({ settings: [{ type: 'routine', email: true, push: false }] })
        .expect(200);
      expect(changed.body.data).toContainEqual(
        expect.objectContaining({ type: 'routine', email: true, push: false }),
      );
      await call()
        .put('/v1/notifications/settings')
        .set('Cookie', cookies)
        .send({ settings: [{ type: 'spam', email: true, push: true }] })
        .expect(400);

      const token = `fcm_${randomUUID()}`;
      await call()
        .post('/v1/notifications/devices')
        .set('Cookie', cookies)
        .send({ token, platform: 'web' })
        .expect(204);
      expect(await db().pushDevice.count({ where: { userId } })).toBe(1);
      await call()
        .delete(`/v1/notifications/devices/${token}`)
        .set('Cookie', cookies)
        .expect(204);
      await call()
        .delete(`/v1/notifications/devices/${token}`)
        .set('Cookie', cookies)
        .expect(404);
    });
  });
});
