/// <reference lib="deno.ns" />
import { startTestSchema } from '../_shared/schemas.ts';
import { fail, ok, readJson, withErrorHandling, clientIp, rateLimit, ApiProblem } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { findCodeRow, verifyPlainCode, deriveSessionToken } from '../_shared/codes.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { QUESTIONS } from '../_shared/questions.ts';
import { SCORING_VERSION } from '../_shared/dimensions.ts';

/**
 * POST /functions/v1/start-test
 * body: { code: string, requestId: uuid }
 *
 * - Validates the code against PBKDF2.
 * - Atomically consumes exactly one credit and creates a session (see
 *   public.start_test_session, which row-locks test_codes).
 * - `requestId` makes retries idempotent: the same id never consumes twice.
 */
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 10 * 60 * 1000;

Deno.serve(
  withErrorHandling(async (req) => {
    if (!rateLimit(`start:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
      return fail('rate_limited', '尝试次数过多，请 10 分钟后再试', 600);
    }

    const parsed = startTestSchema.safeParse(await readJson(req));
    if (!parsed.success) return fail('bad_request', '请求参数不合法');
    const { code, requestId } = parsed.data;

    const row = await findCodeRow(code);

    // Constant-ish work even when the code does not exist.
    if (!row) {
      await sha256Hex(`miss:${requestId}`);
      return fail('invalid_code', '密码不正确');
    }

    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      return fail('rate_limited', '该密码尝试失败次数过多，请稍后再试', 900);
    }
    if (!row.is_active) return fail('inactive_code', '该密码已被停用');

    const valid = await verifyPlainCode(code, row);
    if (!valid) {
      const client = adminClient();
      const { data } = await client.rpc('register_failed_attempt', {
        p_code_hash: row.code_hash,
        p_threshold: 8,
        p_lock_minutes: 15,
      });
      if (data === true) return fail('rate_limited', '尝试失败次数过多，该密码已临时锁定 15 分钟', 900);
      return fail('invalid_code', '密码不正确');
    }

    // Deterministic per requestId => an idempotent replay returns the same token.
    const accessToken = await deriveSessionToken(requestId);
    const accessTokenHash = await sha256Hex(accessToken);

    const { data, error } = await adminClient().rpc('start_test_session', {
      p_code_hash: row.code_hash,
      p_access_token_hash: accessTokenHash,
      p_request_id: requestId,
      p_scoring_version: SCORING_VERSION,
      p_question_count: QUESTIONS.length,
    });

    if (error) {
      const message = error.message ?? '';
      if (message.includes('exhausted')) return fail('exhausted', '该密码的测评次数已经用完了');
      if (message.includes('inactive_code')) return fail('inactive_code', '该密码已被停用');
      if (message.includes('rate_limited')) return fail('rate_limited', '该密码已临时锁定，请稍后再试', 900);
      if (message.includes('invalid_code')) return fail('invalid_code', '密码不正确');
      throw new ApiProblem('server_error', '创建测评会话失败，请稍后再试');
    }

    const row0 = (data as { session_id: string; used_count: number; max_uses: number; started_at: string }[])[0];
    if (!row0) throw new ApiProblem('server_error', '创建测评会话失败，请稍后再试');

    return ok({
      sessionId: row0.session_id,
      accessToken,
      totalQuestions: QUESTIONS.length,
      scoringVersion: SCORING_VERSION,
      usedCount: row0.used_count,
      maxUses: row0.max_uses,
      remaining: Math.max(0, row0.max_uses - row0.used_count),
      startedAt: row0.started_at,
    });
  }),
);