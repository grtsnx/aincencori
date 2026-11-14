import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Freshness, WebResult } from '@/middleware';

// Brave Search's API. Fixed, so not a setting.
const apiUrl = 'https://api.search.brave.com/res/v1/web/search';
const freshnessCode: Record<Freshness, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

// Web search with Brave Search (BRAVE_SEARCH_API_KEY): its own index of the
// web, with a free tier. Errors are thrown as they are; the caller hides
// them from users and tells our team.
@Injectable()
export class BraveService {
  private readonly apiKey?: string;
  // Tests swap in a stand-in.
  fetch: typeof fetch = (input, init) => fetch(input, init);

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('BRAVE_SEARCH_API_KEY');
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(
    query: string,
    options: { limit?: number; freshness?: Freshness } = {},
  ): Promise<WebResult[]> {
    if (!this.apiKey) throw new Error('BRAVE_SEARCH_API_KEY is not set.');
    const params = new URLSearchParams({
      q: query,
      count: String(options.limit ?? 8),
    });
    if (options.freshness) {
      params.set('freshness', freshnessCode[options.freshness]);
    }
    const response = await this.fetch(`${apiUrl}?${params}`, {
      headers: {
        accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(
        `Brave answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    const data = (await response.json()) as {
      web?: {
        results?: {
          title?: string;
          url?: string;
          description?: string;
          age?: string;
        }[];
      };
    };
    return (data.web?.results ?? [])
      .filter((result) => result.url && result.title)
      .map((result) => ({
        title: stripTags(result.title!),
        url: result.url!,
        snippet: stripTags(result.description ?? ''),
        ...(result.age && { date: result.age }),
      }));
  }
}

// Brave marks matched words with <strong>.
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}
