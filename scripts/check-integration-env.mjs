#!/usr/bin/env node
/**
 * Preflight for the real-backend integration suite.
 *
 * Exit codes:
 *   0  environment is complete and safe (or skipping was explicitly allowed)
 *   1  environment is partially configured / unsafe / legacy two-code mode
 *   2  nothing configured (suite would be skipped)
 *
 * This script never makes a network request and never prints credential
 * values. `npm run test:integration` runs it automatically via pretest.
 */

const REQUIRED_CODES = { A: 6, B: 3, C: 3 };
const START_CALLS = { A: 10, B: 11, C: 11 };
const RETAKE_CALLS = { A: 0, B: 3, C: 0 };

const TRACKED = [
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
];

const read = (name) => {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const allowSkip = read('ALLOW_INTEGRATION_SKIP') === '1';
const configured = TRACKED.some((name) => read(name) !== null);

if (!configured) {
  if (allowSkip) {
    console.warn(
      'INTEGRATION SKIPPED: no SUPABASE_TEST_* variables are set (ALLOW_INTEGRATION_SKIP=1).',
    );
    process.exit(0);
  }
  console.error(
    'INTEGRATION SKIPPED: no SUPABASE_TEST_* variables are set. ' +
      'See README "真实后端集成测试". To skip intentionally, run ' +
      '`ALLOW_INTEGRATION_SKIP=1 npm run test:integration`.',
  );
  process.exit(2);
}

const url = read('SUPABASE_TEST_URL');
const key = read('SUPABASE_TEST_KEY');
const target = read('SUPABASE_TEST_ENV');
const projectRefRaw = read('SUPABASE_TEST_PROJECT_REF');
const projectRef = projectRefRaw === null ? null : projectRefRaw.toLowerCase();
const allowedRaw = read('SUPABASE_TEST_ALLOWED_PROJECT_REFS');
const allowedRefs =
  allowedRaw === null
    ? []
    : allowedRaw.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
const batch = read('SUPABASE_TEST_BATCH');
const adminUser = read('SUPABASE_TEST_ADMIN_USERNAME');
const adminPass = read('SUPABASE_TEST_ADMIN_PASSWORD');
const poolRaw = read('SUPABASE_TEST_CODE_POOL');
const legacyCode = read('SUPABASE_TEST_CODE');
const legacyCode2 = read('SUPABASE_TEST_CODE_2');

if (legacyCode !== null || legacyCode2 !== null) {
  if (adminUser === null && adminPass === null && poolRaw === null) {
    console.error(
      'LEGACY TWO-CODE MODE IS NOT SUPPORTED: SUPABASE_TEST_CODE/_2 cannot run the ' +
        'full suite. Batch A needs 6 fresh codes, batch B 3, batch C 3. ' +
        'Use admin provisioning or SUPABASE_TEST_CODE_POOL.',
    );
    process.exit(1);
  }
  console.warn(
    'INTEGRATION NOTE: SUPABASE_TEST_CODE/_2 are ignored; this suite provisions its own codes.',
  );
}

const missing = [];
if (url === null) missing.push('SUPABASE_TEST_URL');
if (key === null) missing.push('SUPABASE_TEST_KEY');
if (target === null) missing.push('SUPABASE_TEST_ENV');
if (projectRef === null) missing.push('SUPABASE_TEST_PROJECT_REF');
if (allowedRaw === null) missing.push('SUPABASE_TEST_ALLOWED_PROJECT_REFS');
if (batch === null) missing.push('SUPABASE_TEST_BATCH');
else if (!(batch in REQUIRED_CODES)) {
  missing.push('SUPABASE_TEST_BATCH (must be A, B or C; one batch per run)');
}

const hasAdmin = adminUser !== null && adminPass !== null;
const pool = poolRaw === null ? [] : poolRaw.split(',').map((part) => part.trim()).filter(Boolean);
if (!hasAdmin && pool.length === 0) {
  if (adminUser !== null) missing.push('SUPABASE_TEST_ADMIN_PASSWORD');
  else if (adminPass !== null) missing.push('SUPABASE_TEST_ADMIN_USERNAME');
  else missing.push('SUPABASE_TEST_ADMIN_USERNAME/PASSWORD or SUPABASE_TEST_CODE_POOL');
}

if (missing.length > 0) {
  console.error(`INTEGRATION ENV INCOMPLETE: missing ${missing.join(', ')}`);
  process.exit(1);
}

if (target !== 'staging') {
  console.error(
    'INTEGRATION REFUSED: SUPABASE_TEST_ENV must be exactly "staging". ' +
      'No network request may be made until the target is confirmed as a staging project.',
  );
  process.exit(1);
}

const REF_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

let refFromUrl = null;
try {
  const parsed = new URL(url);
  const strict =
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.port === '' &&
    (parsed.pathname === '' || parsed.pathname === '/') &&
    parsed.search === '' &&
    parsed.hash === '' &&
    parsed.hostname.endsWith('.supabase.co');
  if (strict) {
    const ref = parsed.hostname.slice(0, -'.supabase.co'.length);
    if (REF_PATTERN.test(ref)) refFromUrl = ref;
  }
} catch {
  refFromUrl = null;
}
if (refFromUrl === null) {
  console.error(
    'INTEGRATION REFUSED: SUPABASE_TEST_URL must be exactly https://<project-ref>.supabase.co ' +
      '(no port, path, query, fragment or userinfo).',
  );
  process.exit(1);
}
if (projectRef === null || projectRef !== refFromUrl) {
  console.error(
    'INTEGRATION REFUSED: SUPABASE_TEST_PROJECT_REF does not match the URL host. ' +
      'Confirm the target project before running any network request.',
  );
  process.exit(1);
}
if (allowedRefs.length === 0) {
  console.error(
    'INTEGRATION REFUSED: SUPABASE_TEST_ALLOWED_PROJECT_REFS is empty. ' +
      'List the staging project ref(s) explicitly.',
  );
  process.exit(1);
}
if (allowedRefs.some((ref) => !REF_PATTERN.test(ref))) {
  console.error(
    'INTEGRATION REFUSED: SUPABASE_TEST_ALLOWED_PROJECT_REFS contains an invalid project ref.',
  );
  process.exit(1);
}
if (!allowedRefs.includes(projectRef)) {
  console.error(
    'INTEGRATION REFUSED: SUPABASE_TEST_PROJECT_REF is not in ' +
      'SUPABASE_TEST_ALLOWED_PROJECT_REFS. A manual staging declaration alone is not ' +
      'accepted; add the confirmed staging ref to the allowlist.',
  );
  process.exit(1);
}

function keyIssue(value) {
  if (value.startsWith('sb_secret_') || value.startsWith('sbp_')) {
    return 'high-privilege key';
  }
  if (value.startsWith('sb_publishable_')) {
    return value.length > 'sb_publishable_'.length ? null : 'empty publishable key';
  }
  if (value.startsWith('eyJ')) {
    const parts = value.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      return 'malformed JWT';
    }
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!payload || typeof payload !== 'object' || !('role' in payload)) {
        return 'JWT without a role claim';
      }
      if (payload.role === 'service_role') return 'service_role JWT';
      if (payload.role !== 'anon') return 'JWT with a non-anon role';
      return null;
    } catch {
      return 'unreadable JWT';
    }
  }
  return 'not a publishable key or anon JWT';
}

const keyProblem = keyIssue(key);
if (keyProblem !== null) {
  console.error(
    `INTEGRATION REFUSED: SUPABASE_TEST_KEY is not an allowed public key (${keyProblem}). ` +
      'Use exactly the publishable key (sb_publishable_...) or a legacy anon-role JWT; ' +
      'unknown formats and high-privilege keys are refused.',
  );
  process.exit(1);
}

if (!(batch in REQUIRED_CODES)) {
  // Defensive: the earlier check should already have exited.
  console.error('INTEGRATION REFUSED: SUPABASE_TEST_BATCH must be A, B or C.');
  process.exit(1);
}

if (poolRaw !== null && !hasAdmin) {
  if (new Set(pool).size !== pool.length) {
    console.error('INTEGRATION REFUSED: SUPABASE_TEST_CODE_POOL contains duplicate codes.');
    process.exit(1);
  }
  if (pool.length < REQUIRED_CODES[batch]) {
    console.error(
      `INTEGRATION REFUSED: batch ${batch} needs ${REQUIRED_CODES[batch]} fresh codes, ` +
        `but SUPABASE_TEST_CODE_POOL contains ${pool.length}.`,
    );
    process.exit(1);
  }
}

const mode = hasAdmin ? 'admin' : 'pool';
console.log(
  `INTEGRATION ENV OK: batch ${batch}, ${mode} mode, ` +
    `${REQUIRED_CODES[batch]} fresh codes required.`,
);
console.log(
  `Batch ${batch} budget: start-test ${START_CALLS[batch]}/12, ` +
    `retake ${RETAKE_CALLS[batch]}/10. Wait at least 10 minutes between batches.`,
);
