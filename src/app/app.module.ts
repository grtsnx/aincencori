import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from '@/config/index.js';
import {
  ActivityInterceptor,
  AuthGuard,
  HttpExceptionFilter,
  ResponseInterceptor,
} from '@/middleware';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LibModule } from '@/lib/lib.module.js';
import { RedisService } from '@/lib/redis/redis.service.js';
import { V1Module } from '@/modules/v1.modules.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ObserveModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        enabled:
          config.getOrThrow<string>('NODE_ENV') !== 'test' &&
          config.getOrThrow<boolean>('OBSERVE_ENABLED'),
        appKey: config.get<string>('OBSERVE_APP_KEY'),
        appSecret: config.get<string>('OBSERVE_APP_SECRET'),
        serviceId: config.get<string>('OBSERVE_SERVICE_ID') ?? '',
      }),
    }),
    // Counted in Redis, so the limit holds across every API server. If
    // Redis is away the request is let through instead of failing.
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: {
          increment: (key, ttl, limit, blockDuration) =>
            redis
              .throttle(`throttle:${key}`, ttl, limit, blockDuration)
              .catch(() => ({
                totalHits: 1,
                timeToExpire: 0,
                isBlocked: false,
                timeToBlockExpire: 0,
              })),
        },
      }),
    }),
    TerminusModule,
    LibModule,
    V1Module,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
