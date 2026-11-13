import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// Tests never call Cencori: without a key the chat answers 503.
describe('Chat (e2e)', () => {
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
    await request(app.getHttpServer())
      .post('/v1/chat')
      .send({ message: 'Hi' })
      .expect(401);
    await request(app.getHttpServer()).get('/v1/chat').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-chat-${randomUUID()}@example.com`;
    const foreignChat = `ses_${randomUUID()}`;
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
      // A chat that belongs to someone else.
      await app.get(PrismaService).db.chatSession.create({
        data: { id: foreignChat, userId: 'someone-else', title: 'Theirs' },
      });
    });

    afterAll(async () => {
      const db = app.get(PrismaService).db;
      await db.chatSession.deleteMany({ where: { id: foreignChat } });
      await db.user.deleteMany({ where: { email } });
    });

    it('lists only my chats', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/chat')
        .set('Cookie', cookies)
        .expect(200);
      expect(response.body.data).toEqual([]);
    });

    it('checks the message shape', async () => {
      await request(app.getHttpServer())
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ message: 'Hi', unknown: true })
        .expect(400);
    });

    it('answers 503 when Cencori is not set up', async () => {
      await request(app.getHttpServer())
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ message: 'Hi' })
        .expect(503);
    });

    it("keeps other people's chats private", async () => {
      const server = app.getHttpServer();
      await request(server)
        .get(`/v1/chat/${foreignChat}/status`)
        .set('Cookie', cookies)
        .expect(403);
      await request(server)
        .delete(`/v1/chat/${foreignChat}`)
        .set('Cookie', cookies)
        .expect(404);
      await request(server)
        .post(`/v1/chat/${foreignChat}/reply`)
        .set('Cookie', cookies)
        .send({ text: 'Hello' })
        .expect(403);
      await request(server)
        .post(`/v1/chat/${foreignChat}/release`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });
});
