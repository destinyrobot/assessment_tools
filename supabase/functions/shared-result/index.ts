/// <reference lib="deno.ns" />
import { z } from 'npm:zod@3.25.67';
import { fail, ok, readJson, withErrorHandling, clientIp, rateLimit } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { sha256Hex } from '../_shared/crypto.ts';

/**
 * POST /functions/v1/shared-result
 * body: { token }
 *
 * The only anonymous read path in the system. It returns exactly the fields
 * needed to render the report and nothing else:
 *   - no password / code hash
 *   - no raw answers
 *   - no session id (the DB function no longer selects it)
 *   - no admin data
 * The server additionally projects `report` through a database-side key
 * whitelist, so future scoring changes cannot leak internal fields by accident.
 *
 * Guessing ids is impossible: the lookup key is the SHA-256 of a 256-bit token.
 */
const schema = z.object({ token: z.string().min(20).max(200) });
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;

Deno.serve(
  withErrorHandling(async (req) => {
    if (!rateLimit(`shared:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
      return fail('rate_limited', '访问过于频繁，请稍后再试', 300);
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) return fail('bad_request', '分享链接无效');

    const tokenHash = await sha256Hex(parsed.data.token);
    const { data, error } = await adminClient().rpc('get_shared_result', {
      p_token_hash: tokenHash,
    });
    if (error) return fail('not_found', '分享链接无效或已被撤销');
    if (!data || (data as unknown[]).length === 0) {
      return fail('not_found', '分享链接无效或已被撤销');
    }

    const row = (
      data as {
        result_id: string;
        scoring_version: string;
        archetype_id: string;
        report: unknown;
        created_at: string;
      }[]
    )[0];

    // The public contract is exactly these three fields. Neither the result id
    // nor any session identifier is returned: the share page renders the report
    // and has no use for internal ids.
    return ok({
      scoringVersion: row.scoring_version,
      report: row.report,
      createdAt: row.created_at,
    });
  }),
);