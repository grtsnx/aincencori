import { describe, expect, it } from 'vitest';
import { hashValue, verifyHash } from '@/middleware/commons/hash.js';

describe('hashing', () => {
  it('hashes with Argon2id and a fresh salt each time', async () => {
    const first = await hashValue('correct horse');
    const second = await hashValue('correct horse');

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
  });

  it('verifies the right value and rejects others', async () => {
    const hashed = await hashValue('correct horse');

    await expect(verifyHash(hashed, 'correct horse')).resolves.toBe(true);
    await expect(verifyHash(hashed, 'wrong horse')).resolves.toBe(false);
    await expect(verifyHash('not-a-hash', 'x')).resolves.toBe(false);
  });
});
