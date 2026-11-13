import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';
import { R2Service } from '@/lib/r2/r2.service.js';

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

    it('reads my saved messages from our database, in pages', async () => {
      const db = app.get(PrismaService).db;
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      const id = `ses_${randomUUID()}`;
      await db.chatSession.create({
        data: { id, userId: user.id, title: 'Mine' },
      });
      await db.chatMessage.createMany({
        data: [1, 2, 3].map((n) => ({
          id: `${id}-m${n}`,
          sessionId: id,
          role: n % 2 ? 'user' : 'agent',
          text: `message ${n}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
        })),
      });
      const server = app.getHttpServer();

      const chats = await request(server)
        .get('/v1/chat')
        .set('Cookie', cookies)
        .expect(200);
      expect(chats.body.data.map((chat: { id: string }) => chat.id)).toEqual([
        id,
      ]);

      const latest = await request(server)
        .get(`/v1/chat/${id}/messages?limit=2`)
        .set('Cookie', cookies)
        .expect(200);
      expect(latest.body.data.map((m: { text: string }) => m.text)).toEqual([
        'message 2',
        'message 3',
      ]);

      const older = await request(server)
        .get(`/v1/chat/${id}/messages?limit=2&before=${id}-m2`)
        .set('Cookie', cookies)
        .expect(200);
      expect(older.body.data.map((m: { text: string }) => m.text)).toEqual([
        'message 1',
      ]);

      // Deleting the user's chat removes its messages too.
      await db.chatSession.delete({ where: { id } });
      expect(await db.chatMessage.count({ where: { sessionId: id } })).toBe(0);
    });

    it('replies to a message, like WhatsApp, and shows the quote in the history', async () => {
      const db = app.get(PrismaService).db;
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      const id = `ses_${randomUUID()}`;
      await db.chatSession.create({
        data: { id, userId: user.id, title: 'Replies' },
      });
      await db.chatMessage.createMany({
        data: [
          {
            id: `${id}-q`,
            sessionId: id,
            role: 'agent',
            agent: 'Agentic',
            text: 'Your Acme invoice is due on Friday.',
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)),
          },
          {
            id: `${id}-r`,
            sessionId: id,
            role: 'user',
            text: 'Can we pay it Monday?',
            replyToId: `${id}-q`,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 2)),
          },
        ],
      });
      const server = app.getHttpServer();

      // A reply needs the chat, and a message of that chat.
      await request(server)
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ message: 'Yes?', replyTo: `${id}-q` })
        .expect(400);
      await request(server)
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ sessionId: id, message: 'Yes?', replyTo: 'not-here' })
        .expect(404);
      // A real quote passes the checks (then Cencori is not set up here).
      await request(server)
        .post('/v1/chat')
        .set('Cookie', cookies)
        .send({ sessionId: id, message: 'Yes?', replyTo: `${id}-q` })
        .expect(503);

      const history = await request(server)
        .get(`/v1/chat/${id}/messages`)
        .set('Cookie', cookies)
        .expect(200);
      expect(history.body.data[0].replyTo).toBeNull();
      expect(history.body.data[1].replyTo).toEqual({
        id: `${id}-q`,
        role: 'agent',
        agent: 'Agentic',
        text: 'Your Acme invoice is due on Friday.',
      });

      // Deleting the quoted message keeps the reply, without the quote.
      await db.chatMessage.delete({ where: { id: `${id}-q` } });
      const after = await db.chatMessage.findUniqueOrThrow({
        where: { id: `${id}-r` },
      });
      expect(after.replyToId).toBeNull();
      await db.chatSession.delete({ where: { id } });
    });

    it('opens attached files from the history and removes them with the chat', async () => {
      const db = app.get(PrismaService).db;
      const r2 = app.get(R2Service);
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      const id = `ses_${randomUUID()}`;
      const key = `chats/${user.id}/${randomUUID()}/0-receipt.png`;
      await r2.put(key, Buffer.from('fake image'), 'image/png');
      await db.chatSession.create({
        data: { id, userId: user.id, title: 'Files' },
      });
      await db.chatMessage.createMany({
        data: [
          {
            id: `${id}-new`,
            sessionId: id,
            role: 'user',
            text: 'What is this?',
            attachments: [
              {
                name: 'receipt.png',
                kind: 'image',
                contentType: 'image/png',
                key,
                size: 10,
              },
            ],
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 2)),
          },
          {
            // How older messages were saved: names only.
            id: `${id}-old`,
            sessionId: id,
            role: 'user',
            text: 'An older one',
            attachments: ['old.pdf'],
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)),
          },
        ],
      });
      const server = app.getHttpServer();

      const history = await request(server)
        .get(`/v1/chat/${id}/messages`)
        .set('Cookie', cookies)
        .expect(200);
      expect(
        history.body.data.map((m: { attachments: unknown }) => m.attachments),
      ).toEqual([
        [{ name: 'old.pdf', kind: 'file', url: null }],
        [
          {
            name: 'receipt.png',
            kind: 'image',
            url: `https://files.example.com/${key}`,
          },
        ],
      ]);

      await request(server)
        .delete(`/v1/chat/${id}`)
        .set('Cookie', cookies)
        .expect(204);
      expect(r2.has(key)).toBe(false);
    });

    it('answers 503 for voice calls until LiveKit is set up', async () => {
      const server = app.getHttpServer();
      await request(server).post('/v1/voice/call').send({}).expect(401);
      await request(server)
        .post('/v1/voice/call')
        .set('Cookie', cookies)
        .send({})
        .expect(503);
      await request(server)
        .post('/v1/voice/call')
        .set('Cookie', cookies)
        .send({ botId: 'not-my-bot' })
        .expect(404);
      await request(server)
        .post('/v1/voice/dictate')
        .set('Cookie', cookies)
        .send({ language: 'english' })
        .expect(400);
      await request(server)
        .post('/v1/voice/dictate')
        .set('Cookie', cookies)
        .send({})
        .expect(503);
    });

    it("keeps other people's chats private", async () => {
      const server = app.getHttpServer();
      await request(server)
        .get(`/v1/chat/${foreignChat}/status`)
        .set('Cookie', cookies)
        .expect(403);
      await request(server)
        .get(`/v1/chat/${foreignChat}/messages`)
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
