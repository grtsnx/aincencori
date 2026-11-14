import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Freshness, WebResult } from '@/middleware';

// Firecrawl's API. Fixed, so not a setting.
const apiUrl = 'https://api.firecrawl.dev';
// An account that said it is out of credit is skipped this long.
const emptyForMs = 60 * 60_000;
const freshnessCode: Record<Freshness, string> = {
  day: 'qdr:d',
  week: 'qdr:w',
  month: 'qdr:m',
  year: 'qdr:y',
};

// Firecrawl: web search, and reading pages in a real browser (pages that need
// JavaScript). One or two accounts (FIRECRAWL_API_KEY, FIRECRAWL_API_KEY_2): a
// call goes to the account that last worked; when it is out of credit, to the
// other. Errors are thrown as they are; the caller hides them from users and
// tells our team.
@Injectable()
export class FirecrawlService {
  private readonly keys: string[];
  private readonly emptyUntil = new Map<string, number>();
  private current = 0;
  // Tests swap in a stand-in.
  fetch: typeof fetch = (input, init) => fetch(input, init);

  constructor(config: ConfigService) {
    this.keys = [
      ...new Set(
        [
          config.get<string>('FIRECRAWL_API_KEY'),
          config.get<string>('FIRECRAWL_API_KEY_2'),
        ]
          .map((key) => key?.trim())
          .filter((key): key is string => Boolean(key)),
      ),
    ];
  }

  get isConfigured(): boolean {
    return this.keys.length > 0;
  }

  async search(
    query: string,
    options: { limit?: number; freshness?: Freshness } = {},
  ): Promise<WebResult[]> {
    const data = (await this.call('/v2/search', {
      query,
      limit: options.limit ?? 8,
      ...(options.freshness && { tbs: freshnessCode[options.freshness] }),
    })) as {
      data?: { web?: { url?: string; title?: string; description?: string }[] };
    };
    return (data.data?.web ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title || item.url!,
        url: item.url!,
        snippet: item.description ?? '',
      }));
  }

  // A page as Markdown, read in a browser (so JavaScript pages work).
  async read(url: string): Promise<{ title: string; text: string }> {
    const data = (await this.call(
      '/v2/scrape',
      { url, formats: ['markdown'], onlyMainContent: true },
      60_000,
    )) as {
      data?: {
        markdown?: string;
        metadata?: { title?: string; statusCode?: number };
      };
    };
    const status = data.data?.metadata?.statusCode ?? 200;
    if (status >= 400) throw new Error(`The page answered ${status}.`);
    return {
      title: data.data?.metadata?.title ?? '',
      text: data.data?.markdown?.trim() ?? '',
    };
  }

  private async call(
    path: string,
    body: unknown,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    if (this.keys.length === 0)
      throw new Error('FIRECRAWL_API_KEY is not set.');
    const now = Date.now();
    // The account that last worked first; ones out of credit go last.
    const order = this.keys
      .map((_, index) => (this.current + index) % this.keys.length)
      .sort(
        (a, b) =>
          Number((this.emptyUntil.get(this.keys[a]) ?? 0) > now) -
          Number((this.emptyUntil.get(this.keys[b]) ?? 0) > now),
      );
    let problem = '';
    for (const index of order) {
      const key = this.keys[index];
      const response = await this.fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (response.ok) {
        this.current = index;
        this.emptyUntil.delete(key);
        return JSON.parse(text || '{}');
      }
      problem = `Firecrawl answered ${response.status}: ${text.slice(0, 300)}`;
      const empty =
        response.status === 402 ||
        ((response.status === 403 || response.status === 429) &&
          /credit|quota|insufficient|plan limit|upgrade/i.test(text));
      if (!empty) break;
      this.emptyUntil.set(key, now + emptyForMs);
    }
    throw new Error(problem || 'Firecrawl did not answer.');
  }
}
