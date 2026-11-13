import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private client?: PrismaClient;

  constructor(private readonly configService: ConfigService) {}

  // The client connects on first use, so the app starts without a database.
  // Anything that reads or writes data throws here when DATABASE_URL is not set.
  get db(): PrismaClient {
    this.client ??= new PrismaClient({
      adapter: new PrismaPg({
        connectionString: this.configService.getOrThrow<string>('DATABASE_URL'),
        connectionTimeoutMillis: 5_000,
        query_timeout: 10_000,
      }),
    });
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
