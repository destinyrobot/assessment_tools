/// <reference lib="deno.ns" />
import { z } from 'npm:zod@3.25.67';
import { fail, ok, readJson, withErrorHandling } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireAdmin } from '../_shared/admin.ts';

/**
 * POST /functions/v1/admin-update-code
 * header: x-access-token
 * body: { id, isActive?, maxUses?, note?, revokeShares? }
 */
const schema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean().optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
  note: z.string().trim().max(200).optional(),
  revokeShares: z.boolean().optional(),
});

Deno.serve(
  withErrorHandling(async (req) => {
    const admin = await requireAdmin(req);
    if (admin instanceof Response) return admin;

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) return fail('bad_request', '请求参数不合法');
    const { id, isActive, maxUses, note, revokeShares } = parsed.data;

    const client = adminClient();
    const { data: current } = await client
      .from('test_codes')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!current) return fail('not_found', '密码不存在');

    const currentRow = current as {
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

    // maxUses may never drop below what has already been consumed.
    const nextMax = maxUses ?? currentRow.max_uses;
    if (nextMax < currentRow.used_count) {
      return fail('bad_request', `次数不能低于已使用的 ${currentRow.used_count} 次`);
    }

    const { data: updated, error } = await client
      .from('test_codes')
      .update({
        ...(isActive === undefined ? {} : { is_active: isActive }),
        ...(maxUses === undefined ? {} : { max_uses: maxUses }),
        ...(note === undefined ? {} : { note }),
      })
      .eq('id', id)
      .select('id, label, code_hint, max_uses, used_count, is_active, note, created_at, updated_at')
      .single();

    if (error || !updated) return fail('server_error', '更新失败');

    if (revokeShares) {
      const { data: sessions } = await client
        .from('test_sessions')
        .select('id')
        .eq('test_code_id', id);
      const sessionIds = (sessions ?? []).map((s) => (s as { id: string }).id);
      if (sessionIds.length > 0) {
        const { data: results } = await client
          .from('test_results')
          .select('id')
          .in('session_id', sessionIds);
        const resultIds = (results ?? []).map((r) => (r as { id: string }).id);
        if (resultIds.length > 0) {
          await client
            .from('share_links')
            .update({ revoked_at: new Date().toISOString() })
            .in('result_id', resultIds);
        }
      }
    }

    const r = updated as {
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

    return ok({
      code: {
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
      },
    });
  }),
);