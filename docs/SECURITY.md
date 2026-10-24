# 安全检查清单

上线前逐项确认。带 ☐ 的项目需要在真实环境里人工验证。

## 密钥与配置

- ☐ 仓库里没有任何 `.env`（只有 `.env.example`）
- ☐ 只对发布产物做密钥扫描：`grep -R "service_role\|sb_secret_\|sbp_" dist/` 无结果
  - 若使用 legacy anon key，`eyJ...` 会合法出现在产物中；需人工确认只有部署配置的
    那一个 JWT，不能简单要求 `eyJ` 零出现。
  - 不要用仓库级 `grep src/ shared/` 作为判据：测试夹具里刻意包含这些前缀字符串，
    会产生假阳性；源码安全性靠类型检查、单元测试与代码审查保证。
- ☐ GitHub Actions Variables 里只有 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_BASE_PATH`
- ☐ `CODE_LOOKUP_KEY` / `SESSION_TOKEN_KEY` 只存在于 `supabase secrets`
- ☐ `CODE_LOOKUP_KEY` 与 `SESSION_TOKEN_KEY` 不同，且都 ≥ 32 字节随机值
- ☐ Supabase 控制台 → API → 已按最小权限配置

## RLS 与数据访问

- ☐ 用 publishable key 直接 `GET /rest/v1/test_codes` 返回空或 401/403
- ☐ 同上验证 `test_sessions` / `test_answers` / `test_results` / `share_links` / `admin_users` / `admin_sessions` / `audit_log`
- ☐ 用 publishable key 无法调用任何 `SECURITY DEFINER` 函数（应报权限错误）
- ☐ 数据库里不存在面向 `anon` / `authenticated` 的策略

## 密码与凭证

- ☐ `test_codes` 中 `code_hash` 与 `password_hash` 都以 `pbkdf2-sha256$` / HMAC 十六进制形式存储，无明文
- ☐ 拖库后无法通过 `code_hint` 反推密码
- ☐ `audit_log` 中不包含密码明文
- ☐ 会话 token 只在创建时返回一次，数据库只存 SHA-256

## 额度逻辑

- ☐ 并发请求无法突破 `max_uses`（用 `npm run test:integration` 验证）
- ☐ 同一 `requestId` 重试不重复扣减
- ☐ 已知他人 `requestId`、但用自己的有效密码重放时返回 `invalid_code`，拿不到对方会话
- ☐ 第 4 次创建会话返回 `exhausted`
- ☐ 上一题 / 下一题 / 改答案 / 刷新页面都不影响额度
- ☐ 修改 localStorage 绕不过额度限制
- ☐ 同一 `requestId` 的并发请求不会重复扣次，也不会暴露为 5xx（依赖待评审的 `0005 advisory lock`；**未应用时结果不确定**：唯一索引会让竞争失败的一方回滚，因此不会重复扣次或产生重复会话，但该请求可能收到 5xx；也可能后到请求恰好看到已提交会话而全部 200。一次全绿不构成竞态已修复的证据）
- ☐ 跨密码并发重放恰好一个成功、一个 `invalid_code`，且没有 5xx；失败一方的密码未被扣次

## 集成测试环境（仅预发）

- ☐ `SUPABASE_TEST_ENV=staging`、`SUPABASE_TEST_PROJECT_REF` 与 `SUPABASE_TEST_URL` 主机名一致，且 ref 在 `SUPABASE_TEST_ALLOWED_PROJECT_REFS` 中；确认前不发起任何网络请求
  - `SUPABASE_TEST_ENV=staging` 只是人工声明，不能证明目标不是生产库；允许列表才是机器校验
- ☐ `SUPABASE_TEST_URL` 恰好是 `https://<ref>.supabase.co`（无端口 / 路径 / 查询 / userinfo）
- ☐ `SUPABASE_TEST_KEY` 只能是 `sb_publishable_...` 或 legacy anon-role JWT；拒绝 `service_role`、`sb_secret_...`、`sbp_...`、未知格式
- ☐ 管理员账号只存在于预发项目；密码通过环境变量注入，不写入源码、日志或断言消息
- ☐ 每个场景从独立的全新密码开始；该场景首个 `start-test` 的 `usedCount` 必须为 1。并发与“败方未扣次”跟进用例随后会在同一密码上按设计推进额度
- ☐ 批次 A/B/C 的实测调用量分别不超过 `start-test` 12 次 / 10 分钟、`retake` 10 次 / 5 分钟、`admin-login` 8 次 / 15 分钟（管理员模式每批次只登录 1 次）；批次之间至少间隔 10 分钟
- ☐ 旧的两密码模式（`SUPABASE_TEST_CODE` / `_2`）不再被视为完整回归
- ☐ `npm run test:integration` 无配置时退出码为 2 并显示 `SKIPPED`；部分配置、非 staging 目标或危险密钥退出码为 1

## 分享链接

- ☐ 分享链接 token ≥ 128 位熵（当前为 256 位）
- ☐ 数据库 `share_links` 只存 `token_hash`
- ☐ 公开接口顶层字段**恰好**是 `scoringVersion` / `report` / `createdAt`，不含内部 result id、sessionId、密码、答案或任何管理字段
- ☐ `report` 的键集合精确等于 `buildReport` 产出（由 `shared/publicReport.test.ts` 与真实集成测试双重约束），`public_report()` 使用显式允许列表而非排除黑名单
- ☐ 随机猜测 token 返回 404
- ☐ 撤销后立即失效
  - 集成测试通过 `admin-update-code { revokeShares: true }` 覆盖；该用例需要管理员模式。
    池模式会显示 `SKIPPED` 并打印警告，**不算该项已通过**。
- ☐ 新浏览器 / 新设备（无 localStorage）可直接打开

## 评分可信性

- ☐ 客户端伪造分数无效（前端根本没有提交分数的字段）
- ☐ 非法题目 ID / 非法选项 / 缺题全部被拒
- ☐ 相同答案 + 相同评分版本结果完全一致
- ☐ 首次提交后结果不可变：重复提交返回 HTTP 200 与**已存储的**结果，不会用新答案覆盖；
  集成测试会再次调用 `get-result` 核对已存分数

## 管理端

- ☐ 未登录访问 `/#/admin` 不会发出任何数据请求
- ☐ 无效管理员 token 调用 `admin-*` 返回 401
- ☐ 管理员密码以 PBKDF2 哈希存储
- ☐ 登录连续失败会被限流

## 前端与部署

- ☐ 直接刷新 `/#/s/<token>` 能正常打开（HashRouter，无服务器重写依赖）
- ☐ 项目页 `VITE_BASE_PATH` 与仓库名一致
- ☐ 移动端（375px / 390px）无横向滚动
- ☐ 键盘可完成全部操作，焦点可见
- ☐ `prefers-reduced-motion` 下动画被关闭
- ☐ 长文本、英文长词不会撑破布局
- ☐ 先隔离本地 `.env.local`（它指向 mock 后端），再用**已确认的**生产
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_BASE_PATH`
  执行 `npm run build`；随后 `grep -R "localhost:8787\|127.0.0.1" dist/` 必须无结果。
  未确认这三项之前不得生成可发布产物
- ☐ `dist/` 不含 mock 内置管理员密码或测试密码（`admin-local-dev-2026` / `LOCAL-TEST-2026`）