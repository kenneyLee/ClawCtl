# ClawCtl MVP v0.1 测试方案

> **状态:** v3 — 增加 Remote Hosts 测试（v1 基础模块, v2 Auth & RBAC, v3 远程实例管理）
> **创建日期:** 2026-03-07
> **更新日期:** 2026-03-07 (v3)
> **关联文档:** `docs/product/clawctl-project-brief.md`, `docs/plans/2026-03-07-clawctl-mvp.md`
> **代码位置:** `/Users/kris/proj/openclaw/ClawSafeMng/`

---

## 一、总体策略

### 1.1 两阶段推进

| 阶段 | 目标 | 重点 |
|------|------|------|
| Phase 1: 内部 dogfooding | 在三实例环境（Lark/飞书/TG）上跑通全部功能 | 功能正确性、集成验证、手动场景验收 |
| Phase 2: 开源发布 | 确保 `npx clawctl` 对社区用户开箱即用 | 自动化覆盖率、CI 流水线、边界 case |

### 1.2 测试金字塔

```
        /  E2E (Playwright)  \          — 6 条核心流程
       / 前端组件测试 (vitest) \        — 8 个页面组件
      /   集成测试 (Hono app)   \       — API 路由 + 依赖协作
     /     单元测试 (vitest)      \     — Gateway、Manager、Store、LLM、各 route
    /    手动测试 (两层 checklist)   \   — 冒烟 7 条 + 场景 ~50 条
```

### 1.3 关键决策

- **Gateway mock**: 单元/集成用 mock WebSocket server；额外提供 `test:live` 可连真实 Gateway（需环境变量），CI 跑 mock
- **LLM 测试**: 只测降级逻辑（未配置返回 400、调用失败不影响主流程），不测 LLM 输出质量
- **Auth mock**: API route 单元测试用 `mockAuthMiddleware()` 注入 admin 用户绕过认证；auth 模块自身有独立测试覆盖 password/token/store/middleware/routes/RBAC
- **Remote Hosts**: SSH discovery 不做真实连接测试（依赖 ssh2），只测 crypto（AES-256-GCM 加解密）、HostStore（CRUD + 凭据加密）、API 路由（RBAC + 参数校验）；discovery.ts 通过 Live 测试或手动验证
- **前端测试**: 组件渲染 + 交互测试（vitest + @testing-library/react + msw）+ Playwright E2E
- **前端 Auth**: MSW mock `/api/auth/status` 和 `/api/auth/me`，Login 页面独立测试；其余页面测试通过 AuthContext.Provider 注入已认证用户

---

## 二、后端测试

### 2.1 单元测试

#### GatewayClient (`gateway/__tests__/client.test.ts` — 扩充)

| 用例 | 说明 |
|------|------|
| 初始化状态 disconnected | 已有 |
| 连接失败状态 error | 已有 |
| 连接成功状态 connected | mock WebSocketServer，验证 status 变化 |
| RPC 正常响应 | 发送 JSON-RPC 请求，mock server 返回 result，验证 resolve |
| RPC 错误响应 | mock server 返回 error，验证 reject |
| RPC 超时 | 30s 内不回复，验证 timeout reject |
| 带 token 连接 | 验证 URL 拼接 `?token=xxx` |
| fetchHealth 数据映射 | mock 返回原始数据，验证映射为 HealthStatus |
| fetchAgents 数据映射 | 验证 agents.list 响应映射 |
| fetchChannels 数据映射 | 验证 channels.status 响应映射 |
| fetchSessions 数据映射 | 验证 sessions.list 响应映射 |
| fetchSkills 数据映射 | 验证 skills.list 响应映射 |
| fetchConfig 数据映射 | 验证 config.get 响应映射 |
| fetchSecurityAudit 数据映射 | 验证 security.audit 响应映射 |
| fetchToolsForAgent 数据映射 | 验证 agents.tools 响应映射 |
| fetchFullInstance 并发获取 | 验证 Promise.all 聚合，部分 RPC 失败不影响其余 |
| disconnect 清理 | 验证 ws 关闭，状态回到 disconnected |

#### InstanceManager (`instances/__tests__/manager.test.ts`)

| 用例 | 说明 |
|------|------|
| addInstance 新增 | 添加后 getAll() 包含新实例 |
| addInstance 重复 id 忽略 | 同 id 不重复添加 |
| addInstance 连接失败 | 实例仍存在于列表，status=error |
| removeInstance | 移除后 getAll() 不包含、WebSocket 断开 |
| refreshInstance 成功 | 返回更新后的 InstanceInfo |
| refreshInstance 不存在 | 返回 null |
| refreshAll | 所有实例刷新，部分失败不阻塞 |
| getClient 返回正确 client | 按 id 获取 |
| listConnections | 返回所有连接信息 |

#### Discovery (`instances/__tests__/discovery.test.ts`)

| 用例 | 说明 |
|------|------|
| 扫描 ~/.openclaw 默认实例 | mock fs，验证返回 local-default |
| 扫描 ~/.openclaw-feishu | 验证返回 local-feishu |
| 多实例发现 | 3 个目录返回 3 个 connection |
| 无 openclaw.json 跳过 | 目录存在但无配置文件 |
| JSON 解析失败容错 | 畸形 JSON 不崩溃，跳过该实例 |
| 自定义端口解析 | gateway.port 不是默认值时正确拼 URL |
| 无 .openclaw 目录 | 返回空数组 |

#### Store (`instances/__tests__/store.test.ts`)

| 用例 | 说明 |
|------|------|
| initDb 创建表 | 验证 4 张表存在 |
| instances CRUD | 插入、查询、更新、删除 |
| operations 插入和查询 | 插入操作记录，按状态筛选 |
| config_snapshots 插入和查询 | 保存配置快照，按 instance_id 查询 |
| settings CRUD | 键值对读写 |
| WAL 模式生效 | pragma 查询验证 |

测试用临时目录的 SQLite 文件，afterEach 清理。

#### LlmClient (`llm/__tests__/client.test.ts`)

| 用例 | 说明 |
|------|------|
| 未配置时 isConfigured 返回 false | |
| 未配置时 complete 抛错 | 错误信息包含 "not configured" |
| configure 后 isConfigured 返回 true | |
| provider 路由到 openai | 验证调用 openaiComplete（mock import） |
| provider 路由到 anthropic | 验证调用 anthropicComplete |
| provider 路由到 ollama | 验证调用 ollamaComplete |
| 未知 provider 抛错 | |

#### Password (`auth/__tests__/password.test.ts`)

| 用例 | 说明 |
|------|------|
| hashPassword 返回 hash 和 salt | 两个字段都是 hex 字符串 |
| 相同密码不同 salt | 两次调用 hash 不同 |
| verifyPassword 正确密码返回 true | |
| verifyPassword 错误密码返回 false | |
| 空密码不崩溃 | 正常执行，verify 返回 false |

#### Session Token (`auth/__tests__/session.test.ts`)

| 用例 | 说明 |
|------|------|
| createToken 返回 data.sig 格式 | 包含一个 `.` 分隔符 |
| verifyToken 验证合法 token | 返回原始 payload |
| verifyToken 拒绝篡改 token | 修改 payload 后返回 null |
| verifyToken 拒绝空/格式错误 token | 返回 null |
| getSessionSecret 首次调用生成并持久化 | 写入 settings 表 |
| getSessionSecret 再次调用返回相同值 | 从 settings 表读取 |

#### UserStore (`auth/__tests__/store.test.ts`)

| 用例 | 说明 |
|------|------|
| init 创建 users 表 | 表存在 |
| hasAnyUser 初始返回 false | 空数据库 |
| createUser 后 hasAnyUser 返回 true | |
| createUser 返回 User 对象（无密码字段） | id/username/role/created_at |
| authenticate 正确凭据返回 User | 更新 last_login |
| authenticate 错误密码返回 null | |
| authenticate 不存在用户返回 null | |
| listUsers 返回所有用户 | |
| updateUser 修改角色 | role 变更 |
| updateUser 修改密码 | 旧密码失效，新密码生效 |
| deleteUser 成功删除 | 再查不到 |
| createUser 重复用户名抛错 | UNIQUE 约束 |

#### Auth Middleware (`auth/__tests__/middleware.test.ts`)

| 用例 | 说明 |
|------|------|
| authMiddleware 放行 /api/auth/login | 无 token 也 200 |
| authMiddleware 放行 /api/auth/setup | 无 token 也 200 |
| authMiddleware 放行 /api/auth/status | 无 token 也 200 |
| authMiddleware 放行 /api/health | 无 token 也 200 |
| authMiddleware 无 token 返回 401 | 普通路由 |
| authMiddleware 无效 token 返回 401 | |
| authMiddleware 有效 cookie token 通过 | c.get("user") 有值 |
| authMiddleware 有效 Bearer header 通过 | |
| requireRole admin 允许 admin | |
| requireRole admin 拒绝 operator (403) | |
| requireRole admin 拒绝 auditor (403) | |
| requireWrite instances 允许 admin | |
| requireWrite instances 允许 operator | |
| requireWrite instances 拒绝 auditor (403) | |
| requireWrite settings 拒绝 operator (403) | settings 不在 operator 写权限内 |

#### Host Credential Encryption (`hosts/__tests__/crypto.test.ts`)

| 用例 | 说明 |
|------|------|
| 加密解密 password | encrypt → decrypt 还原 |
| 加密解密 private key | 含多行 PEM 格式 |
| 每次加密结果不同（随机 IV） | 同明文两次加密，密文不同，解密均正确 |
| 错误 secret 解密失败 | 抛出异常 |

#### HostStore (`hosts/__tests__/store.test.ts`)

| 用例 | 说明 |
|------|------|
| 创建并列出 host（凭据掩码） | credential 返回 "***" |
| 解密凭据正确 | getDecryptedCredential 返回原始值 |
| 更新 host 字段 | label/port 变更，credential 不变 |
| 更新 credential | 新凭据生效 |
| 删除 host | 成功删除 |
| 删除不存在 host 返回 false | |
| 更新扫描结果（成功） | last_scan_at 有值，last_scan_error 为 null |
| 更新扫描结果（失败） | last_scan_error 包含错误信息 |

#### Hosts API Routes (`api/__tests__/hosts.test.ts`)

| 用例 | 说明 |
|------|------|
| GET / 空列表 | 初始无 host |
| POST / 创建 host | 返回 201，credential 掩码 |
| POST / 缺必填字段返回 400 | host/username/credential 必填 |
| DELETE /:id 成功删除 | |
| DELETE /:id 不存在返回 404 | |
| 非 admin 角色被拒 (403) | auditor 访问 /hosts 返回 403 |

#### Auth API Routes (`api/__tests__/auth.test.ts`)

| 用例 | 说明 |
|------|------|
| GET /status 无用户时 needsSetup=true | |
| POST /setup 创建首个 admin | 返回 user + token，Set-Cookie |
| POST /setup 已有用户返回 400 | "Setup already completed" |
| POST /setup 缺少 username/password 返回 400 | |
| POST /setup 密码过短返回 400 | <6 字符 |
| POST /login 正确凭据返回 user + token | |
| POST /login 错误凭据返回 401 | |
| POST /login 缺少字段返回 400 | |
| POST /logout 清除 cookie | |
| GET /me 已认证返回用户信息 | |
| GET /me 未认证返回 401 | |
| GET /users admin 可访问 | 返回用户列表 |
| GET /users operator 被拒 (403) | |
| POST /users admin 创建用户 | 返回 201 |
| POST /users 重复用户名返回 409 | |
| POST /users 无效角色返回 400 | |
| PUT /users/:id admin 修改角色 | |
| DELETE /users/:id admin 删除用户 | |
| DELETE /users/:id 不能删自己 (400) | |

#### RBAC 集成 — 写权限控制 (`api/__tests__/rbac.test.ts`)

验证各角色在受保护路由上的写权限行为。

| 用例 | 说明 |
|------|------|
| admin POST /instances 成功 (201) | admin 有 instances 写权限 |
| operator POST /instances 成功 (201) | operator 有 instances 写权限 |
| auditor POST /instances 被拒 (403) | auditor 无写权限 |
| admin PUT /settings 成功 | admin 有全部写权限 |
| operator PUT /settings 被拒 (403) | operator 无 settings 写权限 |
| auditor GET /instances 成功 (200) | 所有角色都有读权限 |

#### API 路由（每个 route 一个测试文件）

通用模式：构造 mock InstanceManager + mock LlmClient，用 Hono `app.request()` 测试 HTTP 行为。

**instances.test.ts:**

| 用例 | 说明 |
|------|------|
| GET / 返回所有实例 | |
| POST / 缺少 url 返回 400 | |
| POST / 正常创建返回 201 | |
| DELETE /:id 正常删除 | |
| POST /:id/refresh 成功 | |
| POST /:id/refresh 不存在返回 404 | |

**sessions.test.ts:**

| 用例 | 说明 |
|------|------|
| GET /:id/sessions 返回 session 列表 | |
| GET /:id/sessions 不存在返回 404 | |
| GET /:id/sessions/:key 返回消息历史 | |
| POST /:id/sessions/:key/summarize LLM 未配置返回 400 | |
| POST /:id/sessions/:key/summarize 实例不存在返回 404 | |

**config.test.ts:**

| 用例 | 说明 |
|------|------|
| GET /:id/config 返回配置 | |
| GET /:id/config 不存在返回 404 | |
| POST /compare 正常返回两份配置 | |
| POST /compare 缺少实例返回 404 | |

**security.test.ts:**

| 用例 | 说明 |
|------|------|
| GET /:id/security 返回审计列表 | |
| GET /:id/security 不存在返回 404 | |
| GET /overview 返回跨实例汇总 | |
| overview 正确统计 critical/warn 计数 | |

**tools.test.ts:**

| 用例 | 说明 |
|------|------|
| GET /:id/agents/:agentId/tools 返回工具列表 | |
| GET /:id/agents/:agentId/tools 不存在返回 404 | |
| GET /matrix 返回跨实例矩阵 | |
| POST /diagnose agent 不存在时 step 失败 | |
| POST /diagnose tool 不在 allow 时 step 失败 | |
| POST /diagnose 全部通过 | |
| POST /diagnose LLM 未配置不影响 steps 返回 | |
| POST /diagnose 实例不存在返回 404 | |

**operations.test.ts:**

| 用例 | 说明 |
|------|------|
| GET / 返回操作历史列表 | |

**settings.test.ts:**

| 用例 | 说明 |
|------|------|
| GET / 返回当前设置 | |
| PUT / 保存设置 | |
| PUT / 后 GET / 返回更新值 | |

**digest.test.ts:**

| 用例 | 说明 |
|------|------|
| POST / LLM 未配置返回 400 | |

### 2.2 集成测试 (`__tests__/integration.test.ts`)

用完整 Hono app（挂载所有路由），InstanceManager 注入 mock GatewayClient。

| 用例 | 说明 |
|------|------|
| 添加实例后查询返回新实例 | POST /api/instances → GET /api/instances |
| 添加实例后能获取 sessions | POST instances → GET sessions |
| 添加实例后能获取 security overview | POST instances → GET security/overview |
| 工具诊断全链路 | 添加实例 → POST /api/tools/diagnose |
| 配置对比全链路 | 添加两个实例 → POST /api/config/compare |
| 删除实例后查询不到 | POST → DELETE → GET |

### 2.3 Live 测试 (`__tests__/live.test.ts`)

```bash
CLAWCTL_LIVE_URL=ws://your-server-ip:18789 \
CLAWCTL_LIVE_TOKEN=xxx \
npm run test:live
```

仅在环境变量存在时执行，CI 跳过。

| 用例 | 说明 |
|------|------|
| 连接真实 Gateway | connect 成功，status=connected |
| fetchHealth 返回有效数据 | status 为 ok 或 degraded |
| fetchAgents 返回 agent 列表 | 数组非空 |
| fetchChannels 返回 channel 列表 | 数组非空 |
| fetchSessions 返回 session 列表 | |
| fetchSkills 返回 skill 列表 | |
| fetchConfig 返回配置对象 | |
| fetchSecurityAudit 返回审计项 | |
| fetchFullInstance 聚合完整 | 所有字段非空 |

---

## 三、前端测试

### 3.1 测试基础设施

- **框架:** vitest + @testing-library/react + jsdom
- **API Mock:** msw (Mock Service Worker)
- **配置:** `packages/web/src/__tests__/setup.ts` — msw handlers + cleanup

### 3.2 组件测试

#### Login (`pages/__tests__/Login.test.tsx`)

| 用例 | 说明 |
|------|------|
| 首次运行显示 "Create your admin account" | needsSetup=true 时显示 setup 模式 |
| 非首次运行显示 "Sign in to continue" | needsSetup=false |
| 用户名和密码输入框存在 | required 字段 |
| 提交按钮文案 — setup 模式 | "Create Admin Account" |
| 提交按钮文案 — login 模式 | "Sign In" |
| 空表单时按钮 disabled | username 或 password 为空 |
| setup 模式显示密码提示 | "Minimum 6 characters" |
| 登录失败显示错误信息 | 红色错误文本 |

#### AuthGate (App-level auth routing)

| 用例 | 说明 |
|------|------|
| 未认证时显示 Login 页面 | user=null 时渲染 Login |
| 已认证时显示主内容 | user 存在时渲染 Layout |
| loading 时显示加载状态 | loading=true 时显示 "Loading..." |

#### Layout + Sidebar (`components/__tests__/Layout.test.tsx`, `Sidebar.test.tsx`)

| 用例 | 说明 |
|------|------|
| 渲染 8 个导航项 | Dashboard/Sessions/Usage/Security/Config/Tools/Operations/Settings |
| 点击导航项切换路由 | 模拟点击，验证 URL 变化 |
| 当前页面导航项高亮 | active 样式正确 |
| 侧边栏折叠展开 | 如已实现折叠功能 |

#### Dashboard (`pages/__tests__/Dashboard.test.tsx`)

| 用例 | 说明 |
|------|------|
| 渲染实例卡片 | msw 返回 2 个实例，验证 2 张卡片 |
| 卡片展示关键信息 | label、渠道 badge、agent 数、健康灯 |
| 汇总统计展示 | 对话数、token、安全事件数 |
| 添加实例对话框打开 | 点击按钮，对话框可见 |
| 添加实例表单提交 | 填写 url + label，提交，msw 收到 POST |
| 实例不可达时显示 error 状态 | 红色健康灯 |

#### Sessions (`pages/__tests__/Sessions.test.tsx`)

| 用例 | 说明 |
|------|------|
| 渲染 session 列表 | 表格行数正确 |
| 筛选器过滤 | 按实例/渠道筛选后行数变化 |
| 点击 session 展示详情 | 消息时间线渲染 |
| 摘要按钮 LLM 未配置时 disabled | tooltip 提示 |
| 搜索框过滤 | 输入关键词，列表更新 |

#### Security (`pages/__tests__/Security.test.tsx`)

| 用例 | 说明 |
|------|------|
| 审计列表按级别分组 | CRITICAL 在前，INFO 在后 |
| 显示 critical/warn 计数 | badge 数字正确 |
| 权限总览表渲染 | agent 行 + 权限列 |

#### Config (`pages/__tests__/Config.test.tsx`)

| 用例 | 说明 |
|------|------|
| 实例选择器渲染 | 下拉包含所有实例 |
| 选择两个实例后展示 diff | diff 区域可见 |
| Skill 对比矩阵渲染 | 行=skill，列=instance |

#### Tools (`pages/__tests__/Tools.test.tsx`)

| 用例 | 说明 |
|------|------|
| 可用性矩阵渲染 | 行=tool，列=agent |
| 矩阵单元格颜色正确 | enabled=绿，disabled=灰 |
| 诊断向导触发 | 选择 tool + instance + agent，点击诊断 |
| 诊断结果步骤展示 | 每步显示 pass/fail |

#### Settings (`pages/__tests__/Settings.test.tsx`)

| 用例 | 说明 |
|------|------|
| LLM 配置表单渲染 | provider 选择器、API key、model |
| 切换 provider 更新表单 | 选 Ollama 时显示 baseUrl 字段 |
| 保存配置触发 API 调用 | 点击保存，msw 收到 PUT |
| 刷新后加载已保存配置 | GET 返回数据，表单预填 |

### 3.3 E2E 测试 (Playwright)

测试运行方式：启动 dev server + mock Gateway WebSocket server，不依赖真实实例。

#### `e2e/auth.spec.ts` — 认证流程

| 步骤 | 验证 |
|------|------|
| 首次访问显示 setup 页面 | "Create your admin account" 可见 |
| 填写用户名和密码创建 admin | 提交后跳转到 Dashboard |
| 登出后显示登录页面 | "Sign in to continue" 可见 |
| 正确凭据登录成功 | 跳转到 Dashboard |
| 错误凭据登录失败 | 错误信息显示 |

#### `e2e/startup.spec.ts` — 冷启动

| 步骤 | 验证 |
|------|------|
| 打开 http://localhost:7101 | 页面加载，标题包含 "ClawCtl" |
| 侧边栏可见 | 8 个导航项存在 |
| 逐个点击导航 | 每个页面渲染无白屏 |

#### `e2e/add-instance.spec.ts` — 添加实例

| 步骤 | 验证 |
|------|------|
| 点击添加实例按钮 | 对话框出现 |
| 填写 URL 和 label | 输入框接受值 |
| 提交 | 对话框关闭，新卡片出现 |

#### `e2e/sessions.spec.ts` — 会话浏览

| 步骤 | 验证 |
|------|------|
| 导航到 Sessions | 列表渲染 |
| 点击一个 session | 详情面板展开，消息可见 |

#### `e2e/config-diff.spec.ts` — 配置对比

| 步骤 | 验证 |
|------|------|
| 导航到 Config | 页面渲染 |
| 选择两个实例 | diff 区域显示差异 |

#### `e2e/tool-diagnose.spec.ts` — 工具诊断

| 步骤 | 验证 |
|------|------|
| 导航到 Tools | 矩阵渲染 |
| 选择工具和 agent，点击诊断 | 步骤结果逐步展示 |

#### `e2e/settings.spec.ts` — 设置持久化

| 步骤 | 验证 |
|------|------|
| 导航到 Settings | 表单渲染 |
| 选择 provider，填 API key，保存 | 成功提示 |
| 刷新页面 | 表单保留已保存值 |

---

## 四、手动测试清单

### 4.1 冒烟测试（~5 分钟）

在三实例环境执行，每项 pass/fail：

1. [ ] **Dashboard** — 启动后显示 3 个实例卡片，健康灯均为绿色
2. [ ] **Sessions** — 至少一个实例有 session，列表可展示
3. [ ] **Usage** — Token 统计表和模型对比表有数据
4. [ ] **Security** — 审计列表展示 CRITICAL/WARN 项
5. [ ] **Config** — 选择 Lark + 飞书实例，diff 展示配置差异
6. [ ] **Tools** — 可用性矩阵展示 agent 和工具对应关系
7. [ ] **Operations** — 页面可访问，操作历史表渲染
8. [ ] **Remote Hosts** — Settings 页面 Remote Hosts 区域可见（admin），添加/删除/扫描按钮存在

### 4.2 场景级验收（~30 分钟）

#### 场景 A：管理员早间巡检

> 角色：企业管理员，每天早上打开 ClawCtl 查看各实例状况

| # | 操作 | 预期结果 |
|---|------|----------|
| A1 | 打开 Dashboard | 3 个实例卡片，每个显示渠道 badge |
| A2 | 查看今日摘要栏 | 对话数、token 消耗、安全事件数有数据 |
| A3 | 检查 Lark 实例健康灯 | 绿色（已连接） |
| A4 | 检查飞书实例渠道 badge | 显示 "Feishu" |
| A5 | 检查 TG 实例渠道 badge | 显示 "Telegram" |
| A6 | 导航到 Security | 页面加载，审计列表展示 |
| A7 | 查看 CRITICAL 项 | 至少存在已知的 open group policy 告警 |
| A8 | 查看权限总览 | 每个 agent 的 toolsAllow 可见 |
| A9 | 导航到 Sessions | 跨实例 session 列表展示 |
| A10 | 按实例筛选 — 选 Lark | 只显示 Lark 实例的 session |
| A11 | 点击一个 session | 详情展示，消息时间线可读 |
| A12 | 导航到 Usage | Token 统计有数据 |
| A13 | 查看模型对比表 | 3 个实例各自模型配置可见（gpt-5.3-codex / gpt-5.2 等） |
| A14 | 返回 Dashboard | 页面无白屏 |

#### 场景 B：排查工具不可用

> 角色：运维，用户反馈 Lark 实例的 bhpc agent 搜索不可用

| # | 操作 | 预期结果 |
|---|------|----------|
| B1 | 导航到 Tools | 可用性矩阵展示 |
| B2 | 在矩阵中找到 bhpc agent | 行可见 |
| B3 | 查看 web_search 列 | 确认状态（enabled/disabled/not allowed） |
| B4 | 点击诊断（选 Lark + bhpc + web_search） | 诊断向导启动 |
| B5 | 查看步骤 1：Agent 存在检查 | 绿色 pass |
| B6 | 查看步骤 2：tools.allow 检查 | 红色 fail（已知 bhpc 未授权 Brave Search） |
| B7 | 查看诊断结论 | 明确说明 web_search 不在 allow 列表 |
| B8 | 换选 bhpc_owner agent 诊断 | 对比结果不同 |
| B9 | 导航到 Config 确认 | 查看 Lark 实例配置中 bhpc 的 tools.allow |

#### 场景 C：多实例配置管理

> 角色：管理员，需要对比和统一多实例配置

| # | 操作 | 预期结果 |
|---|------|----------|
| C1 | 导航到 Config | 页面加载 |
| C2 | 选择实例 A = Lark，实例 B = 飞书 | 两个下拉可选 |
| C3 | 查看配置 diff | JSON diff 展示，差异行高亮 |
| C4 | 确认模型差异 | Lark=gpt-5.3-codex, 飞书=gpt-5.2 高亮 |
| C5 | 确认渠道差异 | Lark 有 DingTalk，飞书没有 |
| C6 | 查看 Skill 对比 | 矩阵展示，行=skill，列=3 个实例 |
| C7 | 找到一个不一致的 skill | 某 skill 在一个实例 ready，另一个 missing |
| C8 | 切换对比为 Lark vs TG | diff 更新 |
| C9 | 导航到 Settings | 页面加载 |
| C10 | 配置 LLM provider | 选择 provider，填 API key |
| C11 | 保存 | 成功提示 |
| C12 | 刷新页面 | Settings 保留已保存的配置 |

#### 场景 D：首次使用（零配置启动 + Setup Wizard）

> 角色：新用户，第一次运行 `npm run dev`

| # | 操作 | 预期结果 |
|---|------|----------|
| D1 | `cd ClawSafeMng && npm run dev` | server :7100 和 Vite :7101 启动无报错 |
| D2 | 打开 http://localhost:7101 | 页面加载，显示 Setup Wizard（"Create your admin account"） |
| D3 | 填写用户名和密码（<6 字符） | 提交被阻止或返回错误 |
| D4 | 填写有效用户名和密码（>=6 字符），提交 | 创建 admin 账户，跳转到 Dashboard |
| D5 | 如本机无 .openclaw 目录 | Dashboard 空状态，提示添加实例 |
| D6 | 如本机有 .openclaw 目录 | 自动发现，卡片出现 |
| D7 | 点击添加实例 | 对话框打开 |
| D8 | 填写远程实例 URL + token | |
| D9 | 提交 | 新卡片出现，连接状态显示 |
| D10 | 所有 7 个导航页面逐个点击 | 无白屏、无 console 报错 |
| D11 | 导航到 Settings | LLM 未配置提示可见 |
| D12 | Sessions 页面摘要按钮 | disabled，提示需配置 LLM |

#### 场景 E：权限与用户管理 (RBAC)

> 角色：admin 管理员，验证权限系统

| # | 操作 | 预期结果 |
|---|------|----------|
| E1 | 以 admin 登录 | 登录成功，进入 Dashboard |
| E2 | 创建 operator 用户 | 用户管理页面，填写用户名/密码/角色=operator |
| E3 | 创建 auditor 用户 | 同上，角色=auditor |
| E4 | 登出，以 operator 登录 | 登录成功 |
| E5 | operator 添加实例 | 成功（operator 有 instances 写权限） |
| E6 | operator 访问 Settings 并修改 | 被拒（operator 无 settings 写权限） |
| E7 | operator 访问用户管理 | 被拒（仅 admin 可管理用户） |
| E8 | 登出，以 auditor 登录 | 登录成功 |
| E9 | auditor 浏览所有页面 | 可读，数据正常显示 |
| E10 | auditor 尝试添加实例 | 被拒（auditor 无写权限） |
| E11 | auditor 尝试删除实例 | 被拒 |
| E12 | 登出，以 admin 登录 | |
| E13 | admin 修改 operator 角色为 auditor | 成功 |
| E14 | admin 尝试删除自己 | 被拒（"Cannot delete yourself"） |

#### 场景 F：异常与降级

> 验证各种异常情况下的表现

| # | 操作 | 预期结果 |
|---|------|----------|
| E1 | 添加不存在的实例 URL | 卡片显示 error 状态，红色灯 |
| E2 | 实例运行中断开 Gateway | 状态更新为 disconnected |
| E3 | LLM 未配置时点摘要 | 返回 400 提示，UI 友好显示 |
| E4 | LLM 未配置时生成 Digest | 返回 400 提示 |
| E5 | 删除一个实例 | 卡片消失，其他实例不受影响 |
| E6 | 刷新单个实例 | 数据更新，其他实例不受影响 |
| E7 | 配置对比选同一个实例 | diff 为空或提示"配置相同" |
| E8 | 诊断不存在的工具名 | 结果明确说明工具不存在 |

#### 场景 G：远程实例管理 (SSH Discovery)

> 角色：admin 管理员，通过 SSH 发现远程服务器上的 OpenClaw 实例

| # | 操作 | 预期结果 |
|---|------|----------|
| G1 | 以 admin 登录，导航到 Settings | Remote Hosts 区域可见 |
| G2 | 初始状态无 host | 显示"No remote hosts configured" 提示 |
| G3 | 点击 "+ Add Host" | 添加表单展开 |
| G4 | 填写 Label=Prod, Host=your-server-ip, Port=22, Username=ubuntu | |
| G5 | 选择 Auth Method=Password，填写密码 | |
| G6 | 提交 | host 出现在列表中，credential 显示 "***" |
| G7 | 点击 Scan（单个 host） | 发现 3 个 OpenClaw 实例（default/feishu/tg） |
| G8 | 检查 Dashboard | 新发现的实例卡片出现 |
| G9 | 切换 Auth Method=Private Key | textarea 出现，可粘贴 PEM 密钥 |
| G10 | 删除 host | host 从列表消失 |

---

## 五、文件结构

```
packages/server/src/
  auth/__tests__/password.test.ts          # 新增: 5 个用例
  auth/__tests__/session.test.ts           # 新增: 6 个用例
  auth/__tests__/store.test.ts             # 新增: 12 个用例
  auth/__tests__/middleware.test.ts         # 新增: 15 个用例
  hosts/__tests__/crypto.test.ts            # 新增(v3): 4 个用例
  hosts/__tests__/store.test.ts            # 新增(v3): 8 个用例
  api/__tests__/hosts.test.ts              # 新增(v3): 6 个用例
  api/__tests__/auth.test.ts               # 新增: 19 个用例
  api/__tests__/rbac.test.ts               # 新增: 6 个用例
  gateway/__tests__/client.test.ts         # 已有: 18 个用例
  instances/__tests__/discovery.test.ts    # 已有: 8 个用例
  instances/__tests__/store.test.ts        # 已有: 6 个用例
  llm/__tests__/client.test.ts             # 已有: 5 个用例
  api/__tests__/instances.test.ts          # 已有: 6 个用例
  api/__tests__/sessions.test.ts           # 已有: 5 个用例
  api/__tests__/config.test.ts             # 已有: 4 个用例
  api/__tests__/security.test.ts           # 已有: 3 个用例
  api/__tests__/tools.test.ts              # 已有: 8 个用例
  api/__tests__/operations.test.ts         # 已有: 3 个用例
  api/__tests__/settings.test.ts           # 已有: 3 个用例
  api/__tests__/digest.test.ts             # 已有: 1 个用例
  __tests__/integration.test.ts            # 已有: 6 个用例
  __tests__/live.test.ts                   # 已有: 9 个用例 (test:live)

packages/web/src/
  __tests__/setup.ts                       # msw + testing-library 配置
  __tests__/handlers.ts                    # msw handlers (含 auth 端点)
  components/__tests__/Sidebar.test.tsx    # 已有: 3 个用例
  pages/__tests__/Login.test.tsx           # 新增: 8 个用例
  pages/__tests__/Dashboard.test.tsx       # 已有: 5 个用例
  pages/__tests__/Sessions.test.tsx        # 已有: 4 个用例
  pages/__tests__/Security.test.tsx        # 已有: 3 个用例
  pages/__tests__/Config.test.tsx          # 已有: 3 个用例
  pages/__tests__/Tools.test.tsx           # 已有: 4 个用例
  pages/__tests__/Settings.test.tsx        # 已有: 5 个用例

e2e/
  playwright.config.ts
  auth.spec.ts                             # 新增: 5 步
  startup.spec.ts                          # 已有: 3 步
  navigation.spec.ts                       # 已有: 8 步
  settings.spec.ts                         # 已有: 2 步
```

## 六、CI 集成

### 6.1 npm scripts

```json
{
  "test": "vitest",
  "test:unit": "vitest run packages/server",
  "test:components": "vitest run packages/web",
  "test:e2e": "playwright test",
  "test:live": "CLAWCTL_LIVE=1 vitest run packages/server/src/__tests__/live.test.ts",
  "test:all": "vitest run && playwright test"
}
```

### 6.2 GitHub Actions

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm test           # unit + component tests
      - run: npx playwright install --with-deps
      - run: npm run test:e2e   # E2E tests
```

`test:live` 不在 CI 中运行，仅本地/手动触发。

## 七、用例统计

| 层级 | v1 基础 | v2 Auth & RBAC | v3 Remote Hosts | 合计 |
|------|---------|----------------|-----------------|------|
| 后端单元测试 | 76 | +63 | +18 (crypto 4, store 8, API 6) | 157 |
| 后端集成测试 | 6 | — | — | 6 |
| 后端 Live 测试 | 9 (可选) | — | — | 9 |
| 前端组件测试 | 27 | +8 (Login) | — | 35 |
| E2E 测试 | 13 | +4 (auth flow) | — | 17 |
| 手动冒烟测试 | 7 | — | +1 (Remote Hosts) | 8 |
| 手动场景验收 | ~50 | +14 (场景 E RBAC) | +10 (场景 G SSH 发现) | ~74 |
| **合计** | **~188** | **+89** | **+29** | **~306** |

---

## 附录 D: v4 数据修复 + 交互增强 (Session 2) 测试清单

> 新增于 2026-03-07 Session 2

### D.1 Config 解析修复

| # | 测试项 | 验证方式 |
|---|--------|----------|
| D1.1 | Security 页面 Channel Policies 表有数据 | 打开 /security → 滚动到 Channel Policies 表 → 有 telegram/feishu/dingtalk 行 |
| D1.2 | Security 页面 Agent Bindings 表有数据 | 打开 /security → 滚动到 Agent Bindings 表 → 有 bhpc_owner/bhpc 绑定行 |
| D1.3 | Instance Security tab Channel Policies | /instance/ssh-1-feishu → Security tab → Channel Policies 表显示 telegram/feishu 策略 |
| D1.4 | PolicyBadge 颜色正确 | open=红, pairing=黄, allowlist=绿, true=绿, false=灰 |

### D.2 Agent 信息解析

| # | 测试项 | 验证方式 |
|---|--------|----------|
| D2.1 | Model 显示具体模型 | Instance Overview Agents 表 → Model 列显示 `openai-codex/gpt-5.3-codex` 而非 `default` |
| D2.2 | Thinking 深度列 | Agents 表有 Thinking 列, 显示 `low` 或 `high` |
| D2.3 | Tools 白名单 | bhpc agent 显示 `read, exec, process, ...` 而非 `all`; main 显示 `all` |
| D2.4 | Security Agent Permissions Risk | bhpc 有 exec → Risk=high; main tools=all 且无 exec → Risk=low |

### D.3 会话消息分页

| # | 测试项 | 验证方式 |
|---|--------|----------|
| D3.1 | 初始加载 50 条 | 点击一个长会话 → 显示 "50 msgs" + "Load more" 按钮 |
| D3.2 | Load more 加载更多 | 点击 Load more → msgs 数增加 (50→200) |
| D3.3 | 短会话无 Load more | 点击一个 < 50 条消息的会话 → 无 Load more 按钮 |
| D3.4 | Loading 指示器 | 点击会话时显示 "Loading messages..." 直到加载完成 |

### D.4 消息排序

| # | 测试项 | 验证方式 |
|---|--------|----------|
| D4.1 | 默认正序 (↑ Old) | 消息按时间正序排列, 第一条是最早的消息 |
| D4.2 | 切换倒序 (↓ New) | 点击排序按钮 → 最新消息显示在顶部 |
| D4.3 | Instance Sessions tab 排序 | Instance 详情页 Sessions tab 有 ↓New/↑Old 排序按钮, 点击切换列表排序 |

### D.5 Sessions 全局排序

| # | 测试项 | 验证方式 |
|---|--------|----------|
| D5.1 | ↓ New 默认 | Sessions 页面默认显示最新会话在前 |
| D5.2 | ↑ Old 切换 | 点击排序按钮 → 最旧会话在前 (6d ago) |
| D5.3 | 排序状态保持 | 切换实例 filter 后排序状态不变 |
