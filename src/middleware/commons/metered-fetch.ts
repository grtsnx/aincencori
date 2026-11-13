// Counts what each AI call used. Cencori ends every model call with a
// "turn.completed" event that carries the tokens and the cost; this fetch
// reads a copy of the stream as it passes, so nothing is slowed down.

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

// The usage in one "turn.completed" event's data, or null if it has none.
export function usageFromEvent(data: unknown): ModelUsage | null {
  if (!data || typeof data !== 'object') return null;
  const { usage, trace } = data as {
    usage?: Record<string, unknown>;
    trace?: Record<string, unknown>;
  };
  if (!usage) return null;
  return {
    inputTokens: number(usage.input_tokens),
    outputTokens: number(usage.output_tokens),
    // What Cencori charges, or what the AI provider charged if more.
    costUsd: Math.max(
      number(trace?.cost_usd),
      number(trace?.provider_cost_usd),
    ),
  };
}

// Reads server-sent events from a stream and reports each model call's usage.
async function readUsage(
  body: ReadableStream<Uint8Array>,
  onUsage: (usage: ModelUsage) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data = '';
  const line = (text: string) => {
    if (text === '') {
      if (event === 'turn.completed' && data) {
        try {
          const usage = usageFromEvent(JSON.parse(data));
          if (usage) onUsage(usage);
        } catch {
          // Not JSON: nothing to count.
        }
      }
      event = '';
      data = '';
    } else if (text.startsWith('event:')) {
      event = text.slice(6).trim();
    } else if (text.startsWith('data:')) {
      data += text.slice(5).replace(/^ /, '');
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
      }
    }
    if (buffer) line(buffer.replace(/\r$/, ''));
    line('');
  } finally {
    reader.releaseLock();
  }
}

// A fetch that reports the usage of every streamed answer it carries.
export function meteredFetch(
  onUsage: (usage: ModelUsage) => void,
  base: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    const isStream = response.headers
      .get('content-type')
      ?.includes('text/event-stream');
    if (!isStream || !response.body) return response;
    const [forCaller, forMeter] = response.body.tee();
    // Counting must never break the answer.
    readUsage(forMeter, onUsage).catch(() => undefined);
    return new Response(forCaller, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
