/// <reference lib="deno.ns" />
import { submitTestSchema, answersAreLegal } from '../_shared/schemas.ts';
import { fail, ok, readJson, withErrorHandling, clientIp, rateLimit, ApiProblem } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { buildReport, ScoringError } from '../_shared/scoring.ts';
import { SCORING_VERSION } from '../_shared/dimensions.ts';

/**
 * POST /functions/v1/submit-test
 * body: { sessionId, accessToken, answers: [{questionId, optionId}], scoringVersion? }
 *
 * Scoring happens here, on the server. The client only ever sends question and
 * option ids — never scores, never dimension totals, never the archetype.
 *
 * Result immutability: `finalize_submission` keeps the first stored result.
 * The response is therefore re-read from `test_results` after the RPC, so a
 * repeat submission returns the ORIGINAL report (HTTP 200) instead of a freshly
 * computed one that was never persisted.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60 * 1000;

Deno.serve(
  withErrorHandling(async (req) => {
    if (!rateLimit(`submit:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
      return fail('rate_limited', '提交过于频繁，请稍后再试', 300);
    }

    const parsed = submitTestSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      return fail('invalid_answers', '答案不完整或格式不正确，请检查是否有题目未作答');
    }
    const { sessionId, accessToken, answers } = parsed.data;

    // Legal question ids + legal option ids for those questions + full coverage.
    if (!answersAreLegal(answers)) {
      return fail('invalid_answers', '答案中包含无效的题目或选项');
    }

    let report;
    try {
      report = buildReport(answers, SCORING_VERSION);
    } catch (error) {
      if (error instanceof ScoringError) {
        return fail('invalid_answers', error.message);
      }
      throw new ApiProblem('server_error', '评分失败，请稍后再试');
    }

    const tokenHash = await sha256Hex(accessToken);
    const client = adminClient();

    const { data, error } = await client.rpc('finalize_submission', {
      p_session_id: sessionId,
      p_access_token_hash: tokenHash,
      p_scoring_version: report.scoringVersion,
      p_archetype_id: report.archetypeId,
      p_secondary_archetype_id: report.secondaryArchetypeId,
      p_dimension_scores: report.scores,
      p_report: report,
      p_answers: answers,
    });

    if (error) {
      const message = error.message ?? '';
      if (message.includes('unauthorized')) return fail('unauthorized', '会话凭证无效，请重新输入密码');
      if (message.includes('not_found')) return fail('not_found', '会话不存在');
      if (message.includes('invalid_answers')) return fail('invalid_answers', '答案不完整');
      throw new ApiProblem('server_error', '保存结果失败，请稍后再试');
    }

    const row = (
      data as { result_id: string; created_at: string; used_count: number; max_uses: number }[]
    )[0];
    if (!row) throw new ApiProblem('server_error', '保存结果失败，请稍后再试');

    // Read back what is actually stored. On a repeat submission the RPC
    // returns the pre-existing result_id, whose report may differ from the
    // report just computed from the new answers; the stored one is the contract.
    const { data: stored, error: readError } = await client
      .from('test_results')
      .select('id, scoring_version, report, created_at')
      .eq('id', row.result_id)
      .single();
    if (readError || !stored) {
      throw new ApiProblem('server_error', '保存结果失败，请稍后再试');
    }
    const storedRow = stored as {
      id: string;
      scoring_version: string;
      report: unknown;
      created_at: string;
    };

    return ok({
      result: {
        id: storedRow.id,
        sessionId,
        scoringVersion: storedRow.scoring_version,
        report: storedRow.report,
        createdAt: storedRow.created_at,
      },
      usedCount: row.used_count,
      maxUses: row.max_uses,
      remaining: Math.max(0, row.max_uses - row.used_count),
    });
  }),
);