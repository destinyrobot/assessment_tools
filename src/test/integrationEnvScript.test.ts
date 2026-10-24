import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Black-box tests for scripts/check-integration-env.mjs.
 *
 * The script must fail closed on partial/unsafe configuration and must never
 * echo credential values. It makes no network requests.
 */

const SCRIPT = `${process.cwd()}/scripts/check-integration-env.mjs`;

function run(env: Record<string, string>): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

// Synthetic fixtures only. Never real credentials.
const ADMIN_ENV: Record<string, string> = {
  SUPABASE_TEST_URL: 'https://stagingref.supabase.co',
  SUPABASE_TEST_KEY: 'sb_publishable_fixture',
  SUPABASE_TEST_ENV: 'staging',
  SUPABASE_TEST_PROJECT_REF: 'stagingref',
  SUPABASE_TEST_ALLOWED_PROJECT_REFS: 'stagingref',
  SUPABASE_TEST_BATCH: 'A',
  SUPABASE_TEST_ADMIN_USERNAME: 'fixture-admin',
  SUPABASE_TEST_ADMIN_PASSWORD: 'fixture-value',
};

const POOL = Array.from({ length: 6 }, (_, i) => `FIXTURE-CODE-${i}`).join(',');

describe('check-integration-env', () => {
  it('exits 2 and says SKIPPED when nothing is configured', () => {
    const result = run({});
    expect(result.status).toBe(2);
    expect(result.output).toContain('INTEGRATION SKIPPED');
  });

  it('exits 0 when skipping is explicitly allowed', () => {
    const result = run({ ALLOW_INTEGRATION_SKIP: '1' });
    expect(result.status).toBe(0);
    expect(result.output).toContain('INTEGRATION SKIPPED');
  });

  it('fails a partial environment and names the missing variables', () => {
    const result = run({ SUPABASE_TEST_URL: 'https://stagingref.supabase.co' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('INTEGRATION ENV INCOMPLETE');
    expect(result.output).toContain('SUPABASE_TEST_KEY');
    // Values are never echoed.
    expect(result.output).not.toContain('https://stagingref.supabase.co');
  });

  it('accepts a complete admin-mode environment without echoing secrets', () => {
    const result = run(ADMIN_ENV);
    expect(result.status).toBe(0);
    expect(result.output).toContain('batch A');
    expect(result.output).toContain('admin mode');
    expect(result.output).toContain('10/12');
    expect(result.output).not.toContain('fixture-admin');
    expect(result.output).not.toContain('fixture-value');
    expect(result.output).not.toContain('sb_publishable_fixture');
  });

  it('accepts a complete pool-mode environment', () => {
    const result = run({
      SUPABASE_TEST_URL: ADMIN_ENV.SUPABASE_TEST_URL,
      SUPABASE_TEST_KEY: ADMIN_ENV.SUPABASE_TEST_KEY,
      SUPABASE_TEST_ENV: ADMIN_ENV.SUPABASE_TEST_ENV,
      SUPABASE_TEST_PROJECT_REF: ADMIN_ENV.SUPABASE_TEST_PROJECT_REF,
      SUPABASE_TEST_ALLOWED_PROJECT_REFS: ADMIN_ENV.SUPABASE_TEST_ALLOWED_PROJECT_REFS,
      SUPABASE_TEST_BATCH: ADMIN_ENV.SUPABASE_TEST_BATCH,
      SUPABASE_TEST_CODE_POOL: POOL,
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain('pool mode');
    expect(result.output).not.toContain('FIXTURE-CODE-0');
  });

  it('rejects a pool that is too small for the selected batch', () => {
    const result = run({
      SUPABASE_TEST_URL: ADMIN_ENV.SUPABASE_TEST_URL,
      SUPABASE_TEST_KEY: ADMIN_ENV.SUPABASE_TEST_KEY,
      SUPABASE_TEST_ENV: ADMIN_ENV.SUPABASE_TEST_ENV,
      SUPABASE_TEST_PROJECT_REF: ADMIN_ENV.SUPABASE_TEST_PROJECT_REF,
      SUPABASE_TEST_ALLOWED_PROJECT_REFS: ADMIN_ENV.SUPABASE_TEST_ALLOWED_PROJECT_REFS,
      SUPABASE_TEST_BATCH: 'A',
      SUPABASE_TEST_CODE_POOL: 'FIXTURE-1,FIXTURE-2,FIXTURE-3,FIXTURE-4,FIXTURE-5',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('needs 6 fresh codes');
  });

  it('rejects the legacy two-code mode', () => {
    const result = run({
      SUPABASE_TEST_URL: ADMIN_ENV.SUPABASE_TEST_URL,
      SUPABASE_TEST_KEY: ADMIN_ENV.SUPABASE_TEST_KEY,
      SUPABASE_TEST_ENV: ADMIN_ENV.SUPABASE_TEST_ENV,
      SUPABASE_TEST_PROJECT_REF: ADMIN_ENV.SUPABASE_TEST_PROJECT_REF,
      SUPABASE_TEST_BATCH: 'A',
      SUPABASE_TEST_CODE: 'FIXTURE-ONE',
      SUPABASE_TEST_CODE_2: 'FIXTURE-TWO',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('TWO-CODE MODE IS NOT SUPPORTED');
  });

  it('rejects a service_role JWT without echoing it', () => {
    const key = jwt({ role: 'service_role' });
    const result = run({ ...ADMIN_ENV, SUPABASE_TEST_KEY: key });
    expect(result.status).toBe(1);
    expect(result.output).toContain('service_role');
    expect(result.output).not.toContain(key);
  });

  it('rejects an sb_secret_ key without echoing it', () => {
    const key = 'sb_secret_fixture-value';
    const result = run({ ...ADMIN_ENV, SUPABASE_TEST_KEY: key });
    expect(result.status).toBe(1);
    expect(result.output).toContain('high-privilege');
    expect(result.output).not.toContain(key);
  });

  it('refuses a non-staging target', () => {
    const result = run({ ...ADMIN_ENV, SUPABASE_TEST_ENV: 'production' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('staging');
  });

  it('refuses a project ref that does not match the URL', () => {
    const result = run({ ...ADMIN_ENV, SUPABASE_TEST_PROJECT_REF: 'differentref' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not match');
  });

  it('refuses an all-batches run', () => {
    const result = run({ ...ADMIN_ENV, SUPABASE_TEST_BATCH: 'all' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('must be A, B or C');
  });

  it('requires the explicit project-ref allowlist', () => {
    const result = run({ ...ADMIN_ENV, SUPABASE_TEST_ALLOWED_PROJECT_REFS: '' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('SUPABASE_TEST_ALLOWED_PROJECT_REFS');
  });

  it('refuses a ref that is not on the allowlist, even when labelled staging', () => {
    const result = run({
      ...ADMIN_ENV,
      SUPABASE_TEST_ALLOWED_PROJECT_REFS: 'someotherref',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('not in SUPABASE_TEST_ALLOWED_PROJECT_REFS');
  });

  it('refuses an unknown key format without echoing it', () => {
    const key = 'fixture-arbitrary-key';
    const result = run({ ...ADMIN_ENV, SUPABASE_TEST_KEY: key });
    expect(result.status).toBe(1);
    expect(result.output).toContain('not an allowed public key');
    expect(result.output).not.toContain(key);
  });

  it('refuses a non-anon JWT without echoing it', () => {
    const key = jwt({ role: 'authenticated' });
    const result = run({ ...ADMIN_ENV, SUPABASE_TEST_KEY: key });
    expect(result.status).toBe(1);
    expect(result.output).toContain('non-anon');
    expect(result.output).not.toContain(key);
  });

  it('refuses a URL with a port or path', () => {
    const result = run({
      ...ADMIN_ENV,
      SUPABASE_TEST_URL: 'https://stagingref.supabase.co/rest/v1',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('no port, path');
    expect(result.output).not.toContain('stagingref.supabase.co/rest');
  });
});
