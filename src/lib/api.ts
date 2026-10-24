import { isSupabaseConfigured, functionsBaseUrl } from './env';

/**
 * Thin, typed client for the Supabase Edge Functions.
 * Every call is anonymous; the only credential is the per-session access token
 * issued by `start-test`. There is no privileged key in the browser bundle.
 */

export type ApiErrorCode =
  | 'network'
  | 'timeout'
  | 'not_configured'
  | 'invalid_code'
  | 'inactive_code'
  | 'exhausted'
  | 'rate_limited'
  | 'unauthorized'
  | 'not_found'
  | 'invalid_answers'
  | 'already_completed'
  | 'server_error'
  | 'bad_request';

const CODE_TO_STATUS: Record<string, number> = {
  invalid_code: 401,
  inactive_code: 403,
  exhausted: 402,
  rate_limited: 429,
  unauthorized: 401,
  not_found: 404,
  invalid_answers: 422,
  bad_request: 400,
  already_completed: 409,
  not_configured: 500,
  server_error: 500,
  network: 0,
  timeout: 0,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface StartTestResponse {
  sessionId: string;
  accessToken: string;
  totalQuestions: number;
  scoringVersion: string;
  usedCount: number;
  maxUses: number;
  remaining: number;
  startedAt: string;
}

export interface ResultPayload {
  id: string;
  sessionId: string;
  scoringVersion: string;
  report: import('../../shared/types').Report;
  createdAt: string;
}

/**
 * Public share contract. The Edge Function deliberately returns no result id
 * and no session id — only what the report page needs to render.
 */
export interface SharedResultPayload {
  scoringVersion: string;
  report: import('../../shared/types').Report;
  createdAt: string;
}

export interface SubmitTestResponse {
  result: ResultPayload;
  usedCount: number;
  maxUses: number;
  remaining: number;
}

export interface ShareResponse {
  token: string;
  url: string;
  expiresAt: string | null;
}

export interface AdminLoginResponse {
  token: string;
  username: string;
  expiresAt: string;
}

export interface AdminCodeRow {
  id: string;
  label: string | null;
  codeHint: string;
  usedCount: number;
  maxUses: number;
  remaining: number;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminStats {
  totalCodes: number;
  activeCodes: number;
  totalSessions: number;
  completedSessions: number;
  totalResults: number;
  liveShares: number;
}

const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(
  functionName: string,
  options: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown; token?: string } = {
    method: 'POST',
  },
): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new ApiError(
      'not_configured',
      '后端尚未配置：请在部署环境中设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_PUBLISHABLE_KEY。',
      0,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Edge Functions are deployed with `--no-verify-jwt`; the gateway still
    // expects the project publishable key, which is a public value.
    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''}`,
  };
  if (options.token) headers['x-access-token'] = options.token;

  try {
    const response = await fetch(`${functionsBaseUrl()}/${functionName}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: { code: 'server_error', message: '服务返回了无法解析的内容' } };
      }
    }

    if (!response.ok) {
      const err = (payload as { error?: { code?: string; message?: string } } | null)?.error;
      const code = (err?.code ?? 'server_error') as ApiErrorCode;
      const retryAfterHeader = response.headers.get('Retry-After');
      throw new ApiError(
        code in CODE_TO_STATUS ? code : 'server_error',
        err?.message ?? `请求失败（${response.status}）`,
        response.status,
        retryAfterHeader ? Number(retryAfterHeader) : undefined,
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('timeout', '请求超时，请检查网络后重试', 0);
    }
    throw new ApiError('network', '网络连接失败，请检查网络后重试', 0);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  startTest(body: { code: string; requestId: string }) {
    return request<StartTestResponse>('start-test', { method: 'POST', body });
  },
  submitTest(body: {
    sessionId: string;
    accessToken: string;
    answers: { questionId: string; optionId: string }[];
    scoringVersion?: string;
  }) {
    return request<SubmitTestResponse>('submit-test', { method: 'POST', body });
  },
  retake(body: { sessionId: string; accessToken: string; requestId: string }) {
    return request<StartTestResponse>('retake', { method: 'POST', body });
  },
  getResult(body: { sessionId: string; accessToken: string }) {
    return request<ResultPayload>('get-result', { method: 'POST', body });
  },
  createShare(body: { sessionId: string; accessToken: string }) {
    return request<ShareResponse>('create-share', { method: 'POST', body });
  },
  sharedResult(token: string) {
    return request<SharedResultPayload>('shared-result', {
      method: 'POST',
      body: { token },
    });
  },
  adminLogin(body: { username: string; password: string }) {
    return request<AdminLoginResponse>('admin-login', { method: 'POST', body });
  },
  adminListCodes(token: string) {
    return request<{ codes: AdminCodeRow[] }>('admin-list-codes', { method: 'POST', token });
  },
  adminCreateCode(
    token: string,
    body: { label?: string; maxUses: number; note?: string; code?: string },
  ) {
    return request<{ code: AdminCodeRow; plaintext: string }>('admin-create-code', {
      method: 'POST',
      token,
      body,
    });
  },
  adminUpdateCode(
    token: string,
    body: {
      id: string;
      isActive?: boolean;
      maxUses?: number;
      note?: string;
      revokeShares?: boolean;
    },
  ) {
    return request<{ code: AdminCodeRow }>('admin-update-code', { method: 'POST', token, body });
  },
  adminStats(token: string) {
    return request<{ stats: AdminStats }>('admin-stats', { method: 'POST', token });
  },
};