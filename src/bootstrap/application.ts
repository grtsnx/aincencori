import {
  ConsoleLogger,
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule, ObserveInstrument } from '@/app';
import type { Environment } from '@/config/index.js';
import { authBasePath } from '@/config/better-auth.js';
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
  app
    .getHttpAdapter()
    .getInstance()
    .all(`${authBasePath}/{*any}`, app.get(BetterAuthService).handler);

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
  const config = app.get(ConfigService);
  const environment: Environment = {
    NODE_ENV: config.getOrThrow<Environment['NODE_ENV']>('NODE_ENV'),
    PORT: config.getOrThrow<number>('PORT'),
    PLATFORM_NAME: config.getOrThrow<string>('PLATFORM_NAME'),
    CORS_ORIGINS: config.getOrThrow<string[]>('CORS_ORIGINS'),
    OBSERVE_ENABLED: config.getOrThrow<boolean>('OBSERVE_ENABLED'),
    OBSERVE_APP_KEY: config.get<string>('OBSERVE_APP_KEY'),
    OBSERVE_APP_SECRET: config.get<string>('OBSERVE_APP_SECRET'),
    OBSERVE_SERVICE_ID: config.get<string>('OBSERVE_SERVICE_ID'),
    SWAGGER_ENABLED: config.getOrThrow<boolean>('SWAGGER_ENABLED'),
    DATABASE_URL: config.get<string>('DATABASE_URL'),
    BETTER_AUTH_SECRET: config.get<string>('BETTER_AUTH_SECRET'),
    BETTER_AUTH_URL: config.getOrThrow<string>('BETTER_AUTH_URL'),
    AUTH_COOKIE_DOMAIN: config.get<string>('AUTH_COOKIE_DOMAIN'),
  };
  configureApplication(app, environment);
  return { app, environment };
}
