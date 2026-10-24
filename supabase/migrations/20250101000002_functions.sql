-- =============================================================================
-- 0002_functions.sql
-- 事务化的额度扣减、会话创建、结果写入 —— 全部为 SECURITY DEFINER，
-- 只授予 service_role 执行。匿名用户无法直接调用。
-- =============================================================================

-- 原子扣减 + 创建会话。
-- 关键点：
--   1. SELECT ... FOR UPDATE 对 test_codes 行加锁，串行化并发请求
--   2. request_id 幂等：同一 requestId 直接返回既有 session，不扣次数
--   3. used_count >= max_uses 时抛出额度耗尽错误
create or replace function public.start_test_session(
  p_code_hash       text,
  p_access_token_hash text,
  p_request_id      uuid,
  p_scoring_version text default 'v1',
  p_question_count  integer default 24
)
returns table (
  session_id     uuid,
  test_code_id   uuid,
  used_count     integer,
  max_uses       integer,
  started_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code      public.test_codes%rowtype;
  v_existing  public.test_sessions%rowtype;
  v_session   uuid;
  v_now       timestamptz := now();
begin
  -- 幂等：先看这个 request_id 是否已经创建过会话
  select * into v_existing
  from public.test_sessions
  where request_id = p_request_id;

  if found then
    select * into v_code from public.test_codes where id = v_existing.test_code_id;
    return query
      select v_existing.id, v_existing.test_code_id,
             v_code.used_count, v_code.max_uses, v_existing.started_at;
    return;
  end if;

  -- 行锁：并发请求在这里排队，保证额度不会被突破
  select * into v_code
  from public.test_codes
  where code_hash = p_code_hash
  for update;

  if not found then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  if not v_code.is_active then
    raise exception 'inactive_code' using errcode = 'P0001';
  end if;

  if v_code.locked_until is not null and v_code.locked_until > v_now then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if v_code.used_count >= v_code.max_uses then
    raise exception 'exhausted' using errcode = 'P0001';
  end if;

  -- 扣减额度
  update public.test_codes
     set used_count = used_count + 1,
         updated_at = v_now,
         failed_attempts = 0,
         locked_until = null
   where id = v_code.id
  returning * into v_code;

  insert into public.test_sessions (
    test_code_id, access_token_hash, request_id, scoring_version, question_count
  )
  values (
    v_code.id, p_access_token_hash, p_request_id, p_scoring_version, p_question_count
  )
  returning id, started_at into v_session, v_now;

  return query select v_session, v_code.id, v_code.used_count, v_code.max_uses, v_now;
end;
$$;

-- 记录一次密码失败尝试，超过阈值则临时锁定（数据库级防暴力猜测）
create or replace function public.register_failed_attempt(
  p_code_hash text,
  p_threshold  integer default 8,
  p_lock_minutes integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.test_codes%rowtype;
begin
  update public.test_codes
     set failed_attempts = failed_attempts + 1,
         updated_at = now(),
         locked_until = case
           when failed_attempts + 1 >= p_threshold then now() + make_interval(mins => p_lock_minutes)
           else locked_until
         end
   where code_hash = p_code_hash
  returning * into v_row;

  if not found then
    return false;
  end if;
  return v_row.locked_until is not null and v_row.locked_until > now();
end;
$$;

-- 保存一次提交：整轮答案覆盖写入 + 写入结果，session 标记为 submitted
create or replace function public.finalize_submission(
  p_session_id uuid,
  p_access_token_hash text,
  p_scoring_version text,
  p_archetype_id text,
  p_secondary_archetype_id text,
  p_dimension_scores jsonb,
  p_report jsonb,
  p_answers jsonb
)
returns table (
  result_id uuid,
  created_at timestamptz,
  used_count integer,
  max_uses integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session  public.test_sessions%rowtype;
  v_code     public.test_codes%rowtype;
  v_result   uuid;
  v_created  timestamptz;
  v_answer   jsonb;
begin
  select * into v_session
  from public.test_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_session.access_token_hash <> p_access_token_hash then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  -- 幂等：已提交则直接返回既有结果
  if v_session.status = 'submitted' then
    select id, created_at into v_result, v_created
    from public.test_results where session_id = p_session_id;
    select * into v_code from public.test_codes where id = v_session.test_code_id;
    return query select v_result, v_created, v_code.used_count, v_code.max_uses;
    return;
  end if;

  if jsonb_array_length(p_answers) <> v_session.question_count then
    raise exception 'invalid_answers' using errcode = 'P0001';
  end if;

  delete from public.test_answers where session_id = p_session_id;

  for v_answer in select * from jsonb_array_elements(p_answers)
  loop
    insert into public.test_answers (session_id, question_id, option_id)
    values (p_session_id, v_answer->>'questionId', v_answer->>'optionId')
    on conflict (session_id, question_id)
      do update set option_id = excluded.option_id, updated_at = now();
  end loop;

  insert into public.test_results (
    session_id, scoring_version, archetype_id, secondary_archetype_id,
    dimension_scores, report
  )
  values (
    p_session_id, p_scoring_version, p_archetype_id, p_secondary_archetype_id,
    p_dimension_scores, p_report
  )
  returning id, created_at into v_result, v_created;

  update public.test_sessions
     set status = 'submitted', completed_at = now()
   where id = p_session_id;

  select * into v_code from public.test_codes where id = v_session.test_code_id;

  return query select v_result, v_created, v_code.used_count, v_code.max_uses;
end;
$$;

-- 校验会话凭证，返回会话与密码行（只读，不扣额度）
create or replace function public.get_session_context(p_session_id uuid, p_access_token_hash text)
returns table (
  session_id uuid,
  test_code_id uuid,
  status text,
  started_at timestamptz,
  used_count integer,
  max_uses integer,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select s.id, s.test_code_id, s.status, s.started_at,
           c.used_count, c.max_uses, c.is_active
    from public.test_sessions s
    join public.test_codes c on c.id = s.test_code_id
    where s.id = p_session_id
      and s.access_token_hash = p_access_token_hash;
end;
$$;

-- 分享令牌查结果（只暴露渲染报告所需字段，永不返回答案/密码）
create or replace function public.get_shared_result(p_token_hash text)
returns table (
  result_id uuid,
  session_id uuid,
  scoring_version text,
  archetype_id text,
  report jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select r.id, r.session_id, r.scoring_version, r.archetype_id, r.report, r.created_at
    from public.share_links sl
    join public.test_results r on r.id = sl.result_id
    where sl.token_hash = p_token_hash
      and sl.revoked_at is null
      and (sl.expires_at is null or sl.expires_at > now());
end;
$$;

-- 撤销某个结果的所有分享链接
create or replace function public.revoke_shares_for_result(p_result_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.share_links
     set revoked_at = now()
   where result_id = p_result_id and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists test_codes_touch on public.test_codes;
create trigger test_codes_touch before update on public.test_codes
  for each row execute function public.touch_updated_at();

drop trigger if exists test_sessions_touch on public.test_sessions;
create trigger test_sessions_touch before update on public.test_sessions
  for each row execute function public.touch_updated_at();

drop trigger if exists admin_users_touch on public.admin_users;
create trigger admin_users_touch before update on public.admin_users
  for each row execute function public.touch_updated_at();

-- 追加式审计日志
create or replace function public.write_audit(p_event text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (event, detail) values (p_event, p_detail);
$$;