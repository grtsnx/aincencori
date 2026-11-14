// Guards for addresses that users give us and our server then calls (their
// MCP servers). Without it a user could point us at our own private network
// (databases, cloud metadata) and read what comes back.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

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

// Resolves and checks DNS again at connection time, so DNS rebinding cannot
// change a public address into a private one between the check and the call.
export function safeFetch(
  allowPrivate = false,
): typeof fetch & { close: () => Promise<void> } {
  const dispatcher = allowPrivate
    ? undefined
    : new Agent({
        connect: {
          lookup: (hostname, options, callback) => {
            void lookup(hostname, { all: true, verbatim: true }).then(
              (addresses) => {
                const accepted = addresses.filter(
                  (entry) => !isPrivate(entry.address),
                );
                if (
                  addresses.length === 0 ||
                  accepted.length !== addresses.length
                ) {
                  callback(
                    new UnsafeUrlError(
                      'The address must be on the public internet.',
                    ),
                    '',
                    0,
                  );
                  return;
                }
                const familyMatches = options.family
                  ? accepted.filter((entry) => entry.family === options.family)
                  : accepted;
                if (familyMatches.length === 0) {
                  callback(new Error('No matching address family.'), '', 0);
                  return;
                }
                if (options.all) callback(null, familyMatches);
                else
                  callback(
                    null,
                    familyMatches[0].address,
                    familyMatches[0].family,
                  );
              },
              () =>
                callback(
                  new UnsafeUrlError('The address could not be resolved.'),
                  '',
                  0,
                ),
            );
          },
        },
      });
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string' || input instanceof URL ? input : input.url;
    await assertPublicUrl(String(target), allowPrivate);
    try {
      return (await undiciFetch(
        input as unknown as Parameters<typeof undiciFetch>[0],
        {
          ...init,
          redirect: 'error',
          ...(dispatcher ? { dispatcher } : {}),
        } as unknown as Parameters<typeof undiciFetch>[1],
      )) as unknown as Response;
    } catch (error) {
      if (error instanceof TypeError && error.cause instanceof UnsafeUrlError) {
        throw error.cause;
      }
      throw error;
    }
  };
  return Object.assign(request as typeof fetch, {
    // Cleanup must never fail a request that worked (some runtimes, like
    // Bun, give an Agent without close).
    close: async () => {
      try {
        await (
          dispatcher as { close?: () => Promise<void> } | undefined
        )?.close?.();
      } catch {
        // Nothing to clean up.
      }
    },
  });
}
