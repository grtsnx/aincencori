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
import { UsageService } from '@/modules/usage/usage.service.js';

describe('Approvals, usage and activity (e2e)', () => {
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
    await request(app.getHttpServer()).get('/v1/usage').expect(401);
    await request(app.getHttpServer()).get('/v1/approvals').expect(401);
    await request(app.getHttpServer()).get('/v1/activity').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-usage-${randomUUID()}@example.com`;
    let cookies: string[];
    let userId: string;
    const call = () => request(app.getHttpServer());
    const db = () => app.get(PrismaService).db;

    const signIn = async () => {
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
      cookies = await signIn();
      userId = (await db().user.findUniqueOrThrow({ where: { email } })).id;
    });

    afterAll(async () => {
      // Deleted here directly, so the app's own clean-up does not run.
      for (const table of [
        'usageDay',
        'billingPlan',
        'toolRule',
        'pendingApproval',
        'activityLog',
        'bot',
      ] as const) {
        await (
          db()[table] as { deleteMany: (args: object) => Promise<unknown> }
        ).deleteMany({ where: { userId } });
      }
      await db().user.deleteMany({ where: { email } });
    });

    it('counts AI spend and stops AI work when the allowance is used', async () => {
      const fresh = await call()
        .get('/v1/usage')
        .set('Cookie', cookies)
        .expect(200);
      expect(fresh.body.data).toMatchObject({
        plan: 'free',
        monthlyLimitUsd: 2,
        usedUsd: 0,
      });

      // What Cencori reports after each model call (done by the meter).
      const usage = app.get(UsageService);
      await usage.record(userId, 'chat', {
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 1.5,
      });
      await usage.record(userId, 'chat', {
        inputTokens: 500,
        outputTokens: 100,
        costUsd: 0.75,
      });
      // Our own safety reviews don't count.
      await usage.record(userId, 'review', {
        inputTokens: 10,
        outputTokens: 1,
        costUsd: 5,
      });
      const used = await call()
        .get('/v1/usage')
        .set('Cookie', cookies)
        .expect(200);
      expect(used.body.data).toMatchObject({
        usedUsd: 2.25,
        remainingUsd: 0,
        calls: 2,
        inputTokens: 1500,
        days: [expect.objectContaining({ kind: 'chat', calls: 2 })],
      });

      const blocked = await call()
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ message: 'Hello' })
        .expect(402);
      expect(blocked.body.message).toContain('allowance');

      // Only staff change plans.
      await call()
        .put(`/v1/admin/users/${userId}/plan`)
        .set('Cookie', cookies)
        .send({ plan: 'pro' })
        .expect(403);
      // Nor see everyone's activity.
      await call().get('/v1/admin/activity').set('Cookie', cookies).expect(403);
      await db().user.update({
        where: { id: userId },
        data: { role: 'admin' },
      });
      // Roles are read at sign-in.
      const admin = await signIn();
      const pro = await call()
        .put(`/v1/admin/users/${userId}/plan`)
        .set('Cookie', admin)
        .send({ plan: 'pro' })
        .expect(200);
      expect(pro.body.data).toMatchObject({ plan: 'pro', monthlyLimitUsd: 20 });
      const overview = await call()
        .get('/v1/admin/usage')
        .set('Cookie', admin)
        .expect(200);
      expect(overview.body.data.topUsers).toContainEqual(
        expect.objectContaining({ userId, usedUsd: 2.25, plan: 'pro' }),
      );
      await db().user.update({ where: { id: userId }, data: { role: 'user' } });

      // Allowance left again: the chat is no longer refused for money.
      const after = await call()
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ message: 'Hello' });
      expect(after.status).not.toBe(402);
    });

    it('keeps rules for risky tools, and an inbox of waiting steps', async () => {
      const tools = await call()
        .get('/v1/approvals/tools')
        .set('Cookie', cookies)
        .expect(200);
      expect(tools.body.data.map((t: { tool: string }) => t.tool)).toContain(
        'create_routine',
      );

      const rule = await call()
        .put('/v1/approvals/rules')
        .set('Cookie', cookies)
        .send({ tool: 'create_routine', decision: 'allow' })
        .expect(200);
      // Setting it again replaces it.
      await call()
        .put('/v1/approvals/rules')
        .set('Cookie', cookies)
        .send({ tool: 'create_routine', decision: 'deny' })
        .expect(200);
      const rules = await call()
        .get('/v1/approvals/rules')
        .set('Cookie', cookies)
        .expect(200);
      expect(rules.body.data).toEqual([
        expect.objectContaining({ tool: 'create_routine', decision: 'deny' }),
      ]);
      await call()
        .delete(`/v1/approvals/rules/${rule.body.data.id}`)
        .set('Cookie', cookies)
        .expect(404);
      await call()
        .put('/v1/approvals/rules')
        .set('Cookie', cookies)
        .send({ tool: 'create_routine', decision: 'maybe' })
        .expect(400);

      // A routine stopped at a risky step: it waits in the inbox.
      const approvals = app.get(ApprovalService);
      await approvals.recordPending({
        userId,
        chatId: 'ses_e2e',
        source: 'routine',
        items: [
          {
            callId: 'call_1',
            toolName: 'start_plan',
            arguments: '{"goal":"Compare CRMs"}',
          },
        ],
        state: 'signed.state',
      });
      const inbox = await call()
        .get('/v1/approvals')
        .set('Cookie', cookies)
        .expect(200);
      expect(inbox.body.data).toEqual([
        expect.objectContaining({
          chatId: 'ses_e2e',
          source: 'routine',
          state: 'signed.state',
          items: [expect.objectContaining({ toolName: 'start_plan' })],
        }),
      ]);

      // Approved with "for this chat": remembered there, gone from the inbox.
      await approvals.resolve(userId, 'signed.state', {
        call_1: { approved: true, remember: 'chat' },
      });
      const remembered = await approvals.rulesFor(userId);
      expect(remembered).toContainEqual(
        expect.objectContaining({
          tool: 'start_plan',
          chatId: 'ses_e2e',
          decision: 'allow',
        }),
      );
      const empty = await call()
        .get('/v1/approvals')
        .set('Cookie', cookies)
        .expect(200);
      expect(empty.body.data).toEqual([]);

      await approvals.recordPending({
        userId,
        chatId: 'ses_e2e_2',
        source: 'chat',
        items: [{ callId: 'c', toolName: 'delete_routine', arguments: '{}' }],
        state: 'other.state',
      });
      const waiting = await call()
        .get('/v1/approvals')
        .set('Cookie', cookies)
        .expect(200);
      await call()
        .delete(`/v1/approvals/${waiting.body.data[0].id}`)
        .set('Cookie', cookies)
        .expect(204);
      await call()
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({
          sessionId: 'ses_e2e_2',
          approval: {
            state: 'other.state',
            decisions: { c: { approved: true } },
          },
        })
        .expect(404);
    });

    it('answers app steps from the inbox, and chat steps only in chat', async () => {
      const approvals = app.get(ApprovalService);
      await approvals.recordPending({
        userId,
        chatId: 'ses_app',
        source: 'chat',
        items: [{ callId: 'c1', toolName: 'start_plan', arguments: '{}' }],
        state: 'chat.state',
      });
      // An app step in the same chat waits beside it.
      await approvals.recordPending({
        userId,
        chatId: 'ses_app',
        source: 'app',
        items: [
          { callId: 'act_1', toolName: 'gmail_send_email', arguments: '{}' },
        ],
        state: 'action:act_1',
      });
      const inbox = await call()
        .get('/v1/approvals')
        .set('Cookie', cookies)
        .expect(200);
      const bySource = (source: string) =>
        inbox.body.data.find((a: { source: string }) => a.source === source);
      expect(inbox.body.data).toHaveLength(2);

      await call()
        .post(`/v1/approvals/${bySource('chat').id}/answer`)
        .set('Cookie', cookies)
        .send({ approved: true })
        .expect(400);
      await call()
        .post(`/v1/approvals/${randomUUID()}/answer`)
        .set('Cookie', cookies)
        .send({ approved: true })
        .expect(404);
      await call()
        .post(`/v1/approvals/${bySource('app').id}/answer`)
        .set('Cookie', cookies)
        .send({ approved: 'yes' })
        .expect(400);

      // Cencori only: no secret set here, so its webhook is off.
      await call()
        .post('/v1/approvals/cencori')
        .set('content-type', 'application/json')
        .send('{"event":"action.required","data":{"action_id":"act_1"}}')
        .expect((response) => expect([401, 503]).toContain(response.status));

      await db().pendingApproval.deleteMany({ where: { userId } });
    });

    it('shows sign-ins and changes in the activity log', async () => {
      await call()
        .post('/v1/bots')
        .set('Cookie', cookies)
        .send({ name: 'Logged Bot', instructions: 'Say hi.' })
        .expect(200);

      // Entries are written in the background.
      let actions: string[] = [];
      for (let i = 0; i < 20 && !actions.includes('bots.created'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const activity = await call()
          .get('/v1/activity')
          .set('Cookie', cookies)
          .expect(200);
        actions = activity.body.data.map((a: { action: string }) => a.action);
      }
      expect(actions).toEqual(
        expect.arrayContaining([
          'signed-in',
          'bots.created',
          'approvals.rules.set',
          'approval.requested',
          'approval.allowed',
        ]),
      );
    });
  });
});
