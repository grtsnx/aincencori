import { createHmac, timingSafeEqual } from 'node:crypto';

// A paused AI run (stopped at a step the user must approve), signed the same
// way the chat signs it. A routine or plan that stops can then be approved
// later from the inbox, through the normal chat.

const sign = (payload: string, secret: string): Buffer =>
  createHmac('sha256', `cencori-agent-chat:${secret}`).update(payload).digest();

export function signRunState(state: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

// The run's JSON when the signature is right, else null.
export function readRunState(token: string, secret: string): unknown {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
