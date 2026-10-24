/// <reference lib="deno.ns" />
import { sessionAuthSchema } from '../_shared/schemas.ts';
import { fail, ok, readJson, withErrorHandling, clientIp, rateLimit, ApiProblem } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { generateToken, sha256Hex } from '../_shared/crypto.ts';

/**
 * POST /functions/v1/create-share
 * body: { sessionId, accessToken }
 *
 * Mints a 256-bit CSPRNG token, stores only its SHA-256 hash, and returns the
 * plaintext exactly once. The token never contains the code, the answers or
 * any session identifier.
 */
const SHARE_TTL_DAYS = 90;

Deno.serve(
  withErrorHandling(async (req) => {
    if (!rateLimit(`share:${clientIp(req)}`, 30, 10 * 60 * 1000)) {
      return fail('rate_limited', '操作过于频繁，请稍后再试', 300);
    }

    const parsed = sessionAuthSchema.safeParse(await readJson(req));
    if (!parsed.success) return fail('bad_request', '请求参数不合法');
    const { sessionId, accessToken } = parsed.data;

    const client = adminClient();
    const tokenHash = await sha256Hex(accessToken);

    const { data: context } = await client.rpc('get_session_context', {
      p_session_id: sessionId,
      p_access_token_hash: tokenHash,
    });
    if (!context || (context as unknown[]).length === 0) {
      return fail('unauthorized', '会话凭证无效');
    }

    const { data: result, error: resultError } = await client
      .from('test_results')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (resultError) throw new ApiProblem('server_error', '生成分享链接失败');
    if (!result) return fail('not_found', '还没有生成结果');

    const token = generateToken(32);
    const tokenDigest = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 3600 * 1000).toISOString();

    const { error } = await client.from('share_links').insert({
      token_hash: tokenDigest,
      result_id: (result as { id: string }).id,
      expires_at: expiresAt,
    });
    if (error) throw new ApiProblem('server_error', '生成分享链接失败');

    return ok({ token, expiresAt });
  }),
);