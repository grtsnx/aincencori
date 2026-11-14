import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Freshness, WebResult } from '@/middleware';

// Exa's API. Fixed, so not a setting.
const apiUrl = 'https://api.exa.ai/search';
const freshnessDays: Record<Freshness, number> = {
  day: 1,
  week: 7,
  month: 31,
  year: 365,
};

// Web search with Exa (EXA_API_KEY): a search engine built for AI. Each
// result comes with the passages of the page that answer the question, so
// the AI often needs no second step to read the page. Errors are thrown as
// they are; the caller hides them from users and tells our team.
@Injectable()
export class ExaService {
  private readonly apiKey?: string;
  // Tests swap in a stand-in.
  fetch: typeof fetch = (input, init) => fetch(input, init);

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('EXA_API_KEY');
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(
    query: string,
    options: { limit?: number; freshness?: Freshness } = {},
  ): Promise<WebResult[]> {
    if (!this.apiKey) throw new Error('EXA_API_KEY is not set.');
    const body: Record<string, unknown> = {
      query,
      type: 'auto',
      numResults: options.limit ?? 8,
      contents: { highlights: { maxCharacters: 600 } },
    };
    if (options.freshness) {
      body.startPublishedDate = new Date(
        Date.now() - freshnessDays[options.freshness] * 24 * 60 * 60_000,
      ).toISOString();
    }
    const response = await this.fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(
        `Exa answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    const data = (await response.json()) as {
      results?: {
        title?: string | null;
        url?: string;
        publishedDate?: string | null;
        highlights?: string[];
        text?: string;
      }[];
    };
    return (data.results ?? [])
      .filter((result) => result.url)
      .map((result) => ({
        title: result.title || result.url!,
        url: result.url!,
        snippet: (result.highlights ?? []).join(' … ') || (result.text ?? ''),
        ...(result.publishedDate && {
          date: result.publishedDate.slice(0, 10),
        }),
      }));
  }
}
