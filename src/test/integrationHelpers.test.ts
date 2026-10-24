import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SCENARIO_PLAN,
  assertNo5xx,
  assertStagingTarget,
  assertStatuses,
  batchPlan,
  createIntegrationClient,
  createPoolAllocator,
  createProvisioner,
  freshSession,
  inspectTestKey,
  projectRefFromUrl,
  readIntegrationEnv,
  type CallResult,
  type IntegrationClient,
  type StartResponse,
} from './integration-helpers';

/**
 * Ordinary unit tests for the integration plumbing. Nothing here touches the
 * network: the fetch implementation is injected, and the preflight script is
 * exercised separately via a child process.
 */

// Synthetic fixtures only. These are deliberately not real credentials.
const FIXTURE_USER = 'fixture-admin';
const FIXTURE_VALUE = 'fixture-value';

function completeEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    SUPABASE_TEST_URL: 'https://stagingref.supabase.co',
    SUPABASE_TEST_KEY: 'sb_publishable_fixture',
    SUPABASE_TEST_ENV: 'staging',
    SUPABASE_TEST_PROJECT_REF: 'stagingref',
    SUPABASE_TEST_ALLOWED_PROJECT_REFS: 'stagingref',
    SUPABASE_TEST_BATCH: 'A',
    SUPABASE_TEST_ADMIN_USERNAME: FIXTURE_USER,
    SUPABASE_TEST_ADMIN_PASSWORD: FIXTURE_VALUE,
    ...overrides,
  };
}

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

function fakeResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Response;
}

function fakeFetch(
  responder: (url: string, init?: RequestInit) => Response,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    responder(String(input), init)) as typeof fetch;
}

const SESSION: StartResponse = {
  sessionId: '00000000-0000-0000-0000-000000000000',
  accessToken: 'fixture-session-token-value-000000000000',
  remaining: 2,
  usedCount: 1,
  maxUses: 3,
  totalQuestions: 24,
  startedAt: '2026-01-01T00:00:00.000Z',
};

describe('integration manifest', () => {
  it('reports a fully missing environment as absent, not complete', () => {
    const manifest = readIntegrationEnv({});
    expect(manifest.any).toBe(false);
    expect(manifest.complete).toBe(false);
    expect(manifest.legacyOnly).toBe(false);
  });

  it('reports a partial environment as incomplete and names the missing keys', () => {
    const manifest = readIntegrationEnv({ SUPABASE_TEST_URL: 'https://x.supabase.co' });
    expect(manifest.any).toBe(true);
    expect(manifest.complete).toBe(false);
    expect(manifest.missing).toContain('SUPABASE_TEST_KEY');
    expect(manifest.missing).toContain('SUPABASE_TEST_ENV');
  });

  it('accepts a complete admin-mode staging manifest', () => {
    const manifest = readIntegrationEnv(completeEnv());
    expect(manifest.complete).toBe(true);
    expect(manifest.mode).toBe('admin');
    expect(manifest.batch).toBe('A');
    expect(manifest.keyIssue).toBeNull();
  });

  it('accepts a complete pool-mode manifest', () => {
    const pool = Array.from({ length: 6 }, (_, i) => `FIXTURE-CODE-${i}`).join(',');
    const manifest = readIntegrationEnv(
      completeEnv({
        SUPABASE_TEST_ADMIN_USERNAME: undefined,
        SUPABASE_TEST_ADMIN_PASSWORD: undefined,
        SUPABASE_TEST_CODE_POOL: pool,
      }),
    );
    expect(manifest.complete).toBe(true);
    expect(manifest.mode).toBe('pool');
    expect(manifest.pool).toHaveLength(6);
  });

  it('rejects the legacy two-code mode as insufficient', () => {
    const manifest = readIntegrationEnv({
      SUPABASE_TEST_URL: 'https://stagingref.supabase.co',
      SUPABASE_TEST_KEY: 'sb_publishable_fixture',
      SUPABASE_TEST_ENV: 'staging',
      SUPABASE_TEST_PROJECT_REF: 'stagingref',
      SUPABASE_TEST_BATCH: 'A',
      SUPABASE_TEST_CODE: 'FIXTURE-ONE',
      SUPABASE_TEST_CODE_2: 'FIXTURE-TWO',
    });
    expect(manifest.complete).toBe(false);
    expect(manifest.legacyOnly).toBe(true);
  });

  it('refuses any target that is not explicitly staging', () => {
    const manifest = readIntegrationEnv(completeEnv({ SUPABASE_TEST_ENV: 'production' }));
    expect(manifest.complete).toBe(false);
    expect(manifest.targetIssue).toContain('staging');
    expect(() => assertStagingTarget(manifest)).toThrow(/staging/);
  });

  it('requires the project ref to match the URL host', () => {
    const manifest = readIntegrationEnv(
      completeEnv({ SUPABASE_TEST_PROJECT_REF: 'differentref' }),
    );
    expect(manifest.complete).toBe(false);
    expect(manifest.urlIssue).toContain('does not match');
  });

  it('requires the project ref to be on the explicit allowlist', () => {
    const manifest = readIntegrationEnv(
      completeEnv({ SUPABASE_TEST_ALLOWED_PROJECT_REFS: 'otherref,secondref' }),
    );
    expect(manifest.complete).toBe(false);
    expect(manifest.allowlistIssue).toContain('not in');
    expect(() => assertStagingTarget(manifest)).toThrow(/refusing to run/);
  });

  it('normalizes a comma-separated allowlist', () => {
    const manifest = readIntegrationEnv(
      completeEnv({ SUPABASE_TEST_ALLOWED_PROJECT_REFS: ' OtherRef , STAGINGREF ' }),
    );
    expect(manifest.complete).toBe(true);
    expect(manifest.allowedProjectRefs).toEqual(['otherref', 'stagingref']);
  });

  it('does not treat the staging env string alone as proof of target', () => {
    const manifest = readIntegrationEnv(
      completeEnv({ SUPABASE_TEST_ALLOWED_PROJECT_REFS: undefined }),
    );
    expect(manifest.env).toBe('staging');
    expect(manifest.complete).toBe(false);
    expect(manifest.missing).toContain('SUPABASE_TEST_ALLOWED_PROJECT_REFS');
  });

  it('rejects an allowlist containing an invalid ref', () => {
    const manifest = readIntegrationEnv(
      completeEnv({ SUPABASE_TEST_ALLOWED_PROJECT_REFS: 'stagingref,not_a_ref!' }),
    );
    expect(manifest.complete).toBe(false);
    expect(manifest.allowlistIssue).toContain('invalid project ref');
  });

  it('rejects an invalid batch name', () => {
    const manifest = readIntegrationEnv(completeEnv({ SUPABASE_TEST_BATCH: 'all' }));
    expect(manifest.complete).toBe(false);
    expect(manifest.missing.join(' ')).toContain('must be A, B or C');
  });
});

describe('test key inspection', () => {
  it('accepts publishable and anon keys', () => {
    expect(inspectTestKey('sb_publishable_fixture')).toBeNull();
    expect(inspectTestKey(jwt({ role: 'anon' }))).toBeNull();
  });

  it('rejects sb_secret_ and sbp_ keys as high-privilege', () => {
    expect(inspectTestKey('sb_secret_fixture')).toContain('high-privilege');
    expect(inspectTestKey('sbp_fixture')).toContain('high-privilege');
  });

  it('rejects legacy service_role JWTs', () => {
    expect(inspectTestKey(jwt({ role: 'service_role' }))).toContain('service_role');
  });

  it('rejects a JWT whose role is neither anon nor service_role', () => {
    expect(inspectTestKey(jwt({ role: 'authenticated' }))).toContain('anon');
  });

  it('rejects a JWT with no role claim', () => {
    expect(inspectTestKey(jwt({ sub: 'fixture' }))).toContain('role claim');
  });

  it('rejects malformed JWT-shaped keys instead of guessing', () => {
    expect(inspectTestKey('eyJnot-a-jwt')).toContain('malformed');
    expect(inspectTestKey('eyJ.only-two')).toContain('malformed');
  });

  it('rejects unknown key formats and an empty publishable suffix', () => {
    expect(inspectTestKey('fixture-arbitrary-key')).toContain('publishable');
    expect(inspectTestKey('sb_publishable_')).toContain('empty');
  });

  it('parses the project ref only from an exact HTTPS Supabase origin', () => {
    expect(projectRefFromUrl('https://stagingref.supabase.co')).toBe('stagingref');
    expect(projectRefFromUrl('https://stagingref.supabase.co/')).toBe('stagingref');
    expect(projectRefFromUrl('http://stagingref.supabase.co')).toBeNull();
    expect(projectRefFromUrl('https://example.com')).toBeNull();
    expect(projectRefFromUrl('not a url')).toBeNull();
    expect(projectRefFromUrl('https://stagingref.supabase.co:8443')).toBeNull();
    expect(projectRefFromUrl('https://stagingref.supabase.co/rest/v1')).toBeNull();
    expect(projectRefFromUrl('https://stagingref.supabase.co/?x=1')).toBeNull();
    expect(projectRefFromUrl('https://user:pass@stagingref.supabase.co')).toBeNull();
    expect(projectRefFromUrl('https://bad_ref.supabase.co')).toBeNull();
  });
});

describe('integration client transport', () => {
  it('makes no fetch at all when the target is not confirmed staging', async () => {
    const manifest = readIntegrationEnv(completeEnv({ SUPABASE_TEST_ENV: 'production' }));
    let fetches = 0;
    const client = createIntegrationClient(
      manifest,
      fakeFetch(() => {
        fetches += 1;
        return fakeResponse(200, '{}');
      }),
    );

    await expect(client.call('start-test', {})).rejects.toThrow(/staging/);
    expect(fetches).toBe(0);
    expect(client.calls.get('start-test')).toBe(0);
  });

  it('posts to the edge function and returns parsed data', async () => {
    const manifest = readIntegrationEnv(completeEnv());
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const client = createIntegrationClient(
      manifest,
      fakeFetch((url, init) => {
        seenUrl = url;
        seenInit = init;
        return fakeResponse(200, '{"ok":true}');
      }),
    );

    const res = await client.call<{ ok: boolean }>('start-test', { hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.data?.ok).toBe(true);
    expect(seenUrl).toBe('https://stagingref.supabase.co/functions/v1/start-test');
    expect(seenInit?.method).toBe('POST');
    const headers = seenInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer sb_publishable_fixture');
    expect(client.calls.get('start-test')).toBe(1);
  });

  it('turns 429 into a loud rate-limit failure without echoing the body', async () => {
    const manifest = readIntegrationEnv(completeEnv());
    const client = createIntegrationClient(
      manifest,
      fakeFetch(() =>
        fakeResponse(429, '{"error":{"code":"rate_limited","message":"fixture-secret-body"}}', {
          'retry-after': '120',
        }),
      ),
    );

    let message = '';
    try {
      await client.call('start-test', {});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('429');
    expect(message).toContain('retry after 120s');
    expect(message).not.toContain('fixture-secret-body');
  });

  it('returns 5xx as an ordinary result, which assertNo5xx then rejects', async () => {
    const manifest = readIntegrationEnv(completeEnv());
    const client = createIntegrationClient(
      manifest,
      fakeFetch(() => fakeResponse(500, '{"error":{"code":"server_error"}}')),
    );

    const res = await client.call('start-test', {});
    expect(res.status).toBe(500);
    expect(() => assertNo5xx([res], 'unit')).toThrow(/5xx/);
  });

  it('assertStatuses reports the status and error code but not the body', () => {
    const results: CallResult<unknown>[] = [
      {
        status: 503,
        data: { secret: 'fixture-secret-body' },
        error: { code: 'server_error', message: 'fixture-secret-body' },
      },
    ];
    let message = '';
    try {
      assertStatuses(results, [200], 'unit');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('status 503');
    expect(message).not.toContain('fixture-secret-body');
  });

  it('rejects an admin login failure without echoing credentials', async () => {
    const manifest = readIntegrationEnv(completeEnv());
    const client = createIntegrationClient(
      manifest,
      fakeFetch(() => fakeResponse(401, '{"error":{"code":"unauthorized"}}')),
    );

    let message = '';
    try {
      await client.loginAdmin();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('admin-login failed');
    expect(message).not.toContain(FIXTURE_USER);
    expect(message).not.toContain(FIXTURE_VALUE);
  });
});

describe('freshness, budgets and provisioning', () => {
  it('accepts a fresh session and rejects a reused code', () => {
    expect(freshSession({ status: 200, data: SESSION, error: null }, 'unit')).toBe(SESSION);
    expect(() =>
      freshSession(
        { status: 200, data: { ...SESSION, usedCount: 2 }, error: null },
        'unit',
      ),
    ).toThrow(/not fresh/);
  });

  it('rejects a malformed session payload without printing its values', () => {
    let message = '';
    try {
      freshSession(
        {
          status: 200,
          data: {
            ...SESSION,
            accessToken: 'short-secret-value',
            remaining: 99,
            startedAt: 'not-a-date',
          },
          error: null,
        },
        'unit',
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('malformed');
    expect(message).not.toContain('short-secret-value');
    expect(message).not.toContain('not-a-date');
  });

  it('rejects a non-200 start without leaking the payload', () => {
    let message = '';
    try {
      freshSession(
        {
          status: 402,
          data: { ...SESSION, sessionId: 'should-not-leak', accessToken: 'should-not-leak' },
          error: { code: 'exhausted', message: 'should-not-leak' },
        },
        'unit',
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('status 402');
    expect(message).not.toContain('should-not-leak');
  });

  it('counts real calls and enforces the batch limit', () => {
    const manifest = readIntegrationEnv(completeEnv());
    const client = createIntegrationClient(manifest, fakeFetch(() => fakeResponse(200, '{}')));
    for (let i = 0; i < 13; i += 1) client.calls.record('start-test');
    expect(() => client.calls.assertWithin({ 'start-test': 12 })).toThrow(/start-test=13/);
  });

  it('allocates pool codes in order and fails when exhausted', () => {
    const allocator = createPoolAllocator(['FIXTURE-ONE', 'FIXTURE-TWO']);
    expect(allocator.next('first')).toBe('FIXTURE-ONE');
    expect(allocator.next('second')).toBe('FIXTURE-TWO');
    expect(allocator.used).toBe(2);
    expect(() => allocator.next('third')).toThrow(/pool exhausted before scenario "third"/);
  });

  it('logs in once in admin mode and provisions each scenario', async () => {
    const manifest = readIntegrationEnv(completeEnv());
    let logins = 0;
    let created = 0;
    const client = {
      loginAdmin: async () => {
        logins += 1;
        return 'fixture-admin-token';
      },
      createCode: async () => {
        created += 1;
        return {
          plaintext: `FIXTURE-CODE-${created}`,
          id: `00000000-0000-0000-0000-00000000000${created}`,
        };
      },
    } as unknown as IntegrationClient;

    const provision = createProvisioner(client, manifest);
    const first = await provision.withId('one', 1);
    expect(first).toEqual({
      code: 'FIXTURE-CODE-1',
      id: '00000000-0000-0000-0000-000000000001',
    });
    await expect(provision('two', 1)).resolves.toBe('FIXTURE-CODE-2');
    await expect(provision.adminToken()).resolves.toBe('fixture-admin-token');
    expect(logins).toBe(1);
    expect(created).toBe(2);
  });

  it('uses the pool without logging in in pool mode', async () => {
    const manifest = readIntegrationEnv(
      completeEnv({
        SUPABASE_TEST_ADMIN_USERNAME: undefined,
        SUPABASE_TEST_ADMIN_PASSWORD: undefined,
        SUPABASE_TEST_CODE_POOL: 'FIXTURE-ONE,FIXTURE-TWO',
      }),
    );
    const client = {
      loginAdmin: async () => {
        throw new Error('must not log in in pool mode');
      },
      createCode: async () => {
        throw new Error('must not create codes in pool mode');
      },
    } as unknown as IntegrationClient;

    const provision = createProvisioner(client, manifest);
    await expect(provision.withId('one', 1)).resolves.toEqual({
      code: 'FIXTURE-ONE',
      id: null,
    });
    await expect(provision('two', 1)).resolves.toBe('FIXTURE-TWO');
    // Pool mode cannot expose an admin token; this must be a visible failure,
    // not an empty string that could be mistaken for a usable credential.
    await expect(provision.adminToken()).rejects.toThrow(/pool mode/);
  });
});

describe('declared batch budget', () => {
  it('keeps every batch inside the server rate limits', () => {
    expect(batchPlan('A')).toMatchObject({ startCalls: 10, retakeCalls: 0, codeCount: 6 });
    expect(batchPlan('B')).toMatchObject({ startCalls: 11, retakeCalls: 3, codeCount: 3 });
    expect(batchPlan('C')).toMatchObject({ startCalls: 11, retakeCalls: 0, codeCount: 3 });
    for (const batch of ['A', 'B', 'C'] as const) {
      expect(batchPlan(batch).startCalls).toBeLessThanOrEqual(12);
      expect(batchPlan(batch).retakeCalls).toBeLessThanOrEqual(10);
    }
  });

  it('never plans more credits than a scenario code can provide', () => {
    for (const [name, plan] of Object.entries(SCENARIO_PLAN)) {
      for (const code of plan.codes) {
        expect(code.maxCredits, `${name} exceeds its maxUses`).toBeLessThanOrEqual(code.maxUses);
      }
    }
  });

  it('keeps the preflight script constants in sync with the plan', () => {
    const source = readFileSync(`${process.cwd()}/scripts/check-integration-env.mjs`, 'utf8');

    const numberMap = (name: string): Record<string, number> => {
      const match = source.match(new RegExp(`const ${name} = \\{([^}]+)\\};`));
      expect(match, `preflight must define ${name}`).not.toBeNull();
      const map: Record<string, number> = {};
      for (const entry of (match as RegExpMatchArray)[1].split(',')) {
        const [key, value] = entry.split(':').map((part) => part.trim());
        map[key] = Number(value);
      }
      return map;
    };

    expect(numberMap('REQUIRED_CODES')).toEqual({
      A: batchPlan('A').codeCount,
      B: batchPlan('B').codeCount,
      C: batchPlan('C').codeCount,
    });
    expect(numberMap('START_CALLS')).toEqual({
      A: batchPlan('A').startCalls,
      B: batchPlan('B').startCalls,
      C: batchPlan('C').startCalls,
    });
    expect(numberMap('RETAKE_CALLS')).toEqual({
      A: batchPlan('A').retakeCalls,
      B: batchPlan('B').retakeCalls,
      C: batchPlan('C').retakeCalls,
    });
  });
});
