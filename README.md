# Ambient Project Layer Demo

这是一个按 `docs/specs/ambient-project-layer-demo.md` 和 `docs/plans/ambient-project-layer-demo-implementation-plan.md` 实现的可运行 Demo：Codex 通过 MCP 将当前工作回合的项目事件可靠写入本地 SQLite Outbox，服务进程异步投射到 Plane，并提供自制的轻量 React 项目面板查看和修正。Plane SDK/API 只承担后端项目管理能力，Plane 是用户可见项目数据的最终真相源；Panel 不直接持有或调用 Plane API Key。

正式 UI 入口是 MCP App：Codex 调用 `open_project_panel` 后，组件从官方 MCP Apps 工具结果 `_meta` 中读取一次性本地会话 bootstrap，并通过 localhost Fastify Service 访问数据。4318 页面仅用于独立开发/降级，不是正式认证协议。

## 快速启动

需要 Node.js 22 和 Corepack。项目通过 `package.json` 的 `packageManager` 固定使用 pnpm 10.34.5。

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

因此每个 Codex/MCP 进程拥有独立的动态端口和令牌；进程重启后旧 Panel 请求新 BFF 会得到 401。正式插件 `.mcp.json` 不注入 `AMBIENT_SESSION_TOKEN` 或 `AMBIENT_SERVICE_BASE_URL`。默认使用 `PLANE_MODE=fake`，Fake Plane 会提供一个 `Demo Project`。

独立 `apps/service` + 4318 页面只用于开发/宿主降级：开发者必须显式设置 `AMBIENT_SESSION_TOKEN`，Service 使用 `SERVICE_PORT=4317`，Panel 通过 Vite proxy 访问它。Service 若未设置开发令牌会安全地生成内存令牌，但 4318 页面无法自动取得该值。

在 Codex 中显式请求打开项目面板时，模型调用 `open_project_panel`（传入 Hook 上下文中的 `projectContextId` 或当前 `cwd`）。工具的普通 `content` 只返回 “Project panel initialized.”；`serviceBaseUrl`、`sessionToken`、`projectContextId` 只放在组件可见的结果 `_meta["ambient-project/bootstrap"]`，不会进入模型 content、全局 instructions、Hook 输出、SQLite、Plane 或日志。

独立开发降级页面仍可用：`pnpm dev:panel` 后打开 <http://127.0.0.1:4318>，手工输入 cwd 和临时令牌。Vite proxy 只转发 `/api` 和 `/health`，不会注入令牌；页面内存中使用令牌，刷新后需要重新输入。

接入真实 Plane 时，在 `.env` 中设置 `PLANE_MODE=sdk`、`PLANE_BASE_URL`、`PLANE_API_KEY` 和 `PLANE_WORKSPACE_SLUG`，再使用正式插件或开发入口。真实 Plane 连接统一通过官方 `@makeplane/plane-node-sdk` 完成；API key 只由服务端读取，不进入 SQLite、Hook 上下文或浏览器。

## Codex 插件

`plugin/` 包含 `.codex-plugin/plugin.json`、`.mcp.json`、五种 Hook 配置和 `ambient-project` Skill。`pnpm build` 会自动刷新 `plugin/runtime/`：`runtime/mcp/index.js` 和 `runtime/hook-adapter/index.js` 是 Node 22 bundle，`runtime/node_modules/` 只包含 `better-sqlite3` 的 JS/native runtime closure 和 Plane SDK 的生产运行时依赖。插件配置只使用 `${PLUGIN_ROOT}` 内路径，Hook 的命令路径带引号以支持含空格的插件安装目录。

MCP 暴露五个项目工作流工具和一个 UI bootstrap 工具：`list_projects`、`get_binding`、`open_project_panel`、`bind_project`、`change_binding`、`record_project_events`。没有自动删除、跨项目移动或分配人员的工具。Panel 资源 URI 是 `ui://ambient-project/panel/v1.html`，使用官方 `_meta.ui.resourceUri` 连接工具和组件资源；它是自制 Codex 侧边栏/宿主 UI，Plane SDK/API 不进入浏览器代码。

## 验证

```bash
pnpm test
pnpm lint
pnpm build
pnpm eval
pnpm smoke:plugin
```

Hook 可用 fixture 直接试跑：

```bash
node apps/hook-adapter/dist/index.js < fixtures/hooks/user-prompt-submit.json
```

隔离验证只复制 `plugin/`（含空格的临时路径），并检查 MCP STDIO `initialize`/`tools/list` 与五种 Hook fixture：

```bash
pnpm smoke:plugin
```

评估文件 `evals/turns.jsonl` 是真实会话标注模板。将每个自然回合的 `actualBatchId` 和 `shouldCapture` 补齐后运行 `pnpm eval evals/turns.jsonl`，脚本输出捕获率、误记录率和重复记录数。

## 数据边界

本地 SQLite 默认文件为 `ambient-project-demo.sqlite`，只保存项目上下文、Outbox 批次、来源引用、Plane 精简缓存、字段所有权、同步元数据和 Hook 审计。Plane 是用户可见项目数据的唯一真相源。本地不保存完整 Codex transcript、源码、终端输出、评论附件或密钥。
