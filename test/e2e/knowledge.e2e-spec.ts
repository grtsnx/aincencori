import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// A tiny real PDF with one line of text.
function pdfWith(text: string): string {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return `data:application/pdf;base64,${Buffer.from(out).toString('base64')}`;
}

describe('Knowledge (e2e)', () => {
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
    await request(app.getHttpServer()).get('/v1/documents').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-knowledge-${randomUUID()}@example.com`;
    let cookies: string[];
    const call = () => request(app.getHttpServer());
    const add = (body: Record<string, string>) =>
      call().post('/v1/documents').set('Cookie', cookies).send(body);

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
        await db.bot.deleteMany({ where: { userId: user.id } });
        await db.document.deleteMany({ where: { userId: user.id } });
      }
      await db.user.deleteMany({ where: { email } });
    });

    it('reads text, PDF and Markdown, and finds the right parts', async () => {
      const policy = await add({
        name: 'Refund policy',
        text: 'Customers get a full refund within 30 days of purchase. After 30 days, only store credit.',
      }).expect(200);
      expect(policy.body.data).toMatchObject({
        name: 'Refund policy',
        contentType: 'text/plain',
        status: 'ready',
        chunkCount: 1,
      });

      const office = await add({
        name: 'office.pdf',
        dataUrl: pdfWith(
          'The office opens at 9am in Lagos. Parking is behind the building.',
        ),
      }).expect(200);
      expect(office.body.data).toMatchObject({
        contentType: 'application/pdf',
        status: 'ready',
      });

      const notes = await add({
        name: 'notes.md',
        dataUrl: `data:text/markdown;base64,${Buffer.from('# Team\nAda leads sales.').toString('base64')}`,
      }).expect(200);
      expect(notes.body.data.status).toBe('ready');

      // A whole question still finds the answer, best match first.
      const hits = await call()
        .get('/v1/documents/search')
        .query({ q: 'how long do I have to get a refund?' })
        .set('Cookie', cookies)
        .expect(200);
      expect(hits.body.data[0]).toMatchObject({
        documentName: 'Refund policy',
        text: expect.stringContaining('30 days'),
      });

      const parking = await call()
        .get('/v1/documents/search')
        .query({ q: 'parking' })
        .set('Cookie', cookies)
        .expect(200);
      expect(parking.body.data[0].documentName).toBe('office.pdf');

      const listed = await call()
        .get('/v1/documents')
        .set('Cookie', cookies)
        .expect(200);
      expect(listed.body.data).toHaveLength(3);

      const one = await call()
        .get(`/v1/documents/${office.body.data.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(one.body.data.url).toContain('knowledge/');
    });

    it('refuses files it cannot read', async () => {
      await add({
        name: 'photo.png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }).expect(400);
      await add({
        name: 'both',
        text: 'a',
        dataUrl: 'data:text/plain,a',
      }).expect(400);
      // A PDF without text is kept, but marked failed with the reason.
      const empty = await add({
        name: 'scan.pdf',
        dataUrl: pdfWith(''),
      }).expect(200);
      expect(empty.body.data).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('No text found'),
      });
    });

    it('lets each bot search only the documents it was given', async () => {
      const doc = await add({
        name: 'Pricing',
        text: 'The Pro plan costs 20 dollars a month.',
      }).expect(200);
      const bot = await call()
        .post('/v1/bots')
        .set('Cookie', cookies)
        .send({
          name: 'Pricing Bot',
          instructions: 'Answer pricing questions.',
          documentIds: [doc.body.data.id],
        })
        .expect(200);
      expect(bot.body.data.documents).toEqual([
        { id: doc.body.data.id, name: 'Pricing' },
      ]);

      const own = await call()
        .get('/v1/documents/search')
        .query({ q: 'Pro plan price', botId: bot.body.data.id })
        .set('Cookie', cookies)
        .expect(200);
      expect(own.body.data).toHaveLength(1);
      // The refund policy is not this bot's.
      const other = await call()
        .get('/v1/documents/search')
        .query({ q: 'refund', botId: bot.body.data.id })
        .set('Cookie', cookies)
        .expect(200);
      expect(other.body.data).toEqual([]);

      // Someone else's (or a made-up) document can't be given to a bot.
      await call()
        .patch(`/v1/bots/${bot.body.data.id}`)
        .set('Cookie', cookies)
        .send({ documentIds: [randomUUID()] })
        .expect(400);

      // Deleting the document takes it from the bot.
      await call()
        .delete(`/v1/documents/${doc.body.data.id}`)
        .set('Cookie', cookies)
        .expect(204);
      const after = await call()
        .get(`/v1/bots/${bot.body.data.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(after.body.data.documents).toEqual([]);
    });
  });
});
