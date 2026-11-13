import {
  ConsoleLogger,
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import express, { type ErrorRequestHandler } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from '@/app';
import { validateEnvironment, type Environment } from '@/config/index.js';
import { authBasePath } from '@/config/auth/better-auth.js';
import { BetterAuthService } from '@/lib/better-auth/better-auth.service.js';
import { RequestIdMiddleware } from '@/middleware';
import { configureSwagger } from './swagger.js';

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
  const { handler } = app.get(BetterAuthService);
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
  // These routes run before Nest's default parsers; apply the same explicit
  // byte limit here, then pass their UTF-8 body through to Better Auth.
  server.use(authBasePath, authBodyParser, authBodyLimitError);
  server.use('/.well-known', authBodyParser, authBodyLimitError);
  server.all(`${authBasePath}/{*any}`, handler);
  // Agent Auth's discovery document lives under the auth path; agents look
  // for it here.
  server.get(
    '/.well-known/agent-configuration',
    (request: { url: string }, response: unknown) => {
      request.url = `${authBasePath}/agent-configuration`;
      return handler(request as never, response as never);
    },
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
