-- =============================================================================
-- 0001_core.sql
-- 人生选择指南 · 基础表结构、索引、约束
-- 幂等：可重复执行（全部使用 IF NOT EXISTS）
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- test_codes：测试密码凭证 + 额度
--   code_hash     = HMAC-SHA256(CODE_LOOKUP_KEY, 规范化密码)  —— 仅用于索引查询
--   password_hash = PBKDF2-SHA256(明文, 随机盐, 210k 轮)      —— 用于真正校验
-- 两把钥匙都只在 Edge Function 环境里，永不存储在数据库中。
-- 任何一列都不包含密码明文。
-- -----------------------------------------------------------------------------
create table if not exists public.test_codes (
  id            uuid primary key default gen_random_uuid(),
  code_hash     text        not null,
  password_hash text        not null,
  -- 仅用于让管理员在列表中辨认，不参与校验
  code_hint     text        not null,
  label         text,
  note          text,
  max_uses      integer     not null default 3 check (max_uses between 1 and 100),
  used_count    integer     not null default 0 check (used_count >= 0),
  is_active     boolean     not null default true,
  failed_attempts integer   not null default 0,
  locked_until  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint test_codes_used_within_max check (used_count <= max_uses)
);

create unique index if not exists test_codes_code_hash_key
  on public.test_codes (code_hash);
create index if not exists test_codes_active_idx
  on public.test_codes (is_active) where is_active;

-- -----------------------------------------------------------------------------
-- test_sessions：每一轮测评
-- -----------------------------------------------------------------------------
create table if not exists public.test_sessions (
  id                uuid primary key default gen_random_uuid(),
  test_code_id      uuid not null references public.test_codes(id) on delete restrict,
  -- session 凭证（access token）的哈希，明文只在创建时返回一次
  access_token_hash text not null,
  -- 幂等键：同一 requestId 的重复请求返回同一个 session，不重复扣次数
  request_id        uuid not null,
  status            text not null default 'in_progress'
                      check (status in ('in_progress','submitted','abandoned')),
  scoring_version   text not null default 'v1',
  question_count    integer not null default 24 check (question_count between 1 and 200),
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint test_sessions_completed_has_time
    check ((status = 'submitted') = (completed_at is not null))
);

create unique index if not exists test_sessions_request_id_key
  on public.test_sessions (request_id);
create index if not exists test_sessions_code_idx
  on public.test_sessions (test_code_id, created_at desc);
create index if not exists test_sessions_token_idx
  on public.test_sessions (access_token_hash);

-- -----------------------------------------------------------------------------
-- test_answers：每一轮答题明细（永不通过公开接口返回）
-- -----------------------------------------------------------------------------
create table if not exists public.test_answers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.test_sessions(id) on delete cascade,
  question_id text not null,
  option_id   text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists test_answers_session_question_key
  on public.test_answers (session_id, question_id);
create index if not exists test_answers_session_idx on public.test_answers (session_id);

-- -----------------------------------------------------------------------------
-- test_results：评分结果（服务端计算）
-- -----------------------------------------------------------------------------
create table if not exists public.test_results (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null unique references public.test_sessions(id) on delete cascade,
  scoring_version  text not null,
  archetype_id     text not null,
  secondary_archetype_id text not null,
  dimension_scores jsonb not null,
  report           jsonb not null,
  created_at       timestamptz not null default now(),
  constraint test_results_scores_object check (jsonb_typeof(dimension_scores) = 'object')
);

create index if not exists test_results_created_idx
  on public.test_results (created_at desc);

-- -----------------------------------------------------------------------------
-- share_links：公开分享链接
-- 数据库只保存 token 的 SHA-256，明文只在创建时返回一次
-- -----------------------------------------------------------------------------
create table if not exists public.share_links (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null,
  result_id   uuid not null references public.test_results(id) on delete cascade,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists share_links_token_hash_key on public.share_links (token_hash);
create index if not exists share_links_result_idx on public.share_links (result_id);
create index if not exists share_links_live_idx
  on public.share_links (token_hash) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- admin_users / admin_sessions：服务端管理员鉴权
-- -----------------------------------------------------------------------------
create table if not exists public.admin_users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  password_hash text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists admin_users_username_key on public.admin_users (username);

create table if not exists public.admin_sessions (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid not null references public.admin_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists admin_sessions_token_hash_key on public.admin_sessions (token_hash);
create index if not exists admin_sessions_expiry_idx on public.admin_sessions (expires_at);

-- -----------------------------------------------------------------------------
-- 审计日志：记录失败尝试与关键操作，不记录任何密码明文
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  event      text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);