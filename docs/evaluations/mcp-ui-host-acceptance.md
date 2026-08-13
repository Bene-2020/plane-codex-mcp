# MCP UI 宿主验收记录

日期：2026-08-10

## 已实现

MCP server 注册一个正式可交互的 MCP App 工具和资源：

```text
tool: open_project_panel
resource: ui://ambient-project/panel/v1.html
mime: text/html;profile=mcp-app
```

工具使用官方 `_meta.ui.resourceUri` 关联资源。调用结果的普通 `content` 只有 `Project panel initialized.`；`serviceBaseUrl`、`sessionToken`、`projectContextId` 位于 `_meta["ambient-project/bootstrap"]`，由 `App.ontoolresult` 传给组件，不能通过模型可见 content 获得。

正式 `apps/mcp` 入口在同一进程以动态端口启动 BFF/worker，并生成进程级 32-byte CSPRNG base64url 临时令牌保护所有 `/api/*`。资源通过 `_meta.ui.csp.connectDomains` 声明该实例的实际 localhost origin；Panel 不持有 Plane API Key。

## 已验证

自动测试覆盖 MCP tools/list 的 App metadata、工具结果 metadata 与 content 隔离、缺失 bootstrap 安全行为、动态 BFF 启动/实际 URL/授权请求/重启令牌轮换、`open_project_panel → App.ontoolresult → App.callServerTool → MCP server-tool bridge → 动态 BFF summary` 完整链、Panel bootstrap 解析、统一请求头、401 清理且不重试；Service 覆盖 web-sandbox 与 Desktop sandbox Origin、`null`/4318 开发来源、恶意 Origin 拒绝、带 token 的 summary 和精确 CORS。插件隔离冒烟覆盖显式 `PLANE_MODE=fake` 的测试入口、缺少 Plane 配置时在打开数据库前失败、PATH 无 node/pnpm/bun、MCP `initialize`/`tools/list`/`resources/read`/`open_project_panel`、Panel server-tool bridge、带 Origin 的 summary 和五种 Hook fixture。正式 Desktop 的真实 SDK、数据库和凭据配置按 [Codex Desktop 安装与真人验收](../codex-desktop-installation.md) 记录，不把 Plane key 放入 Panel 或模型可见输出。

正式 Desktop 验收还必须在首次安装和每次升级后人工信任当前版本的五个 Hook，再新建 task。插件 enabled 或 MCP 可用不能替代 Hook 信任验证；若 Hook 显示 `modified`，宿主会在适配器启动前拦截执行，正式数据库不会产生该 session 的审计记录。重新信任后的当前 task 可验证 `UserPromptSubmit`，完整 `SessionStart` 链必须用新 task 验证。

## SMWC-10 / SMWC-13 根因与自动回归

- SMWC-10：独立页面的 `/api/context` 在 cwd 未绑定时返回 `null`；旧 Panel 直接清空 summary 并返回，所以 `Load project` 没有用户可见结果。现在该路径抛出并显示 `No project is bound to <cwd>`。Codex host 路径始终按 bootstrap `projectContextId` 读取，不执行 cwd lookup。
- SMWC-13：MCP result 和标准 host bridge 都没有丢失 `_meta`。实际断点是 `setApiClient(createPanelApi(...))`：React 把返回的 callable client 当成 state updater 执行。现在使用 `setApiClient(() => createPanelApi(...))`；协议链测试证明 result `_meta` 经真实 `AppBridge` 到 `App.ontoolresult`。

## SMWC-14 / SMWC-15 复测基线

正式插件按宿主安装平台专属 Node 22.22.1 sidecar，支持 macOS arm64、macOS x64、Linux x64、Linux arm64 和 Windows x64；Unix 使用 `runtime/bin/ambient-node`，Windows 使用 `runtime/bin/ambient-node.cmd` 与 `node.exe`，均使用 Node 内置 `node:sqlite`。因此宿主 Node 22/25 的 ABI 差异不再参与启动。BFF allowlist 精确包含 `https://web-sandbox.oaiusercontent.com` 以及 Codex Desktop 的 `codex-sandbox://*.web-sandbox.oaiusercontent.com`，保留 `X-Ambient-Session-Token`，恶意 Origin 没有 CORS 响应头。Panel 对 fetch/CORS 失败显示 localhost 服务/CORS 诊断，不提示重新绑定。

平台包结构验收由 `node scripts/validate-plugin-runtime.mjs dist/plugins/ambient-project-layer --all` 负责：当前原生 macOS arm64 执行 sidecar `--version`，其他四个目标静态核对 `runtime.json`、Node 官方归档对应的 sidecar 文件名、`LICENSE.nodejs`、MCP 命令和五个 Hook 命令；`pnpm smoke:plugin` 还核对五目标 launcher 选择，并在原生包真实运行 MCP 与五个 Hook。当前开发机无法真实执行 macOS x64、Linux x64、Linux arm64 或 Windows x64 二进制，需在对应真实机完成 MCP STDIO、五 Hook 和 Windows `.cmd` 含空格路径验收。

## SMWC-25 生产 Desktop 动态 localhost 复测

2026-08-13 的 Codex Desktop 151 实机复现显示：重启后的正式 sidecar 监听 `127.0.0.1:65185`，面板失败后没有到该端口的 `ESTABLISHED` 连接。只读核验 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 发现生产 WebView 的 `onBeforeRequest` 仍以 `allowLocalDevelopment=false` 拦截 HTTP localhost；`_meta.ui.csp.connectDomains` 会进入宿主 CSP，但不改变该独立 URL gate。`Access-Control-Allow-Private-Network` 因请求尚未发出而无效。

修复将生产面板请求改为官方 MCP Apps `App.callServerTool`，新增仅 `app` 可见的 `ambient_project_panel_request`，服务端只代理 Panel 所需的 allowlist 路径并复用动态 session token。回归覆盖真实 `AppBridge`、MCP server、动态 BFF 和 summary；全量测试为 76 tests passed，插件 isolation smoke 也覆盖该 bridge。最终完成仍以重启后的真实 Desktop 面板显示项目数据为准，不能用 curl、inject 或独立 runtime 代替。

## SMWC-4 复测

日期：2026-08-12。先生成仅用于本次开发复测的临时 session token（不记录 token），用独立 Service `4317`、项目规定的 Vite Panel `4318` 和 `/Users/bene/Agent/see-my-work` 的 URL 编码 `cwd` 请求；数据库为临时 SQLite，Plane 使用显式 `PLANE_MODE=fake`，未访问或写入真实 Plane。

| 路径 | 实际 URL | HTTP | Content-Type | 响应 |
| --- | --- | --- | --- | --- |
| Service context | `http://127.0.0.1:4317/api/context?cwd=%2FUsers%2Fbene%2FAgent%2Fsee-my-work` | 200 | `application/json; charset=utf-8` | JSON |
| Service summary | `http://127.0.0.1:4317/api/projects/project_1/summary` | 200 | `application/json; charset=utf-8` | JSON |
| Vite Panel context | `http://127.0.0.1:4318/api/context?cwd=%2FUsers%2Fbene%2FAgent%2Fsee-my-work` | 200 | `application/json; charset=utf-8` | JSON |
| Vite Panel summary | `http://127.0.0.1:4318/api/projects/project_1/summary` | 200 | `application/json; charset=utf-8` | JSON |

SMWC-4 归类为“错误测试路径/不可复现”：历史测试使用了临时端口 `56510`，不代表项目规定的 Vite Panel `4318`；按真实 `4317 → 4318` proxy 路径复测未收到 HTML，也没有增加 JSON fallback、端口探测或兼容分支。

## 待目标宿主人工记录

需要在目标 Codex Desktop 实机记录：

1. 调用 `open_project_panel` 后是否以内联方式渲染 `ui://ambient-project/panel/v1.html`；画中画和 Fullscreen 不属于当前产品验收范围。
2. `ui/notifications/tool-result` 是否将结果 `_meta` 传给组件，且 Panel 能带 `X-Ambient-Session-Token` 读取 localhost Service。
3. 重开是否稳定；Service 重启后旧 Panel 是否收到 401 并要求重新初始化。
4. Inline 中的状态操作是否可用，且“在 Plane 中打开 ↗”是否进入正确的 Plane 页面。

当前产品不要求永久项目级 Codex chrome/侧边栏。宿主未渲染时继续使用 `pnpm dev:panel` 的 4318 同款页面做开发和降级；该页面不是独立完整看板，也不使用 CDP 或非公开 UI 注入。产品范围见 [Inline 项目卡片产品边界](../architecture/inline-panel-product-boundary.md)。
