-- =============================================================================
-- 0003_rls.sql
-- 行列级安全策略
--
-- 设计原则（关键安全检查项）：
--   1. 所有业务表一律启用 RLS。
--   2. 匿名角色（anon / authenticated）没有任何 SELECT / INSERT / UPDATE /
--      DELETE 策略 —— 也就是说匿名用户完全无法读取这些表。
--   3. 所有数据访问都经由 Edge Functions（service_role，会绕过 RLS）。
--   4. SECURITY DEFINER 函数只授予 service_role 执行，撤销 anon/authenticated。
-- =============================================================================

alter table public.test_codes     enable row level security;
alter table public.test_sessions  enable row level security;
alter table public.test_answers   enable row level security;
alter table public.test_results   enable row level security;
alter table public.share_links    enable row level security;
alter table public.admin_users    enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.audit_log      enable row level security;

-- 强制 RLS（连表 owner 之外的普通角色也无法绕过）
alter table public.test_codes     force row level security;
alter table public.test_sessions  force row level security;
alter table public.test_answers   force row level security;
alter table public.test_results   force row level security;
alter table public.share_links    force row level security;
alter table public.admin_users    force row level security;
alter table public.admin_sessions force row level security;
alter table public.audit_log      force row level security;

-- 撤销匿名角色的全部表级权限
revoke all on table public.test_codes     from anon, authenticated;
revoke all on table public.test_sessions  from anon, authenticated;
revoke all on table public.test_answers   from anon, authenticated;
revoke all on table public.test_results   from anon, authenticated;
revoke all on table public.share_links    from anon, authenticated;
revoke all on table public.admin_users    from anon, authenticated;
revoke all on table public.admin_sessions from anon, authenticated;
revoke all on table public.audit_log      from anon, authenticated;

-- 撤销匿名角色对 SECURITY DEFINER 函数的执行权限
revoke all on function public.start_test_session(text, text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.register_failed_attempt(text, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_submission(uuid, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.get_session_context(uuid, text) from public, anon, authenticated;
revoke all on function public.get_shared_result(text) from public, anon, authenticated;
revoke all on function public.revoke_shares_for_result(uuid) from public, anon, authenticated;
revoke all on function public.write_audit(text, jsonb) from public, anon, authenticated;

-- 仅授予 service_role
grant execute on function public.start_test_session(text, text, uuid, text, integer) to service_role;
grant execute on function public.register_failed_attempt(text, integer, integer) to service_role;
grant execute on function public.finalize_submission(uuid, text, text, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.get_session_context(uuid, text) to service_role;
grant execute on function public.get_shared_result(text) to service_role;
grant execute on function public.revoke_shares_for_result(uuid) to service_role;
grant execute on function public.write_audit(text, jsonb) to service_role;

-- service_role 直接读写全部业务表
grant all on table public.test_codes     to service_role;
grant all on table public.test_sessions  to service_role;
grant all on table public.test_answers   to service_role;
grant all on table public.test_results   to service_role;
grant all on table public.share_links    to service_role;
grant all on table public.admin_users    to service_role;
grant all on table public.admin_sessions to service_role;
grant all on table public.audit_log      to service_role;

-- ---------------------------------------------------------------------
-- 显式的「零策略」注释与保险
-- 不创建任何 anon/authenticated 策略 = 匿名访问一律拒绝。
-- 下面这些 revoke 再执行一次，确保迁移可重复。
-- ---------------------------------------------------------------------
revoke all on table public.test_codes     from anon, authenticated;
revoke all on table public.test_sessions  from anon, authenticated;
revoke all on table public.test_answers   from anon, authenticated;
revoke all on table public.test_results   from anon, authenticated;
revoke all on table public.share_links    from anon, authenticated;
revoke all on table public.admin_users    from anon, authenticated;
revoke all on table public.admin_sessions from anon, authenticated;
revoke all on table public.audit_log      from anon, authenticated;