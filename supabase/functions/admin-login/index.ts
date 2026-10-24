/// <reference lib="deno.ns" />
import { z } from 'npm:zod@3.25.67';
import { fail, ok, readJson, withErrorHandling, clientIp, rateLimit } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verifyPassword } from '../_shared/password.ts';
import { generateToken, sha256Hex } from '../_shared/crypto.ts';

/**
 * POST /functions/v1/admin-login
 * body: { username, password }
 *
 * Returns an opaque, expiring session token. The password is only ever compared
 * against a PBKDF2 hash stored server-side.
 */
const schema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(200),
});

const SESSION_HOURS = 4;
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

Deno.serve(
  withErrorHandling(async (req) => {
    const ip = clientIp(req);
    if (!rateLimit(`admin:${ip}`, MAX_ATTEMPTS, WINDOW_MS)) {
      return fail('rate_limited', '尝试次数过多，请 15 分钟后再试', 900);
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) return fail('bad_request', '请求参数不合法');

    const client = adminClient();
    const { data } = await client
      .from('admin_users')
      .select('id, username, password_hash, is_active')
      .eq('username', parsed.data.username)
      .maybeSingle();

    if (!data || !(data as { is_active: boolean }).is_active) {
      // Keep the response time roughly constant for unknown users.
      await sha256Hex(`unknown:${parsed.data.username}`);
      return fail('unauthorized', '用户名或密码不正确');
    }

    const row = data as { id: string; username: string; password_hash: string };
    const valid = await verifyPassword(parsed.data.password, row.password_hash);
    if (!valid) return fail('unauthorized', '用户名或密码不正确');

    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();

    const { error } = await client.from('admin_sessions').insert({
      admin_id: row.id,
      token_hash: await sha256Hex(token),
      expires_at: expiresAt,
    });
    if (error) return fail('server_error', '创建管理员会话失败');

    return ok({ token, username: row.username, expiresAt });
  }),
);