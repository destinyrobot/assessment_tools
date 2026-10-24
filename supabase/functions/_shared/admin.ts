/// <reference lib="deno.ns" />
import { sha256Hex } from './crypto.ts';
import { adminClient } from './supabase.ts';
import { fail, type ErrorCode } from './http.ts';
import { z } from 'npm:zod@3.25.67';

/** Validates an opaque admin bearer token against admin_sessions. */
export async function requireAdmin(req: Request): Promise<{ id: string; username: string } | Response> {
  const header = req.headers.get('x-access-token');
  if (!header) return fail('unauthorized', '缺少管理员凭证');

  const tokenHash = await sha256Hex(header);
  const { data, error } = await adminClient()
    .from('admin_sessions')
    .select('id, admin_id, expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error || !data) return fail('unauthorized', '管理员会话无效或已过期');

  const { data: admin } = await adminClient()
    .from('admin_users')
    .select('id, username, is_active')
    .eq('id', (data as { admin_id: string }).admin_id)
    .maybeSingle();

  if (!admin || !(admin as { is_active: boolean }).is_active) {
    return fail('unauthorized', '管理员账号不可用');
  }

  return {
    id: (admin as { id: string }).id,
    username: (admin as { username: string }).username,
  };
}

export const adminTokenSchema = z.object({ token: z.string().min(20).max(200) });

/** Defense in depth: never let a database error string reach the browser. */
export function rethrowAsProblem(error: { message?: string } | null, fallback: ErrorCode = 'server_error') {
  if (error) throw new Error(fallback);
}

export { timingSafeEqualHex };