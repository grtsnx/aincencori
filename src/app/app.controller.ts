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
import { PrismaService } from '@/lib/prisma/prisma.service.js';

@Controller({ version: ['1', '2'] })
@ApiTags('Server')
@Public()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
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
    description: 'Shows the server can take traffic.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      example: {
        database: { status: 'up' },
        memory_heap: { status: 'up' },
        memory_rss: { status: 'up' },
      },
    },
  })
  @SkipThrottle()
  @Get('health/ready')
  @HealthCheck({ swaggerDocumentation: false })
  async ready() {
    const result = await this.health.check([
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 1_500_000_000),
      async () => {
        await this.prisma.db.$queryRaw`SELECT 1`;
        return { database: { status: 'up' as const } };
      },
    ]);
    return result.details;
  }
}
