import { describe, expect, it } from 'vitest';
import {
  assertPublicUrl,
  safeFetch,
  UnsafeUrlError,
} from '@/middleware/commons/safe-url.js';

describe('assertPublicUrl', () => {
  it('refuses addresses that lead to a private network', async () => {
    for (const url of [
      'https://127.0.0.1/mcp',
      'https://10.0.0.5/mcp',
      'https://192.168.1.10/mcp',
      'https://172.16.0.1/mcp',
      'https://169.254.169.254/latest/meta-data', // cloud metadata
      'https://[::1]/mcp',
      'https://[::ffff:127.0.0.1]/mcp',
      'https://localhost/mcp',
    ]) {
      await expect(assertPublicUrl(url), url).rejects.toThrow(UnsafeUrlError);
    }
  });

  it('refuses http, other schemes, passwords and nonsense', async () => {
    for (const url of [
      'http://8.8.8.8/mcp',
      'ftp://8.8.8.8/mcp',
      'https://user:pass@8.8.8.8/mcp',
      'not a url',
    ]) {
      await expect(assertPublicUrl(url), url).rejects.toThrow(UnsafeUrlError);
    }
  });

  it('accepts a public https address', async () => {
    await expect(
      assertPublicUrl('https://8.8.8.8/mcp'),
    ).resolves.toBeInstanceOf(URL);
  });

  it('lets http and localhost through only in local development', async () => {
    await expect(
      assertPublicUrl('http://localhost:4000/mcp', true),
    ).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl('file:///etc/passwd', true)).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('checks the address on every fetch', async () => {
    await expect(safeFetch()('https://10.0.0.5/mcp')).rejects.toThrow(
      UnsafeUrlError,
    );
  });
});
