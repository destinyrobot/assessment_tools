/// <reference lib="deno.ns" />
import { fail, ok, withErrorHandling, readJson } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireAdmin } from '../_shared/admin.ts';

/** POST /functions/v1/admin-stats — aggregate counters for the dashboard. */
Deno.serve(
  withErrorHandling(async (req) => {
    const admin = await requireAdmin(req);
    if (admin instanceof Response) return admin;

    await readJson(req).catch(() => ({}));

    const client = adminClient();
    const now = new Date().toISOString();

    const [codes, activeCodes, sessions, completed, results, shares] = await Promise.all([
      client.from('test_codes').select('id', { count: 'exact', head: true }),
      client.from('test_codes').select('id', { count: 'exact', head: true }).eq('is_active', true),
      client.from('test_sessions').select('id', { count: 'exact', head: true }),
      client
        .from('test_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'submitted'),
      client.from('test_results').select('id', { count: 'exact', head: true }),
      client
        .from('share_links')
        .select('id', { count: 'exact', head: true })
        .is('revoked_at', null)
        .gt('expires_at', now),
    ]);

    if (codes.error || sessions.error) return fail('server_error', '读取统计失败');

    return ok({
      stats: {
        totalCodes: codes.count ?? 0,
        activeCodes: activeCodes.count ?? 0,
        totalSessions: sessions.count ?? 0,
        completedSessions: completed.count ?? 0,
        totalResults: results.count ?? 0,
        liveShares: shares.count ?? 0,
      },
    });
  }),
);