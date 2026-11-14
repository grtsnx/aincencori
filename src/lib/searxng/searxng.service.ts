import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Freshness, WebResult } from '@/middleware';

// Web search with our own SearXNG (SEARXNG_URL): a free search engine we run
// ourselves (see compose.yaml), which asks several search engines at once.
// No key and no bill. Errors are thrown as they are; the caller hides them
// from users and tells our team.
@Injectable()
export class SearxngService {
  private readonly baseUrl?: string;
  // Tests swap in a stand-in.
  fetch: typeof fetch = (input, init) => fetch(input, init);

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('SEARXNG_URL')?.replace(/\/+$/, '');
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async search(
    query: string,
    options: { limit?: number; freshness?: Freshness } = {},
  ): Promise<WebResult[]> {
    if (!this.baseUrl) throw new Error('SEARXNG_URL is not set.');
    const params = new URLSearchParams({ q: query, format: 'json' });
    if (options.freshness) params.set('time_range', options.freshness);
    const response = await this.fetch(`${this.baseUrl}/search?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`SearXNG answered ${response.status}.`);
    }
    const data = (await response.json()) as {
      results?: {
        title?: string;
        url?: string;
        content?: string;
        publishedDate?: string | null;
      }[];
    };
    return (data.results ?? [])
      .filter((result) => result.url && result.title)
      .slice(0, options.limit ?? 8)
      .map((result) => ({
        title: result.title!,
        url: result.url!,
        snippet: result.content ?? '',
        ...(result.publishedDate && {
          date: result.publishedDate.slice(0, 10),
        }),
      }));
  }
}
