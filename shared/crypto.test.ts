import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.ts';
import { generateToken, randomBytes, sha256Hex, timingSafeEqualHex } from './crypto.ts';

describe('password hashing', () => {
  // Fewer iterations keep the suite fast; production uses 210_000.
  const FAST = 1000;

  it('produces a pbkdf2-sha256 string that hides the plaintext', async () => {
    const hash = await hashPassword('My-Secret-Code', FAST);
    expect(hash.startsWith('pbkdf2-sha256$')).toBe(true);
    expect(hash).not.toContain('My-Secret-Code');
    expect(hash.split('$')).toHaveLength(4);
  });

  it('salts every hash so identical passwords hash differently', async () => {
    const a = await hashPassword('same', FAST);
    const b = await hashPassword('same', FAST);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse', FAST);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('correct hors', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
    expect(await verifyPassword('CORRECT HORSE', hash)).toBe(false);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$abc$00$00')).toBe(false);
    expect(await verifyPassword('x', `md5$1$aa$bb`)).toBe(false);
  });

  it('honours the stored iteration count', async () => {
    const weak = await hashPassword('x', 1000);
    const strong = await hashPassword('x', 2000);
    expect(weak.split('$')[1]).toBe('1000');
    expect(strong.split('$')[1]).toBe('2000');
    expect(await verifyPassword('x', weak)).toBe(true);
  });
});

describe('token generation', () => {
  it('produces url-safe tokens of at least 128 bits of entropy', () => {
    const token = generateToken(32);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomBytes(32)).toHaveLength(32);
  });

  it('does not repeat', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateToken(32)));
    expect(set.size).toBe(500);
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 of the empty string', async () => {
    await expect(sha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is stable and hex-encoded', async () => {
    const a = await sha256Hex('人生选择指南');
    const b = await sha256Hex('人生选择指南');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex('人生选择指北')).not.toBe(a);
  });
});

describe('timingSafeEqualHex', () => {
  it('compares equal and unequal strings correctly', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(true);
  });
});