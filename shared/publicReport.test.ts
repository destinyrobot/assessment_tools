import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUESTIONS } from './questions.ts';
import { buildReport } from './scoring.ts';
import type { Answer } from './types.ts';

/**
 * Contract test for the database-side public report whitelist.
 *
 * `public.public_report` in 0004 is the last line of defence for the anonymous
 * share endpoint. It must be an allowlist — never "everything except these
 * sensitive keys". This test reads the migration itself so the SQL and the
 * TypeScript `Report` shape cannot drift apart silently.
 */
// Vitest runs with the project root as cwd; `import.meta.url` is not a file
// URL under the jsdom environment, so resolve from cwd instead.
const MIGRATION = `${process.cwd()}/supabase/migrations/20250101000004_production_hardening.sql`;

const OPTION_INDEX = 0;

function answers(): Answer[] {
  return QUESTIONS.map((q) => ({ questionId: q.id, optionId: q.options[OPTION_INDEX].id }));
}

function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  expect(start, `migration must define ${signature}`).toBeGreaterThanOrEqual(0);
  const bodyStart = sql.indexOf('as $$', start);
  expect(bodyStart).toBeGreaterThanOrEqual(0);
  const bodyEnd = sql.indexOf('$$;', bodyStart);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return sql.slice(bodyStart, bodyEnd);
}

function whitelistedKeys(body: string): string[] {
  const marker = body.indexOf('where entry.key = any (array[');
  expect(marker, 'public_report must filter through an explicit key array').toBeGreaterThanOrEqual(0);
  const listStart = body.indexOf('[', marker) + 1;
  const listEnd = body.indexOf(']);', listStart);
  expect(listEnd).toBeGreaterThan(listStart);
  const list = body.slice(listStart, listEnd);
  return Array.from(list.matchAll(/'([^']+)'/g), (m) => m[1]);
}

describe('public_report SQL whitelist', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = functionBody(sql, 'create or replace function public.public_report(p_report jsonb)');

  it('is an allowlist, not a subtraction of known-bad keys', () => {
    // A blacklist would look like `p_report - array[...]`; an allowlist must
    // build a new object from an explicit key array.
    expect(body).not.toMatch(/\bp_report\s*-\s*array\s*\[/);
    expect(body).toContain('jsonb_object_agg');
    expect(body).toContain('jsonb_each');
  });

  it('names every report key exactly once', () => {
    const keys = whitelistedKeys(body);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches exactly the keys buildReport produces', () => {
    const whitelist = whitelistedKeys(body).sort();
    const produced = Object.keys(buildReport(answers())).sort();
    expect(whitelist).toEqual(produced);
  });
});
