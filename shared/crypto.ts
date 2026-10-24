/**
 * Cryptographic helpers shared by the Edge Functions and Node tooling.
 * Only Web Crypto is used so the exact same code runs in Deno and Node.
 */

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/**
 * URL-safe random token built from a CSPRNG.
 * 32 bytes => 256 bits of entropy (requirement is >= 128).
 */
export function generateToken(bytes = 32): string {
  const b = randomBytes(bytes);
  let binary = '';
  for (const x of b) binary += String.fromCharCode(x);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

/** Constant-time comparison for hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export { toHex, fromHex, encoder };