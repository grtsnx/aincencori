import { describe, expect, it } from 'vitest';
import { HashService } from '@/lib/hash/hash.service.js';

describe('HashService', () => {
  const hasher = new HashService();

  it('hashes with Argon2id and a fresh salt each time', async () => {
    const first = await hasher.hash('correct horse');
    const second = await hasher.hash('correct horse');

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
  });

  it('verifies the right value and rejects others', async () => {
    const hashed = await hasher.hash('correct horse');

    await expect(hasher.verify(hashed, 'correct horse')).resolves.toBe(true);
    await expect(hasher.verify(hashed, 'wrong horse')).resolves.toBe(false);
    await expect(hasher.verify('not-a-hash', 'x')).resolves.toBe(false);
  });
});
