import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { TestHelpers } from 'better-auth/plugins';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

async function createApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  configureApplication(
    app,
    validateEnvironment({
      NODE_ENV: 'test',
      SWAGGER_ENABLED: true,
      CORS_ORIGINS: 'https://app.example.com',
    }),
  );
  await app.init();
  return app;
}

describe('Better Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Better Auth routes with the app security headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/ok')
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('rejects protected routes without a session', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/auth/session')
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: 'Sign in to continue.',
    });
  });

  it('keeps public routes open', async () => {
    await request(app.getHttpServer()).get('/v1/health/live').expect(200);
  });

  it('has no password sign-up', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: 'x@example.com', password: 'whatever-123', name: 'X' });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('never links Google to an existing account by email', () => {
    const { accountLinking } = app.get(BetterAuthService).auth.options.account;
    expect(accountLinking).toMatchObject({ disableImplicitLinking: true });
  });

  it('publishes MCP discovery metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/.well-known/oauth-protected-resource')
      .expect(200);

    expect(response.body.resource).toBe('http://localhost:3000/mcp');
  });

  it('shows Better Auth routes in the v1 docs, without Dash internals', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1-json')
      .expect(200);
    const paths = Object.keys(response.body.paths);

    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/auth/session',
        '/api/auth/sign-in/email-otp',
        '/api/auth/organization/create',
        '/api/auth/admin/set-role',
      ]),
    );
    expect(paths.some((path) => path.startsWith('/api/auth/dash'))).toBe(false);
    // Password routes are off, so the docs leave them out.
    expect(paths).not.toContain('/api/auth/sign-in/email');
    expect(paths).not.toContain('/api/auth/error');
    expect(response.body.paths['/api/auth/ok'].get.summary).toBe(
      'Check auth is running',
    );
    expect(
      response.body.paths['/api/auth/passkey/generate-register-options'].get
        .summary,
    ).toBe('Start adding a passkey');
    expect(response.body.paths['/api/auth/admin/set-role'].post).toMatchObject({
      tags: ['Admin'],
      summary: 'Change user role',
    });
  });

  it('keeps every docs title and section description to 4 words', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1-json')
      .expect(200);
    const words = (text: string) => text.trim().split(/\s+/).length;

    const titles = Object.values(
      response.body.paths as Record<
        string,
        Record<string, { summary: string }>
      >,
    ).flatMap((operations) =>
      Object.values(operations).map((operation) => operation.summary),
    );
    expect(titles.filter((title) => words(title) > 4)).toEqual([]);

    const sections = response.body.tags as {
      name: string;
      description: string;
    }[];
    expect(sections.map((section) => section.name)).toEqual([
      'Server',
      'Auth',
      'User',
      'Organization',
      'Admin',
    ]);
    expect(
      sections.filter((section) => words(section.description) > 4),
    ).toEqual([]);
  });

  // Needs Postgres (DATABASE_URL). Skipped where no database is configured.
  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-${randomUUID()}@example.com`;
    const slug = `e2e-${randomUUID()}`;

    // Signs in with an email code captured by Better Auth's test helpers.
    async function signIn(): Promise<string[]> {
      const server = app.getHttpServer();
      const context = await app.get(BetterAuthService).auth.$context;
      const helpers = (context as unknown as { test: TestHelpers }).test;

      await request(server)
        .post('/api/auth/email-otp/send-verification-otp')
        .send({ email, type: 'sign-in' })
        .expect(200);
      const otp = helpers.getOTP?.(email);
      expect(otp).toMatch(/^\d{6}$/);

      const response = await request(server)
        .post('/api/auth/sign-in/email-otp')
        .send({ email, otp })
        .expect(200);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.join(';')).toContain('session_token');
      return cookies;
    }

    afterAll(async () => {
      const db = app.get(PrismaService).db;
      await db.organization.deleteMany({ where: { slug } });
      await db.user.deleteMany({ where: { email } });
    });

    it('signs in with an email code, reads the session, then signs out', async () => {
      const server = app.getHttpServer();
      const cookies = await signIn();

      const session = await request(server)
        .get('/v1/auth/session')
        .set('Cookie', cookies)
        .expect(200);
      expect(session.body.data.user).toMatchObject({
        email,
        emailVerified: true,
      });

      const user = await app
        .get(PrismaService)
        .db.user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({
        lastLoginMethod: 'email-otp',
        role: 'user',
      });

      await request(server)
        .post('/api/auth/sign-out')
        .set('Cookie', cookies)
        .expect(200);

      await request(server)
        .get('/v1/auth/session')
        .set('Cookie', cookies)
        .expect(401);
    });

    it('shows my profile, sign-in methods and sessions', async () => {
      const server = app.getHttpServer();
      const cookies = await signIn();

      const profile = await request(server)
        .get('/v1/user')
        .set('Cookie', cookies)
        .expect(200);
      expect(profile.body.data).toMatchObject({
        email,
        role: 'user',
        twoFactorEnabled: false,
        lastLoginMethod: 'email-otp',
      });

      const accounts = await request(server)
        .get('/v1/user/accounts')
        .set('Cookie', cookies)
        .expect(200);
      expect(Array.isArray(accounts.body.data)).toBe(true);

      const sessions = await request(server)
        .get('/v1/user/sessions')
        .set('Cookie', cookies)
        .expect(200);
      expect(sessions.body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ current: true })]),
      );
    });

    it('creates an organization with a team and lists it', async () => {
      const server = app.getHttpServer();
      const cookies = await signIn();

      const created = await request(server)
        .post('/api/auth/organization/create')
        .set('Cookie', cookies)
        .send({ name: 'E2E Org', slug })
        .expect(200);
      await request(server)
        .post('/api/auth/organization/set-active')
        .set('Cookie', cookies)
        .send({ organizationId: created.body.id })
        .expect(200);
      await request(server)
        .post('/api/auth/organization/create-team')
        .set('Cookie', cookies)
        .send({ name: 'Support' })
        .expect(200);

      const list = await request(server)
        .get('/v1/organizations')
        .set('Cookie', cookies)
        .expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ name: 'E2E Org', slug }),
      ]);

      const active = await request(server)
        .get('/v1/organizations/active')
        .set('Cookie', cookies)
        .expect(200);
      expect(active.body.data.members).toEqual([
        expect.objectContaining({ role: 'owner' }),
      ]);
      expect(active.body.data.teams).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Support' })]),
      );
    });

    it('lets only admins list users', async () => {
      const server = app.getHttpServer();
      const cookies = await signIn();

      const denied = await request(server)
        .get('/v1/admin/users')
        .set('Cookie', cookies)
        .expect(403);
      expect(denied.body.statusCode).toBe(403);

      await app
        .get(PrismaService)
        .db.user.update({ where: { email }, data: { role: 'admin' } });

      const allowed = await request(server)
        .get('/v1/admin/users')
        .query({ search: email, limit: 5 })
        .set('Cookie', cookies)
        .expect(200);
      expect(allowed.body.data.users).toEqual([
        expect.objectContaining({ email, role: 'admin' }),
      ]);
    });
  });
});
