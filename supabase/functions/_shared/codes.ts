/// <reference lib="deno.ns" />
import { hashPassword, verifyPassword } from './password.ts';
import { generateToken, sha256Hex, timingSafeEqualHex } from './crypto.ts';
import { adminClient } from './supabase.ts';

/**
 * Test-code credential handling.
 *
 * Two hashes per code:
 *
 *  1. `code_hash`     = HMAC-SHA256(CODE_LOOKUP_KEY, normalised code)
 *     Used for the indexed lookup. The key lives only in the Edge Function
 *     environment, so a database dump alone cannot be attacked offline.
 *
 *  2. `password_hash` = PBKDF2-SHA256(code, random salt, 210_000 iterations)
 *     Used for the actual verification, so brute-forcing stays expensive even
 *     for someone who has both the table and the lookup key.
 *
 * Plaintext codes are never stored, never logged and never returned.
 */

export type CodeRow = {
  id: string;
  code_hash: string;
  password_hash: string;
  code_hint: string;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  locked_until: string | null;
};

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Codes are compared case-insensitively and without internal spaces. */
export function normalizeCode(code: string): string {
  return code.trim().replace(/\s+/g, '').toUpperCase();
}

async function lookupKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('CODE_LOOKUP_KEY');
  if (!secret) {
    throw new Error('CODE_LOOKUP_KEY is not configured (supabase secrets set CODE_LOOKUP_KEY=...)');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function lookupHash(code: string): Promise<string> {
  const key = await lookupKey();
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalizeCode(code)));
  return hex(new Uint8Array(mac));
}

export function randomSaltHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return hex(buf);
}

export async function findCodeRow(code: string): Promise<CodeRow | null> {
  const client = adminClient();
  const codeHash = await lookupHash(code);
  const { data, error } = await client
    .from('test_codes')
    .select('id, code_hash, password_hash, code_hint, max_uses, used_count, is_active, locked_until')
    .eq('code_hash', codeHash)
    .maybeSingle();
  if (error) throw new Error(`lookup failed: ${error.message}`);
  return (data as CodeRow | null) ?? null;
}

export async function createCodeRow(params: {
  code: string;
  label?: string;
  note?: string;
  maxUses: number;
}): Promise<{ id: string; hint: string }> {
  const client = adminClient();
  const code = normalizeCode(params.code);
  const codeHash = await lookupHash(code);
  const passwordHash = await hashPassword(code);

  const { data, error } = await client
    .from('test_codes')
    .insert({
      code_hash: codeHash,
      password_hash: passwordHash,
      code_hint: hintFor(code),
      label: params.label ?? null,
      note: params.note ?? null,
      max_uses: params.maxUses,
    })
    .select('id, code_hint')
    .single();
  if (error) throw new Error(`create failed: ${error.message}`);
  return { id: data.id as string, hint: data.code_hint as string };
}

/** `AB****YZ` style hint — enough for an admin to recognise it, not enough to guess. */
export function hintFor(code: string): string {
  const c = normalizeCode(code);
  if (c.length <= 4) return `${c.slice(0, 1)}***`;
  return `${c.slice(0, 2)}****${c.slice(-2)}`;
}

/** 12 chars from a 30-symbol alphabet (no 0/O/1/I/L) so users can retype it. */
export function generateCode(length = 12): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export async function verifyPlainCode(code: string, row: CodeRow): Promise<boolean> {
  return verifyPassword(normalizeCode(code), row.password_hash);
}

/**
 * Deterministic per-request session token.
 *
 * Deriving the token from `requestId` with a server-side HMAC key means an
 * idempotent replay of the very same requestId returns the very same token —
 * so "请求超时重试" can never create a session the client cannot open, and can
 * never double-consume a credit either.
 */
export async function deriveSessionToken(requestId: string): Promise<string> {
  const secret = Deno.env.get('SESSION_TOKEN_KEY');
  if (!secret) {
    throw new Error('SESSION_TOKEN_KEY is not configured (supabase secrets set SESSION_TOKEN_KEY=...)');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${requestId}`));
  return hex(new Uint8Array(mac));
}

export { generateToken, sha256Hex, timingSafeEqualHex };