import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatResults, freshnessFor, useAlertSink } from '@/middleware';
import { ChatService } from '@/modules/chat/chat.service.js';

const alerts: { source: string; title: string; detail?: string }[] = [];
useAlertSink((alert) => alerts.push(alert));
afterEach(() => {
  alerts.length = 0;
});

const search = (answer: () => Promise<unknown[]>) => ({
  isConfigured: true,
  search: vi.fn(answer),
});

// The chat's web search, with stand-ins for the searches, the usage meter
// and today's count of paid searches.
function chatWith(
  exa?: ReturnType<typeof search>,
  searxng?: ReturnType<typeof search>,
  more: {
    firecrawl?: ReturnType<typeof search>;
    context?: ReturnType<typeof search>;
    searchesToday?: number;
  } = {},
) {
  const record = vi.fn().mockResolvedValue(undefined);
  const service = new ChatService(
    { get: () => undefined } as never,
    {} as never,
    {} as never,
    {
      db: {
        usageDay: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ calls: more.searchesToday ?? 0 }),
        },
      },
    } as never,
    { handle: vi.fn(), add: vi.fn() } as never,
    {} as never,
    { record } as never,
    {} as never,
    { log: vi.fn() } as never,
    exa as never,
    searxng as never,
    more.firecrawl as never,
    more.context as never,
  );
  const searchWeb = (
    service as unknown as {
      searchWeb: (
        userId: string,
        query: string,
        freshness?: string,
      ) => Promise<string>;
    }
  ).searchWeb.bind(service);
  return Object.assign(
    (query: string, freshness?: string) => searchWeb('u1', query, freshness),
    { record },
  );
}

const result = {
  title: 'Bitcoin price today',
  url: 'https://www.coindesk.com/price/bitcoin',
  snippet: 'BTC to USD live price.',
  date: '2026-11-14',
};

describe('web search, our own', () => {
  it('uses Exa first, with the date range asked for', async () => {
    const exa = search(() => Promise.resolve([result]));
    const searxng = search(() => Promise.resolve([]));

    const text = await chatWith(exa, searxng)('bitcoin price', '24h');

    expect(text).toContain('1. Bitcoin price today');
    expect(text).toContain('https://www.coindesk.com/price/bitcoin');
    expect(exa.search).toHaveBeenCalledWith('bitcoin price', {
      freshness: 'day',
    });
    expect(searxng.search).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it('falls back to our SearXNG when Exa fails, and tells the team', async () => {
    const exa = search(() => Promise.reject(new Error('Exa answered 429')));
    const searxng = search(() => Promise.resolve([result]));

    const text = await chatWith(exa, searxng)('bitcoin price');

    expect(text).toContain('Bitcoin price today');
    expect(alerts).toEqual([
      expect.objectContaining({
        source: 'web-search',
        detail: expect.stringContaining('Exa answered 429'),
      }),
    ]);
  });

  it('never passes an outside error to the AI, and says plainly it cannot search', async () => {
    const exa = search(() =>
      Promise.reject(new Error('credit balance exhausted for key sk-123')),
    );
    const searxng = search(() =>
      Promise.reject(new Error('SearXNG answered 502.')),
    );

    const text = await chatWith(exa, searxng)('weather in Lagos');

    expect(text).toContain('Web search is not available right now');
    expect(text).not.toContain('credit');
    expect(text).not.toContain('sk-123');
    expect(alerts).toEqual([
      expect.objectContaining({
        title: 'Web search failed',
        detail: expect.stringContaining('credit balance exhausted'),
      }),
    ]);
  });

  it('turns "24h", "7d", "1m", "1y" into search date ranges', () => {
    expect(freshnessFor('24h')).toBe('day');
    expect(freshnessFor('7d')).toBe('week');
    expect(freshnessFor('3m')).toBe('year');
    expect(freshnessFor('1m')).toBe('month');
    expect(freshnessFor('soon')).toBeUndefined();
    expect(formatResults([])).toBe('No results.');
  });
});

describe('Exa', () => {
  it('asks for recent pages with their best passages, and reads them back', async () => {
    const { ExaService } = await import('@/lib/exa/exa.service.js');
    const exa = new ExaService({ get: () => 'exa_test' } as never);
    let sent:
      | {
          url: string;
          headers: Record<string, string>;
          body: Record<string, unknown>;
        }
      | undefined;
    exa.fetch = (input, init) => {
      sent = {
        url: String(input),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      };
      return Promise.resolve(
        Response.json({
          results: [
            {
              title: 'Bitcoin price today',
              url: 'https://www.coindesk.com/price/bitcoin',
              publishedDate: '2026-11-14T08:00:00.000Z',
              highlights: ['BTC is trading at $68,399.', 'Up 2% today.'],
            },
          ],
        }),
      );
    };

    const results = await exa.search('bitcoin price', { freshness: 'day' });

    expect(sent?.url).toBe('https://api.exa.ai/search');
    expect(sent?.headers['x-api-key']).toBe('exa_test');
    expect(sent?.body).toMatchObject({
      query: 'bitcoin price',
      type: 'auto',
      contents: { highlights: { maxCharacters: 600 } },
    });
    const since = Date.parse(String(sent?.body.startPublishedDate));
    expect(Date.now() - since).toBeLessThan(25 * 60 * 60_000);
    expect(results).toEqual([
      {
        title: 'Bitcoin price today',
        url: 'https://www.coindesk.com/price/bitcoin',
        snippet: 'BTC is trading at $68,399. … Up 2% today.',
        date: '2026-11-14',
      },
    ]);
  });
});

describe('web search: order, billing and fair use', () => {
  it('tries Exa, Firecrawl, Context.dev, then SearXNG, and bills only paid ones', async () => {
    const exa = search(() => Promise.reject(new Error('Exa answered 402')));
    const firecrawl = search(() => Promise.reject(new Error('out of credit')));
    const context = search(() => Promise.resolve([result]));
    const searxng = search(() => Promise.resolve([]));
    const searchWeb = chatWith(exa, searxng, { firecrawl, context });

    const text = await searchWeb('bitcoin price');

    expect(text).toContain('Bitcoin price today');
    expect(searxng.search).not.toHaveBeenCalled();
    // Context.dev answered: one paid search on the user's usage.
    await vi.waitFor(() =>
      expect(searchWeb.record).toHaveBeenCalledWith('u1', 'search', {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0.003,
      }),
    );
    expect(alerts[0].detail).toContain('Exa answered 402');
  });

  it('after the day’s fair use, asks only our free SearXNG, and bills nothing', async () => {
    const exa = search(() => Promise.resolve([result]));
    const searxng = search(() => Promise.resolve([result]));
    const searchWeb = chatWith(exa, searxng, { searchesToday: 200 });

    await searchWeb('bitcoin price');

    expect(exa.search).not.toHaveBeenCalled();
    expect(searxng.search).toHaveBeenCalled();
    expect(searchWeb.record).not.toHaveBeenCalled();
  });
});

describe('push notifications (Firebase)', () => {
  it('signs in with the service account, sends the push, and spots removed devices', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const { FirebaseService } =
      await import('@/lib/firebase/firebase.service.js');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const account = JSON.stringify({
      project_id: 'agentic-test',
      client_email: 'push@agentic-test.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
    const firebase = new FirebaseService({
      get: () => Buffer.from(account).toString('base64'),
    } as never);
    const calls: { url: string; body: string }[] = [];
    firebase.fetch = (input, init) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body) });
      if (url.includes('oauth2')) {
        return Promise.resolve(
          Response.json({ access_token: 'ya29.test', expires_in: 3600 }),
        );
      }
      return Promise.resolve(
        String(init?.body).includes('old-token')
          ? Response.json(
              {
                error: {
                  status: 'NOT_FOUND',
                  details: [{ errorCode: 'UNREGISTERED' }],
                },
              },
              { status: 404 },
            )
          : Response.json({ name: 'projects/agentic-test/messages/1' }),
      );
    };

    expect(firebase.isConfigured).toBe(true);
    await expect(
      firebase.push('new-token', {
        title: 'Hi',
        body: 'There',
        link: 'https://app.example.com/approvals',
      }),
    ).resolves.toBe('sent');
    await expect(
      firebase.push('old-token', { title: 'Hi', body: 'There' }),
    ).resolves.toBe('gone');

    // One sign-in, reused.
    expect(calls.filter((call) => call.url.includes('oauth2'))).toHaveLength(1);
    const send = calls.find((call) => call.url.includes('fcm.googleapis.com'))!;
    expect(send.url).toBe(
      'https://fcm.googleapis.com/v1/projects/agentic-test/messages:send',
    );
    expect(JSON.parse(send.body)).toMatchObject({
      message: {
        token: 'new-token',
        notification: { title: 'Hi', body: 'There' },
        webpush: { fcm_options: { link: 'https://app.example.com/approvals' } },
      },
    });
  });
});
