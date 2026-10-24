# 人生选择指南

> 男怕选错行，女怕嫁错郎。
> 一个可以部署到 GitHub Pages、业务逻辑跑在 Supabase 上的中文付费性格 / 职业测评 MVP。

- **前端**：React + Vite + TypeScript + Tailwind CSS v4 + React Router（HashRouter）+ html-to-image
- **后端**：Supabase PostgreSQL + Edge Functions + RLS + SQL migration
- **部署**：前端 GitHub Actions → GitHub Pages；后端 Supabase
- **评分**：完全在服务端计算，客户端只提交「题目 ID + 选项 ID」

> 本测评为娱乐与自我探索参考，**不具备任何心理诊断、医疗或职业决策效力**。
> 任何地方都不宣称诊断能力，也不使用性别刻板印象作为评分规则。

---

## 目录

- [产品结构](#产品结构)
- [快速开始（本地开发）](#快速开始本地开发)
- [环境变量](#环境变量)
- [Supabase 后端部署](#supabase-后端部署)
- [数据库设计](#数据库设计)
- [安全设计](#安全设计)
- [密码与 3 次额度](#密码与-3-次额度)
- [管理员使用说明](#管理员使用说明)
- [GitHub Pages 部署](#github-pages-部署)
- [测试](#测试)
- [未完成项与外部配置要求](#未完成项与外部配置要求)

---

## 产品结构

```
共享域名 / 路径
   │
   ├─ #/                 入口 + 密码验证
   ├─ #/intro            测评介绍
   ├─ #/quiz              逐题答题（一次一题，可返回修改）
   ├─ #/result/:sessionId 结果报告（需本机会话凭证）
   ├─ #/s/:token          公开分享结果页（跨设备、无需密码）
   ├─ #/admin             管理员后台
   └─ 其他               404 页
```

使用 **HashRouter** 是刻意的：GitHub Pages 只托管静态文件、没有任何重写规则，
所有深层链接必须落在 URL fragment 里，这样分享链接在任何浏览器、任何设备、
未来很久以后都能打开。

### 目录结构

```
shared/                     前后端共用的唯一真相源（纯 TS，无依赖）
  types.ts                  领域类型
  dimensions.ts             8 个维度定义 + 评分版本
  questions.ts              24 道题 + 选项权重
  archetypes.ts             8 种性格原型 + 全部报告文案
  scoring.ts                确定性评分引擎 + 报告生成
  schemas.ts                Zod 入参校验（前后端一致）
  password.ts               PBKDF2 密码哈希
  crypto.ts                 CSPRNG token、SHA-256、恒定时间比较

src/                        前端
  config/                   品牌与文案配置
  lib/                      API 客户端、存储、分享 URL、剪贴板
  components/               设计系统 + 结果报告 + 长图导出
  pages/                    各页面
  test/                     流程测试、校验测试、后端集成测试

supabase/
  migrations/               版本化 SQL（表、函数、RLS）
  functions/                Edge Functions（Deno）
  functions/_shared/        由 `npm run sync:shared` 从 shared/ 自动生成

tests/e2e/                  Playwright 端到端测试
scripts/                    sync-shared、hash-password
docs/                       安全检查清单、上线前验证清单
```

---

## 快速开始（本地开发）

```bash
npm install
cp .env.example .env.local     # 填入 Supabase 地址和 publishable key
npm run dev                    # http://localhost:5173
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地开发服务器 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript 全量类型检查 |
| `npm run test` | 单元 + 流程测试（Vitest） |
| `npm run test:integration` | 对着真实 Supabase 项目的集成测试（见下） |
| `npm run build` | 类型检查 + 静态构建到 `dist/` |
| `npm run preview` | 预览生产构建 |
| `npm run test:e2e` | Playwright 端到端测试 |
| `npm run sync:shared` | 把 `shared/` 同步进 Edge Functions |
| `npm run hash:password -- "xxx"` | 离线生成密码哈希 |

> 修改了 `shared/` 之后一定要执行 `npm run sync:shared` 并提交生成的文件，
> 否则 Edge Function 里跑的还是旧评分逻辑。CI 会检查这一点。

---

## 环境变量

### 前端（公开，可以进仓库 / GitHub Actions Variables）

| 变量 | 说明 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase 项目地址，例如 `https://xxxx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key（等价于旧版 anon key） |
| `VITE_BASE_PATH` | 部署子路径。用户主页站留空；项目站填 `/<仓库名>/` |

### 服务端（机密，只放在 Supabase secrets）

| 变量 | 说明 |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 自动注入，**永远不要**出现在前端 |
| `CODE_LOOKUP_KEY` | 用于 HMAC 计算密码查询哈希的随机长字符串 |
| `SESSION_TOKEN_KEY` | 用于由 requestId 派生会话 token 的 HMAC 密钥 |

```bash
supabase secrets set CODE_LOOKUP_KEY="$(openssl rand -hex 32)" \
                   SESSION_TOKEN_KEY="$(openssl rand -hex 32)"
```

**绝对禁止**在 `VITE_*` 里放 service_role / secret key、数据库密码或任何高权限凭证。
Vite 会把 `VITE_*` 原样内联进 JS 产物，一旦提交就等于公开。

---

## Supabase 后端部署

### 0. 前置条件

```bash
npm i -g supabase      # 需要 Node 20+
supabase login
supabase link --project-ref <你的项目 ref>     # 在 Supabase 控制台 Project Settings → API 拿到
```

### 1. 应用数据库迁移

```bash
supabase db push
```

包含四份可重复执行的迁移：

| 文件 | 内容 |
| --- | --- |
| `20250101000001_core.sql` | 全部表、索引、约束、外键 |
| `20250101000002_functions.sql` | 事务化额度扣减、提交落库、分享查询等数据库函数 |
| `20250101000003_rls.sql` | RLS 启用、权限撤销、函数执行权限收敛 |
| `20250101000004_production_hardening.sql` | 生产加固：移除坏触发器、幂等分支空值防御、分享字段白名单 |

> `0004` 修复了一个会让**所有正常提交失败**的缺陷：`test_sessions` 表没有
> `updated_at` 列，但 `touch_updated_at()` 触发器被建在了这张表上，
> 任何 `UPDATE test_sessions`（即 `finalize_submission`）都会报
> `record "new" has no field "updated_at"`。升级已有项目时务必执行。

本地开发也可以用 `supabase start` 起一整套本地栈，然后用 `supabase db reset` 重放迁移。

> ⚠️ 若旧项目已写入数据，先备份再 `db push`；`0004` 只做修复与收紧，不删数据。

### 2. 配置服务端 secrets

```bash
supabase secrets set CODE_LOOKUP_KEY="$(openssl rand -hex 32)" \
                   SESSION_TOKEN_KEY="$(openssl rand -hex 32)"
```

### 3. 部署 Edge Functions

```bash
npm run fn:deploy
# 等价于：
supabase functions deploy start-test submit-test retake get-result \
  create-share shared-result \
  admin-login admin-list-codes admin-create-code admin-update-code admin-stats \
  --no-verify-jwt
```

所有函数都**自行校验凭证**（会话 token / 管理员 token / 分享 token），
所以用 `--no-verify-jwt` 部署；浏览器只有 publishable key，无法签发 Supabase JWT。

> `--no-verify-jwt` 是安全的：函数内部对每一条请求都做了独立的凭证校验，
> 且所有数据库访问都走 service_role。

### 4. 初始化管理员

```bash
# 生成密码哈希（明文不会被保存）
npm run hash:password -- "你的管理员密码"

# 在 Supabase SQL Editor 里执行
insert into public.admin_users (username, password_hash)
values ('admin', '把上一步生成的 pbkdf2-sha256$... 粘到这里');
```

也可以直接用后台创建第一个测试密码，然后登录 `/#/admin` 管理。

---

## 数据库设计

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `test_codes` | 测试密码凭证与额度 | `code_hash` 唯一；`used_count <= max_uses` |
| `test_sessions` | 每一轮测评会话 | `request_id` 唯一（幂等）；`access_token_hash` 唯一索引 |
| `test_answers` | 每轮答题明细 | `(session_id, question_id)` 唯一 |
| `test_results` | 服务端计算出的结果 | `session_id` 唯一（重提交覆盖，不新建行） |
| `share_links` | 公开分享链接 | `token_hash` 唯一；含 `expires_at` / `revoked_at` |
| `admin_users` / `admin_sessions` | 管理员鉴权 | `token_hash` 唯一 + 过期 |
| `audit_log` | 关键操作与失败尝试审计 | 不记录任何密码明文 |

关键函数：

- `start_test_session(...)` —— 行锁 + 原子扣额度 + 幂等
- `register_failed_attempt(...)` —— 防暴力猜测，连续失败临时锁定
- `finalize_submission(...)` —— 整轮答案 + 结果在一个事务内落库
- `get_session_context(...)` —— 受控读取（需会话 token）
- `get_shared_result(...)` —— 公开读取，**只返回白名单字段**，且 `report`
  经 `public_report()` 做 key 级投影（新增键默认拒绝，必须显式放行）

---

## 安全设计

完整清单见 [`docs/SECURITY.md`](docs/SECURITY.md)。要点：

1. **RLS 全开、策略为零。** 8 张业务表全部 `enable` + `force row level security`，
   并且 `revoke all ... from anon, authenticated`。
   匿名用户拿 publishable key 直接查 REST API 也拿不到任何一行。
2. **所有读写都经 Edge Functions。** 数据库函数是 `SECURITY DEFINER`，
   只授予 `service_role` 执行，匿名角色无法调用。
3. **密码不落明文。**
   - `code_hash = HMAC-SHA256(CODE_LOOKUP_KEY, 密码)` → 只用于索引查询
   - `password_hash = PBKDF2-SHA256(密码, 随机盐, 210000 轮)` → 只用于真正校验
   即使数据库被拖库，没有 `CODE_LOOKUP_KEY` 且不付出 PBKDF2 的暴力破解成本也拿不到密码。
4. **评分在服务端。** 客户端只发 `{questionId, optionId}`，
   服务端校验题目 ID、选项合法性、完整性，然后自己算分。伪造分数无法生效。
5. **分享 token 是 256 位 CSPRNG**，数据库只存 SHA-256，明文只返回一次。
   撤销与有效期都在数据库里判断。
6. **会话 token 由 `requestId` + 服务端密钥派生**，所以「请求超时重试」既不会
   重复扣额度，也不会出现「服务端建了会话但客户端拿不到 token」的情况。
7. **密码不进 URL、不进日志、不进本地存储。** 会话 token 存 sessionStorage，
   答题草稿存 localStorage，二者都只是便利，服务端一律重新校验。
8. **管理员接口全部服务端鉴权**，前端隐藏按钮不作为任何保护。

---

## 密码与 3 次额度

规则：

1. 输入密码 → 服务端校验 PBKDF2。
2. 校验通过且有余额 → **原子扣减 1 次并创建会话**（同一事务）。
3. 只有创建成功才扣次数；上一题 / 下一题 / 修改答案 / 刷新页面都不影响额度。
4. 「再测一次」先检查余额，成功创建新会话才扣。
5. 第 4 次创建会话会被服务端拒绝，返回 `exhausted`。
6. 无效 / 停用 / 耗尽分别给出不同的明确文案。
7. 并发请求被 `SELECT ... FOR UPDATE` 行锁串行化，不会突破上限。
8. 重试使用同一个 `requestId` 是幂等的，不会重复扣减。
9. 修改 localStorage 无法绕过——额度判断完全在服务端。
10. 连续 8 次输错会把该密码临时锁定 15 分钟（数据库级，不是内存级）。

---

## 管理员使用说明

1. 打开 `https://<你的域名>/#/admin`。
2. 用 `admin_users` 表里的账号登录（见上文「初始化管理员」）。
3. 「新建测试密码」：
   - 备注名建议写清批次，例如 `小红书 10 月 A 批`
   - 自定义密码留空则自动生成 `XXXX-XXXX-XXXX`（去掉了 0/O/1/I/L，方便用户手输）
   - 默认额度 3 次
   - **完整密码只在创建成功时显示一次**，请立即复制
4. 列表里可以「次数 +1」「停用 / 启用」。
5. 统计卡片显示密码总数、启用中、已完成测评、有效分享链接。

> 列表只显示 `AB****YZ` 形式的掩码，服务端也不会再次返回明文。

---

## GitHub Pages 部署

### 1. 推代码

```bash
git init
git add .
git commit -m "feat: 人生选择指南 MVP"
git branch -M main
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

### 2. 打开 Pages

仓库 → **Settings → Pages → Build and deployment → Source: GitHub Actions**。

### 3. 配置公开变量

仓库 → **Settings → Secrets and variables → Actions → Variables**：

| 变量 | 值 |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `VITE_BASE_PATH` | 用户/组织页填 `/`；**项目页填 `/<仓库名>/`** |

推送后 workflow 会自动：lint → typecheck → unit test → build → e2e → deploy。

### 4. 关于路由

- 前端使用 `HashRouter`，URL 形如 `https://<用户名>.github.io/<仓库>/#/s/<token>`。
- 不需要任何服务器重写规则，也不需要 `404.html` 兜底。
- `VITE_BASE_PATH` 由 `.github/workflows/deploy.yml` 注入，Vite 会自动给
  `index.html` 和所有资源加前缀；分享链接通过 `import.meta.env.BASE_URL`
  动态拼接，所以**改部署路径也不会坏**。
- 只有一件事需要人工做：项目页的 `VITE_BASE_PATH` 必须和仓库名一致。

---

## 测试

```bash
npm run test          # 普通单元测试：评分、加密、校验、前端全流程、集成测试基础设施
npm run test:all      # 上面这些 + 真实后端集成测试（无配置时会失败，见下文）
npm run test:e2e      # Playwright
```

| 文件 | 覆盖 |
| --- | --- |
| `shared/scoring.test.ts` | 题库完整性、答案校验、分数范围与确定性、平分与并列、8 种原型的可达性、报告内容完整性、不同作答产生不同报告、原始答案不会泄漏进报告 |
| `shared/crypto.test.ts` | PBKDF2 哈希 / 校验 / 加盐 / 拒绝畸形输入、token 熵、SHA-256、恒定时间比较 |
| `src/test/validation.test.ts` | Zod 入参校验、非法题目与选项、Edge Function 共享模块同步一致性 |
| `src/lib/url.test.ts` | 部署子路径下的分享链接生成、token 解析 |
| `src/test/flow.test.tsx` | 密码门禁、答题流程（禁重复提交、返回保留答案）、结果页、分享链接、跨浏览器打开、再测一次、结果页按钮布局、管理员鉴权、**刷新恢复不扣次**、**retake 重试幂等**、**分享链接不含密码/会话 id** |
| `src/test/backend.integration.test.ts` | **仅预发环境**：按 A/B/C 批次运行，每个场景独立新密码；并发额度（自证式 `usedCount` 不变式）、retake 幂等 / 耗尽、requestId 跨密码重放被拒、同 requestId 并发（`0005` 前结果不确定：可能 5xx，也可能因重放检查恰好看到已提交结果而全部 200；后者不代表竞态被覆盖）、**结果不可变 + 重提交返回已存结果**、分享三字段 / 完整分数白名单、**分享撤销**（仅管理员模式）、8 张表 RLS 探测、4 个管理员接口未授权 |
| `src/test/integrationHelpers.test.ts` | 集成测试基础设施单测：staging 确认 + 显式 project-ref 允许列表、只接受 `sb_publishable_` / anon JWT、429 / 5xx 处理、首次 `usedCount` 与 session 结构新鲜度、批次预算、密码池分配、`withId` 管理端开码 |
| `src/test/integrationEnvScript.test.ts` | 预检脚本黑盒测试：缺失 / 部分 / 完整配置的退出码、旧两密码模式被拒、project-ref 允许列表、未知密钥格式与 URL 变体被拒、凭证值不回显 |
| `shared/publicReport.test.ts` | 静态解析 0004 迁移：`public_report` 必须是 `jsonb_each` + 显式 key 数组的**允许列表**（不是减法黑名单），且 key 集合与 `buildReport` 完全一致 |
| `src/test/migrations.test.ts` | 迁移静态守卫：`get_shared_result` 必须先 DROP 再重建、不再返回 `session_id`、DROP 后重新授权 `service_role`、坏触发器被移除、幂等重放绑定密码哈希 |
| `tests/e2e/flow.spec.ts` | 移动端 / 桌面端布局、长图导出与文件名（移动端走分享面板）、分享链接在新浏览器上下文打开、404、结果页按钮同排（宽屏并排 / 窄屏堆叠） |

### 真实后端集成测试（仅预发环境）

集成测试会直接调用真实 Edge Functions 和 PostgreSQL 函数，**只允许在预发项目运行**。
`npm run test:integration` 会先执行 `scripts/check-integration-env.mjs`：

- 完全未配置 → 退出码 `2`，明确显示 `INTEGRATION SKIPPED`；
- 配置不完整、目标不是 `staging`、URL 与 project ref 不匹配、project ref 不在
  显式允许列表、URL 含端口 / 路径 / 查询 / userinfo、或密钥不是
  `sb_publishable_...` / anon-role JWT → 退出码 `1`，**不会发起任何网络请求**；
- 完整且安全 → 退出码 `0`，才允许 Vitest 连接预发项目。

`SUPABASE_TEST_ENV=staging` 只是人工声明，不能证明目标不是生产库；机器校验以
`SUPABASE_TEST_ALLOWED_PROJECT_REFS` 为准。

必需变量：

| 变量 | 说明 |
| --- | --- |
| `SUPABASE_TEST_URL` | 必须**恰好**是 `https://<staging-ref>.supabase.co`（不允许端口 / 路径 / 查询 / userinfo） |
| `SUPABASE_TEST_KEY` | 只接受 `sb_publishable_...` 或 legacy anon-role JWT；`service_role`、`sb_secret_...`、`sbp_...`、未知格式一律拒绝 |
| `SUPABASE_TEST_ENV` | 必须是 `staging`，仅代表人工确认，不能单独证明目标 |
| `SUPABASE_TEST_PROJECT_REF` | 必须与 URL 主机名一致 |
| `SUPABASE_TEST_ALLOWED_PROJECT_REFS` | **必填**：逗号分隔的预发 project ref 允许列表；目标 ref 必须包含在内 |
| `SUPABASE_TEST_BATCH` | `A` / `B` / `C`；一次只跑一个批次 |
| `SUPABASE_TEST_ADMIN_USERNAME` / `_PASSWORD` | 预发管理员账号（推荐；自动开码） |
| `SUPABASE_TEST_CODE_POOL` | 备选：逗号分隔的全新密码，数量见下表 |

管理员模式会在每批次开始登录一次，并用 `admin-create-code` 为每个场景创建
独立的全新密码；密码明文只存在于进程内存，不写入源码、日志或断言消息。
池模式按顺序消费 `SUPABASE_TEST_CODE_POOL`。管理员账号必须已存在于预发项目的
`admin_users` 表（创建方法见上文“管理员密码”）。

批次与真实预算（脚本静态校验 + 运行时 `CallCounter` 双重校验）：

| 批次 | 场景 | start-test | retake | 新密码数 |
| --- | --- | --- | --- | --- |
| A | 访问 / requestId 幂等 / 跨密码重放 / 提交校验 / 结果不可变 / 分享 / 分享撤销（管理员模式）/ RLS / 管理员鉴权 | 10 / 12 | 0 / 10 | 6 |
| B | 并发额度 / retake 耗尽 / retake 幂等 | 11 / 12 | 3 / 10 | 3 |
| C | 同一 requestId 并发（7 并发 + 1 跟进）/ 跨密码并发（含败方未扣次跟进） | 11 / 12 | 0 / 10 | 3 |

```bash
# 批次 A（示例；不要把真实密码写进仓库或 shell 历史）
SUPABASE_TEST_URL=https://<staging-ref>.supabase.co \
SUPABASE_TEST_KEY=sb_publishable_xxx \
SUPABASE_TEST_ENV=staging \
SUPABASE_TEST_PROJECT_REF=<staging-ref> \
SUPABASE_TEST_ALLOWED_PROJECT_REFS=<staging-ref> \
SUPABASE_TEST_BATCH=A \
SUPABASE_TEST_ADMIN_USERNAME=<staging-admin> \
SUPABASE_TEST_ADMIN_PASSWORD='<通过本地环境变量注入，不要提交>' \
npm run test:integration
```

注意：

- 服务端限流按 IP 计算（`start-test` 12 次 / 10 分钟，`retake` 10 次 / 5 分钟，
  `admin-login` 8 次 / 15 分钟；管理员模式每批次只登录 1 次）。
  一个批次跑完后**至少等 10 分钟**再跑下一批；重跑同一批次也要等窗口重置，
  并重新提供全新的密码。
- 旧的两个密码模式（`SUPABASE_TEST_CODE` / `_2`）**不能**跑完整套件，预检会直接
  拒绝；它最多证明两条路径，不能当作回归结果。
- 批次 C 的两个并发用例在 `0005 advisory lock` 迁移获批并应用前**结果不确定**：
  取决于时序，可能因唯一索引冲突回滚而返回 5xx；也可能后到的请求在重放检查时
  恰好看到已提交的会话，于是全部返回 200。**一次全绿不能证明竞态已修复**，因为
  那次运行可能根本没有命中竞争窗口。不得通过放宽断言、静默跳过或把 5xx 当成功
  来变绿。`0005` 目前只是待评审建议，仓库中没有该迁移文件。
- 分享撤销用例需要管理员模式的 code id；池模式会显示 `SKIPPED` 并在控制台警告，
  **不计为通过**。完整安全回归应使用管理员模式运行批次 A。
- 结果契约：首次提交后结果不可变；重复提交返回 HTTP 200 和**数据库中已存储的**
  结果，不会用新答案覆盖。集成测试会再次调用 `get-result` 核对已存分数。
- `npm run test:all` 现在包含集成测试，无配置时会失败；如需明确跳过，使用
  `ALLOW_INTEGRATION_SKIP=1 npm run test:all`，输出会标记 `SKIPPED`。
- 本阶段不要求执行任何数据库命令；运行集成测试不会自动 push 或 reset 数据库。

---

## 未完成项与外部配置要求

需要你提供外部信息才能真正上线的部分：

1. **Supabase 项目凭证**：项目 ref、publishable key、service_role（仅本地 CLI 用）。
2. **两个服务端密钥**：`CODE_LOOKUP_KEY`、`SESSION_TOKEN_KEY`（用 `openssl rand -hex 32` 生成即可）。
3. **域名**：如果要用自定义域名，记得同步调整 `VITE_BASE_PATH` 或改回 `/`。
4. **GitHub Pages 设置**：仓库 Settings → Pages → Source 选 `GitHub Actions`；
   并在 Settings → Secrets and variables → Actions 里新建三个 **Variables**
   （不是 Secrets，因为会被内联进产物）：`VITE_SUPABASE_URL`、
   `VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_BASE_PATH`。
   项目站点填 `/<仓库名>/`，用户/组织站点留空或填 `/`。

### 本次已执行的验证 / 仍未执行的验证

**已执行并通过：**

- `npm run lint` / `npm run typecheck` —— 全项目通过
- `npm run test` —— 145 个单元与流程测试全绿（9 个测试文件；不包含真实后端集成测试）
- `vitest list` 校验批次注册：A=15、B=3、C=2 个用例，未执行任何 hook / 请求
- 预检脚本黑盒测试：缺失 `2` / 显式跳过 `0` / 部分配置 `1` / 完整 staging `0` /
  非 staging `1` / ref 不在允许列表 `1` / 未知密钥格式 `1`
- **干净构建冒烟检查**：临时移开 `.env.local`，显式注入占位
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_BASE_PATH`，
  构建到 `/tmp` 临时目录并扫描；产物不含 `localhost:8787`、`127.0.0.1`、
  `service_role`、`sb_secret_`、`sbp_`、`CODE_LOOKUP_KEY`、`SESSION_TOKEN_KEY`、
  mock 管理员密码或测试密码，也不含 `.env.local` 的 publishable key 值。
  该临时产物已删除，**不是**可发布产物。
- （上一阶段）Playwright 端到端（系统 Chrome，桌面 Pixel/Desktop 双视口）—— 19 通过 / 1 按设计跳过

**发布产物状态：**

- 仓库里现有的 `dist/` 是上一阶段用 `.env.local` 构建的，扫描仍能发现
  `localhost:8787`，**不可部署**，也不应作为发布证据。
- 已确认的生产 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、
  `VITE_BASE_PATH` 尚未提供（`.env.local` 指向本地 mock，base path 为 `/`）。
  因此本阶段**没有**生成可发布产物；提供这三项后再执行干净构建与扫描。

**仍未执行（需要你提供外部环境）：**

1. **后端集成测试** `npm run test:integration` —— 需要真实 Supabase **预发**项目、
   管理员账号或密码池，并按 A/B/C 分批执行。它会验证并发扣次、RLS、分享白名单、
   分享撤销与结果不可变等**只能在真实 PostgreSQL / Edge Functions 上确认**的性质
   （本地无 Docker / Postgres，未能执行迁移）。批次 C 在 `0005 advisory lock`
   获批并应用前结果不确定：可能全 200，也可能 5xx，不能当作已修复。
2. **`supabase db push` 与函数部署** —— 需要项目 ref 与访问令牌。
3. **Safari (WebKit) 长图导出** —— `npx playwright install webkit` 后跑
   `--project=mobile-safari`。Safari 对 canvas 尺寸限制最严，是导出环节风险最高的一环，
   上线前必须人工验证。
4. **真实设备上的分享面板** —— iOS/Android 的 `navigator.share` 只能真机验证。
5. **Supabase CORS 预检** —— 代码已设置 `Access-Control-Allow-Origin: *`，
   但需在真实项目域名下实际发一次 OPTIONS 确认网关未额外拦截。
- 真实 GitHub Pages 部署
- 真实移动端设备的长图保存 / Web Share 行为

详见 [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md)。

---

## 评分算法说明

- 8 个维度，每个维度 3 道题，共 24 题；每题 4 个选项。
- 每个选项携带若干维度权重，取值 `[-2, 2]`，正数推向该维度的高极、负数推向低极。
- 单维得分 = `100 × 正向压力 / (正向压力 + 反向压力)`，无压力记 50，保留一位小数。
- 原型匹配度 = `Σ(维度分 − 50) × 原型亲和权重 / Σ|权重|`；
  取最高者为原型，次高为第二原型。**完全并列时按声明顺序裁决**，保证确定性。
- 相同答案 + 相同 `SCORING_VERSION` 一定产生完全相同的报告（已由测试覆盖）。
- 报告内容由「原型固定文案」+「按实际分数动态生成的句子」组合，
  因此不同用户不会拿到完全一样的模板。

---

## 许可与免责

本项目为商业测评 MVP 示例代码。作者不对任何人的测评结果负责。