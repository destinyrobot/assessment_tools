import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Static guards over the SQL migrations. These do NOT execute against a
 * database — they exist to catch release-blocking ordering/signature mistakes
 * that would only surface when the migration is applied for real.
 */
// Vitest runs with the project root as cwd; `import.meta.url` is not a file
// URL under the jsdom environment, so resolve from cwd instead.
const MIGRATIONS_DIR = `${process.cwd()}/supabase/migrations/`;

function migration(name: string): string {
  return readFileSync(`${MIGRATIONS_DIR}${name}`, 'utf8');
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

describe('migration set', () => {
  it('has one timestamped file per step, in the expected order', () => {
    // Supabase applies migrations in lexical filename order; every file must
    // therefore carry a sortable timestamp prefix.
    for (const file of files) {
      expect(file, `${file} must start with a 14-digit timestamp`).toMatch(/^\d{14}_.+\.sql$/);
    }
    expect(files).toHaveLength(new Set(files).size);
    expect(files[0]).toMatch(/^20250101000001_/);
  });
});

describe('0004 production hardening', () => {
  const sql = migration('20250101000004_production_hardening.sql');

  it('drops the broken test_sessions_touch trigger', () => {
    // 0002 creates a trigger that writes NEW.updated_at, but test_sessions has
    // no such column; any UPDATE (including finalize_submission) would fail.
    expect(sql).toContain('drop trigger if exists test_sessions_touch on public.test_sessions;');
  });

  it('drops get_shared_result before recreating it with a new return shape', () => {
    // PostgreSQL rejects CREATE OR REPLACE when the OUT/return columns change.
    const dropAt = sql.indexOf('drop function if exists public.get_shared_result(text);');
    const createAt = sql.indexOf(
      'create or replace function public.get_shared_result(p_token_hash text)',
    );
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it('no longer exposes session_id from get_shared_result', () => {
    const start = sql.indexOf(
      'create or replace function public.get_shared_result(p_token_hash text)',
    );
    const end = sql.indexOf('$$;', start);
    const definition = sql.slice(start, end);
    expect(definition).not.toContain('session_id');
    expect(definition).toContain('result_id');
    // The report must go through the whitelist projection.
    expect(definition).toContain('public.public_report(r.report)');
  });

  it('re-grants execute to service_role after the function is dropped', () => {
    const dropAt = sql.indexOf('drop function if exists public.get_shared_result(text);');
    const grantAt = sql.indexOf(
      'grant execute on function public.get_shared_result(text) to service_role;',
    );
    expect(grantAt).toBeGreaterThan(dropAt);
  });

  it('binds an idempotent start_test_session replay to the submitted code', () => {
    // Knowing another user's request_id must not yield their session: the
    // stored session must belong to the code hash presented in this request.
    expect(sql).toContain('v_code.code_hash is distinct from p_code_hash');
  });
});
