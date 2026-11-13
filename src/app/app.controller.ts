import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { AppService } from './app.service.js';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '@/middleware';

@Controller({ version: ['1', '2'] })
@ApiTags('Server')
@Public()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @ApiOperation({
    summary: 'Ping',
    description: 'Confirms the API answers requests.',
  })
  @ApiOkResponse({ schema: { type: 'string', example: 'Hello World!' } })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiOperation({
    summary: 'Liveness',
    description: 'Shows the process is running.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { status: { type: 'string', example: 'ok' } },
    },
  })
  @SkipThrottle()
  @Get('health/live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @ApiOperation({
    summary: 'Readiness',
    description:
      'Checks database, Redis, Cencori, email, workers and file storage.',
  })
  @ApiOkResponse({
    description:
      'Ready. Answers 503 only when the database, Redis or memory fail; ' +
      'Cencori, email, workers and storage are shown but never fail it.',
    schema: {
      type: 'object',
      example: {
        database: { status: 'up', latencyMs: 2 },
        redis: { status: 'up', latencyMs: 1 },
        memory_heap: { status: 'up' },
        memory_rss: { status: 'up' },
        cencori: { status: 'up', latencyMs: 180 },
        email: { status: 'up', provider: 'smtp', waiting: 0, failed: 0 },
        workers: { status: 'up', count: 2 },
        storage: { status: 'up', latencyMs: 12 },
      },
    },
  })
  @SkipThrottle()
  @Get('health/ready')
  @HealthCheck({ swaggerDocumentation: false })
  async ready() {
    const [result, optional] = await Promise.all([
      this.health.check([
        async () => ({ database: await this.appService.database() }),
        async () => ({ redis: await this.appService.redis() }),
        () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
        () => this.memory.checkRSS('memory_rss', 1_500_000_000),
      ]),
      this.appService.optional(),
    ]);
    return { ...result.details, ...optional };
  }
}
