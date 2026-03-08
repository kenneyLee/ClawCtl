# ClawSafeMng Changelog

## 2026-03-07 (Session 3) — 生命周期管理 + 监控 + Bug 修复

### Features

- **Monitoring 页面**: 新增主机监控仪表盘，实时展示 CPU/内存/运行时间和关联实例状态。服务端 30s 缓存 + 请求去重，避免并发 SSH 连接风暴。
- **Instance Lifecycle 管理**: Control tab 支持 Start/Stop/Restart 进程控制、版本查看、配置文件查看/编辑。
- **Stream Logs**: 实时日志流，自动检测日志源 (文件 → journalctl --user → journalctl system)，SSE 格式推送。
- **Config Snapshots**: 配置快照管理，支持创建、查看、对比 (diff)、清理。
- **Agent 配置管理**: 结构化的 Agent CRUD、全局默认值设置、安全模板应用。
- **Install/Upgrade**: 主机级别的 OpenClaw 安装/升级，含 Node.js 版本检查。
- **Host Diagnose**: 远程主机诊断 (Node 版本、OpenClaw 版本、磁盘空间)。
- **ReactFlow 拓扑图**: Dashboard 新增交互式实例拓扑图 (ReactFlow)。
- **Recharts 图表**: Usage 页面新增 token 用量折线图 (Recharts)。

### Bug Fixes

- **Config 路径 `~` 不展开**: `getConfigDir()` 使用 `~` 在 SSH 非交互式 shell 的双引号中不展开，导致 `cat "~/.openclaw/openclaw.json"` 失败。改为 `$HOME`。
- **VERSION 显示 "not found"**: `openclaw --version` 在 SSH 中不稳定。改为优先使用 WebSocket 握手返回的版本号。
- **进程状态误报 "Stopped"**: `lsof` 在远端查找本地 tunnel 端口导致误判。改为 WebSocket 连接状态作为首要信号。
- **Stream Logs 无输出**: 日志文件不存在时 `tail -f` 静默挂起。改为多源检测 + journalctl --user 支持。
- **journalctl 误报**: `-- No entries --` 被 `grep -c .` 计为有内容。加 `-q` 标志修复。
- **Configuration File 空白**: 上述 `~` → `$HOME` 修复的直接体现。config-file GET 端点增加 try-catch 和前端错误展示。
- **Monitoring 加载慢**: 每次请求重新建立 SSH 连接。增加服务端 30s 缓存 + in-flight 请求去重。

### 经验教训

1. **SSH 非交互式 shell**: `~` 在双引号内不展开 (`"~/.openclaw"` → 字面 `~`)，必须用 `$HOME`。
2. **systemd --user**: OpenClaw 以用户级 systemd 服务运行，需要 `journalctl --user` 和 `systemctl --user`。
3. **WebSocket 状态优先**: 对于已连接的实例，WebSocket 连接状态比 SSH lsof 更可靠。
4. **服务端缓存模式**: SSH 密集型端点应做服务端缓存 + 请求去重，避免并发 SSH 连接。

---

## 2026-03-07 (Session 2) — 数据修复 + 交互增强

### Bug Fixes

- **Config 路径修复**: `Security.tsx` 和 `Instance.tsx` 中的 channel policies / bindings 解析路径错误 (`config.channels` → `config.parsed.channels`)，导致安全页面 Channel Policies 和 Agent Bindings 表格为空。
- **Agent 配置路径修复**: per-agent 配置在 `agents.list[]` 数组中，而非 `agents.agents{}` 对象。之前代码查 `agents.agents` 导致 tools.allow / model / thinking 全部取不到。
- **Model "default" 问题**: Agent model 显示 "default" 而非具体模型名。原因是 `agents.list` RPC 返回的 model 字段为 `"default"`，需要从 config 的 `agents.defaults.model.primary` 或 per-agent `model.primary` 解析。

### Features

- **Thinking 深度列**: Agent 表格新增 Thinking 列，显示每个 agent 的思考深度 (low/high/etc)，从 config 的 `agents.defaults.thinkingDefault` 或 per-agent 覆盖解析。
- **Tools 白名单解析**: 从 `agents.list[].tools.allow` 解析每个 agent 的工具白名单，不再全部显示 "all"。bhpc agent 正确显示 `read, exec, process, feishu_doc...` 等。
- **会话消息分页**: `chat.history` RPC 支持 `limit` 参数 (1-1000, 默认 200)。前端初始加载 50 条，"Load more" 逐步加载更多 (50→200→800→1000)。
- **消息加载指示器**: 点击会话后显示 "Loading messages..." 直到消息加载完成。
- **消息正倒序**: 会话消息支持 ↑Old / ↓New 排序切换，方便快速查看最新或最早消息。
- **Sessions 排序**: Instance 详情页的 Sessions tab 新增排序切换按钮 (↓New / ↑Old)。

### 经验教训

1. **OpenClaw config 结构**: 配置通过 Gateway 的 `config.read` RPC 返回，格式为 `{ path, exists, raw, parsed: {...} }`。实际配置在 `parsed` 下。
2. **Agent 配置在 list 而非 agents**: `parsed.agents.list[]` 是 agent 数组，每个 agent 有 `id, name, workspace, tools, model` 等字段。`parsed.agents.agents` 不存在或为空。
3. **Model 解析链**: Agent model 优先级: per-agent `list[].model.primary` → `defaults.model.primary` → RPC 返回值。
4. **Thinking 解析链**: per-agent `list[].thinkingDefault` → `defaults.thinkingDefault` → per-model `defaults.models[key].params.thinking`。
5. **Tools 解析链**: RPC `agents.list` 的 `tools.allow` (通常为空) → config `agents.list[].tools.allow`。
6. **认证 cookie 名**: 登录 cookie 名为 `clawctl_token`，非 `auth_token`。

---

## 2026-03-07 (Session 1) — MVP 上线 + 5 大功能

### Features

- **Sessions 实例过滤**: 实例 > 4 个时自动切换为下拉选择，否则使用水平可滚动标签。
- **Sessions 排序 + 别名**: 正序/倒序切换按钮。会话有 displayName 时优先显示，key 作为副标题。
- **Instance 详情页**: Dashboard 实例卡片可点击进入 `/instance/:id`，含 Overview/Sessions/Config/Security 4 个 Tab。
- **工具诊断模糊匹配**: 精确 → 子串模糊匹配 + 工具目录交叉检查。
- **Security 页面增强**: Channel Policies 表 (dmPolicy/groupPolicy/allowFrom 等) + Agent Bindings 表。
- **版本修复**: 从 SSH 二进制获取版本 (`openclaw --version`) 作为主源，Gateway handshake 作为 fallback。
- **Usage 页面**: 全局汇总 + 每实例 token 用量表。
- **强制退出**: SSH tunnel `destroy()` + 3s 超时 `process.exit(1)` 防止僵尸进程。
