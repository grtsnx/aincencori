// A small load test against a running API (no AI calls, so it costs nothing).
//   bun run load-test                      (http://localhost:3000, 20 at once, 20 s)
//   bun run load-test https://api.example.com 50 30
// Set COOKIE to a signed-in session cookie to also hit signed-in routes.
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const concurrency = Number(process.argv[3] ?? 20);
const seconds = Number(process.argv[4] ?? 20);
const cookie = process.env.COOKIE;

const routes = [
  '/v1/health/live',
  '/v1/marketplace?limit=20',
  ...(cookie
    ? ['/v1/bots', '/v1/usage', '/v1/approvals', '/v1/chat']
    : []),
];

const timings: Record<string, number[]> = {};
const failures: Record<string, number> = {};
const deadline = Date.now() + seconds * 1000;

async function worker(index: number): Promise<void> {
  let turn = index;
  while (Date.now() < deadline) {
    const route = routes[turn++ % routes.length];
    const started = performance.now();
    try {
      const response = await fetch(`${base}${route}`, {
        headers: cookie ? { cookie } : {},
      });
      await response.arrayBuffer();
      if (response.status >= 500 || response.status === 429) {
        failures[route] = (failures[route] ?? 0) + 1;
      }
    } catch {
      failures[route] = (failures[route] ?? 0) + 1;
    }
    (timings[route] ??= []).push(performance.now() - started);
  }
}

const percentile = (values: number[], share: number) =>
  values[Math.min(values.length - 1, Math.floor(values.length * share))] ?? 0;

console.log(`${concurrency} at once for ${seconds}s against ${base}\n`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

let total = 0;
let failed = 0;
for (const route of routes) {
  const values = (timings[route] ?? []).sort((a, b) => a - b);
  total += values.length;
  failed += failures[route] ?? 0;
  console.log(
    `${route.padEnd(28)} ${String(values.length).padStart(6)} requests  ` +
      `p50 ${percentile(values, 0.5).toFixed(0)}ms  ` +
      `p95 ${percentile(values, 0.95).toFixed(0)}ms  ` +
      `p99 ${percentile(values, 0.99).toFixed(0)}ms  ` +
      `failed ${failures[route] ?? 0}`,
  );
}
console.log(
  `\n${(total / seconds).toFixed(0)} requests a second, ${failed} failed ` +
    '(429 means the rate limit worked).',
);
