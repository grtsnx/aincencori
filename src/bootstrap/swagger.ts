import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import {
  authRouteDocs,
  docSections,
  mcpRouteDoc,
  hiddenPaths,
  userPaths,
} from '@/config/docs/routes.js';
import {
  sampleErrors,
  sampleResponses,
  sampleValues,
} from '@/config/docs/samples.js';
import { authBasePath } from '@/config/auth/better-auth.js';
import type { Environment } from '@/config/index.js';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';
import { statusType } from '@/middleware';

const apiVersions = ['1', '2'] as const;
type ApiVersion = (typeof apiVersions)[number];

// The docs section for a Better Auth route, or null to leave it out.
function authTag(path: string): string | null {
  const starts = (prefixes: string[]) =>
    prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  if (starts(hiddenPaths)) return null;
  if (starts(['/agent', '/agent-configuration', '/capability', '/host'])) {
    return 'Agent Auth';
  }
  if (starts(['/admin'])) return 'Admin';
  if (starts(['/organization'])) return 'Organization';
  if (starts(userPaths)) return 'User';
  return 'Auth';
}

// A fallback title for a route not listed in authRouteDocs: /foo/do-thing -> "Foo do thing".
function shortTitle(path: string): string {
  const words = path
    .split('/')
    .filter(Boolean)
    .join(' ')
    .replaceAll('-', ' ')
    .replace(/\{|\}/g, '');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Adds Better Auth's routes to a Nest document, under authBasePath.
// Each route in exactly one section. Nest's docs copy a route's own section
// up to its whole controller, so routes can end up in two (or the same one
// twice). The route's own, most specific section wins; staff routes are
// always under Admin.
function oneSectionEach(document: OpenAPIObject): void {
  for (const operations of Object.values(document.paths)) {
    for (const operation of Object.values(
      operations as Record<string, unknown>,
    )) {
      const op = operation as { tags?: string[] };
      if (!op?.tags?.length) continue;
      op.tags = [
        op.tags.includes('Admin') ? 'Admin' : op.tags[op.tags.length - 1],
      ];
    }
  }
}

function withAuthRoutes(
  document: OpenAPIObject,
  auth: Record<string, unknown> | undefined,
): OpenAPIObject {
  if (!auth) return document;
  // A copy, so filling in examples never changes Better Auth's cached document.
  const copy = structuredClone(auth);
  const paths = (copy.paths ?? {}) as Record<string, Record<string, unknown>>;
  const components = (copy.components ?? {}) as {
    schemas?: Record<string, unknown>;
  };

  for (const [path, operations] of Object.entries(paths)) {
    const tag = authTag(path);
    if (!tag) continue;
    const fullPath = path.startsWith('/.well-known')
      ? path
      : `${authBasePath}${path}`;
    document.paths[fullPath] = Object.fromEntries(
      Object.entries(operations).map(([method, operation]) => [
        method,
        {
          ...(operation as object),
          tags: [tag],
          summary: authRouteDocs[path]?.title ?? shortTitle(path),
          description:
            authRouteDocs[path]?.description ??
            (operation as { description?: string }).description,
        },
      ]),
    );
    for (const operation of Object.values(document.paths[fullPath])) {
      sampleAuthErrors(operation as Schema);
    }
  }

  document.components = {
    ...document.components,
    schemas: {
      ...(components.schemas as NonNullable<
        OpenAPIObject['components']
      >['schemas']),
      ...document.components?.schemas,
    },
  };
  return document;
}

type Schema = Record<string, unknown>;

const isoDate = '2026-11-13T09:30:00.000Z';

// A sample value for a field, from its name, then its type.
function sampleFor(name: string, schema: Schema): unknown {
  if (schema.example !== undefined) return schema.example;
  if (name in sampleValues) return sampleValues[name];
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (schema.default !== undefined) return schema.default;

  const lower = name.toLowerCase();
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'boolean') return true;
  if (type === 'integer' || type === 'number') {
    return /^(exp|iat|nbf|auth_?time)$/i.test(name) ? 1794535800 : 1;
  }
  if (type === 'array') {
    const items = (schema.items ?? {}) as Schema;
    return items.$ref ? [] : [sampleFor(name.replace(/s$/, ''), items)];
  }
  if (type === 'object') return {};
  if (schema.format === 'date-time' || /(At|_at)$/.test(name)) return isoDate;
  if (/email/.test(lower)) return 'ada@example.com';
  if (/(url|uri)$/.test(lower)) return 'https://app.example.com';
  if (/(id|_id)$/.test(lower)) return 'kq3F9aB2xY7pLm1n';
  if (/token/.test(lower)) return 'h4Lz8QmVr2NcY7pKs1WdE6tXb3Gu9JfA';
  if (/secret/.test(lower)) return 'secret_9Wd2Hs7Q';
  return 'example';
}

// Puts a sample value on every field of every schema that has none. Lists
// and nested objects get full sample items (built from their schema), not
// empty [] or {}.
function fillExamples(node: unknown, schemas: Record<string, Schema>): void {
  if (Array.isArray(node)) {
    for (const item of node) fillExamples(item, schemas);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const schema = node as Schema;

  const properties = schema.properties as Record<string, Schema> | undefined;
  if (properties) {
    for (const [name, property] of Object.entries(properties)) {
      if (property && !property.$ref && property.example === undefined) {
        const value = sampleOf(property, schemas, name);
        if (value !== undefined) property.example = value;
      }
    }
  }

  // Query and path parameters.
  const parameters = schema.parameters as
    { name: string; example?: unknown; schema?: Schema }[] | undefined;
  for (const parameter of parameters ?? []) {
    if (parameter.example === undefined) {
      parameter.example = sampleFor(parameter.name, parameter.schema ?? {});
    }
  }

  for (const value of Object.values(schema)) fillExamples(value, schemas);
}

// Example error body for Better Auth routes: { "message": "..." }.
function sampleAuthErrors(operation: Schema): void {
  const responses = (operation.responses ?? {}) as Record<string, Schema>;
  for (const [status, response] of Object.entries(responses)) {
    if (Number(status) < 400) continue;
    const content = (response.content ?? {}) as Record<string, Schema>;
    content['application/json'] ??= {};
    content['application/json'].example = {
      message: sampleErrors[status] ?? 'Error',
    };
    response.content = content;
  }
}

// A sample value for a whole schema: objects, lists, refs and combinations.
// Models that point back at each other (a user has sessions, a session has a
// user) are expanded once per path, and each model's sample is built once.
const refSamples = new WeakMap<object, Map<string, unknown>>();

function sampleOf(
  schema: Schema | undefined,
  schemas: Record<string, Schema>,
  name = '',
  seen: ReadonlySet<string> = new Set(),
): unknown {
  if (!schema) return undefined;
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref.split('/').pop() ?? '';
    if (seen.has(ref) || seen.size >= 4) return undefined;
    let cache = refSamples.get(schemas);
    if (!cache) {
      cache = new Map();
      refSamples.set(schemas, cache);
    }
    if (!cache.has(ref)) {
      cache.set(
        ref,
        sampleOf(schemas[ref], schemas, name, new Set([...seen, ref])),
      );
    }
    return cache.get(ref);
  }
  if (schema.example !== undefined) return schema.example;
  const parts = (schema.allOf ?? schema.oneOf ?? schema.anyOf) as
    Schema[] | undefined;
  if (parts) {
    const samples = (schema.allOf ? parts : parts.slice(0, 1))
      .map((part) => sampleOf(part, schemas, name, seen))
      .filter((value) => value !== undefined);
    return samples.length > 0 &&
      samples.every((value) => value && typeof value === 'object')
      ? Object.assign({}, ...samples)
      : samples[0];
  }
  const properties = schema.properties as Record<string, Schema> | undefined;
  if (properties) {
    return Object.fromEntries(
      Object.entries(properties).flatMap(([key, value]) => {
        const sample = sampleOf(value, schemas, key, seen);
        return sample === undefined ? [] : [[key, sample]];
      }),
    );
  }
  if (schema.type === 'array') {
    const item = sampleOf(
      schema.items as Schema,
      schemas,
      name.replace(/s$/, ''),
      seen,
    );
    return item === undefined ? [] : [item];
  }
  return sampleFor(name, schema);
}

// Gives every response a sample body (and every redirect a sample address),
// so no route in the docs shows an empty answer.
function sampleAllResponses(document: OpenAPIObject): void {
  const schemas = (document.components?.schemas ?? {}) as Record<
    string,
    Schema
  >;
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(
      operations as Record<string, Schema>,
    )) {
      const responses = (operation.responses ?? {}) as Record<string, Schema>;
      for (const [status, response] of Object.entries(responses)) {
        const code = Number(status);
        if (code === 204) continue;
        if (code >= 300 && code < 400) {
          const headers = (response.headers ?? {}) as Record<string, Schema>;
          headers.Location ??= { schema: { type: 'string', format: 'uri' } };
          headers.Location.example ??=
            'https://app.example.com/callback?code=h4Lz8QmVr2NcY7pK';
          response.headers = headers;
          continue;
        }
        const content = (response.content ?? {}) as Record<string, Schema>;
        if (Object.keys(content).length === 0) {
          content['application/json'] = {};
        }
        for (const [type, media] of Object.entries(content)) {
          const key = `${method.toUpperCase()} ${path} ${status}`;
          if (key in sampleResponses) {
            media.example = sampleResponses[key];
            continue;
          }
          if (media.example !== undefined || media.examples) continue;
          if (code >= 400) {
            media.example = {
              message:
                (response.description as string | undefined) ??
                sampleErrors[status] ??
                'Error',
            };
            continue;
          }
          const sample = sampleOf(media.schema as Schema, schemas);
          media.example =
            sample === undefined && type.startsWith('text/') ? '' : sample;
        }
        response.content = content;
      }
    }
  }
}

// Our routes return { statusCode, statusType, message, data } (see the
// response interceptor) and errors with path, requestId and timestamp.
// Shows that real shape, with samples, on every Nest route.
function sampleNestResponses(document: OpenAPIObject): void {
  const errorExample = (status: number, message: string, path: string) => ({
    statusCode: status,
    statusType: statusType(status),
    message,
    path,
    requestId: '7d0ad96f-7aae-4ca4-86fd-933f1a45603f',
    timestamp: isoDate,
  });
  const errorResponse = (status: number, message: string, path: string) => ({
    description: message,
    content: {
      'application/json': { example: errorExample(status, message, path) },
    },
  });

  for (const [path, operations] of Object.entries(document.paths)) {
    if (!/^\/v\d+(\/|$)/.test(path)) continue;
    for (const operation of Object.values(operations) as Schema[]) {
      const responses = (operation.responses ?? {}) as Record<string, Schema>;
      const isPublic = (operation.tags as string[] | undefined)?.includes(
        'Server',
      );

      for (const [status, response] of Object.entries(responses)) {
        const code = Number(status);
        // 204 has no body, so no wrapper.
        if (code < 200 || code >= 300 || code === 204) continue;
        const content = response.content as Record<string, Schema> | undefined;
        // Streams (the chat) and audio are not JSON, so no wrapper.
        if (content && !content['application/json']) continue;
        const data = content?.['application/json']?.schema ?? {};
        response.description ||= 'Success';
        response.content = {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: { type: 'integer', example: code },
                statusType: { type: 'string', example: statusType(code) },
                message: { type: 'string', example: 'Success' },
                data,
              },
            },
          },
        };
      }

      // Declared errors (403, 404...) get our real error body.
      for (const [status, response] of Object.entries(responses)) {
        const code = Number(status);
        if (code < 400 || response.content) continue;
        // A copy: one decorator's response object is shared by many routes.
        responses[status] = Object.assign(
          { ...response },
          errorResponse(
            code,
            (response.description as string | undefined) ??
              sampleErrors[status] ??
              'Error',
            path,
          ),
        );
      }

      const hasInput = ((operation.parameters as unknown[]) ?? []).length > 0;
      if (hasInput) {
        responses['400'] ??= errorResponse(
          400,
          'limit must not be greater than 100',
          path,
        );
      }
      if (!isPublic) {
        responses['401'] ??= errorResponse(401, 'Sign in to continue.', path);
      }
      responses['429'] ??= errorResponse(
        429,
        'ThrottlerException: Too Many Requests',
        path,
      );
      responses['500'] ??= errorResponse(500, 'Internal server error', path);
      operation.responses = responses;
    }
  }
}

export function configureSwagger(
  app: INestApplication,
  environment: Environment,
): void {
  if (!environment.SWAGGER_ENABLED) return;

  const betterAuth = app.get(BetterAuthService);

  const buildDocument = (version: ApiVersion) => {
    const builder = new DocumentBuilder()
      .setTitle(environment.PLATFORM_NAME)
      .setDescription(`${environment.PLATFORM_NAME} API`)
      .setVersion(`v${version}`)
      .addCookieAuth('better-auth.session_token');
    for (const tag of docSections) builder.addTag(tag.name, tag.description);

    const document = SwaggerModule.createDocument(app, builder.build());
    const prefix = `/v${version}`;
    document.paths = Object.fromEntries(
      Object.entries(document.paths).filter(
        ([path]) => path === prefix || path.startsWith(`${prefix}/`),
      ),
    );
    sampleNestResponses(document);
    oneSectionEach(document);
    // Better Auth lives under /v1/auth, so only v1 lists its routes.
    if (version === '1') withAuthRoutes(document, betterAuth.openApiDocument());
    // The MCP address has no version; it is listed with v1.
    if (version === '1') {
      document.paths['/mcp'] = { post: structuredClone(mcpRouteDoc) } as never;
    }
    const schemas = (document.components?.schemas ?? {}) as Record<
      string,
      Schema
    >;
    fillExamples(document.components, schemas);
    fillExamples(document.paths, schemas);
    sampleAllResponses(document);
    return document;
  };

  const freshDocument = (
    version: ApiVersion,
    response: { setHeader(name: string, value: string): void },
  ) => {
    response.setHeader('Cache-Control', 'no-store');
    return buildDocument(version);
  };

  for (const version of apiVersions) {
    SwaggerModule.setup(`api/v${version}`, app, () => buildDocument(version), {
      ui: false,
      raw: ['json'],
      jsonDocumentUrl: `api/v${version}-json`,
      patchDocumentOnRequest: (_request, response) =>
        freshDocument(
          version,
          response as { setHeader(name: string, value: string): void },
        ),
    });
  }

  SwaggerModule.setup('api', app, () => buildDocument('1'), {
    explorer: true,
    raw: false,
    customSiteTitle: `${environment.PLATFORM_NAME} API`,
    customCss: [
      'html, body, #swagger-ui, .swagger-ui { min-height: 100%; }',
      'html:not(.dark-mode), html:not(.dark-mode) body, html:not(.dark-mode) #swagger-ui, html:not(.dark-mode) .swagger-ui { background: #fafafa !important; color-scheme: light; }',
      'html.dark-mode, html.dark-mode body, html.dark-mode #swagger-ui, html.dark-mode .swagger-ui { background: #1c2022 !important; color-scheme: dark; }',
      '.swagger-ui .info a[href$="-json"] { display: none; }',
      '.swagger-ui .topbar { display: none; }',
      '.swagger-ui .topbar a { display: none; }',
      '.swagger-ui .topbar .download-url-wrapper { display: none; }',
      '.swagger-ui .topbar .dark-mode-toggle { display: none; }',
      '.swagger-ui .api-version-picker { margin-top: 20px; max-width: 220px; width: 100%; }',
      '.swagger-ui .api-version-picker select { border: 2px solid #62a03f; border-radius: 4px; height: 40px; padding: 0 12px; width: 100%; }',
      'html:not(.dark-mode) .swagger-ui .api-version-picker select { background: #fff; color: #3b4151; }',
      'html.dark-mode .swagger-ui .api-version-picker select { background: #1c2022; color: #e4e6e6; }',
      '.swagger-ui .info .title .api-theme-toggle { align-items: center; background: transparent; border: 1px solid currentColor; border-radius: 999px; color: inherit; cursor: pointer; display: inline-flex; font-size: 13px; height: 26px; justify-content: center; margin-left: 8px; padding: 0; vertical-align: super; width: 26px; }',
      '.swagger-ui .info .title .api-theme-toggle:hover { opacity: .75; }',
    ].join('\n'),
    swaggerOptions: {
      persistAuthorization: false,
      urls: apiVersions.map((version) => ({
        url: `/api/v${version}-json`,
        name: `v${version}`,
      })),
      'urls.primaryName': 'v1',
      // Hide the models list.
      defaultModelsExpandDepth: -1,
      onComplete: () => {
        const nativeSelect = document.querySelector<HTMLSelectElement>(
          '.swagger-ui .topbar .download-url-wrapper select',
        );
        const nativeThemeButton = document.querySelector<HTMLButtonElement>(
          '.swagger-ui .topbar .dark-mode-toggle button',
        );
        const info = document.querySelector<HTMLElement>('.swagger-ui .info');

        if (!nativeSelect || !info) return;

        document.querySelector('.api-version-picker')?.remove();
        document.querySelector('.api-theme-toggle')?.remove();

        const picker = document.createElement('div');
        const select = nativeSelect.cloneNode(true) as HTMLSelectElement;
        picker.className = 'api-version-picker';
        select.removeAttribute('id');
        select.setAttribute('aria-label', 'API version');
        select.value = nativeSelect.value;
        select.addEventListener('change', () => {
          nativeSelect.value = select.value;
          nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        picker.append(select);

        const description = info.querySelector('.description');
        if (description) {
          description.insertAdjacentElement('afterend', picker);
        } else {
          info.append(picker);
        }

        const title = info.querySelector<HTMLElement>('.title');
        if (nativeThemeButton && title) {
          const themeToggle = document.createElement('button');
          const updateThemeToggle = () => {
            const dark =
              document.documentElement.classList.contains('dark-mode');
            const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
            themeToggle.textContent = dark ? '☀' : '☾';
            themeToggle.setAttribute('aria-label', label);
            themeToggle.title = label;
          };

          themeToggle.className = 'api-theme-toggle';
          themeToggle.type = 'button';
          themeToggle.addEventListener('click', () => {
            nativeThemeButton.click();
            requestAnimationFrame(updateThemeToggle);
          });
          updateThemeToggle();
          title.append(themeToggle);
        }
      },
    },
    patchDocumentOnRequest: (_request, response) =>
      freshDocument(
        '1',
        response as { setHeader(name: string, value: string): void },
      ),
  });

  app.use(
    '/docs',
    (
      _request: unknown,
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      response.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
        ].join('; '),
      );
      next();
    },
    apiReference({
      agent: { disabled: true },
      cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.0',
      darkMode: false,
      hideDarkModeToggle: true,
      pageTitle: `${environment.PLATFORM_NAME} API Reference`,
      showDeveloperTools: 'never',
      sources: apiVersions.map((version, index) => ({
        default: index === 0,
        slug: `v${version}`,
        title: `v${version}`,
        url: `/api/v${version}-json`,
      })),
      hideModels: true,
      theme: 'default',
      urlRouting: false,
    }),
  );
}
