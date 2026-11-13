import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
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
      SWAGGER_ENABLED: false,
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

  // Needs Postgres (DATABASE_URL). Skipped where no database is configured.
  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-${randomUUID()}@example.com`;

    afterAll(async () => {
      await app.get(PrismaService).db.user.deleteMany({ where: { email } });
    });

    it('signs up, reads the session, then signs out', async () => {
      const server = app.getHttpServer();

      const signUp = await request(server)
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'correct-horse-battery', name: 'E2E User' })
        .expect(200);
      const cookies = signUp.headers['set-cookie'] as unknown as string[];
      expect(cookies.join(';')).toContain('session_token');

      const session = await request(server)
        .get('/v1/auth/session')
        .set('Cookie', cookies)
        .expect(200);
      expect(session.body.data.user).toMatchObject({
        email,
        name: 'E2E User',
        emailVerified: false,
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
  });
});
