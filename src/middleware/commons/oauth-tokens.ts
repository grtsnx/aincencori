// Encrypts OAuth tokens stored before Better Auth's encryptOAuthTokens was on.
// Used by scripts/encrypt-oauth-tokens.ts; already-encrypted values are kept.
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';

async function isEncrypted(token: string, secret: string): Promise<boolean> {
  if (token.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(token)) return false;
  try {
    await symmetricDecrypt({ key: secret, data: token });
    return true;
  } catch {
    return false;
  }
}

export async function encryptOAuthToken(
  token: string | null,
  secret: string,
): Promise<string | null> {
  if (token == null || (await isEncrypted(token, secret))) return token;
  return symmetricEncrypt({ key: secret, data: token });
}
