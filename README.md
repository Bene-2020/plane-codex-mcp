# Ambient Project Layer Demo

这是一个按 `docs/specs/ambient-project-layer-demo.md` 和 `docs/plans/ambient-project-layer-demo-implementation-plan.md` 实现的可运行 Demo：Codex 通过 MCP 将当前工作回合的项目事件可靠写入本地 SQLite Outbox，服务进程异步投射到 Plane，并提供自制的轻量 React 项目面板查看和修正。Plane SDK/API 只承担后端项目管理能力，Plane 是用户可见项目数据的最终真相源；Panel 不直接持有或调用 Plane API Key。

正式 UI 入口是 MCP App：Codex 调用 `open_project_panel` 后，组件从官方 MCP Apps 工具结果 `_meta` 中读取一次性本地会话 bootstrap，并通过 localhost Fastify Service 访问数据。4318 页面仅用于独立开发/降级，不是正式认证协议。

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

Panel 的两条加载路径刻意分开：Codex host 收到 `App.ontoolresult` 后直接使用 bootstrap 中的 `projectContextId` 读取 summary；独立 4318 页面才按输入的 cwd 查询绑定。独立页面找不到绑定时会显示 `No project is bound to …`，不会让 `Load project` 静默无响应。React 保存 API client 时必须把 callable value 包在 state updater 中；回归测试还会让真实 MCP `tools/call` 结果经过 SDK `AppBridge` 和 `ui/notifications/tool-result` 到达 `App.ontoolresult`，证明组件私有 `_meta` 没有被模型 content 代替。

独立开发降级页面仍可用：`pnpm dev:panel` 后打开 <http://127.0.0.1:4318>，手工输入 cwd 和临时令牌。Vite proxy 只转发 `/api` 和 `/health`，不会注入令牌；页面内存中使用令牌，刷新后需要重新输入。

接入真实 Plane 时，独立开发入口可以在 `.env` 中设置 `PLANE_MODE=sdk`、`PLANE_BASE_URL`、`PLANE_API_KEY` 和 `PLANE_WORKSPACE_SLUG`。Codex Desktop 正式插件由 GUI 启动，不能假定它继承终端 `export`；请按 [Codex Desktop 安装与真人验收](docs/codex-desktop-installation.md) 将这些变量持久写入用户级 `~/.codex/config.toml` 的 MCP `env`，不要写入仓库。Plane SDK 当前使用 Axios；当宿主提供明文 `https_proxy` 时，运行时只把配置的 Plane HTTPS host 加入当前 MCP 进程的 `no_proxy`，避免 SDK 把明文 HTTP 发到 HTTPS 端口。这不是 fake 或本地数据 fallback，直连失败会明确报错。真实 Plane 连接统一通过官方 `@makeplane/plane-node-sdk` 完成；API key 只由 MCP/Service 服务端读取，不进入 SQLite、Hook 上下文、Panel、模型 content 或日志。Task、Bug、Decision、Idea、Risk、Milestone 会复用或按需创建同名 Plane Work Item Type，并把 type ID 写入 Work Item；远端刷新时再由该原生 type 恢复 Panel 分类。计划父子项使用 Task 类型，进展写评论，完成写状态。

## Codex 插件

`plugin/` 包含 `.codex-plugin/plugin.json`、`.mcp.json`、五种 Hook 配置和 `ambient-project` Skill。正式插件当前只支持 macOS arm64：`pnpm build` 将固定的 Node 22.22.1 sidecar、`runtime/bin/ambient-node` wrapper、Node 内置 `node:sqlite`、MCP/Hook bundle 和 Plane SDK 运行时一起写入 `plugin/runtime/`；不再打包 `better-sqlite3` 或任何 `.node` ABI 文件。wrapper 在其他 OS/arch 启动时直接报兼容性错误。MCP 与 Hook 都使用插件内入口，路径带引号并支持含空格的安装目录；它们不依赖用户本机的 node、pnpm、bun 或 Node ABI。MCP 配置以插件根目录为 `cwd`，`.mcp.json` 的 `env_vars` 只白名单转发宿主已经提供的变量，不能替代 Codex Desktop 的用户级持久配置。Hook 使用宿主保证的稳定 `PLUGIN_DATA/ambient.sqlite`；MCP 的 `AMBIENT_DB_PATH` 必须明确指向同一文件。Plane Key 只留在 MCP env，不进入 Hook、数据库、Panel 或模型上下文。

MCP 暴露六个项目工作流工具和一个 UI bootstrap 工具：`list_projects`、`get_binding`、`open_project_panel`、`bind_project`、`change_binding`、`record_project_events`、`acknowledge_no_project_events`。后者只持久化当前回合“已审查且无项目事件”的幂等确认，不创建 Plane 项目记录或 Outbox 批次。没有自动删除、跨项目移动或分配人员的工具。Panel 资源 URI 是 `ui://ambient-project/panel/v1.html`，使用官方 `_meta.ui.resourceUri` 连接工具和组件资源；它是自制 Codex 侧边栏/宿主 UI，Plane SDK/API 不进入浏览器代码。

## 验证

```bash
pnpm test
pnpm lint
pnpm build
pnpm eval
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

评估文件 `evals/turns.jsonl` 是真实会话标注模板。将每个自然回合的 `actualBatchId` 和 `shouldCapture` 补齐后运行 `pnpm eval evals/turns.jsonl`，脚本输出捕获率、误记录率和重复记录数。

## 数据边界

本地 SQLite 默认文件为 `ambient-project-demo.sqlite`，由 Node 内置 `node:sqlite` 访问，只保存项目上下文、Outbox 批次、无事件审查确认、来源引用、Plane 精简缓存、字段所有权、同步元数据和 Hook 审计。Plane 是用户可见项目数据的唯一真相源。本地不保存完整 Codex transcript、源码、终端输出、评论附件或密钥。
