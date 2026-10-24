/**
 * Shared plumbing for the REAL Supabase integration suite.
 *
 * Rules enforced here (see README / docs/SECURITY.md):
 * - No network request is made until the manifest explicitly confirms a
 *   `staging` target. `assertStagingTarget` runs before every fetch.
 * - A manual `SUPABASE_TEST_ENV=staging` declaration cannot prove the target
 *   is not production. The project ref must also be on the explicit
 *   `SUPABASE_TEST_ALLOWED_PROJECT_REFS` allowlist.
 * - Only an `sb_publishable_…` key or a legacy anon-role JWT is accepted;
 *   service_role JWT / sb_secret_… / sbp_… / unknown formats are refused.
 * - Codes are provisioned per scenario, so one scenario can never silently
 *   consume another scenario's quota.
 * - Every call is counted. The suite asserts the per-batch budget at runtime,
 *   not just in a static table.
 * - Error messages never contain codes, passwords, tokens or key material.
 */

export type Batch = 'A' | 'B' | 'C';
export type IntegrationMode = 'admin' | 'pool';

export interface IntegrationManifest {
  /** True when any SUPABASE_TEST_* variable is present. */
  any: boolean;
  /** True only when every required variable is present and safe. */
  complete: boolean;
  missing: string[];
  legacyOnly: boolean;
  url: string | null;
  key: string | null;
  env: string | null;
  projectRef: string | null;
  allowedProjectRefs: string[];
  batch: Batch | null;
  mode: IntegrationMode | null;
  adminUsername: string | null;
  adminPassword: string | null;
  pool: string[];
  keyIssue: string | null;
  urlIssue: string | null;
  targetIssue: string | null;
  allowlistIssue: string | null;
  poolIssue: string | null;
}

export interface CallResult<T> {
  status: number;
  data: T | null;
  error: { code: string; message: string } | null;
}

export interface StartResponse {
  sessionId: string;
  accessToken: string;
  remaining: number;
  usedCount: number;
  maxUses: number;
  totalQuestions: number;
  startedAt: string;
}

export interface TableProbe {
  ok: boolean;
  status: number;
  rows: unknown[] | null;
}

export interface IntegrationClient {
  readonly manifest: IntegrationManifest;
  readonly calls: CallCounter;
  call<T>(
    fn: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<CallResult<T>>;
  probeTable(table: string): Promise<TableProbe>;
  loginAdmin(): Promise<string>;
  createCode(
    adminToken: string,
    label: string,
    maxUses: number,
  ): Promise<{ plaintext: string; id: string }>;
  start(code: string, requestId?: string): Promise<CallResult<StartResponse>>;
  retake(session: StartResponse, requestId: string): Promise<CallResult<StartResponse>>;
}

export interface PoolAllocator {
  next(scenario: string): string;
  readonly size: number;
  readonly used: number;
}

export interface ProvisionedCode {
  code: string;
  /** Null in pool mode: without an admin token a pool code has no known id. */
  id: string | null;
}

export interface Provisioner {
  (scenario: string, maxUses: number): Promise<string>;
  /** Admin mode returns the code id so admin-only assertions (revocation) work. */
  withId(scenario: string, maxUses: number): Promise<ProvisionedCode>;
  /** Cached admin token; throws in pool mode. Never logs or returns the password. */
  adminToken(): Promise<string>;
}

export interface ScenarioPlan {
  batch: Batch;
  startCalls: number;
  retakeCalls: number;
  codes: Array<{ maxUses: number; maxCredits: number }>;
}

export interface BatchPlan {
  startCalls: number;
  retakeCalls: number;
  codeCount: number;
  maxCredits: number;
}

/**
 * Server-side in-memory limits:
 * - start-test: 12 / 10 min per IP
 * - retake: 10 / 5 min per IP
 * - admin-login: 8 / 15 min per IP (one login per batch in admin mode)
 */
export const BATCH_LIMITS = {
  'start-test': 12,
  retake: 10,
  'admin-login': 8,
} as const;

const TRACKED_VARIABLES = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_KEY',
  'SUPABASE_TEST_ENV',
  'SUPABASE_TEST_PROJECT_REF',
  'SUPABASE_TEST_ALLOWED_PROJECT_REFS',
  'SUPABASE_TEST_BATCH',
  'SUPABASE_TEST_CODE',
  'SUPABASE_TEST_CODE_2',
  'SUPABASE_TEST_CODE_POOL',
  'SUPABASE_TEST_ADMIN_USERNAME',
  'SUPABASE_TEST_ADMIN_PASSWORD',
] as const;

const BATCHES: readonly Batch[] = ['A', 'B', 'C'];

function read(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isBatch(value: string): value is Batch {
  return (BATCHES as readonly string[]).includes(value);
}

const PROJECT_REF_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PUBLISHABLE_PREFIX = 'sb_publishable_';

/**
 * Returns the project ref only for exactly `https://<ref>.supabase.co`.
 * Ports, paths, queries, fragments and userinfo are refused: they would make
 * the host comparison ambiguous and could point the suite somewhere else.
 */
export function projectRefFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.port !== '') return null;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
  if (parsed.search !== '' || parsed.hash !== '') return null;
  const suffix = '.supabase.co';
  if (!parsed.hostname.endsWith(suffix)) return null;
  const ref = parsed.hostname.slice(0, -suffix.length);
  return PROJECT_REF_PATTERN.test(ref) ? ref : null;
}

function decodeJwtPayload(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
}

/**
 * Allowlist by shape, not by blocklist:
 * - `sb_publishable_…` (non-empty suffix) is the only accepted new-style key.
 * - A legacy JWT is accepted only when its payload says `role: "anon"`.
 * Everything else — `sb_secret_…`, `sbp_…`, service_role/unknown roles,
 * malformed or unreadable JWTs, arbitrary strings — is refused.
 * The reason intentionally contains no part of the key.
 */
export function inspectTestKey(key: string): string | null {
  if (key.startsWith('sb_secret_') || key.startsWith('sbp_')) {
    return 'high-privilege key is not allowed in integration tests';
  }
  if (key.startsWith(PUBLISHABLE_PREFIX)) {
    return key.length > PUBLISHABLE_PREFIX.length ? null : 'publishable key is empty';
  }
  if (key.startsWith('eyJ')) {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      return 'malformed JWT';
    }
    let payload: unknown;
    try {
      payload = decodeJwtPayload(parts[1]);
    } catch {
      return 'unreadable JWT';
    }
    if (payload === null || typeof payload !== 'object' || !('role' in payload)) {
      return 'JWT has no role claim';
    }
    const role = (payload as { role?: unknown }).role;
    if (role === 'service_role') {
      return 'service_role JWT is not allowed in integration tests';
    }
    if (role !== 'anon') return 'only anon-role JWTs are allowed in integration tests';
    return null;
  }
  return 'SUPABASE_TEST_KEY must be a publishable key (sb_publishable_...) or an anon-role JWT';
}

export function readIntegrationEnv(
  env: Record<string, string | undefined>,
): IntegrationManifest {
  const url = read(env, 'SUPABASE_TEST_URL');
  const key = read(env, 'SUPABASE_TEST_KEY');
  const targetEnv = read(env, 'SUPABASE_TEST_ENV');
  const projectRefRaw = read(env, 'SUPABASE_TEST_PROJECT_REF');
  const projectRef = projectRefRaw === null ? null : projectRefRaw.toLowerCase();
  const allowedRaw = read(env, 'SUPABASE_TEST_ALLOWED_PROJECT_REFS');
  const allowedProjectRefs =
    allowedRaw === null
      ? []
      : allowedRaw
          .split(',')
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean);
  const batchRaw = read(env, 'SUPABASE_TEST_BATCH');
  const adminUsername = read(env, 'SUPABASE_TEST_ADMIN_USERNAME');
  const adminPassword = read(env, 'SUPABASE_TEST_ADMIN_PASSWORD');
  const poolRaw = read(env, 'SUPABASE_TEST_CODE_POOL');
  const legacyCode = read(env, 'SUPABASE_TEST_CODE');
  const legacyCode2 = read(env, 'SUPABASE_TEST_CODE_2');

  const any = TRACKED_VARIABLES.some((name) => read(env, name) !== null);
  const batch: Batch | null = batchRaw !== null && isBatch(batchRaw) ? batchRaw : null;
  const pool = poolRaw === null ? [] : poolRaw.split(',').map((part) => part.trim()).filter(Boolean);

  const missing: string[] = [];
  if (url === null) missing.push('SUPABASE_TEST_URL');
  if (key === null) missing.push('SUPABASE_TEST_KEY');
  if (targetEnv === null) missing.push('SUPABASE_TEST_ENV');
  if (projectRef === null) missing.push('SUPABASE_TEST_PROJECT_REF');
  if (allowedRaw === null) missing.push('SUPABASE_TEST_ALLOWED_PROJECT_REFS');
  if (batchRaw === null) missing.push('SUPABASE_TEST_BATCH');
  else if (batch === null) missing.push('SUPABASE_TEST_BATCH (must be A, B or C)');

  const hasAdmin = adminUsername !== null && adminPassword !== null;
  const mode: IntegrationMode | null = hasAdmin ? 'admin' : poolRaw !== null ? 'pool' : null;
  if (mode === null) {
    if (adminUsername !== null) missing.push('SUPABASE_TEST_ADMIN_PASSWORD');
    else if (adminPassword !== null) missing.push('SUPABASE_TEST_ADMIN_USERNAME');
    else missing.push('SUPABASE_TEST_ADMIN_USERNAME/PASSWORD or SUPABASE_TEST_CODE_POOL');
  }

  const targetIssue =
    targetEnv !== null && targetEnv !== 'staging'
      ? 'SUPABASE_TEST_ENV must be "staging" (explicit target confirmation)'
      : null;

  let urlIssue: string | null = null;
  if (url !== null) {
    const refFromUrl = projectRefFromUrl(url);
    if (refFromUrl === null) {
      urlIssue = 'SUPABASE_TEST_URL must be https://<project-ref>.supabase.co';
    } else if (projectRef !== null && projectRef !== refFromUrl) {
      urlIssue = 'SUPABASE_TEST_PROJECT_REF does not match the URL host';
    }
  }

  let allowlistIssue: string | null = null;
  if (allowedRaw !== null) {
    if (allowedProjectRefs.length === 0) {
      allowlistIssue = 'SUPABASE_TEST_ALLOWED_PROJECT_REFS contains no project refs';
    } else if (allowedProjectRefs.some((ref) => !PROJECT_REF_PATTERN.test(ref))) {
      allowlistIssue = 'SUPABASE_TEST_ALLOWED_PROJECT_REFS contains an invalid project ref';
    } else if (projectRef !== null && !allowedProjectRefs.includes(projectRef)) {
      allowlistIssue = 'SUPABASE_TEST_PROJECT_REF is not in SUPABASE_TEST_ALLOWED_PROJECT_REFS';
    }
  }

  const keyIssue = key === null ? null : inspectTestKey(key);
  const poolIssue =
    poolRaw !== null && pool.length === 0 ? 'SUPABASE_TEST_CODE_POOL contains no codes' : null;

  const legacyOnly =
    (legacyCode !== null || legacyCode2 !== null) &&
    adminUsername === null &&
    adminPassword === null &&
    poolRaw === null;

  const complete =
    missing.length === 0 &&
    targetIssue === null &&
    urlIssue === null &&
    keyIssue === null &&
    allowlistIssue === null &&
    poolIssue === null;

  return {
    any,
    complete,
    missing,
    legacyOnly,
    url,
    key,
    env: targetEnv,
    projectRef,
    allowedProjectRefs,
    batch,
    mode,
    adminUsername,
    adminPassword,
    pool,
    keyIssue,
    urlIssue,
    targetIssue,
    allowlistIssue,
    poolIssue,
  };
}

/**
 * Must run before every fetch. Refuses anything not explicitly staging.
 *
 * `SUPABASE_TEST_ENV=staging` is a manual declaration: it cannot by itself
 * prove the target is not production. The explicit project-ref allowlist is
 * the machine-checkable guard; the declaration only adds intent.
 */
export function assertStagingTarget(manifest: IntegrationManifest): void {
  if (!manifest.complete) {
    const issues = [...manifest.missing];
    if (manifest.targetIssue !== null) issues.push(manifest.targetIssue);
    if (manifest.urlIssue !== null) issues.push(manifest.urlIssue);
    if (manifest.keyIssue !== null) issues.push(manifest.keyIssue);
    if (manifest.allowlistIssue !== null) issues.push(manifest.allowlistIssue);
    if (manifest.poolIssue !== null) issues.push(manifest.poolIssue);
    throw new Error(`[integration] refusing to run: ${issues.join('; ')}`);
  }
  if (manifest.env !== 'staging') {
    throw new Error('[integration] refusing to run: target is not confirmed as staging');
  }
}

/** Per-function call counter, used to verify the real batch budget. */
export class CallCounter {
  private counts = new Map<string, number>();

  record(fn: string): void {
    this.counts.set(fn, (this.counts.get(fn) ?? 0) + 1);
  }

  get(fn: string): number {
    return this.counts.get(fn) ?? 0;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  assertWithin(limits: Record<string, number>): void {
    const exceeded = Object.entries(limits).filter(([fn, limit]) => this.get(fn) > limit);
    if (exceeded.length === 0) return;
    const detail = exceeded
      .map(([fn, limit]) => `${fn}=${this.get(fn)} > ${limit}`)
      .join(', ');
    throw new Error(
      `[integration] real call budget exceeded (${detail}). ` +
        'The server rate-limits per IP; wait for the window to reset and use fresh codes.',
    );
  }
}

function parseError(parsed: unknown): { code: string; message: string } | null {
  if (parsed === null || typeof parsed !== 'object' || !('error' in parsed)) return null;
  const raw = (parsed as { error?: unknown }).error;
  if (raw === null || typeof raw !== 'object' || !('code' in raw)) return null;
  const code = (raw as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  const message = (raw as { message?: unknown }).message;
  return { code, message: typeof message === 'string' ? message : '' };
}

export function createIntegrationClient(
  manifest: IntegrationManifest,
  fetchImpl?: typeof fetch,
): IntegrationClient {
  const doFetch: typeof fetch =
    fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const calls = new CallCounter();

  function baseUrl(): string {
    assertStagingTarget(manifest);
    if (manifest.url === null) throw new Error('[integration] missing URL');
    return manifest.url.replace(/\/$/, '');
  }

  function apiKey(): string {
    assertStagingTarget(manifest);
    if (manifest.key === null) throw new Error('[integration] missing key');
    return manifest.key;
  }

  async function call<T>(
    fn: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<CallResult<T>> {
    const root = baseUrl();
    const key = apiKey();
    // Count before the request so a network failure still reveals the budget.
    calls.record(fn);

    const response = await doFetch(`${root}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new Error(
        `[integration] ${fn} returned 429 (rate limited` +
          `${retryAfter === null ? '' : `, retry after ${retryAfter}s`}). ` +
          'Stop and wait for the rate-limit window before rerunning this batch.',
      );
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }
    return {
      status: response.status,
      data: parsed as T | null,
      error: parseError(parsed),
    };
  }

  async function probeTable(table: string): Promise<TableProbe> {
    const root = baseUrl();
    const key = apiKey();
    calls.record(`rest:${table}`);
    const response = await doFetch(`${root}/rest/v1/${table}?select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (response.ok) {
      const rows = (await response.json()) as unknown[];
      return { ok: true, status: response.status, rows };
    }
    return { ok: false, status: response.status, rows: null };
  }

  async function loginAdmin(): Promise<string> {
    if (
      manifest.mode !== 'admin' ||
      manifest.adminUsername === null ||
      manifest.adminPassword === null
    ) {
      throw new Error('[integration] admin provisioning is not configured');
    }
    const res = await call<{ token: string }>('admin-login', {
      username: manifest.adminUsername,
      password: manifest.adminPassword,
    });
    if (res.status !== 200 || typeof res.data?.token !== 'string') {
      throw new Error(
        `[integration] admin-login failed (status ${res.status}` +
          `${res.error === null ? '' : `, ${res.error.code}`})`,
      );
    }
    return res.data.token;
  }

  async function createCode(
    adminToken: string,
    label: string,
    maxUses: number,
  ): Promise<{ plaintext: string; id: string }> {
    const res = await call<{ plaintext: string; code?: { id?: unknown } }>(
      'admin-create-code',
      { label, maxUses },
      { 'x-access-token': adminToken },
    );
    const id = res.data?.code?.id;
    if (
      res.status !== 200 ||
      typeof res.data?.plaintext !== 'string' ||
      typeof id !== 'string'
    ) {
      throw new Error(
        `[integration] admin-create-code failed (status ${res.status}` +
          `${res.error === null ? '' : `, ${res.error.code}`})`,
      );
    }
    return { plaintext: res.data.plaintext, id };
  }

  function start(code: string, requestId?: string): Promise<CallResult<StartResponse>> {
    return call<StartResponse>('start-test', {
      code,
      requestId: requestId ?? crypto.randomUUID(),
    });
  }

  function retake(
    session: StartResponse,
    requestId: string,
  ): Promise<CallResult<StartResponse>> {
    return call<StartResponse>('retake', {
      sessionId: session.sessionId,
      accessToken: session.accessToken,
      requestId,
    });
  }

  return {
    manifest,
    calls,
    call,
    probeTable,
    loginAdmin,
    createCode,
    start,
    retake,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asserts that a scenario got a truly fresh code and a well-formed session.
 * A used code would make the quota assertions meaningless, so this is a hard
 * failure, never a skip. Failure messages never include sessionId or token.
 */
export function freshSession(
  result: CallResult<StartResponse>,
  scenario: string,
): StartResponse {
  if (result.status !== 200 || result.data === null) {
    throw new Error(
      `[integration] ${scenario}: expected a fresh session (status ${result.status}` +
        `${result.error === null ? '' : `, ${result.error.code}`}). ` +
        'Provision a new code for this batch.',
    );
  }
  const session = result.data;
  if (session.usedCount !== 1) {
    throw new Error(
      `[integration] ${scenario}: code is not fresh (usedCount=${session.usedCount}). ` +
        'Provision a new code for this batch.',
    );
  }

  const problems: string[] = [];
  if (!UUID_PATTERN.test(session.sessionId)) problems.push('sessionId is not a UUID');
  if (typeof session.accessToken !== 'string' || session.accessToken.length < 32) {
    problems.push('accessToken is missing or too short');
  }
  if (!Number.isInteger(session.maxUses) || session.maxUses < 1) {
    problems.push('maxUses is not a positive integer');
  }
  if (!Number.isInteger(session.totalQuestions) || session.totalQuestions < 1) {
    problems.push('totalQuestions is not a positive integer');
  }
  if (session.remaining !== session.maxUses - session.usedCount) {
    problems.push('remaining is not maxUses - usedCount');
  }
  if (
    typeof session.startedAt !== 'string' ||
    Number.isNaN(Date.parse(session.startedAt))
  ) {
    problems.push('startedAt is not a parseable timestamp');
  }
  if (problems.length > 0) {
    throw new Error(
      `[integration] ${scenario}: malformed session payload: ${problems.join('; ')}. ` +
        'Values are intentionally not printed.',
    );
  }
  return session;
}

export function createPoolAllocator(pool: string[]): PoolAllocator {
  let index = 0;
  return {
    next(scenario: string): string {
      if (index >= pool.length) {
        throw new Error(
          `[integration] code pool exhausted before scenario "${scenario}". ` +
            'Provide one fresh code per scenario.',
        );
      }
      const code = pool[index];
      index += 1;
      return code;
    },
    get size(): number {
      return pool.length;
    },
    get used(): number {
      return index;
    },
  };
}

/** Admin mode logs in once per run; pool mode consumes codes in order. */
export function createProvisioner(
  client: IntegrationClient,
  manifest: IntegrationManifest,
): Provisioner {
  let cachedToken: string | null = null;
  const pool = manifest.mode === 'pool' ? createPoolAllocator(manifest.pool) : null;

  async function adminToken(): Promise<string> {
    if (manifest.mode !== 'admin') {
      throw new Error('[integration] an admin token is unavailable in pool mode');
    }
    if (cachedToken === null) cachedToken = await client.loginAdmin();
    return cachedToken;
  }

  const withId = async (
    scenario: string,
    maxUses: number,
  ): Promise<ProvisionedCode> => {
    if (manifest.mode === 'admin') {
      const token = await adminToken();
      const created = await client.createCode(
        token,
        `${scenario}-${Date.now()}`,
        maxUses,
      );
      return { code: created.plaintext, id: created.id };
    }
    if (pool === null) {
      throw new Error('[integration] no code provisioning mode configured');
    }
    // Pool mode has no admin token, so the code id is unknown to the suite.
    return { code: pool.next(scenario), id: null };
  };

  const provision = (async (scenario: string, maxUses: number): Promise<string> => {
    return (await withId(scenario, maxUses)).code;
  }) as Provisioner;
  provision.withId = withId;
  provision.adminToken = adminToken;
  return provision;
}

/** Fails on every 5xx; 5xx is never evidence of a successful outcome. */
export function assertNo5xx(results: CallResult<unknown>[], scenario: string): void {
  const statuses = [...new Set(results.filter((r) => r.status >= 500).map((r) => r.status))];
  if (statuses.length === 0) return;
  throw new Error(
    `[integration] ${scenario}: ${statuses.length} distinct 5xx status(es) ` +
      `(${statuses.join(', ')}). Server errors are never treated as success.`,
  );
}

/** Asserts every response has an allowed status; messages never include bodies. */
export function assertStatuses(
  results: CallResult<unknown>[],
  allowed: number[],
  scenario: string,
): void {
  const unexpected = results.filter((r) => !allowed.includes(r.status));
  if (unexpected.length === 0) return;
  const detail = unexpected
    .map((r) => `status ${r.status}${r.error === null ? '' : ` (${r.error.code})`}`)
    .join(', ');
  throw new Error(`[integration] ${scenario}: unexpected response(s): ${detail}`);
}

/**
 * Declared per-scenario call/credit plan. Unit tests verify these numbers stay
 * inside the server limits; the integration run additionally checks the REAL
 * counts in `afterAll` through `CallCounter`.
 */
export const SCENARIO_PLAN: Record<string, ScenarioPlan> = {
  access: {
    batch: 'A',
    startCalls: 4,
    retakeCalls: 0,
    codes: [{ maxUses: 3, maxCredits: 2 }],
  },
  crossCode: {
    batch: 'A',
    startCalls: 3,
    retakeCalls: 0,
    codes: [
      { maxUses: 3, maxCredits: 1 },
      { maxUses: 3, maxCredits: 1 },
    ],
  },
  submission: {
    batch: 'A',
    startCalls: 1,
    retakeCalls: 0,
    codes: [{ maxUses: 1, maxCredits: 1 }],
  },
  result: {
    batch: 'A',
    startCalls: 1,
    retakeCalls: 0,
    codes: [{ maxUses: 1, maxCredits: 1 }],
  },
  share: {
    batch: 'A',
    startCalls: 1,
    retakeCalls: 0,
    codes: [{ maxUses: 1, maxCredits: 1 }],
  },
  rlsAdmin: {
    batch: 'A',
    startCalls: 0,
    retakeCalls: 0,
    codes: [],
  },
  quotaConcurrency: {
    batch: 'B',
    startCalls: 9,
    retakeCalls: 0,
    codes: [{ maxUses: 3, maxCredits: 3 }],
  },
  retakeExhausted: {
    batch: 'B',
    startCalls: 1,
    retakeCalls: 1,
    codes: [{ maxUses: 1, maxCredits: 1 }],
  },
  retakeIdempotent: {
    batch: 'B',
    startCalls: 1,
    retakeCalls: 2,
    codes: [{ maxUses: 3, maxCredits: 2 }],
  },
  requestIdRace: {
    batch: 'C',
    // 7 concurrent retries + 1 follow-up proving exactly one credit was used.
    startCalls: 8,
    retakeCalls: 0,
    codes: [{ maxUses: 3, maxCredits: 2 }],
  },
  crossCodeRace: {
    batch: 'C',
    // 2 racing starts + 1 follow-up proving the losing code was not charged.
    startCalls: 3,
    retakeCalls: 0,
    codes: [
      { maxUses: 1, maxCredits: 1 },
      { maxUses: 1, maxCredits: 1 },
    ],
  },
};

export function batchPlan(batch: Batch): BatchPlan {
  const scenarios = Object.values(SCENARIO_PLAN).filter((plan) => plan.batch === batch);
  return {
    startCalls: scenarios.reduce((total, plan) => total + plan.startCalls, 0),
    retakeCalls: scenarios.reduce((total, plan) => total + plan.retakeCalls, 0),
    codeCount: scenarios.reduce((total, plan) => total + plan.codes.length, 0),
    maxCredits: scenarios.reduce(
      (total, plan) =>
        total + plan.codes.reduce((sum, code) => sum + code.maxCredits, 0),
      0,
    ),
  };
}

export function assertBatchBudget(batch: Batch): BatchPlan {
  const plan = batchPlan(batch);
  if (plan.startCalls > BATCH_LIMITS['start-test']) {
    throw new Error(
      `[integration] batch ${batch} plans ${plan.startCalls} start-test calls, ` +
        `above the ${BATCH_LIMITS['start-test']}/10min limit`,
    );
  }
  if (plan.retakeCalls > BATCH_LIMITS.retake) {
    throw new Error(
      `[integration] batch ${batch} plans ${plan.retakeCalls} retake calls, ` +
        `above the ${BATCH_LIMITS.retake}/5min limit`,
    );
  }
  return plan;
}
