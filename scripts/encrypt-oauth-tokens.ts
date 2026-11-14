import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { encryptOAuthToken } from '../src/middleware/commons/oauth-tokens.js';

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;

if (!databaseUrl || !secret) {
  throw new Error('DATABASE_URL and BETTER_AUTH_SECRET are required');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function migrate(): Promise<void> {
  let cursor: string | undefined;
  let encryptedCount = 0;
  let changedDuringMigration = 0;

  for (;;) {
    const accounts = await prisma.account.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: 100,
      select: {
        id: true,
        accessToken: true,
        refreshToken: true,
        idToken: true,
      },
    });
    if (accounts.length === 0) break;

    for (const account of accounts) {
      const accessToken = await encryptOAuthToken(account.accessToken, secret!);
      const refreshToken = await encryptOAuthToken(
        account.refreshToken,
        secret!,
      );
      const idToken = await encryptOAuthToken(account.idToken, secret!);
      if (
        accessToken === account.accessToken &&
        refreshToken === account.refreshToken &&
        idToken === account.idToken
      ) {
        continue;
      }

      const result = await prisma.account.updateMany({
        where: {
          id: account.id,
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          idToken: account.idToken,
        },
        data: { accessToken, refreshToken, idToken },
      });
      if (result.count === 1) encryptedCount++;
      else changedDuringMigration++;
    }

    cursor = accounts.at(-1)?.id;
  }

  console.info(
    `OAuth token migration complete: ${encryptedCount} account rows encrypted; ${changedDuringMigration} rows changed concurrently.`,
  );
}

try {
  await migrate();
} catch {
  console.error('OAuth token migration failed. No token values were logged.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
