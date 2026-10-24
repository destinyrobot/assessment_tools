/// <reference lib="dom" />

/** Shared HTTP helpers for every Edge Function. */

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-access-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export type ErrorCode =
  | 'invalid_code'
  | 'inactive_code'
  | 'exhausted'
  | 'rate_limited'
  | 'unauthorized'
  | 'not_found'
  | 'invalid_answers'
  | 'already_completed'
  | 'bad_request'
  | 'server_error';

const STATUS: Record<ErrorCode, number> = {
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

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
  });
}

export function ok<T>(body: T) {
  return json(body, 200);
}

export function fail(code: ErrorCode, message: string, retryAfterSeconds?: number) {
  const headers: Record<string, string> = {};
  if (retryAfterSeconds) headers['Retry-After'] = String(retryAfterSeconds);
  return json({ error: { code, message } }, STATUS[code], headers);
}

export function handleOptions(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  return null;
}

/** Reads and JSON-parses the body, tolerating an empty payload. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    throw new ApiProblem('bad_request', '请求体不是合法 JSON');
  }
}

export class ApiProblem extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Wraps a handler so internal errors never leak database details. */
export function withErrorHandling(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const preflight = handleOptions(req);
    if (preflight) return preflight;
    if (req.method !== 'POST') return fail('bad_request', '只接受 POST 请求');
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof ApiProblem) return fail(error.code, error.message);
      if (error instanceof Error) {
        const code = (error.message.match(/^[a-z_]+$/) ? error.message : 'server_error') as ErrorCode;
        if (code in STATUS) return fail(code, code);
      }
      console.error('[edge] unhandled error', error instanceof Error ? error.message : error);
      return fail('server_error', '服务暂时不可用，请稍后再试');
    }
  };
}

/** Best-effort client IP for in-memory rate limiting. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  if (entry.count > limit) return false;
  return true;
}

export function clearRateLimit(key: string): void {
  buckets.delete(key);
}