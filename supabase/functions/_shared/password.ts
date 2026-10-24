// AUTO-GENERATED FROM shared/ — do not edit here.
// Run `npm run sync:shared` after editing the files in shared/.
import { timingSafeEqualHex } from './crypto.ts';

/**
 * Password hashing for test codes and admin accounts.
 *
 * Format: pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>
 * Passwords are NEVER stored in plaintext and never logged.
 */
const ITERATIONS = 210_000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

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

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  const derived = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toHex(salt)}$${toHex(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 5_000_000) return false;
  try {
    const salt = fromHex(parts[2]);
    const expected = parts[3];
    const derived = await pbkdf2(password, salt, iterations);
    return timingSafeEqualHex(toHex(derived), expected);
  } catch {
    return false;
  }
}

/**
 * Lookup-friendly digest for test codes.
 * The lookup value is a salted digest so a database leak does not allow an
 * offline dictionary attack on the real code without also stealing the salt
 * column value (which is stored separately from the code row).
 */
export async function hashLookup(lookup: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${lookup}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}