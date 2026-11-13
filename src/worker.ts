import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app';
import { validateEnvironment } from '@/config/index.js';
import { BullmqService } from '@/lib/bullmq/bullmq.service.js';

// Starts a worker: it runs background jobs (routines, emails, cleanups) and
// serves no API routes. Run as many as you need beside the API servers; they
// share the same Postgres and Redis. Production: `node dist/worker.js`.
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: new ConsoleLogger({
    json: true,
    logLevels: ['log', 'warn', 'error', 'fatal'],
  }),
});
validateEnvironment(process.env);
// On stop (deploys, scaling down) running jobs finish before it exits.
app.enableShutdownHooks();
const jobs = app.get(BullmqService).startWorkers();

new ConsoleLogger('Worker').log(`Running jobs: ${jobs.join(', ')}`);
