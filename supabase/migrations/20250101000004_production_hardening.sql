-- =============================================================================
-- 0004_production_hardening.sql
-- 生产加固：修复真实缺陷 + 收紧公开接口字段
--
-- 幂等：可重复执行
--
-- 修复清单
--   F1. test_sessions_touch 触发器引用了 test_sessions 上不存在的 updated_at
--       列。任何 UPDATE test_sessions 都会抛
--       `record "new" has no field "updated_at"`，导致 finalize_submission
--       （正常提交的唯一路径）100% 失败。
--   F2. finalize_submission 幂等分支：若 test_results 无对应行，return query
--       会跳过 NULL 行并返回 0 行，Edge Function 得到 server_error。
--       改为显式抛 not_found。
--   F3. start_test_session 幂等分支：命中 request_id 时若 test_codes 行缺失
--       （管理员改密/删码），v_code.used_count 为 NULL，被当成 0 返回，
--       前端显示的剩余额度会错。改为显式抛 invalid_code。
--   F4. get_shared_result 之前返回 session_id，按「只返回明确允许公开的字段」
--       要求剔除。注意：PostgreSQL 不允许 CREATE OR REPLACE 修改返回列定义，
--       因此必须先 DROP FUNCTION 再重建（执行权限在同一文件末尾重新授予）。
--   F5. get_shared_result 增加 report 的字段白名单投影，防止未来评分逻辑
--       变更时把内部字段误带进公开接口。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- F1. 移除坏触发器（test_sessions 没有 updated_at 列）
-- -----------------------------------------------------------------------------
drop trigger if exists test_sessions_touch on public.test_sessions;

-- -----------------------------------------------------------------------------
-- F2. finalize_submission：幂等分支必须拿到结果行，否则明确报错
-- -----------------------------------------------------------------------------
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

  -- 幂等：已提交则直接返回既有结果。
  -- 标记为 submitted 必然伴随一条 test_results（同一事务内写入），
  -- 因此查不到即说明数据被外部破坏，必须报错而不是静默返回 0 行。
  if v_session.status = 'submitted' then
    select r.id, r.created_at into v_result, v_created
    from public.test_results r
    where r.session_id = p_session_id;

    if v_result is null then
      raise exception 'not_found' using errcode = 'P0001';
    end if;

    select * into v_code from public.test_codes where id = v_session.test_code_id;
    return query
      select v_result, v_created,
             coalesce(v_code.used_count, 0), coalesce(v_code.max_uses, 0);
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

  return query
    select v_result, v_created,
           coalesce(v_code.used_count, 0), coalesce(v_code.max_uses, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- F3. start_test_session：幂等分支的额度字段不能是 NULL
-- -----------------------------------------------------------------------------
create or replace function public.start_test_session(
  p_code_hash         text,
  p_access_token_hash text,
  p_request_id        uuid,
  p_scoring_version   text default 'v1',
  p_question_count    integer default 24
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

    -- 会话存在但密码行已不在：不能返回 NULL 额度，否则前端会把剩余次数
    -- 显示成 0 而误导用户。以 invalid_code 明确失败。
    if v_code.id is null then
      raise exception 'invalid_code' using errcode = 'P0001';
    end if;

    -- 幂等重放必须属于本次提交的密码。否则，知道他人 request_id 的人可以
    -- 用自己的有效密码拿到他人会话 id，以及由 request_id 派生的会话 token。
    -- 使用 IS DISTINCT FROM 以防御 NULL 入参。
    if v_code.code_hash is distinct from p_code_hash then
      raise exception 'invalid_code' using errcode = 'P0001';
    end if;

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

-- -----------------------------------------------------------------------------
-- F4 + F5. get_shared_result：字段白名单
--
-- 公开接口只允许返回渲染报告所需的字段。明确排除：
--   session_id / access_token_hash / request_id / 密码 / 原始答案 / 管理字段
--
-- report 采用显式白名单投影：即使未来 buildReport 新增字段，也必须在这里
-- 显式添加才会进入公开接口，默认拒绝。
--
-- 注意：0002 中的旧函数返回 6 列，本迁移改为 5 列。PostgreSQL 的
-- CREATE OR REPLACE FUNCTION 不允许修改既有函数的返回列定义，所以必须先
-- DROP FUNCTION；随后在本文件末尾重新授予 service_role 执行权限。
-- -----------------------------------------------------------------------------

-- 公开报告的字段白名单：只透出渲染长图与报告所需的键。
-- 新增键必须同时更新 shared/types.ts、本函数与 shared/publicReport.test.ts。
create or replace function public.public_report(p_report jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(entry.key, entry.value),
    '{}'::jsonb
  )
  from jsonb_each(
    case
      when jsonb_typeof(p_report) = 'object' then p_report
      else '{}'::jsonb
    end
  ) as entry(key, value)
  where entry.key = any (array[
    'scoringVersion',
    'archetypeId',
    'archetypeName',
    'archetypeGlyph',
    'palette',
    'tagline',
    'oneLiner',
    'secondaryArchetypeId',
    'secondaryArchetypeName',
    'scores',
    'strongest',
    'weakest',
    'spread',
    'balanced',
    'coreTraits',
    'strengths',
    'blindSpots',
    'career',
    'workEnvironment',
    'communication',
    'relationship',
    'growth',
    'dimensionNotes',
    'headline',
    'keywords'
  ]);
$$;

-- 返回列定义变化：必须先 DROP，不能直接 CREATE OR REPLACE。
drop function if exists public.get_shared_result(text);

create or replace function public.get_shared_result(p_token_hash text)
returns table (
  result_id uuid,
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
    select
      r.id,
      r.scoring_version,
      r.archetype_id,
      public.public_report(r.report),
      r.created_at
    from public.share_links sl
    join public.test_results r on r.id = sl.result_id
    where sl.token_hash = p_token_hash
      and sl.revoked_at is null
      and (sl.expires_at is null or sl.expires_at > now());
end;
$$;

-- -----------------------------------------------------------------------------
-- 重新授予执行权限（0003 已 revoke，这里按 0004 的新签名重建）
-- -----------------------------------------------------------------------------
revoke all on function public.start_test_session(text, text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finalize_submission(uuid, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.get_shared_result(text) from public, anon, authenticated;
revoke all on function public.public_report(jsonb) from public, anon, authenticated;

grant execute on function public.start_test_session(text, text, uuid, text, integer) to service_role;
grant execute on function public.finalize_submission(uuid, text, text, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.get_shared_result(text) to service_role;
grant execute on function public.public_report(jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 兜底：确认匿名角色仍然对这些函数零权限
-- -----------------------------------------------------------------------------
revoke all on function public.start_test_session(text, text, uuid, text, integer) from anon, authenticated;
revoke all on function public.finalize_submission(uuid, text, text, text, text, jsonb, jsonb, jsonb) from anon, authenticated;
revoke all on function public.get_shared_result(text) from anon, authenticated;
revoke all on function public.public_report(jsonb) from anon, authenticated;