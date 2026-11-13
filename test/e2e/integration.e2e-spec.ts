import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { EmailService } from '@/lib/email/email.service.js';
import { PrismaService } from '@/lib/prisma/prisma.service.js';

// A small real MCP server with one tool. It only answers the right token.
function startMcpServer(token: string): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const mcp = new McpServer({ name: 'test', version: '1.0.0' });
      mcp.registerTool(
        'create_issue',
        { description: 'Create an issue in a repository.' },
        () => ({ content: [{ type: 'text', text: 'ok' }] }),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      void mcp
        .connect(transport)
        .then(() =>
          transport.handleRequest(
            req,
            res,
            chunks.length
              ? JSON.parse(Buffer.concat(chunks).toString())
              : undefined,
          ),
        );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server)),
  );
}

describe('Integrations (e2e)', () => {
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
    await request(app.getHttpServer()).get('/v1/integrations').expect(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)('with a database', () => {
    const email = `e2e-integration-${randomUUID()}@example.com`;
    const token = 'secret-token-123';
    let cookies: string[];
    let mcp: Server;
    let mcpUrl: string;

    beforeAll(async () => {
      mcp = await startMcpServer(token);
      mcpUrl = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;
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
      mcp.close();
      const db = app.get(PrismaService).db;
      const user = await db.user.findUnique({ where: { email } });
      if (user) await db.integration.deleteMany({ where: { userId: user.id } });
      await db.user.deleteMany({ where: { email } });
    });

    it('connects many servers, hides tokens and reads real tools', async () => {
      const server = app.getHttpServer();
      const db = app.get(PrismaService).db;

      const created = await request(server)
        .post('/v1/integrations')
        .set('Cookie', cookies)
        .send({ name: 'github', url: mcpUrl, token })
        .expect(200);
      const integration = created.body.data;
      expect(integration).toMatchObject({
        name: 'github',
        app: 'mcp',
        status: 'active',
        hasToken: true,
        enabled: true,
      });
      // The token never comes back, and is not readable in the database.
      expect(JSON.stringify(created.body)).not.toContain(token);
      const stored = await db.integration.findUniqueOrThrow({
        where: { id: integration.id },
      });
      expect(stored.token).not.toContain(token);

      // A second one for the same user; the same name twice is refused.
      await request(server)
        .post('/v1/integrations')
        .set('Cookie', cookies)
        .send({ name: 'notion', url: mcpUrl })
        .expect(200);
      await request(server)
        .post('/v1/integrations')
        .set('Cookie', cookies)
        .send({ name: 'github', url: mcpUrl })
        .expect(409);

      const list = await request(server)
        .get('/v1/integrations')
        .set('Cookie', cookies)
        .expect(200);
      expect(
        list.body.data.map((item: { name: string }) => item.name).sort(),
      ).toEqual(['github', 'notion']);

      // Talks to the real MCP server with the saved token.
      const tools = await request(server)
        .get(`/v1/integrations/${integration.id}/tools`)
        .set('Cookie', cookies)
        .expect(200);
      expect(tools.body.data).toEqual([
        {
          name: 'create_issue',
          description: 'Create an issue in a repository.',
        },
      ]);

      // Without the token the server refuses us, and we say so.
      await request(server)
        .patch(`/v1/integrations/${integration.id}`)
        .set('Cookie', cookies)
        .send({ token: '' })
        .expect(200);
      await request(server)
        .get(`/v1/integrations/${integration.id}/tools`)
        .set('Cookie', cookies)
        .expect(400);

      await request(server)
        .delete(`/v1/integrations/${integration.id}`)
        .set('Cookie', cookies)
        .expect(204);
    });

    it('lists the apps and refuses ones it does not know', async () => {
      const server = app.getHttpServer();
      // Cencori is off in tests, so only the user's own MCP server is offered.
      const apps = await request(server)
        .get('/v1/integrations/apps')
        .set('Cookie', cookies)
        .expect(200);
      expect(apps.body.data).toEqual([
        { slug: 'mcp', name: 'Your own MCP server', signIn: 'none' },
      ]);
      await request(server)
        .post('/v1/integrations')
        .set('Cookie', cookies)
        .send({ name: 'mail', app: 'not-an-app' })
        .expect(400);
      // Your own MCP server needs an address.
      await request(server)
        .post('/v1/integrations')
        .set('Cookie', cookies)
        .send({ name: 'no-address' })
        .expect(400);
    });

    it('refuses bad names and addresses', async () => {
      const server = app.getHttpServer();
      await request(server)
        .post('/v1/integrations')
        .set('Cookie', cookies)
        .send({ name: 'Bad Name!', url: mcpUrl })
        .expect(400);
      await request(server)
        .post('/v1/integrations')
        .set('Cookie', cookies)
        .send({ name: 'files', url: 'file:///etc/passwd' })
        .expect(400);
    });

    it("hides other people's integrations", async () => {
      const db = app.get(PrismaService).db;
      const id = randomUUID();
      await db.integration.create({
        data: { id, userId: 'someone-else', name: `theirs-${id}`, url: mcpUrl },
      });
      try {
        await request(app.getHttpServer())
          .get(`/v1/integrations/${id}/tools`)
          .set('Cookie', cookies)
          .expect(404);
        await request(app.getHttpServer())
          .delete(`/v1/integrations/${id}`)
          .set('Cookie', cookies)
          .expect(404);
      } finally {
        await db.integration.delete({ where: { id } });
      }
    });
  });
});
