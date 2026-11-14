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

function chatWith(
  brave?: ReturnType<typeof search>,
  searxng?: ReturnType<typeof search>,
) {
  const service = new ChatService(
    { get: () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
    { handle: vi.fn(), add: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    { log: vi.fn() } as never,
    brave as never,
    searxng as never,
  );
  return (
    service as unknown as {
      searchWeb: (query: string, freshness?: string) => Promise<string>;
    }
  ).searchWeb.bind(service);
}

const result = {
  title: 'Bitcoin price today',
  url: 'https://www.coindesk.com/price/bitcoin',
  snippet: 'BTC to USD live price.',
  date: '2026-11-14',
};

describe('web search, our own', () => {
  it('uses Brave first, with the date range asked for', async () => {
    const brave = search(() => Promise.resolve([result]));
    const searxng = search(() => Promise.resolve([]));

    const text = await chatWith(brave, searxng)('bitcoin price', '24h');

    expect(text).toContain('1. Bitcoin price today');
    expect(text).toContain('https://www.coindesk.com/price/bitcoin');
    expect(brave.search).toHaveBeenCalledWith('bitcoin price', {
      freshness: 'day',
    });
    expect(searxng.search).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it('falls back to our SearXNG when Brave fails, and tells the team', async () => {
    const brave = search(() => Promise.reject(new Error('Brave answered 429')));
    const searxng = search(() => Promise.resolve([result]));

    const text = await chatWith(brave, searxng)('bitcoin price');

    expect(text).toContain('Bitcoin price today');
    expect(alerts).toEqual([
      expect.objectContaining({
        source: 'web-search',
        detail: expect.stringContaining('Brave answered 429'),
      }),
    ]);
  });

  it('never passes an outside error to the AI, and says plainly it cannot search', async () => {
    const brave = search(() =>
      Promise.reject(new Error('credit balance exhausted for key sk-123')),
    );
    const searxng = search(() =>
      Promise.reject(new Error('SearXNG answered 502.')),
    );

    const text = await chatWith(brave, searxng)('weather in Lagos');

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
