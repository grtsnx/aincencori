import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Profile pictures from Gravatar, falling back to a DiceBear avatar (Loops by
// default). Only a SHA-256 hash of the email leaves the app, never the email.

export type GravatarRating = 'g' | 'pg' | 'r' | 'x';

export type GravatarDefaultImage =
  | '404'
  | 'mm'
  | 'identicon'
  | 'monsterid'
  | 'wavatar'
  | 'retro'
  | 'robohash'
  | 'blank';

export interface GravatarOptions {
  size?: string;
  rating?: GravatarRating;
  default?: GravatarDefaultImage;
}

export type AvatarFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok'>>;

export const DEFAULT_DICEBEAR_STYLE = 'loops';
const DEFAULT_SIZE = '200';
const DEFAULT_RATING: GravatarRating = 'pg';
const DICEBEAR_API_BASE = 'https://api.dicebear.com/10.x';
const GRAVATAR_API_BASE = 'https://www.gravatar.com/avatar';
const GRAVATAR_LOOKUP_TIMEOUT_MS = 2000;

export function avatarSeed(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Builds a direct DiceBear fallback URL. Loops uses SVG because DiceBear's
 * animation is CSS embedded in the SVG; raster formats flatten it.
 */
export function buildDicebearUrl(
  email: string,
  style: string,
  size: string,
): string {
  const params = new URLSearchParams({ seed: avatarSeed(email), size });
  const animated = style === DEFAULT_DICEBEAR_STYLE;
  if (animated) params.set('tags', 'animation');
  const format = animated ? 'svg' : 'png';
  return `${DICEBEAR_API_BASE}/${encodeURIComponent(style)}/${format}?${params.toString()}`;
}

export function buildGravatarUrl(
  email: string,
  size: string,
  rating: GravatarRating = DEFAULT_RATING,
  defaultImage?: GravatarDefaultImage,
): string {
  const params = new URLSearchParams({ s: size, r: rating });
  if (defaultImage) params.set('d', defaultImage);
  return `${GRAVATAR_API_BASE}/${avatarSeed(email)}?${params.toString()}`;
}

/**
 * The Gravatar URL when the email has one, otherwise the DiceBear avatar.
 * Gravatar answers 404 for unknown emails when asked with `d=404`; a timeout
 * or network error also falls back, so sign-up never waits long or fails.
 */
export async function resolveProfileImage(
  email: string,
  style: string = DEFAULT_DICEBEAR_STYLE,
  size: string = DEFAULT_SIZE,
  fetcher: AvatarFetch = fetch,
): Promise<string> {
  const fallback = buildDicebearUrl(email, style, size);
  try {
    const response = await fetcher(
      buildGravatarUrl(email, size, DEFAULT_RATING, '404'),
      {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(GRAVATAR_LOOKUP_TIMEOUT_MS),
      },
    );
    return response.ok ? buildGravatarUrl(email, size) : fallback;
  } catch {
    return fallback;
  }
}

@Injectable()
export class GravatarService {
  private readonly style: string;

  constructor(config: ConfigService) {
    this.style = config.getOrThrow<string>('DICEBEAR_STYLE');
  }

  /** Profile picture for an email: Gravatar, or the configured DiceBear style. */
  profileImage(email: string, fetcher: AvatarFetch = fetch): Promise<string> {
    return resolveProfileImage(email, this.style, DEFAULT_SIZE, fetcher);
  }

  /** A Gravatar URL with an explicit Gravatar default, or the resolved picture. */
  async getGravatarUrl(
    email: string,
    options?: GravatarOptions,
    fetcher: AvatarFetch = fetch,
  ): Promise<string> {
    const size = options?.size ?? DEFAULT_SIZE;
    if (!options?.default) {
      return resolveProfileImage(email, this.style, size, fetcher);
    }
    return buildGravatarUrl(
      email,
      size,
      options.rating ?? DEFAULT_RATING,
      options.default,
    );
  }
}
