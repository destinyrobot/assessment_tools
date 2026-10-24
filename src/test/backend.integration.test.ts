import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUESTIONS } from '@shared/questions.ts';
import { buildReport } from '@shared/scoring.ts';
import {
  BATCH_LIMITS,
  assertBatchBudget,
  assertNo5xx,
  assertStatuses,
  createIntegrationClient,
  createProvisioner,
  freshSession,
  readIntegrationEnv,
  type CallResult,
  type IntegrationClient,
  type Provisioner,
  type StartResponse,
} from './integration-helpers';

/**
 * REAL integration tests against a deployed Supabase STAGING project.
 *
 * This file is intentionally split into three batches because the Edge
 * Functions rate-limit per IP (start-test 12/10min, retake 10/5min):
 *
 *   batch A: access, cross-code replay, submission, result, share, RLS
 *   batch B: quota concurrency, retake exhaustion, retake idempotency
 *   batch C: same-requestId concurrency, cross-code concurrency
 *
 * Each scenario provisions its own fresh code. Codes are never shared between
 * scenarios, so a consumed quota can no longer turn a security assertion into a
 * silent return. See README "真实后端集成测试" for the environment manifest.
 *
 * No request is made unless SUPABASE_TEST_ENV=staging, the project ref in the
 * URL matches SUPABASE_TEST_PROJECT_REF, and that ref is on the explicit
 * SUPABASE_TEST_ALLOWED_PROJECT_REFS allowlist. Critical security cases fail
 * loudly; they never skip, relax assertions, or accept 5xx as success.
 */

interface ResultEnvelope {
  id: string;
  report: { archetypeId: string; scoringVersion: string; scores: Record<string, number> };
}

const uuid = () => crypto.randomUUID();

/** Safe for error bodies and null; never prints the value. */
function hasOwnKey(value: unknown, key: string): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function answersFrom(pattern: 'a' | 'b' | 'c' | 'd' = 'a') {
  const index = { a: 0, b: 1, c: 2, d: 3 }[pattern];
  return QUESTIONS.map((q) => ({ questionId: q.id, optionId: q.options[index].id }));
}

const manifest = readIntegrationEnv(process.env);
const allowSkip = process.env.ALLOW_INTEGRATION_SKIP === '1';

if (manifest.legacyOnly) {
  describe('integration configuration', () => {
    it('rejects the legacy two-code mode', () => {
      throw new Error(
        'SUPABASE_TEST_CODE / _2 alone cannot run the full suite: batch A needs 6 fresh ' +
          'codes, batch B 3 and batch C 3. Configure SUPABASE_TEST_ADMIN_USERNAME/PASSWORD ' +
          '(preferred) or SUPABASE_TEST_CODE_POOL. See README.',
      );
    });
  });
} else if (!manifest.any) {
  if (allowSkip) {
    describe.skip('Supabase backend integration (SKIPPED: no environment)', () => {
      it('is skipped intentionally', () => {
        // Nothing to run. The loud warning below is the point.
      });
    });
    console.warn(
      '[integration] SKIPPED: no SUPABASE_TEST_* variables. This is NOT a passing ' +
        'backend run; see README "真实后端集成测试".',
    );
  } else {
    describe('integration configuration', () => {
      it('requires an explicit staging manifest', () => {
        throw new Error(
          'No SUPABASE_TEST_* variables are set. Run `npm run test:integration` ' +
            '(preflight) or set ALLOW_INTEGRATION_SKIP=1 to skip deliberately.',
        );
      });
    });
  }
} else if (!manifest.complete) {
  const problems = [
    ...manifest.missing,
    manifest.targetIssue,
    manifest.urlIssue,
    manifest.keyIssue,
    manifest.allowlistIssue,
    manifest.poolIssue,
  ].filter((problem): problem is string => problem !== null);
  describe('integration configuration', () => {
    it('is complete and targets staging', () => {
      throw new Error(
        `Integration environment is incomplete or unsafe: ${problems.join('; ')}. ` +
          'No network request was made.',
      );
    });
  });
} else {
  const batch = manifest.batch;
  if (batch === null) throw new Error('[integration] complete manifest without a batch');

  const client = createIntegrationClient(manifest);
  const provision = createProvisioner(client, manifest);

  describe(`Supabase backend integration — batch ${batch}`, () => {
    beforeAll(() => {
      // Static plan guard: fail before the first request if a future edit
      // pushes a batch above the server limit.
      assertBatchBudget(batch);
    });

    afterAll(() => {
      // Runtime guard: the REAL number of calls made by this run.
      client.calls.assertWithin({
        'start-test': BATCH_LIMITS['start-test'],
        retake: BATCH_LIMITS.retake,
        'admin-login': BATCH_LIMITS['admin-login'],
      });
    });

    if (batch === 'A') registerBatchA(client, provision);
    else if (batch === 'B') registerBatchB(client, provision);
    else registerBatchC(client, provision);
  });
}

function registerBatchA(client: IntegrationClient, provision: Provisioner): void {
  if (client.manifest.mode !== 'admin') {
    console.warn(
      '[integration] share revocation test is SKIPPED in pool mode: pool codes have no ' +
        'admin token or code id. This is NOT a passing security check; run batch A in ' +
        'admin mode for full coverage.',
    );
  }

  describe('access and requestId ownership', () => {
    let code: string;
    let first: StartResponse;
    let wrong: CallResult<unknown>;

    beforeAll(async () => {
      code = await provision('access', 3);
      first = freshSession(await client.start(code), 'access');
      wrong = await client.call('start-test', {
        code: 'DEFINITELY-WRONG-CODE',
        requestId: uuid(),
      });
    });

    it('creates a session for the correct code', () => {
      expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof first.accessToken).toBe('string');
      expect(first.accessToken.length).toBeGreaterThan(20);
      expect(first.totalQuestions).toBe(24);
      expect(first.maxUses).toBe(3);
      expect(first.usedCount).toBe(1);
      expect(first.remaining).toBe(2);
    });

    it('rejects an incorrect code without returning a session', () => {
      expect(wrong.status).toBe(401);
      expect(wrong.error?.code).toBe('invalid_code');
      expect(hasOwnKey(wrong.data, 'sessionId')).toBe(false);
    });

    it('is idempotent: the same requestId never double-consumes a credit', async () => {
      const requestId = uuid();
      const a = await client.start(code, requestId);
      const b = await client.start(code, requestId);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      // The scenario already consumed one credit, so the first call here
      // consumes the second; the replay must observe the same count.
      expect(a.data?.usedCount).toBe(2);
      expect(b.data?.usedCount).toBe(2);
      expect(b.data?.sessionId).toBe(a.data?.sessionId);
      expect(b.data?.accessToken).toBe(a.data?.accessToken);
      expect(b.data?.remaining).toBe(1);
      expect(b.data?.maxUses).toBe(3);
    });
  });

  describe('cross-code requestId replay', () => {
    let ownerCode: string;
    let attackerCode: string;

    beforeAll(async () => {
      ownerCode = await provision('cross-code-owner', 3);
      attackerCode = await provision('cross-code-attacker', 3);
    });

    it('does not return a session when a different valid code reuses its requestId', async () => {
      const requestId = uuid();
      const owner = freshSession(await client.start(ownerCode, requestId), 'cross-code owner');
      const attacker = freshSession(
        await client.start(attackerCode),
        'cross-code attacker',
      );
      expect(attacker.sessionId).not.toBe(owner.sessionId);

      // Knowing another user's requestId must not yield their session, even
      // with a different valid code. This case is mandatory: no early return.
      const attack = await client.start(attackerCode, requestId);
      expect(attack.status).toBe(401);
      expect(attack.error?.code).toBe('invalid_code');
      expect(hasOwnKey(attack.data, 'sessionId')).toBe(false);
      expect(hasOwnKey(attack.data, 'accessToken')).toBe(false);
    });
  });

  describe('submission validation', () => {
    let session: StartResponse;

    beforeAll(async () => {
      const code = await provision('submission', 1);
      session = freshSession(await client.start(code), 'submission');
    });

    it('refuses to submit an incomplete answer set', async () => {
      const res = await client.call('submit-test', {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
        answers: answersFrom('a').slice(0, 10),
      });
      expect(res.status).toBe(422);
      expect(res.error?.code).toBe('invalid_answers');
    });

    it('rejects illegal question ids and illegal options', async () => {
      const badQuestion = answersFrom('a');
      badQuestion[0] = { questionId: 'q99', optionId: 'a' };
      const questionRes = await client.call('submit-test', {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
        answers: badQuestion,
      });
      expect(questionRes.status).toBe(422);
      expect(questionRes.error?.code).toBe('invalid_answers');

      const badOption = answersFrom('a');
      badOption[3] = { questionId: badOption[3].questionId, optionId: 'zzz' };
      const optionRes = await client.call('submit-test', {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
        answers: badOption,
      });
      expect(optionRes.status).toBe(422);
      expect(optionRes.error?.code).toBe('invalid_answers');
    });

    it('rejects a submission with a forged access token', async () => {
      const res = await client.call('submit-test', {
        sessionId: session.sessionId,
        accessToken: 'x'.repeat(48),
        answers: answersFrom('a'),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('result ownership and immutability', () => {
    let session: StartResponse;
    let stored: ResultEnvelope;
    const firstAnswers = answersFrom('b');

    beforeAll(async () => {
      const code = await provision('result', 1);
      session = freshSession(await client.start(code), 'result');
    });

    it('stores a result and serves it back to the owner', async () => {
      const expected = buildReport(firstAnswers);
      const submitted = await client.call<{ result: ResultEnvelope }>('submit-test', {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
        answers: firstAnswers,
      });
      expect(submitted.status).toBe(200);
      expect(submitted.data?.result.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(submitted.data?.result.report).toEqual(expected);
      if (!submitted.data) throw new Error('[integration] submit-test returned no result');
      stored = submitted.data.result;

      const fetched = await client.call<{ id: string; report: ResultEnvelope['report'] }>(
        'get-result',
        {
          sessionId: session.sessionId,
          accessToken: session.accessToken,
        },
      );
      expect(fetched.status).toBe(200);
      expect(fetched.data?.id).toBe(stored.id);
      expect(fetched.data?.report).toEqual(expected);
    });

    it('returns the stored result on re-submission and never rewrites it', async () => {
      // A different answer set must NOT replace the stored report. The
      // contract is "first result wins", not "last write wins" — so the
      // response and the subsequent get-result are both the ORIGINAL result.
      const resubmitted = await client.call<{ result: ResultEnvelope }>('submit-test', {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
        answers: answersFrom('d'),
      });
      expect(resubmitted.status).toBe(200);
      expect(resubmitted.data?.result.id).toBe(stored.id);
      expect(resubmitted.data?.result.report).toEqual(stored.report);

      const refetched = await client.call<{ report: ResultEnvelope['report'] }>(
        'get-result',
        {
          sessionId: session.sessionId,
          accessToken: session.accessToken,
        },
      );
      expect(refetched.status).toBe(200);
      expect(refetched.data?.report).toEqual(stored.report);
      expect(refetched.data?.report.scores).toEqual(buildReport(firstAnswers).scores);
    });
  });

  describe('public share contract', () => {
    let code: string;
    let codeId: string | null = null;
    let session: StartResponse;
    let shared: CallResult<Record<string, unknown>>;

    beforeAll(async () => {
      const provisioned = await provision.withId('share', 1);
      code = provisioned.code;
      codeId = provisioned.id;
      session = freshSession(await client.start(code), 'share');

      const submitted = await client.call('submit-test', {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
        answers: answersFrom('d'),
      });
      expect(submitted.status).toBe(200);

      const share = await client.call<{ token: string }>('create-share', {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
      });
      expect(share.status).toBe(200);
      if (typeof share.data?.token !== 'string') {
        throw new Error('[integration] create-share did not return a token');
      }
      // Boolean assertions: a failing string matcher would print the token.
      const token = share.data.token;
      expect(token.length >= 40, 'share token must be at least 40 characters').toBe(true);
      expect(/^[A-Za-z0-9_-]+$/.test(token), 'share token must be URL-safe').toBe(true);

      shared = await client.call<Record<string, unknown>>('shared-result', { token });
    });

    it('returns exactly the three public top-level keys', () => {
      expect(shared.status).toBe(200);
      expect(Object.keys(shared.data ?? {}).sort()).toEqual([
        'createdAt',
        'report',
        'scoringVersion',
      ]);

      // Boolean checks keep the code/session id out of failure output.
      const serialised = JSON.stringify(shared.data);
      expect(serialised.includes(code), 'public payload must not contain the test code').toBe(
        false,
      );
      expect(
        serialised.includes(session.sessionId),
        'public payload must not contain the session id',
      ).toBe(false);
      expect(serialised.includes('accessToken'), 'public payload must not contain a token').toBe(
        false,
      );
      expect(serialised.includes('optionId'), 'public payload must not contain answers').toBe(
        false,
      );
    });

    it('projects exactly the allowlisted report, including full scores', () => {
      const report = (shared.data as { report?: Record<string, unknown> } | null)?.report ?? {};
      const forbidden = [
        'answers',
        'optionIds',
        'rawAnswers',
        'accessToken',
        'sessionId',
        'requestId',
        'codeHint',
        'code_hash',
        'password_hash',
        'codeHash',
        'passwordHash',
        'token',
        'tokenHash',
        'adminId',
      ];
      for (const key of forbidden) {
        expect(report, `shared report must not contain ${key}`).not.toHaveProperty(key);
      }
      const expected = buildReport(answersFrom('d'));
      expect(Object.keys(report).sort()).toEqual(Object.keys(expected).sort());
      // Values, not just keys: a projection that returned empty/zeroed scores
      // would still pass a key-set assertion.
      expect(report.scores).toEqual(expected.scores);
    });

    it('rejects a fabricated share token', async () => {
      const res = await client.call('shared-result', { token: 'A'.repeat(43) });
      expect(res.status).toBe(404);
    });

    // Reuses this scenario's session: revocation needs no extra start-test
    // call, so the declared batch budget stays exact. Declared last so the
    // earlier contract assertions run before the share is revoked.
    it.skipIf(client.manifest.mode !== 'admin')(
      'invalidates an existing share immediately after revokeShares',
      async () => {
        if (codeId === null) {
          throw new Error('[integration] admin provisioning returned no code id');
        }
        const share = await client.call<{ token: string }>('create-share', {
          sessionId: session.sessionId,
          accessToken: session.accessToken,
        });
        expect(share.status).toBe(200);
        const token = share.data?.token;
        if (typeof token !== 'string') {
          throw new Error('[integration] create-share did not return a token');
        }

        const before = await client.call('shared-result', { token });
        expect(before.status).toBe(200);

        const adminToken = await provision.adminToken();
        const revoked = await client.call(
          'admin-update-code',
          // isActive keeps the update non-empty; revokeShares is the assertion.
          { id: codeId, isActive: true, revokeShares: true },
          { 'x-access-token': adminToken },
        );
        expect(revoked.status).toBe(200);

        const after = await client.call('shared-result', { token });
        expect(after.status).toBe(404);
      },
    );
  });

  describe('RLS and admin authentication', () => {
    it('blocks anonymous table reads through RLS', async () => {
      const probes = [
        'test_codes',
        'test_sessions',
        'test_answers',
        'test_results',
        'share_links',
        'admin_users',
        'admin_sessions',
        'audit_log',
      ];
      for (const table of probes) {
        const res = await client.probeTable(table);
        if (res.ok) {
          // Assert the count, not the rows: a failure must not dump table data.
          expect(
            res.rows?.length ?? 0,
            `${table} must not be readable by the publishable key`,
          ).toBe(0);
        } else {
          // A 5xx is not an RLS guarantee.
          expect([401, 403, 404], `${table} returned an unexpected status`).toContain(res.status);
        }
      }
    });

    it('refuses every admin endpoint without a valid admin token', async () => {
      for (const fn of [
        'admin-list-codes',
        'admin-stats',
        'admin-create-code',
        'admin-update-code',
      ]) {
        const res = await client.call(fn, {}, { 'x-access-token': 'not-a-real-admin-token-000000' });
        expect(res.status, fn).toBe(401);
      }
      const noToken = await client.call('admin-list-codes', {});
      expect(noToken.status).toBe(401);
    });
  });
}

function registerBatchB(client: IntegrationClient, provision: Provisioner): void {
  describe('quota concurrency', () => {
    it('never creates more than maxUses sessions, even under concurrency', async () => {
      const code = await provision('quota-concurrency', 3);
      const burst = await Promise.all(
        Array.from({ length: 8 }, () => client.start(code)),
      );

      assertNo5xx(burst, 'quota concurrency');
      assertStatuses(burst, [200, 402], 'quota concurrency');

      const created = burst.filter((r) => r.status === 200);
      const exhausted = burst.filter(
        (r) => r.status === 402 && r.error?.code === 'exhausted',
      );
      expect(created.length).toBe(3);
      expect(exhausted.length).toBe(5);
      expect(created.length + exhausted.length).toBe(8);

      const usedCounts = created
        .map((r) => {
          if (r.data === null) throw new Error('[integration] 200 without a session payload');
          return r.data.usedCount;
        })
        .sort((a, b) => a - b);
      expect(usedCounts).toEqual([1, 2, 3]);

      for (const r of created) {
        expect(r.data?.maxUses).toBe(3);
        expect(r.data?.remaining).toBe(3 - (r.data?.usedCount ?? 0));
      }

      // A fresh code now exhausted must say so; it must not keep handing out
      // sessions. This call also proves the burst consumed exactly 3 credits.
      const after = await client.start(code);
      expect(after.status).toBe(402);
      expect(after.error?.code).toBe('exhausted');
    });
  });

  describe('retake quota exhaustion', () => {
    it('rejects a retake once the quota is exhausted', async () => {
      const code = await provision('retake-exhausted', 1);
      const session = freshSession(await client.start(code), 'retake exhausted');

      const retake = await client.retake(session, uuid());
      expect(retake.status).toBe(402);
      expect(retake.error?.code).toBe('exhausted');
      expect(hasOwnKey(retake.data, 'sessionId')).toBe(false);
    });
  });

  describe('retake idempotency', () => {
    it('never double-consumes on a repeated requestId', async () => {
      const code = await provision('retake-idempotent', 3);
      const session = freshSession(await client.start(code), 'retake idempotent');

      const requestId = uuid();
      const a = await client.retake(session, requestId);
      const b = await client.retake(session, requestId);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      // One credit consumed by the first retake; the replay must observe 2,
      // not 3. This is what catches a duplicate charge.
      expect(a.data?.usedCount).toBe(2);
      expect(b.data?.usedCount).toBe(2);
      expect(b.data?.sessionId).toBe(a.data?.sessionId);
      expect(b.data?.maxUses).toBe(3);
    });
  });
}

function registerBatchC(client: IntegrationClient, provision: Provisioner): void {
  describe('same requestId concurrency', () => {
    it('fails loudly on 5xx and consumes exactly one credit', async () => {
      const code = await provision('request-id-race', 3);
      const requestId = uuid();
      const burst = await Promise.all(
        Array.from({ length: 7 }, () => client.start(code, requestId)),
      );

      try {
        assertNo5xx(burst, 'same requestId race');
      } catch (error) {
        throw new Error(
          `${(error as Error).message} Pending fix: the 0005 advisory-lock migration is ` +
            'still a proposal and has not been applied. Without it the outcome is ' +
            'nondeterministic: depending on timing this may 5xx (the unique index ' +
            'rolls the losing transaction back, so no double charge), or every ' +
            'request may see the committed session and return 200. A green run ' +
            'is not evidence the race is fixed. This test must not be relaxed to ' +
            'accept the race.',
        );
      }
      assertStatuses(burst, [200], 'same requestId race');

      const sessionIds = new Set(
        burst.map((r) => {
          if (r.data === null) throw new Error('[integration] 200 without a session payload');
          return r.data.sessionId;
        }),
      );
      expect(sessionIds.size).toBe(1);
      const accessTokens = new Set(
        burst.map((r) => {
          if (r.data === null) throw new Error('[integration] 200 without a session payload');
          return r.data.accessToken;
        }),
      );
      expect(accessTokens.size).toBe(1);
      for (const r of burst) {
        expect(r.data?.usedCount).toBe(1);
        expect(r.data?.maxUses).toBe(3);
        expect(r.data?.remaining).toBe(2);
        expect(r.data?.accessToken.length).toBeGreaterThanOrEqual(32);
      }

      // Exactly one credit was consumed: a new requestId advances to 2.
      const followUp = await client.start(code);
      expect(followUp.status).toBe(200);
      expect(followUp.data?.usedCount).toBe(2);
    });
  });

  describe('cross-code concurrent replay', () => {
    it('allows one valid code, charges only that code, and rejects the other', async () => {
      const ownerCode = await provision('cross-code-race-owner', 1);
      const attackerCode = await provision('cross-code-race-attacker', 1);
      const requestId = uuid();

      const attempts = [
        { label: 'owner', code: ownerCode },
        { label: 'attacker', code: attackerCode },
      ] as const;
      const results = await Promise.all(
        attempts.map((attempt) => client.start(attempt.code, requestId)),
      );

      try {
        assertNo5xx(results, 'cross-code concurrent replay');
      } catch (error) {
        throw new Error(
          `${(error as Error).message} Pending fix: the 0005 advisory-lock migration is ` +
            'still a proposal and has not been applied. This failure is timing-dependent ' +
            'and is not guaranteed to reproduce on every run.',
        );
      }
      assertStatuses(results, [200, 401], 'cross-code concurrent replay');

      const outcomes = results.map((result, index) => ({
        ...attempts[index],
        result,
      }));
      const allowed = outcomes.filter((outcome) => outcome.result.status === 200);
      const denied = outcomes.filter(
        (outcome) =>
          outcome.result.status === 401 && outcome.result.error?.code === 'invalid_code',
      );
      expect(allowed.length).toBe(1);
      expect(denied.length).toBe(1);

      const winner = allowed[0].result.data;
      if (winner === null) throw new Error('[integration] winning start returned no session');
      expect(winner.usedCount).toBe(1);
      expect(winner.maxUses).toBe(1);
      expect(winner.remaining).toBe(0);
      expect(winner.accessToken.length).toBeGreaterThanOrEqual(32);

      const denial = denied[0].result;
      expect(hasOwnKey(denial.data, 'sessionId')).toBe(false);
      expect(hasOwnKey(denial.data, 'accessToken')).toBe(false);

      // The losing code must not have been charged by the rejected attempt.
      // A new requestId on that same code must still create its one session.
      const corrected = freshSession(
        await client.start(denied[0].code),
        'cross-code race losing code follow-up',
      );
      expect(corrected.usedCount).toBe(1);
      expect(corrected.maxUses).toBe(1);
      expect(corrected.remaining).toBe(0);
    });
  });
}
