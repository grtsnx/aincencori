import { symmetricEncrypt } from 'better-auth/crypto';

function isEncrypted(token: string): boolean {
  return token.startsWith('$ba$') || (token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token));
}

export async function encryptOAuthToken(
  token: string | null,
  secret: string,
): Promise<string | null> {
  if (token == null || isEncrypted(token)) return token;
  return symmetricEncrypt({ key: secret, data: token });
}
