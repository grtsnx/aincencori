// Tells the team when something breaks, by posting to a chat webhook (Slack,
// Discord or any URL that takes {"text": "..."}). The same alert is sent at
// most once every 10 minutes per server, so a flood of errors is one message.

const quietMs = 10 * 60_000;
const lastSent = new Map<string, number>();

export function sendAlert(
  webhookUrl: string | undefined,
  title: string,
  detail?: string,
): void {
  if (!webhookUrl) return;
  const now = Date.now();
  if ((lastSent.get(title) ?? 0) > now - quietMs) return;
  lastSent.set(title, now);
  if (lastSent.size > 500) lastSent.clear();
  const text = detail ? `${title}\n${detail.slice(0, 1500)}` : title;
  // An alert must never cause a second error.
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}
