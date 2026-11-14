// Tells our team when something breaks. Users never see these details: they
// get a plain message, and the real error comes here.
//
// When the app runs, the alert module (modules/alert) takes every alert: it
// keeps it, emails the admins and posts to ALERT_WEBHOOK_URL. Before that
// (or in a process without it) alerts go straight to the webhook. The same
// alert is sent at most once every 10 minutes, so a flood is one message.

const quietMs = 10 * 60_000;
const lastSent = new Map<string, number>();

export type AlertSink = (alert: {
  source: string;
  title: string;
  detail?: string;
}) => void;

let sink: AlertSink | undefined;

// The alert module plugs itself in here.
export function useAlertSink(next: AlertSink | undefined): void {
  sink = next;
}

// Reports a problem with an outside service (or our own), for staff only.
export function reportProblem(
  source: string,
  title: string,
  detail?: unknown,
): void {
  const text =
    detail instanceof Error
      ? detail.message
      : typeof detail === 'string'
        ? detail
        : detail === undefined
          ? undefined
          : JSON.stringify(detail);
  if (sink) {
    sink({ source, title, detail: text });
    return;
  }
  postToWebhook(process.env.ALERT_WEBHOOK_URL, title, text);
}

// Older callers pass the webhook address themselves.
export function sendAlert(
  webhookUrl: string | undefined,
  title: string,
  detail?: string,
): void {
  if (sink) {
    sink({ source: 'server', title, detail });
    return;
  }
  postToWebhook(webhookUrl, title, detail);
}

// Posts to a chat webhook (Slack, Discord, or anything taking {"text"}).
export function postToWebhook(
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
