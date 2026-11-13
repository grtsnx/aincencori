import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';

type Schema = Record<string, unknown>;
type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  responses?: Record<string, Schema>;
};

const words = (text = '') => text.trim().split(/\s+/).filter(Boolean).length;

// Every schema field (in requests, responses and models) without a sample.
function fieldsWithoutExample(node: unknown, path = ''): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) =>
      fieldsWithoutExample(item, `${path}[${index}]`),
    );
  }
  if (!node || typeof node !== 'object') return [];
  const schema = node as Schema;
  const missing: string[] = [];
  const properties = schema.properties as Record<string, Schema> | undefined;
  for (const [name, property] of Object.entries(properties ?? {})) {
    if (property && !property.$ref && property.example === undefined) {
      missing.push(`${path}.${name}`);
    }
  }
  for (const [key, value] of Object.entries(schema)) {
    missing.push(...fieldsWithoutExample(value, `${path}.${key}`));
  }
  return missing;
}

describe('API docs and versioning (e2e)', () => {
  let app: INestApplication;
  const documents: Record<string, Schema> = {};

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

    for (const version of ['v1', 'v2']) {
      const response = await request(app.getHttpServer())
        .get(`/api/${version}-json`)
        .expect(200);
      documents[version] = response.body;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('versioning', () => {
    it('answers each version on its own routes', async () => {
      const server = app.getHttpServer();
      await request(server).get('/v1/health/live').expect(200);
      await request(server).get('/v2/health/live').expect(200);
      await request(server).get('/v1/user').expect(401);
      // User routes exist only in v1; unknown versions do not exist at all.
      await request(server).get('/v2/user').expect(404);
      await request(server).get('/v3/health/live').expect(404);
    });

    it('lists only its own version in each document', () => {
      const v1 = Object.keys(documents.v1.paths as Schema);
      const v2 = Object.keys(documents.v2.paths as Schema);

      expect(v1).toContain('/v1/user');
      expect(v1.some((path) => path.startsWith('/v2'))).toBe(false);
      expect(v2).toContain('/v2/health/live');
      expect(v2.some((path) => path.startsWith('/v1'))).toBe(false);
    });

    it('shows the MCP address in v1', () => {
      const mcp = (documents.v1.paths as Record<string, Schema>)['/mcp'];
      expect((mcp.post as Operation).summary).toBe('Connect an AI app');
      expect(Object.keys(documents.v2.paths as Schema)).not.toContain('/mcp');
    });

    it('lists Better Auth routes in v1 only (they live under /v1/auth)', () => {
      expect(Object.keys(documents.v1.paths as Schema)).toContain(
        '/v1/auth/sign-in/email-otp',
      );
      expect(
        Object.keys(documents.v2.paths as Schema).some((path) =>
          path.startsWith('/v1/'),
        ),
      ).toBe(false);
    });
  });

  describe.each(['v1', 'v2'])('%s document', (version) => {
    const operations = () =>
      Object.entries(
        documents[version].paths as Record<string, Schema>,
      ).flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, operation]) => ({
          route: `${method.toUpperCase()} ${path}`,
          path,
          ...(operation as Operation),
        })),
      );

    it('gives every route a short title and description', () => {
      const bad = operations().filter(
        (operation) =>
          !operation.summary ||
          words(operation.summary) > 4 ||
          !operation.description ||
          words(operation.description) > 12,
      );
      expect(bad.map((operation) => operation.route)).toEqual([]);
    });

    it('has a sample on every field', () => {
      expect(fieldsWithoutExample(documents[version].paths, 'paths')).toEqual(
        [],
      );
      expect(
        fieldsWithoutExample(documents[version].components, 'components'),
      ).toEqual([]);
    });

    it('has a sample on every response', () => {
      const document = documents[version];
      const schemas = ((document.components as Schema | undefined)?.schemas ??
        {}) as Record<string, Schema>;
      // True when the schema (or each of its fields) carries a sample.
      const sampled = (node: unknown, depth = 0): boolean => {
        let schema = node as Schema | undefined;
        while (schema && typeof schema.$ref === 'string') {
          schema = schemas[schema.$ref.split('/').pop() ?? ''];
        }
        if (!schema || depth > 8) return false;
        if (schema.example !== undefined) return true;
        const properties = schema.properties as Schema | undefined;
        if (properties && Object.keys(properties).length > 0) {
          return Object.values(properties).every((p) => sampled(p, depth + 1));
        }
        if (schema.type === 'array') return sampled(schema.items, depth + 1);
        return false;
      };

      const missing: string[] = [];
      for (const operation of operations()) {
        const responses = (operation.responses ?? {}) as Record<string, Schema>;
        for (const [status, response] of Object.entries(responses)) {
          const code = Number(status);
          if (code === 204) continue;
          if (code >= 300 && code < 400) {
            const headers = response.headers as
              Record<string, Schema> | undefined;
            if (headers?.Location?.example === undefined) {
              missing.push(`${operation.route} ${status}`);
            }
            continue;
          }
          const content = response.content as
            Record<string, Schema> | undefined;
          if (!content || Object.keys(content).length === 0) {
            missing.push(`${operation.route} ${status}`);
            continue;
          }
          for (const [type, media] of Object.entries(content)) {
            if (media.example !== undefined || media.examples) continue;
            if (!sampled(media.schema)) {
              missing.push(`${operation.route} ${status} ${type}`);
            }
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it('fills lists and objects in success samples (no empty [] or {})', () => {
      // Parts that are empty for real: OAuth revoke answers {} by design.
      const emptyByDesign = ['POST /v1/auth/oauth2/revoke'];
      const empties = (value: unknown, path = ''): string[] => {
        if (Array.isArray(value)) {
          return value.length === 0
            ? [path || '(root)']
            : empties(value[0], `${path}[0]`);
        }
        if (value && typeof value === 'object') {
          const entries = Object.entries(value);
          if (entries.length === 0) return [path || '(root)'];
          return entries.flatMap(([key, item]) =>
            empties(item, `${path}.${key}`),
          );
        }
        return [];
      };
      const found: string[] = [];
      for (const operation of operations()) {
        if (emptyByDesign.includes(operation.route)) continue;
        const responses = (operation.responses ?? {}) as Record<string, Schema>;
        for (const [status, response] of Object.entries(responses)) {
          if (!status.startsWith('2') || status === '204') continue;
          const content = (response.content ?? {}) as Record<string, Schema>;
          for (const media of Object.values(content)) {
            for (const part of empties(media.example)) {
              found.push(`${operation.route} ${status} ${part}`);
            }
          }
        }
      }
      expect(found).toEqual([]);
    });

    it("shows our routes' real response wrapper and errors", () => {
      for (const operation of operations()) {
        // Only our Nest routes use the wrapper; Better Auth answers raw JSON.
        if (!operation.operationId?.includes('Controller_')) continue;
        const responses = operation.responses ?? {};
        if (responses['204']) continue; // No body to wrap.
        const ok = responses['200'] as {
          content: Record<string, { schema: Schema }>;
        };
        // Streams (the chat) and audio are not JSON, so no wrapper.
        if (!ok.content['application/json']) {
          expect(Object.keys(responses)).toEqual(
            expect.arrayContaining(['429', '500']),
          );
          continue;
        }
        expect(
          Object.keys(
            ok.content['application/json'].schema.properties as Schema,
          ),
        ).toEqual(['statusCode', 'statusType', 'message', 'data']);
        expect(Object.keys(responses)).toEqual(
          expect.arrayContaining(['429', '500']),
        );
      }
    });
  });
});
