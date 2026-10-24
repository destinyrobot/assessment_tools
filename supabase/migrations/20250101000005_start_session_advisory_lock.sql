-- =============================================================================
-- 0005_start_session_advisory_lock.sql
-- 并发幂等修复：串行化同一 request_id 的 start_test_session 调用
--
-- 背景
--   0004 的 start_test_session 在读取 test_sessions.request_id 时没有加锁。
--   两个使用同一 request_id 的并发请求都可能先读到「不存在」，随后：
--     - 同一密码：后到者排队拿到 test_codes 行锁、扣次、插入同 request_id，
--       撞 test_sessions_request_id_key 唯一索引，整个事务回滚 → 返回 5xx；
--     - 不同密码：两行互不阻塞，同样撞唯一索引 → 败方回滚（未扣次），
--       但返回 5xx 而不是 invalid_code。
--   两种情况都不会重复扣次或产生重复会话，但违反了「幂等重放不暴露 5xx」
--   的接口契约。
--
-- 修复
--   在读取 test_sessions 之前获取以 request_id 为键的事务级 advisory lock。
--   同一 request_id 的并发事务因此串行化：后到者等待先到者提交后，在
--   READ COMMITTED 下能看到已提交的会话，走既有的幂等重放分支返回 200。
--
-- 为什么要求 READ COMMITTED
--   advisory lock 只负责排队，不能让 REPEATABLE READ / SERIALIZABLE 的旧快照
--   看到先提交的行。若隔离级别更高，后到者醒来后仍会读到「不存在」，继续
--   插入并撞唯一索引。与其在错误隔离级别下静默退化为 5xx，本函数明确报错。
--   该守卫只防止静默运行，不能证明目标环境的实际隔离级别，也不能替代预发
--   并发验收。
--
-- 不变项
--   函数签名、返回列、默认参数、SECURITY DEFINER、search_path、replay 密码
--   校验、额度判断、test_codes 行锁、返回值语义全部与 0004 一致。
--
-- 幂等：可重复执行
-- =============================================================================

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
  -- 隔离级别守卫（fail-closed）。
  -- 本函数的幂等依赖 READ COMMITTED 的语句级快照：获得 advisory lock 后
  -- 的 SELECT 必须能看到先提交者的会话。更高的隔离级别会复用旧快照，
  -- 使后到者继续插入并撞唯一索引，因此明确失败而不是静默退化。
  if lower(current_setting('transaction_isolation')) <> 'read committed' then
    raise exception 'unsupported_isolation_level' using errcode = 'P0001';
  end if;

  -- 串行化同一 request_id 的并发请求。必须在读取 test_sessions 之前获取，
  -- 否则两个事务都可能读到「不存在」。64 位哈希碰撞只会造成额外排队，
  -- 不影响正确性。锁顺序固定为 advisory lock → test_codes 行锁。
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );

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
-- 授权：与 0003 / 0004 保持一致，仅 service_role 可执行。
-- CREATE OR REPLACE 会保留既有 ACL，这里显式重申，避免迁移顺序或手工操作
-- 导致函数回落到默认的 PUBLIC 执行权限。
-- -----------------------------------------------------------------------------
revoke all on function public.start_test_session(text, text, uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.start_test_session(text, text, uuid, text, integer)
  to service_role;

revoke all on function public.start_test_session(text, text, uuid, text, integer)
  from anon, authenticated;
