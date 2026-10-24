#!/usr/bin/env node
/**
 * 本地 Mock 后端 —— 仅用于开发预览，绝不用于生产。
 *
 * 它在内存里模拟 Supabase Edge Functions 的 HTTP 契约，并复用 `shared/` 里
 * 真实的评分逻辑（scoring.ts）与密码哈希（password.ts），因此前端看到的报告
 * 与线上完全一致。区别只在于：没有数据库、没有并发锁、进程重启后数据清空。
 *
 *   node scripts/mock-server.mjs            # 监听 8787
 *   PORT=9000 node scripts/mock-server.mjs
 *
 * 然后在 .env.local 里把 VITE_SUPABASE_URL 指向 http://localhost:8787。
 */
import { createServer } from 'node:http';

import { QUESTIONS } from '../shared/questions.ts';
import { SCORING_VERSION } from '../shared/dimensions.ts';
import { buildReport, ScoringError } from '../shared/scoring.ts';
import { hashPassword, verifyPassword } from '../shared/password.ts';
import { generateToken, sha256Hex, timingSafeEqualHex } from '../shared/crypto.ts';
import {
  adminLoginSchema,
  answersAreLegal,
  sessionAuthSchema,
  startTestSchema,
  submitTestSchema,
} from '../shared/schemas.ts';
import { z } from 'zod';

const PORT = Number(process.env.PORT ?? 8787);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-access-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const ERROR_STATUS = {
  invalid_code: 401,
  inactive_code: 403,
  exhausted: 402,
  rate_limited: 429,
  unauthorized: 401,
  not_found: 404,
  invalid_answers: 422,
  already_completed: 409,
  bad_request: 400,
  server_error: 500,
};

/** 进程内存储，结构与数据库表一一对应（去掉了外键与索引）。 */
const db = {
  codes: [],
  sessions: new Map(),
  results: new Map(),
  shares: new Map(),
  admins: [],
  adminSessions: new Map(),
  /** requestId -> sessionId，保证重试幂等。 */
  byRequestId: new Map(),
};

const now = () => new Date().toISOString();
const uuid = () => globalThis.crypto.randomUUID();

function normalizeCode(code) {
  return code.trim().replace(/\s+/g, '').toUpperCase();
}

function hintFor(code) {
  const c = normalizeCode(code);
  if (c.length <= 4) return `${c.slice(0, 1)}***`;
  return `${c.slice(0, 2)}****${c.slice(-2)}`;
}

function generateCode(length = 12) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

async function insertCode({ code, label, note, maxUses }) {
  const plaintext = normalizeCode(code);
  const row = {
    id: uuid(),
    code: plaintext,
    password_hash: await hashPassword(plaintext),
    code_hint: hintFor(plaintext),
    label: label ?? null,
    note: note ?? null,
    max_uses: maxUses,
    used_count: 0,
    is_active: true,
    locked_until: null,
    created_at: now(),
    updated_at: now(),
  };
  db.codes.unshift(row);
  return row;
}

function publicCode(row) {
  return {
    id: row.id,
    label: row.label,
    codeHint: row.code_hint,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    remaining: Math.max(0, row.max_uses - row.used_count),
    isActive: row.is_active,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 校验会话凭证；返回会话或 null（调用方自行决定报哪个错）。 */
async function authSession(sessionId, accessToken) {
  const session = db.sessions.get(sessionId);
  if (!session) return null;
  if (!timingSafeEqualHex(session.access_token_hash, await sha256Hex(accessToken))) return null;
  return session;
}

function startPayload(session) {
  return {
    sessionId: session.id,
    accessToken: session.access_token_plain,
    totalQuestions: QUESTIONS.length,
    scoringVersion: SCORING_VERSION,
    usedCount: session.used_count,
    maxUses: session.max_uses,
    remaining: Math.max(0, session.max_uses - session.used_count),
    startedAt: session.started_at,
  };
}

/** 原子性地占用一次额度并建会话（mock 版无并发，但逻辑与 SQL 函数一致）。 */
async function startSession(codeRow, requestId) {
  const replay = db.byRequestId.get(requestId);
  if (replay) {
    const session = db.sessions.get(replay);
    // 幂等重放必须属于本次提交的密码，否则知道他人 request_id 的人可以用
    // 自己的有效密码拿到他人会话。与 SQL 函数保持一致。
    if (!session || session.code_id !== codeRow.id) throw fail('invalid_code', '密码不正确');
    return session;
  }

  if (!codeRow.is_active) throw fail('inactive_code', '该密码已被停用');
  if (codeRow.used_count >= codeRow.max_uses) throw fail('exhausted', '该密码的测评次数已经用完了');

  codeRow.used_count += 1;
  codeRow.updated_at = now();

  const accessToken = generateToken(32);
  const session = {
    id: uuid(),
    code_id: codeRow.id,
    access_token_plain: accessToken,
    access_token_hash: await sha256Hex(accessToken),
    status: 'in_progress',
    used_count: codeRow.used_count,
    max_uses: codeRow.max_uses,
    started_at: now(),
  };
  db.sessions.set(session.id, session);
  db.byRequestId.set(requestId, session.id);
  return session;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireAdmin(req) {
  const token = req.headers['x-access-token'];
  if (typeof token !== 'string') return null;
  const session = db.adminSessions.get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.adminSessions.delete(token);
    return null;
  }
  return session;
}

const routes = {
  'start-test': async (req, body) => {
    const parsed = startTestSchema.safeParse(body);
    if (!parsed.success) throw fail('bad_request', '请求参数不合法');
    const { code, requestId } = parsed.data;

    const normalized = normalizeCode(code);
    const row = db.codes.find((c) => c.code === normalized);
    if (!row) throw fail('invalid_code', '密码不正确');
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      throw fail('rate_limited', '该密码尝试失败次数过多，请稍后再试');
    }
    if (!(await verifyPassword(normalized, row.password_hash))) {
      row.failed_attempts = (row.failed_attempts ?? 0) + 1;
      if (row.failed_attempts >= 8) {
        row.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        row.failed_attempts = 0;
        throw fail('rate_limited', '尝试失败次数过多，该密码已临时锁定 15 分钟');
      }
      throw fail('invalid_code', '密码不正确');
    }
    row.failed_attempts = 0;

    return startPayload(await startSession(row, requestId));
  },

  'submit-test': async (req, body) => {
    const parsed = submitTestSchema.safeParse(body);
    if (!parsed.success) throw fail('invalid_answers', '答案不完整或格式不正确，请检查是否有题目未作答');
    const { sessionId, accessToken, answers } = parsed.data;

    if (!answersAreLegal(answers)) throw fail('invalid_answers', '答案中包含无效的题目或选项');

    const session = await authSession(sessionId, accessToken);
    if (!session) throw fail('unauthorized', '会话凭证无效，请重新输入密码');

    // Results are immutable: a repeat submission returns the STORED result,
    // exactly like public.finalize_submission. Answers in the second request
    // are ignored, not re-scored.
    const existing = db.results.get(sessionId);
    if (session.status === 'submitted' && existing) {
      return {
        result: resultPayload(existing, sessionId),
        usedCount: session.used_count,
        maxUses: session.max_uses,
        remaining: Math.max(0, session.max_uses - session.used_count),
      };
    }

    let report;
    try {
      report = buildReport(answers, SCORING_VERSION);
    } catch (error) {
      if (error instanceof ScoringError) throw fail('invalid_answers', error.message);
      throw fail('server_error', '评分失败，请稍后再试');
    }

    session.status = 'submitted';
    const result = {
      id: uuid(),
      session_id: sessionId,
      scoring_version: report.scoringVersion,
      report,
      created_at: now(),
    };
    db.results.set(sessionId, result);
    return { result: resultPayload(result, sessionId), usedCount: session.used_count, maxUses: session.max_uses, remaining: Math.max(0, session.max_uses - session.used_count) };
  },

  retake: async (req, body) => {
    const parsed = z
      .object({ sessionId: z.string().uuid(), accessToken: z.string().min(20).max(200), requestId: z.string().uuid() })
      .safeParse(body);
    if (!parsed.success) throw fail('bad_request', '请求参数不合法');
    const { sessionId, accessToken, requestId } = parsed.data;

    const session = await authSession(sessionId, accessToken);
    if (!session) throw fail('unauthorized', '会话凭证无效，请重新输入密码');
    const codeRow = db.codes.find((c) => c.id === session.code_id);
    if (!codeRow) throw fail('not_found', '密码不存在');

    return startPayload(await startSession(codeRow, requestId));
  },

  'get-result': async (req, body) => {
    const parsed = sessionAuthSchema.safeParse(body);
    if (!parsed.success) throw fail('bad_request', '请求参数不合法');
    const { sessionId, accessToken } = parsed.data;

    const result = db.results.get(sessionId);
    if (!result) throw fail('not_found', '还没有生成结果');
    if (!(await authSession(sessionId, accessToken))) throw fail('unauthorized', '会话凭证无效');

    return resultPayload(result, sessionId);
  },

  'create-share': async (req, body) => {
    const parsed = sessionAuthSchema.safeParse(body);
    if (!parsed.success) throw fail('bad_request', '请求参数不合法');
    const { sessionId, accessToken } = parsed.data;

    if (!(await authSession(sessionId, accessToken))) throw fail('unauthorized', '会话凭证无效');
    const result = db.results.get(sessionId);
    if (!result) throw fail('not_found', '还没有生成结果');

    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    db.shares.set(await sha256Hex(token), {
      result_id: result.id,
      session_id: sessionId,
      expires_at: expiresAt,
      revoked_at: null,
    });
    return { token, expiresAt };
  },

  'shared-result': async (req, body) => {
    const parsed = z.object({ token: z.string().min(20).max(200) }).safeParse(body);
    if (!parsed.success) throw fail('bad_request', '分享链接无效');

    const share = db.shares.get(await sha256Hex(parsed.data.token));
    if (!share) throw fail('not_found', '分享链接无效或已被撤销');
    if (share.revoked_at || new Date(share.expires_at).getTime() < Date.now()) {
      throw fail('not_found', '分享链接无效或已被撤销');
    }
    const result = db.results.get(share.session_id);
    if (!result) throw fail('not_found', '分享链接无效或已被撤销');

    return sharedPayload(result);
  },

  'admin-login': async (req, body) => {
    const parsed = adminLoginSchema.safeParse(body);
    if (!parsed.success) throw fail('bad_request', '请求参数不合法');

    const admin = db.admins.find((a) => a.username === parsed.data.username && a.is_active);
    if (!admin || !(await verifyPassword(parsed.data.password, admin.password_hash))) {
      throw fail('unauthorized', '用户名或密码不正确');
    }

    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    db.adminSessions.set(token, { admin_id: admin.id, expires_at: expiresAt });
    return { token, username: admin.username, expiresAt };
  },

  'admin-list-codes': async (req) => {
    requireAdminOrThrow(req);
    return { codes: db.codes.map(publicCode) };
  },

  'admin-create-code': async (req, body) => {
    requireAdminOrThrow(req);
    const parsed = z
      .object({
        label: z.string().trim().max(80).optional(),
        note: z.string().trim().max(200).optional(),
        maxUses: z.number().int().min(1).max(100).default(3),
        code: z.string().trim().min(8).max(64).optional(),
      })
      .safeParse(body);
    if (!parsed.success) throw fail('bad_request', '请求参数不合法');

    const plaintext = parsed.data.code ?? generateCode(12);
    if (db.codes.some((c) => c.code === normalizeCode(plaintext))) {
      throw fail('bad_request', '这个密码已经存在了');
    }
    const row = await insertCode({ ...parsed.data, code: plaintext });
    return { code: publicCode(row), plaintext };
  },

  'admin-update-code': async (req, body) => {
    requireAdminOrThrow(req);
    const parsed = z
      .object({
        id: z.string().uuid(),
        isActive: z.boolean().optional(),
        maxUses: z.number().int().min(1).max(100).optional(),
        note: z.string().trim().max(200).optional(),
        revokeShares: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) throw fail('bad_request', '请求参数不合法');
    const { id, isActive, maxUses, note, revokeShares } = parsed.data;

    const row = db.codes.find((c) => c.id === id);
    if (!row) throw fail('not_found', '密码不存在');

    const nextMax = maxUses ?? row.max_uses;
    if (nextMax < row.used_count) throw fail('bad_request', `次数不能低于已使用的 ${row.used_count} 次`);

    if (isActive !== undefined) row.is_active = isActive;
    if (maxUses !== undefined) row.max_uses = maxUses;
    if (note !== undefined) row.note = note;
    row.updated_at = now();

    if (revokeShares) {
      const sessionIds = new Set(
        [...db.sessions.values()].filter((s) => s.code_id === id).map((s) => s.id),
      );
      for (const [key, share] of db.shares) {
        if (sessionIds.has(share.session_id)) db.shares.delete(key);
      }
    }

    return { code: publicCode(row) };
  },

  'admin-stats': async (req) => {
    requireAdminOrThrow(req);
    const liveShares = [...db.shares.values()].filter(
      (s) => !s.revoked_at && new Date(s.expires_at).getTime() > Date.now(),
    ).length;
    return {
      stats: {
        totalCodes: db.codes.length,
        activeCodes: db.codes.filter((c) => c.is_active).length,
        totalSessions: db.sessions.size,
        completedSessions: [...db.sessions.values()].filter((s) => s.status === 'submitted').length,
        totalResults: db.results.size,
        liveShares,
      },
    };
  },
};

function requireAdminOrThrow(req) {
  if (!requireAdmin(req)) throw fail('unauthorized', '管理员会话已失效，请重新登录');
}

function resultPayload(result, sessionId) {
  return {
    id: result.id,
    sessionId,
    scoringVersion: result.scoring_version,
    report: result.report,
    createdAt: result.created_at,
  };
}

/** 公开分享接口不返回任何内部 id，与 shared-result Edge Function 保持一致。 */
function sharedPayload(result) {
  return {
    scoringVersion: result.scoring_version,
    report: result.report,
    createdAt: result.created_at,
  };
}

const server = createServer((req, res) => {
  const send = (status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
    res.end(body);
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const name = (req.url ?? '').replace(/^\/functions\/v1\//, '').replace(/\/$/, '');
  const handler = routes[name];

  if (req.method !== 'POST' || !handler) {
    send(404, { error: { code: 'not_found', message: '未找到该接口' } });
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', async () => {
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      send(400, { error: { code: 'bad_request', message: '请求体不是合法 JSON' } });
      return;
    }
    try {
      send(200, await handler(req, body));
    } catch (error) {
      const code = error?.code in ERROR_STATUS ? error.code : 'server_error';
      const message = code === 'server_error' ? '服务暂时不可用，请稍后再试' : error.message;
      if (code === 'server_error') console.error('[mock]', error);
      send(ERROR_STATUS[code], { error: { code, message } });
    }
  });
});

await insertCode({ code: 'LOCAL-TEST-2026', label: '本地预览', note: 'mock 服务内置，额度 3', maxUses: 3 });
db.admins.push({
  id: uuid(),
  username: 'admin',
  password_hash: await hashPassword('admin-local-dev-2026'),
  is_active: true,
});

server.listen(PORT, () => {
  console.log(`[mock] Edge Functions 已启动: http://localhost:${PORT}/functions/v1/<name>`);
  console.log('[mock] 测试密码: LOCAL-TEST-2026  (额度 3)');
  console.log('[mock] 管理员:   admin / admin-local-dev-2026');
});