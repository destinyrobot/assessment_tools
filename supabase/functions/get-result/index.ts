/// <reference lib="deno.ns" />
import { sessionAuthSchema } from '../_shared/schemas.ts';
import { fail, ok, readJson, withErrorHandling } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { sha256Hex } from '../_shared/crypto.ts';

/**
 * POST /functions/v1/get-result
 * body: { sessionId, accessToken }
 *
 * Returns the owner's own result. Requires the per-session token; knowing only
 * a session id is never enough (session ids are UUIDv4 but never the credential).
 */
Deno.serve(
  withErrorHandling(async (req) => {
    const parsed = sessionAuthSchema.safeParse(await readJson(req));
    if (!parsed.success) return fail('bad_request', '请求参数不合法');
    const { sessionId, accessToken } = parsed.data;

    const tokenHash = await sha256Hex(accessToken);
    const client = adminClient();

    const { data, error } = await client
      .from('test_results')
      .select('id, session_id, scoring_version, report, created_at')
      .eq('session_id', sessionId)
      .single();
    if (error || !data) return fail('not_found', '还没有生成结果');

    const { data: context } = await client.rpc('get_session_context', {
      p_session_id: sessionId,
      p_access_token_hash: tokenHash,
    });
    if (!context || (context as unknown[]).length === 0) {
      return fail('unauthorized', '会话凭证无效');
    }

    const row = data as {
      id: string;
      session_id: string;
      scoring_version: string;
      report: unknown;
      created_at: string;
    };

    return ok({
      id: row.id,
      sessionId: row.session_id,
      scoringVersion: row.scoring_version,
      report: row.report,
      createdAt: row.created_at,
    });
  }),
);

export { ApiProblem };