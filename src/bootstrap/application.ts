import {
  ConsoleLogger,
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from '@/app';
import { validateEnvironment, type Environment } from '@/config/index.js';
import { authBasePath } from '@/config/auth/better-auth.js';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';
import { RequestIdMiddleware } from '@/middleware';
import { configureSwagger } from './swagger.js';

// Matches a path (after the auth base path) against every route Better Auth
// registered, such as /sign-in/email-otp or /callback/:id.
function betterAuthRouteMatcher(api: object): (path: string) => boolean {
  const patterns = Object.values(api).flatMap((endpoint: unknown) => {
    const path = (endpoint as { path?: unknown }).path;
    return typeof path === 'string'
      ? [new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}/?$`)]
      : [];
  });
  return (path) => patterns.some((pattern) => pattern.test(path));
}

export function configureApplication(
  app: INestApplication,
  environment: Environment,
): void {
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
  app.useSecurityHeaders({
    contentSecurityPolicy:
      environment.NODE_ENV === 'production'
        ? true
        : { directives: { upgradeInsecureRequests: null } },
  });
  app.enableCsrfProtection({ trustedOrigins: environment.CORS_ORIGINS });
  app.enableVersioning({ type: VersioningType.URI });
  app.enableShutdownHooks();

  if (environment.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: environment.CORS_ORIGINS,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Request-ID',
      ],
      credentials: true,
    });
  }

  // Better Auth reads the raw request body, so its routes are mounted here:
  // after security headers, CSRF and CORS, before Nest adds its JSON parser on init.
  // /.well-known is where MCP clients discover the OAuth server.
  const betterAuth = app.get(BetterAuthService);
  const { handler } = betterAuth;
  const server = app.getHttpAdapter().getInstance();
  const authBodyParser = express.text({ type: '*/*', limit: 1_048_576 });
  const authBodyLimitError: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    if (
      error &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      response.status(413).json({ message: 'Request body too large.' });
      return;
    }
    next(error);
  };
  // Parses the body with an explicit byte limit, then hands it to Better Auth.
  const toBetterAuth: RequestHandler = (request, response, next) =>
    authBodyParser(request, response, (error?: unknown) =>
      error
        ? authBodyLimitError(error, request, response, next)
        : void handler(request, response),
    );

  // Our own routes share /v1/auth (for example /v1/auth/session), so only
  // paths Better Auth actually serves go to it; the rest reach Nest.
  const isAuthRoute = betterAuthRouteMatcher(betterAuth.auth.api);
  server.all(`${authBasePath}/{*any}`, ((request, response, next) =>
    isAuthRoute(request.path.slice(authBasePath.length))
      ? toBetterAuth(request, response, next)
      : next()) as RequestHandler);
  // Agent Auth's discovery document lives under the auth path; agents look
  // for it here.
  server.get('/.well-known/agent-configuration', ((request, response, next) => {
    request.url = `${authBasePath}/agent-configuration`;
    toBetterAuth(request, response, next);
  }) as RequestHandler);
  server.use('/.well-known', authBodyParser, authBodyLimitError);
  // Chat messages can carry images and files (up to 5, as data URLs).
  server.post(
    '/v1/chat',
    express.json({ limit: 25 * 1_048_576 }),
    authBodyLimitError,
  );
  // Voice recordings (up to 10 MB, as a data URL).
  server.post(
    '/v1/voice/transcribe',
    express.json({ limit: 15 * 1_048_576 }),
    authBodyLimitError,
  );
  server.all('/.well-known/{*any}', handler);

  app.useGlobalPipes(
    new ValidationPipe({
      disableErrorMessages: environment.NODE_ENV === 'production',
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  configureSwagger(app, environment);
}

export async function createApplication(): Promise<{
  app: INestApplication;
  environment: Environment;
}> {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    logger: new ConsoleLogger({
      json: true,
      logLevels: ['warn', 'error', 'fatal'],
    }),
  });
  // ConfigModule has already checked these and loaded .env into process.env.
  const environment = validateEnvironment(process.env);
  configureApplication(app, environment);
  return { app, environment };
}
