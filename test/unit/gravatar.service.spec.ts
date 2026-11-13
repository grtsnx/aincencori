import { describe, expect, it, vi } from 'vitest';
import {
  avatarSeed,
  resolveProfileImage,
} from '@/lib/gravatar/gravatar.service.js';

const email = '  Ada@Example.com ';
const hash = avatarSeed('ada@example.com');

describe('profile pictures', () => {
  it('hashes the email; the address itself never goes out', () => {
    expect(avatarSeed(email)).toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses the Gravatar when the email has one', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    const url = await resolveProfileImage(email, undefined, undefined, fetcher);

    expect(url).toBe(`https://www.gravatar.com/avatar/${hash}?s=200&r=pg`);
    expect(fetcher.mock.calls[0]?.[0]).toContain('d=404');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' });
  });

  it('falls back to an animated DiceBear loops avatar', async () => {
    const missing = vi.fn().mockResolvedValue({ ok: false });

    const url = await resolveProfileImage(email, undefined, undefined, missing);

    expect(url).toBe(
      `https://api.dicebear.com/10.x/loops/svg?seed=${hash}&size=200&tags=animation`,
    );
  });

  it('falls back when Gravatar is down or slow', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      resolveProfileImage(email, undefined, undefined, failing),
    ).resolves.toContain('api.dicebear.com/10.x/loops/svg');
  });
});
