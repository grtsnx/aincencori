import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Freshness, WebResult } from '@/middleware';

// Context.dev's MCP address. Fixed, so not a setting.
const mcpUrl = 'https://mcp.context.dev/mcp';
const freshnessCode: Record<Freshness, string> = {
  day: 'last_24_hours',
  week: 'last_week',
  month: 'last_month',
  year: 'last_year',
};

// Context.dev (CONTEXT_API_KEY): web search and page reading, through its MCP
// tools. It answers 200 even when it refuses, so refusals are read from the
// answer. Errors are thrown as they are; the caller hides them from users and
// tells our team.
@Injectable()
export class ContextDevService {
  private readonly apiKey?: string;
  // Tests swap in a stand-in.
  fetch: typeof fetch = (input, init) => fetch(input, init);

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('CONTEXT_API_KEY');
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(
    query: string,
    options: { limit?: number; freshness?: Freshness } = {},
  ): Promise<WebResult[]> {
    const text = await this.tool('web-search', {
      query,
      numResults: options.limit ?? 8,
      responseMode: 'compact',
      ...(options.freshness && { freshness: freshnessCode[options.freshness] }),
    });
    const data = JSON.parse(text) as {
      results?: { url?: string; title?: string; description?: string }[];
    };
    return (data.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title || item.url!,
        url: item.url!,
        snippet: item.description ?? '',
      }));
  }

  // A page as Markdown.
  async read(url: string): Promise<{ title: string; text: string }> {
    const text = await this.tool(
      'web-scrape',
      { url, formats: { markdown: true } },
      60_000,
    );
    const data = JSON.parse(text) as {
      markdown?: { success?: boolean | null; data?: string | null };
      metadata?: { title?: string };
    };
    if (data.markdown?.success === false) {
      throw new Error('Context.dev could not read the page.');
    }
    return {
      title: data.metadata?.title ?? '',
      text: data.markdown?.data?.trim() ?? '',
    };
  }

  private async tool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<string> {
    if (!this.apiKey) throw new Error('CONTEXT_API_KEY is not set.');
    const response = await this.fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `Context.dev answered ${response.status}: ${raw.slice(0, 300)}`,
      );
    }
    // A JSON answer, or one server-sent event carrying it.
    const payload = raw.trimStart().startsWith('{')
      ? raw
      : (raw.match(/^data: (\{.*\})$/m)?.[1] ?? '');
    const body = JSON.parse(payload || '{}') as {
      error?: { message?: string };
      result?: { isError?: boolean; content?: { text?: string }[] };
    };
    const text = body.result?.content?.find((item) => item.text)?.text;
    if (body.error || body.result?.isError || !text) {
      throw new Error(
        `Context.dev ${name} refused: ${(body.error?.message ?? text ?? 'no answer').slice(0, 300)}`,
      );
    }
    return text;
  }
}
