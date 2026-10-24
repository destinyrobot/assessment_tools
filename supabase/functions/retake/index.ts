/// <reference lib="deno.ns" />
import { z } from 'npm:zod@3.25.67';
import { fail, ok, readJson, withErrorHandling, clientIp, rateLimit, ApiProblem } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { deriveSessionToken } from '../_shared/codes.ts';
import { QUESTIONS } from '../_shared/questions.ts';
import { SCORING_VERSION } from '../_shared/dimensions.ts';

/**
 * POST /functions/v1/retake
 * body: { sessionId, accessToken, requestId }
 *
 * Starts a new session on the same test code. The quota check and the decrement
 * happen inside public.start_test_session (row lock), so concurrent retries can
 * never push usage past max_uses, and an identical requestId is idempotent.
 */
const schema = z.object({
  sessionId: z.string().uuid(),
  accessToken: z.string().min(20).max(200),
  requestId: z.string().uuid(),
});

Deno.serve(
  withErrorHandling(async (req) => {
    if (!rateLimit(`retake:${clientIp(req)}`, 10, 5 * 60 * 1000)) {
      return fail('rate_limited', '操作过于频繁，请稍后再试', 300);
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) return fail('bad_request', '请求参数不合法');
    const { sessionId, accessToken, requestId } = parsed.data;

    const tokenHash = await sha256Hex(accessToken);
    const client = adminClient();

    const { data: context, error: contextError } = await client.rpc('get_session_context', {
      p_session_id: sessionId,
      p_access_token_hash: tokenHash,
    });

    if (contextError) throw new ApiProblem('server_error', '校验会话失败，请稍后再试');
    const current = (context as { test_code_id: string; is_active: boolean }[])[0];
    if (!current) return fail('unauthorized', '会话凭证无效，请重新输入密码');
    if (!current.is_active) return fail('inactive_code', '该密码已被停用');

    const { data: codeRow, error: codeError } = await client
      .from('test_codes')
      .select('code_hash')
      .eq('id', current.test_code_id)
      .single();
    if (codeError) throw new ApiProblem('server_error', '读取密码信息失败');

    const nextToken = await deriveSessionToken(requestId);
    const nextTokenHash = await sha256Hex(nextToken);

    const { data, error } = await client.rpc('start_test_session', {
      p_code_hash: (codeRow as { code_hash: string }).code_hash,
      p_access_token_hash: nextTokenHash,
      p_request_id: requestId,
      p_scoring_version: SCORING_VERSION,
      p_question_count: QUESTIONS.length,
    });

    if (error) {
      const message = error.message ?? '';
      if (message.includes('exhausted')) return fail('exhausted', '该密码的测评次数已经用完了');
      if (message.includes('inactive_code')) return fail('inactive_code', '该密码已被停用');
      throw new ApiProblem('server_error', '开始新一轮测评失败，请稍后再试');
    }

    const row = (data as { session_id: string; used_count: number; max_uses: number; started_at: string }[])[0];
    if (!row) throw new ApiProblem('server_error', '开始新一轮测评失败，请稍后再试');

    return ok({
      sessionId: row.session_id,
      accessToken: nextToken,
      totalQuestions: QUESTIONS.length,
      scoringVersion: SCORING_VERSION,
      usedCount: row.used_count,
      maxUses: row.max_uses,
      remaining: Math.max(0, row.max_uses - row.used_count),
      startedAt: row.started_at,
    });
  }),
);