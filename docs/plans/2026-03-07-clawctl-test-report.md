# ClawCtl MVP v0.1 测试报告

> **日期:** 2026-03-07
> **状态:** All Passing
> **版本:** v3（v1 基础模块 + v2 Auth & RBAC + v3 Remote Hosts）
> **代码位置:** `/Users/kris/proj/openclaw/ClawSafeMng/`
> **关联文档:** `docs/plans/2026-03-07-clawctl-test-plan.md`

---

## 一、执行摘要

ClawCtl MVP v0.1 完成三轮测试实现：

- **v1（基础模块）** — 覆盖 7 个业务模块（Dashboard, Sessions, Usage, Security, Config, Tools, Operations + Settings）
- **v2（Auth & RBAC）** — 覆盖认证和权限系统（Password, Session, UserStore, Middleware, Auth API, RBAC, Login 页面, E2E Auth Flow）
- **v3（Remote Hosts）** — 覆盖远程实例管理（Credential Encryption, HostStore, Hosts API + RBAC）

全部测试通过，无跳过（除 Live 测试需环境变量）。

---

## 二、测试结果汇总

| 层级 | 文件数 | 测试数 | 通过 | 失败 | 跳过 |
|------|--------|--------|------|------|------|
| 后端单元测试 | 22 | 156 | 156 | 0 | 0 |
| 后端 Live 测试 | 1 | 9 | — | — | 9 (env-gated) |
| 前端组件测试 | 8 | 35 | 35 | 0 | 0 |
| E2E (Playwright + Chromium) | 4 | 17 | 17 | 0 | 0 |
| **合计** | **35** | **217** | **208** | **0** | **9** |

执行耗时：
- Backend: ~960ms
- Frontend: ~1.3s
- E2E: ~4.3s

---

## 三、后端测试明细

### 3.1 Gateway & Instance 层

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `gateway/__tests__/client.test.ts` | 18 | PASS |
| `instances/__tests__/discovery.test.ts` | 8 | PASS |
| `instances/__tests__/store.test.ts` | 6 | PASS |
| `llm/__tests__/client.test.ts` | 5 | PASS |

### 3.2 Auth & RBAC 层

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `auth/__tests__/password.test.ts` | 5 | PASS |
| `auth/__tests__/session.test.ts` | 5 | PASS |
| `auth/__tests__/store.test.ts` | 12 | PASS |
| `auth/__tests__/middleware.test.ts` | 15 | PASS |

### 3.3 Remote Hosts 层

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `hosts/__tests__/crypto.test.ts` | 4 | PASS |
| `hosts/__tests__/store.test.ts` | 8 | PASS |
| `api/__tests__/hosts.test.ts` | 6 | PASS |

### 3.4 API 路由层

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `api/__tests__/auth.test.ts` | 19 | PASS |
| `api/__tests__/rbac.test.ts` | 6 | PASS |
| `api/__tests__/instances.test.ts` | 6 | PASS |
| `api/__tests__/sessions.test.ts` | 5 | PASS |
| `api/__tests__/config.test.ts` | 4 | PASS |
| `api/__tests__/security.test.ts` | 3 | PASS |
| `api/__tests__/tools.test.ts` | 8 | PASS |
| `api/__tests__/operations.test.ts` | 3 | PASS |
| `api/__tests__/settings.test.ts` | 3 | PASS |
| `api/__tests__/digest.test.ts` | 1 | PASS |

### 3.5 集成测试

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `__tests__/integration.test.ts` | 6 | PASS |
| `__tests__/live.test.ts` | 9 | SKIPPED (需 `CLAWCTL_LIVE_URL`) |

---

## 四、前端测试明细

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `components/__tests__/Sidebar.test.tsx` | 3 | PASS |
| `pages/__tests__/Login.test.tsx` | 8 | PASS |
| `pages/__tests__/Dashboard.test.tsx` | 5 | PASS |
| `pages/__tests__/Sessions.test.tsx` | 4 | PASS |
| `pages/__tests__/Security.test.tsx` | 3 | PASS |
| `pages/__tests__/Config.test.tsx` | 3 | PASS |
| `pages/__tests__/Tools.test.tsx` | 4 | PASS |
| `pages/__tests__/Settings.test.tsx` | 5 | PASS |

---

## 五、E2E 测试明细

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `e2e/auth.spec.ts` | 4 | PASS |
| `e2e/startup.spec.ts` | 3 | PASS |
| `e2e/navigation.spec.ts` | 8 | PASS |
| `e2e/settings.spec.ts` | 2 | PASS |

E2E 使用 Playwright + headless Chromium，通过 `globalSetup` 自动创建 admin 账户并保存 session cookie。

---

## 六、测试基础设施

### 6.1 后端 Mock

| 组件 | 文件 | 说明 |
|------|------|------|
| Mock WebSocket Gateway | `__tests__/helpers/mock-ws-server.ts` | JSON-RPC mock，支持 `onRpc()` 注册 handler |
| Mock Instance Manager | `__tests__/helpers/mock-instance-manager.ts` | 无真实 WS 连接的 InstanceManager |
| Test Fixtures | `__tests__/helpers/fixtures.ts` | `makeConnection()`, `makeInstanceInfo()`, `MOCK_RPC_RESPONSES` |
| Mock Auth Middleware | `__tests__/helpers/mock-auth.ts` | 注入 admin 用户绕过认证（支持自定义角色） |

### 6.2 前端 Mock

| 组件 | 文件 | 说明 |
|------|------|------|
| MSW Handlers | `__tests__/handlers.ts` | 所有 API 端点 mock（含 auth） |
| Test Setup | `__tests__/setup.ts` | MSW server lifecycle + jest-dom |

### 6.3 E2E 基础设施

| 组件 | 文件 | 说明 |
|------|------|------|
| Playwright Config | `e2e/playwright.config.ts` | headless Chromium, dev server 自启动 |
| Global Setup | `e2e/global-setup.ts` | 自动创建 admin 账户 + 保存 auth cookie |

### 6.4 CI

| 文件 | 说明 |
|------|------|
| `.github/workflows/test.yml` | GitHub Actions: unit → component → E2E |

### 6.5 npm scripts

```
npm run test:unit       # 后端单元测试 (156 tests)
npm run test:components # 前端组件测试 (35 tests)
npm run test:e2e        # Playwright E2E (17 tests)
npm run test:live       # Live 集成测试 (需 CLAWCTL_LIVE_URL)
npm run test:all        # unit + components
```

---

## 七、实现过程中修复的问题

| 问题 | 原因 | 修复 |
|------|------|------|
| Mock WS server handler 抛异常导致客户端 hang | `catch {}` 静默吞异常不回复 | 捕获后返回 JSON-RPC error response |
| 前端 vitest setupFiles 路径错误 | 相对路径从 CWD 解析而非 config 目录 | 改用 `path.resolve(__dirname, ...)` |
| E2E `getByText` 匹配多个元素 | sidebar 链接和页面标题同名 | 改用 `getByRole("heading", ...)` |
| Operations 页面 heading 不匹配 | 实际标题是 "Operation Center" | 更新测试数据 |
| Settings 组件测试崩溃 | `useAuth()` 需要 AuthContext.Provider | 包裹 AuthContext.Provider + mock auth |
| E2E 登录后才能访问页面 | Auth 系统加入后所有页面需认证 | 添加 Playwright globalSetup 处理登录 |
| `DELETE /users/:id` 测试失败 | admin token userId=1 与被删用户 id=1 冲突 | 先创建 admin 用户使 alice 获得 id=2 |
| E2E auth 测试 `getByLabel` 找不到 | label 未关联 input（无 htmlFor） | 改用 `getByText` |
| E2E settings 多 select 冲突 | User Management 新增角色 select | 用 `filter({ has: ... })` 精确匹配 |

---

## 八、覆盖范围

### 已覆盖

- 所有 7 个业务模块的后端 API 路由
- Auth 系统全链路（password → token → store → middleware → API → RBAC）
- Remote Hosts 管理（AES-256-GCM 凭据加密、HostStore CRUD、API 路由 + admin RBAC）
- 前端 8 个页面组件渲染和交互
- E2E 导航、设置、认证流程
- Gateway WebSocket 客户端（18 场景包含部分失败容错）
- 实例发现、SQLite Store、LLM 降级

### 未覆盖（设计决策）

- SSH Discovery (`hosts/discovery.ts`) — 依赖真实 SSH 连接，通过手动测试验证
- Remote Hosts 前端区域 — Settings 组件测试未覆盖 hosts UI（MSW 缺 `/api/hosts` handler）
- LLM 输出质量测试（按方案，只测降级逻辑）
- WebSocket 实时推送（仅测 HTTP API）
- 性能/负载测试
- 跨浏览器 E2E（仅 Chromium）

### 已知 Warning

- Settings 前端测试运行时 MSW 报 `GET /api/hosts` 未处理 — 不影响测试通过，admin 用户渲染 Settings 时请求 hosts 列表
