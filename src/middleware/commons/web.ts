// The web, for agents: search results in one shape (whichever search we
// use), and reading a page as plain text. Pages are only fetched from the
// public internet, never our own network.
import { htmlToText } from './document-text.js';
import { assertPublicUrl, safeFetch } from './safe-url.js';

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  // When it was published, when the search knows.
  date?: string;
}

export type Freshness = 'day' | 'week' | 'month' | 'year';

// "24h", "7d", "1m", "3m", "1y"... as the nearest range searches offer.
export function freshnessFor(value?: string): Freshness | undefined {
  const match = /^(\d+)\s*([hdwmy])$/i.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const days =
    Number(match[1]) *
    { h: 1 / 24, d: 1, w: 7, m: 30, y: 365 }[
      match[2].toLowerCase() as 'h' | 'd' | 'w' | 'm' | 'y'
    ];
  if (days <= 1) return 'day';
  if (days <= 7) return 'week';
  if (days <= 31) return 'month';
  return 'year';
}

// Results as the AI reads them: numbered, with the link and a snippet.
export function formatResults(results: WebResult[]): string {
  if (results.length === 0) return 'No results.';
  return results
    .map(
      (result, index) =>
        `${index + 1}. ${result.title}\n   ${result.url}` +
        (result.date ? `\n   Published: ${result.date}` : '') +
        (result.snippet ? `\n   ${result.snippet}` : ''),
    )
    .join('\n');
}

export class PageReadError extends Error {}

const maxPageBytes = 3 * 1_048_576;

// A web page as plain text, cut to maxChars. Throws PageReadError with a
// plain reason when the page cannot be read.
export async function readWebPage(
  address: string,
  maxChars = 20_000,
): Promise<string> {
  const url = await assertPublicUrl(address).catch(() => {
    throw new PageReadError('Only public https pages can be read.');
  });
  const fetcher = safeFetch();
  try {
    const response = await fetcher(url, {
      headers: {
        accept: 'text/html,text/plain;q=0.9,*/*;q=0.5',
        'user-agent': 'Mozilla/5.0 (compatible; AgenticBot/1.0)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new PageReadError(
        `The page answered ${response.status}; it could not be read.`,
      );
    }
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/|json|xml/i.test(type)) {
      throw new PageReadError(`This is not a page of text (${type}).`);
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > maxPageBytes) {
      throw new PageReadError('The page is too big to read.');
    }
    const raw = new TextDecoder().decode(body);
    const text = (/html/i.test(type) ? htmlToText(raw) : raw)
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*/g, '\n\n')
      .trim();
    return text.length > maxChars
      ? `${text.slice(0, maxChars)}\n\n(The page goes on; only the start was read.)`
      : text || 'The page has no text.';
  } catch (error) {
    if (error instanceof PageReadError) throw error;
    throw new PageReadError('The page could not be reached.');
  } finally {
    await fetcher.close();
  }
}
