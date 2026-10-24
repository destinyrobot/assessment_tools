/// <reference lib="deno.ns" />
import { z } from 'npm:zod@3.25.67';
import { fail, ok, readJson, withErrorHandling } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';
import { createCodeRow, generateCode } from '../_shared/codes.ts';

/**
 * POST /functions/v1/admin-create-code
 * header: x-access-token
 * body: { label?, maxUses?, note?, code? }
 *
 * The plaintext code is returned exactly once. Only the PBKDF2 hash and the
 * keyed lookup hash are stored.
 */
const schema = z.object({
  label: z.string().trim().max(80).optional(),
  note: z.string().trim().max(200).optional(),
  maxUses: z.number().int().min(1).max(100).default(3),
  code: z.string().trim().min(8).max(64).optional(),
});

Deno.serve(
  withErrorHandling(async (req) => {
    const admin = await requireAdmin(req);
    if (admin instanceof Response) return admin;

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) return fail('bad_request', '请求参数不合法');

    const code = parsed.data.code ?? generateCode(12);
    if (parsed.data.code && parsed.data.code.trim().replace(/\s+/g, '').length < 8) {
      return fail('bad_request', '自定义密码至少需要 8 位');
    }

    try {
      const created = await createCodeRow({
        code,
        label: parsed.data.label,
        note: parsed.data.note,
        maxUses: parsed.data.maxUses,
      });

      return ok({
        code: {
          id: created.id,
          label: parsed.data.label ?? null,
          codeHint: created.hint,
          maxUses: parsed.data.maxUses,
          usedCount: 0,
          remaining: parsed.data.maxUses,
          isActive: true,
          note: parsed.data.note ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        // Shown once so the admin can hand it over; never stored in plaintext.
        plaintext: code,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message.includes('duplicate')) {
        return fail('bad_request', '这个密码已经存在了');
      }
      return fail('server_error', '创建失败，请稍后再试');
    }
  }),
);