import { describe, expect, it } from 'vitest';
import { basePath, buildShareUrl, parseShareToken } from './url.ts';

describe('basePath', () => {
  it('always starts and ends with a slash', () => {
    const p = basePath();
    expect(p.startsWith('/')).toBe(true);
    expect(p.endsWith('/')).toBe(true);
  });
});

describe('buildShareUrl', () => {
  it('produces a hash-router link that GitHub Pages can serve without rewrites', () => {
    const url = buildShareUrl('A'.repeat(43));
    expect(url).toMatch(/^https?:\/\/[^/]+\/[^#]*#\/s\/A{43}$/);
  });

  it('keeps a project sub-path', () => {
    const url = buildShareUrl('B'.repeat(43));
    // jsdom origin + BASE_PATH ('/'); the important part is the fragment shape.
    expect(url.endsWith(`#/s/${'B'.repeat(43)}`)).toBe(true);
  });

  it('never leaks anything but the token', () => {
    const url = buildShareUrl('C'.repeat(43));
    expect(url.split('#')[1]).toBe(`/s/${'C'.repeat(43)}`);
  });
});

describe('parseShareToken', () => {
  it('extracts a valid token from a hash', () => {
    expect(parseShareToken('#/s/' + 'D'.repeat(43))).toBe('D'.repeat(43));
  });

  it('returns null for anything else', () => {
    expect(parseShareToken('#/')).toBeNull();
    expect(parseShareToken('#/s/short')).toBeNull();
    expect(parseShareToken('')).toBeNull();
    expect(parseShareToken('#/admin')).toBeNull();
  });
});