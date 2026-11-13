// Guards for addresses that users give us and our server then calls (their
// MCP servers). Without it a user could point us at our own private network
// (databases, cloud metadata) and read what comes back.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const privateAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  privateAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 127], // :: and ::1
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  privateAddresses.addSubnet(network, prefix, 'ipv6');
}

function isPrivate(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const value = mapped ?? address;
  return privateAddresses.check(value, isIP(value) === 6 ? 'ipv6' : 'ipv4');
}

export class UnsafeUrlError extends Error {}

// Throws unless the address is https and leads to the public internet.
// allowPrivate (local development only) also lets http and localhost through.
export async function assertPublicUrl(
  value: string,
  allowPrivate = false,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeUrlError('The address is not a valid URL.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('The address must not contain a password.');
  }
  if (allowPrivate) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new UnsafeUrlError('The address must start with https://.');
    }
    return url;
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError('The address must start with https://.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((found) => found.map((entry) => entry.address))
        .catch(() => []);
  if (addresses.length === 0 || addresses.some(isPrivate)) {
    throw new UnsafeUrlError('The address must be on the public internet.');
  }
  return url;
}

// A fetch that checks the address on every call and never follows redirects
// (a redirect could lead somewhere private).
export function safeFetch(allowPrivate = false): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string' || input instanceof URL ? input : input.url;
    await assertPublicUrl(String(target), allowPrivate);
    return fetch(input, { ...init, redirect: 'error' });
  }) as typeof fetch;
}
