/// <reference lib="deno.ns" />
import { fail, ok, withErrorHandling, readJson } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireAdmin } from '../_shared/admin.ts';

/**
 * POST /functions/v1/admin-list-codes
 * header: x-access-token
 *
 * Never returns code_hash, password_hash or anything else sensitive — only the
 * masked hint and the quota counters needed to operate the business.
 */
Deno.serve(
  withErrorHandling(async (req) => {
    const admin = await requireAdmin(req);
    if (admin instanceof Response) return admin;

    await readJson(req).catch(() => ({}));

    const { data, error } = await adminClient()
      .from('test_codes')
      .select('id, label, code_hint, max_uses, used_count, is_active, note, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return fail('server_error', '读取失败');

    const codes = (data ?? []).map((row) => {
      const r = row as {
        id: string;
        label: string | null;
        code_hint: string;
        max_uses: number;
        used_count: number;
        is_active: boolean;
        note: string | null;
        created_at: string;
        updated_at: string;
      };
      return {
        id: r.id,
        label: r.label,
        codeHint: r.code_hint,
        maxUses: r.max_uses,
        usedCount: r.used_count,
        remaining: Math.max(0, r.max_uses - r.used_count),
        isActive: r.is_active,
        note: r.note,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    return ok({ codes });
  }),
);