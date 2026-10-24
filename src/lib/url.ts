/**
 * URL helpers that stay correct no matter where the site is deployed
 * (user root, project sub-path, preview domain, custom domain).
 */

/** e.g. "/" or "/my-repo/" — always starts and ends with a slash. */
export function basePath(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** Absolute URL to the app root, e.g. https://user.github.io/repo/ */
export function appRootUrl(): string {
  if (typeof window === 'undefined') return basePath();
  return new URL(basePath(), window.location.origin).toString();
}

/**
 * Share links always use the hash router so GitHub Pages never needs a
 * server-side rewrite:  https://user.github.io/repo/#/s/<token>
 */
export function buildShareUrl(token: string): string {
  const root = appRootUrl();
  return `${root}#/${SHARE_ROUTE_PREFIX}/${token}`;
}

export const SHARE_ROUTE_PREFIX = 's';

export function parseShareToken(hash: string): string | null {
  const match = /#\/s\/([A-Za-z0-9_-]{20,200})/.exec(hash);
  return match ? match[1] : null;
}

/** Session-scoped access token. Kept in sessionStorage, never in the URL. */
export function generateRequestId(): string {
  const webCrypto: Crypto = globalThis.crypto;
  const maybe = webCrypto as Crypto & { randomUUID?: () => string };
  if (typeof maybe.randomUUID === 'function') return maybe.randomUUID();
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}