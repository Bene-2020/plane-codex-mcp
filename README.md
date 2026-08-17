# Ambient Project Layer Demo

Ambient Project Layer 通过 MCP 将当前工作回合的项目事件可靠写入本地 SQLite Outbox，服务进程异步投射到 Plane，并提供轻量 React Inline 项目卡片查看相关工作和直接修改状态。Plane 是用户可见项目数据的最终真相源和完整项目管理界面；Panel 不直接持有或调用 Plane API Key。

正式 UI 入口是 MCP App：Codex 调用 `open_project_panel` 后，组件从官方 MCP Apps 工具结果 `_meta` 中读取一次性本地会话 bootstrap。在生产 Codex Desktop 中，Panel 通过官方 `App.callServerTool` 桥接由 MCP 进程访问动态 localhost Fastify Service；这样不依赖宿主对沙盒发起本地 HTTP。4318 页面仍用于独立开发/宿主降级，不是正式认证协议。

Inline card 只展示约 3–5 个相关工作项，提供“全部”与四状态查看切换，并支持把卡片拖到四状态更新状态；列表摘要明确区分当前显示数与 Plane 项目级总数。底部主要 CTA 为“在 Plane 中打开 ↗”。

## 快速启动

开发构建需要 Node.js 22 和 Corepack。项目通过 `package.json` 的 `packageManager` 固定使用 pnpm 10.34.5；正式插件不使用用户的 Node/pnpm/bun。

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
pnpm build

# 开发降级：终端 1，固定端口的独立 Service 和 Outbox worker
export AMBIENT_SESSION_TOKEN="$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("base64url"))')"
pnpm dev:service

# 开发降级：终端 2，独立 4318 Panel
pnpm dev:panel
```

正式 Codex 插件路径不需要启动上面的独立 Service，也不需要 export 任何会话变量。插件的 `apps/mcp` 入口在每个 MCP 子进程内：

- 生成一次 32-byte CSPRNG、43 字符 base64url 临时令牌；
- 在 `127.0.0.1:0` 启动该进程专属的 Fastify BFF 和 Outbox worker；
- 将实际端口、BFF 地址和令牌直接注入 MCP App bootstrap；
- MCP 进程关闭时按 MCP transport → Fastify → worker/Storage 顺序清理。

因此每个 Codex/MCP 进程拥有独立的动态端口和令牌；进程重启后旧 Panel 请求新 BFF 会得到 401。正式插件 `.mcp.json` 不注入 `AMBIENT_SESSION_TOKEN` 或 `AMBIENT_SERVICE_BASE_URL`。正式入口不再默认选择 Plane 模式：缺少 `PLANE_MODE` 会在打开数据库前明确失败，不会创建 `Demo Project` 或默认缓存库。Fake 只通过显式的 `PLANE_MODE=fake` 本地测试入口使用。

独立 `apps/service` + 4318 页面只用于开发/宿主降级：开发者必须显式设置 `AMBIENT_SESSION_TOKEN`，Service 使用 `SERVICE_PORT=4317`，Panel 通过 Vite proxy 访问它。Service 若未设置开发令牌会安全地生成内存令牌，但 4318 页面无法自动取得该值。

在 Codex 中显式请求打开项目面板时，模型调用 `open_project_panel`（传入 Hook 上下文中的 `projectContextId` 或当前 `cwd`）。工具的普通 `content` 只返回 “Project panel initialized.”；`serviceBaseUrl`、`sessionToken`、`projectContextId` 只放在组件可见的结果 `_meta["ambient-project/bootstrap"]`，不会进入模型 content、全局 instructions、Hook 输出、SQLite、Plane 或日志。

Panel 的两条加载路径刻意分开：Codex host 收到 `App.ontoolresult` 后直接使用 bootstrap 中的 `projectContextId` 读取 summary；独立 4318 页面才按输入的 cwd 查询绑定。Codex host 若工具返回错误、缺少/非法 bootstrap、宿主或首次 summary 请求失败，统一显示 Plane 风格 720px 异常卡片，不把技术原因透传给用户。React 保存 API client 时必须把 callable value 包在 state updater 中；回归测试还会让真实 MCP `tools/call` 结果经过 SDK `AppBridge` 和 `ui/notifications/tool-result` 到达 `App.ontoolresult`，证明组件私有 `_meta` 没有被模型 content 代替。

独立开发降级页面仍可用：`pnpm dev:panel` 后打开 <http://127.0.0.1:4318>，手工输入 cwd 和临时令牌。Vite proxy 只转发 `/api` 和 `/health`，不会注入令牌；页面内存中使用令牌，刷新后需要重新输入。

接入真实 Plane 时，独立开发入口可以在 `.env` 中设置 `PLANE_MODE=sdk`、`PLANE_BASE_URL`、`PLANE_API_KEY` 和 `PLANE_WORKSPACE_SLUG`。Codex Desktop 正式插件由 GUI 启动，不能假定它继承终端 `export`；请将这些变量持久写入用户级 `~/.codex/config.toml` 的 MCP `env`，不要写入仓库。Plane SDK 当前使用 Axios；当宿主提供明文 `https_proxy` 时，运行时只把配置的 Plane HTTPS host 加入当前 MCP 进程的 `no_proxy`，避免 SDK 把明文 HTTP 发到 HTTPS 端口。这不是 fake 或本地数据 fallback，直连失败会明确报错。真实 Plane 连接统一通过官方 `@makeplane/plane-node-sdk` 完成；API key 只由 MCP/Service 服务端读取，不进入 SQLite、Hook 上下文、Panel、模型 content 或日志。Task、Bug、Decision、Idea、Risk、Milestone 会复用或按需创建同名 Plane Work Item Type，并把 type ID 写入 Work Item；远端刷新时再由该原生 type 恢复 Panel 分类。计划父子项使用 Task 类型，进展写评论，完成写状态。

## Codex 插件

`plugin/` 保存插件 manifest、五种 Hook 配置和 `ambient-project` Skill；构建时生成目标平台 `.mcp.json`、Panel 与 runtime。Codex 插件的 MCP/Hook 配置是单一命令字符串，没有按宿主 OS/架构条件选择命令的字段，因此正式发布采用平台专属包：每个包只携带一个固定 Node 22.22.1 sidecar，并由安装/marketplace 选择与宿主匹配的包。支持矩阵严格为：

| 包目录 | 宿主 | Node 官方归档 | sidecar | launcher |
| --- | --- | --- | --- | --- |
| `darwin-arm64` | macOS arm64 | `node-v22.22.1-darwin-arm64.tar.gz` | `runtime/bin/node` | `runtime/bin/ambient-node` |
| `darwin-x64` | macOS x64 | `node-v22.22.1-darwin-x64.tar.gz` | `runtime/bin/node` | `runtime/bin/ambient-node` |
| `linux-x64` | Linux x64 | `node-v22.22.1-linux-x64.tar.gz` | `runtime/bin/node` | `runtime/bin/ambient-node` |
| `linux-arm64` | Linux arm64 | `node-v22.22.1-linux-arm64.tar.gz` | `runtime/bin/node` | `runtime/bin/ambient-node` |
| `win32-x64` | Windows x64 | `node-v22.22.1-win-x64.zip` | `runtime/bin/node.exe` | `runtime/bin/ambient-node.cmd` |

`pnpm build` 默认构建当前宿主的可安装包到 `plugin/`；发布全部目标时先构建应用，再运行 `pnpm package:plugin -- --all`，产物位于 `dist/plugins/ambient-project-layer/<target>/`，每个目标目录本身就是可安装插件根目录。也可以单独构建，例如 `pnpm package:plugin -- --target=linux-arm64 --output=dist/plugins/ambient-project-layer/linux-arm64`。每个包的 `runtime/runtime.json` 声明唯一 target、平台、架构、Node 版本、sidecar 文件名和 `node:sqlite`；Unix 包使用目标专属 POSIX launcher，Windows 包使用 `ambient-node.cmd` 和 `node.exe`，不会把 Unix shell wrapper 交给 Windows。

包布局为：

```text
<target-package>/
├── .codex-plugin/plugin.json
├── .mcp.json
├── hooks/hooks.json
├── panel/dist/index.html
└── runtime/
    ├── bin/ambient-node       # Unix；Windows 为 ambient-node.cmd
    ├── bin/node               # Unix；Windows 为 node.exe
    ├── LICENSE.nodejs
    ├── runtime.json
    ├── mcp/index.js
    └── hook-adapter/index.js
```

`pnpm validate:plugin` 验证当前 `plugin/`，验证完整平台集合使用 `node scripts/validate-plugin-runtime.mjs dist/plugins/ambient-project-layer --all`。验证器对当前原生目标执行 sidecar `--version`，对其他目标检查 manifest、runtime manifest、归档对应的 sidecar 文件名、Node license、MCP 与全部五个 Hook 的 launcher 选择，并拒绝 `.node`/`better-sqlite3` 和系统 runtime fallback。launcher 在错装到其他 OS/arch 时直接报告兼容性错误并退出，不调用用户本机的 node、pnpm 或 bun。MCP 与 Hook 都使用插件内入口，路径带引号并支持含空格的安装目录；MCP 配置以插件根目录为 `cwd`，`.mcp.json` 的 `env_vars` 只白名单转发宿主已经提供的变量，不能替代 Codex Desktop 的用户级持久配置。Hook 使用宿主保证的稳定 `PLUGIN_DATA/ambient.sqlite`；MCP 的 `AMBIENT_DB_PATH` 必须明确指向同一文件。Plane Key 只留在 MCP env，不进入 Hook、数据库、Panel 或模型上下文。

安装或升级插件后，必须在 Codex 的 Hook 管理界面人工复核并信任当前版本的五个 Hook，然后再新建 task 验收。`enabled = true` 只表示 Hook 已配置，不代表它已获准执行；如果运行时信任状态为 `modified`，Codex 会在启动 Hook 进程前拦截它。即使 `hooks.json` 文本没有变化，版本化缓存路径或解析后的命令变化也可能改变定义哈希，因此不要沿用上一版本的信任结果。典型症状是 MCP 工具仍可用，但新 task 没有项目上下文注入，正式插件数据库也没有该 session 的 `SessionStart` 或 `UserPromptSubmit` 审计。重新信任后，当前 task 的下一次提示可恢复 `UserPromptSubmit`；已经错过的 `SessionStart` 不会补跑，必须再新建 task 验证完整启动链。

MCP 暴露八个项目工作流工具和一个 UI bootstrap 工具：`list_projects`、`get_binding`、`open_project_panel`、`bind_project`、`change_binding`、`decline_project_binding`、`restore_project_binding`、`record_project_events`、`acknowledge_no_project_events`。未绑定 cwd 的新 session 首次 UserPromptSubmit 会依据当前消息和可见对话主动引导列出真实 Plane 项目并等待用户选择；漏问时后续 prompt 会补问，模糊暂缓只影响当前 session，明确长期拒绝才写入按稳定 workspace identity 归属的本地偏好。非 Git root 拒绝由 child/sibling 按最长祖先继承，child 重复 decline 复用 root，child restore/bind 使用精确 override，不静默影响 sibling。`PostToolUse` 可审计 `list_projects`、record/ack 和两个绑定偏好工具；`record_tool_called` 只由 `record_project_events` 置为 1，`binding_list_tool_called` 只由精确的 `list_projects` 置为 1。调用 `list_projects` 后，工具输出、commentary 和思考过程不算用户交付；最终 `last_assistant_message` 必须展示真实项目，并包含“项目绑定（待确认）”区块、至少一个 Markdown 项目列表项和“请选择一个项目，或回复‘稍后再说’。”，同时继续完成主任务。用户明确推翻计划时，系统创建的计划父项及其步骤会逐项先完成再归档；完成、替换或归档父项前必须检查并处理全部已知子项，不能只关闭主项。Panel 另有仅组件可见的 `ambient_project_panel_request` server-tool bridge；它只代理固定的 Panel API 路径，不进入模型工具目录，且由 MCP 进程在同一动态 BFF 会话中带 token 请求。后者只持久化当前回合“已审查且无项目事件”的幂等确认，不创建 Plane 项目记录或 Outbox 批次。没有自动删除、跨项目移动或分配人员的模型工具。Panel 资源 URI 是 `ui://ambient-project/panel/v1.html`，使用官方 `_meta.ui.resourceUri` 连接工具和组件资源；它是自制 Codex Inline/宿主 UI，Plane SDK/API 不进入浏览器代码。

## 验证

```bash
pnpm test
pnpm lint
pnpm build
pnpm validate:plugin
pnpm smoke:plugin
```

Hook 可用 fixture 直接试跑：

```bash
node apps/hook-adapter/dist/index.js < fixtures/hooks/user-prompt-submit.json
```

隔离验证只复制 `plugin/`（含空格的临时路径），把 PATH 设为不含 node/pnpm/bun 的目录，并检查 MCP STDIO `initialize`/`tools/list`/`resources/read`/`open_project_panel`、带 `https://web-sandbox.oaiusercontent.com` Origin 的 token summary 请求与五种 Hook fixture：

```bash
pnpm smoke:plugin
```

## 数据边界

本地 SQLite 默认文件为 `ambient-project-demo.sqlite`，由 Node 内置 `node:sqlite` 访问，只保存项目上下文、Outbox 批次、无事件审查确认、来源引用、Plane 精简缓存、字段所有权、同步元数据和 Hook 审计。`turn_audits.binding_list_tool_called` 只表示同一 `session_id + turn_id` 是否收到过精确的 `list_projects` PostToolUse；Stop 行的 `capture_decision_recorded` 与 `binding_prompt_delivered` 只保存当前回合捕获/绑定交付的布尔结果，非适用场景为 `NULL`，不保存 `last_assistant_message` 或用户原文。Stop 始终允许回合结束，不返回用户可见反馈或注入二次提示。Plane 是用户可见项目数据的唯一真相源。本地不保存完整 Codex transcript、源码、终端输出、评论附件或密钥。

仓库开发数据库与 Codex Desktop 已安装插件数据库彼此独立，不会自动同步。
