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

自动测试覆盖 MCP tools/list 的 App metadata、工具结果 metadata 与 content 隔离、缺失 bootstrap 安全行为、动态 BFF 启动/实际 URL/授权请求/重启令牌轮换、`open_project_panel → App.ontoolresult → 动态 service URL summary fetch` 完整链、Panel bootstrap 解析、统一请求头、401 清理且不重试；Service 覆盖 web-sandbox Origin、`null`/4318 开发来源、恶意 Origin 拒绝、带 token 的 summary 和精确 CORS。插件隔离冒烟覆盖显式 `PLANE_MODE=fake` 的测试入口、缺少 Plane 配置时在打开数据库前失败、PATH 无 node/pnpm/bun、MCP `initialize`/`tools/list`/`resources/read`/`open_project_panel`、带 Origin 的 summary 和五种 Hook fixture。正式 Desktop 的真实 SDK、数据库和凭据配置按 [Codex Desktop 安装与真人验收](../codex-desktop-installation.md) 记录，不把 Plane key 放入 Panel 或模型可见输出。

## SMWC-10 / SMWC-13 根因与自动回归

- SMWC-10：独立页面的 `/api/context` 在 cwd 未绑定时返回 `null`；旧 Panel 直接清空 summary 并返回，所以 `Load project` 没有用户可见结果。现在该路径抛出并显示 `No project is bound to <cwd>`。Codex host 路径始终按 bootstrap `projectContextId` 读取，不执行 cwd lookup。
- SMWC-13：MCP result 和标准 host bridge 都没有丢失 `_meta`。实际断点是 `setApiClient(createPanelApi(...))`：React 把返回的 callable client 当成 state updater 执行。现在使用 `setApiClient(() => createPanelApi(...))`；协议链测试证明 result `_meta` 经真实 `AppBridge` 到 `App.ontoolresult`。

## SMWC-14 / SMWC-15 复测基线

正式插件包固定 macOS arm64 Node 22.22.1 sidecar，并使用 Node 内置 `node:sqlite`；因此宿主 Node 22/25 的 ABI 差异不再参与启动。BFF allowlist 精确包含 `https://web-sandbox.oaiusercontent.com`，保留 `X-Ambient-Session-Token`，恶意 Origin 没有 CORS 响应头。Panel 对 fetch/CORS 失败显示 localhost 服务/CORS 诊断，不提示重新绑定。

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

1. 调用 `open_project_panel` 后是否在内联、画中画或全屏渲染 `ui://ambient-project/panel/v1.html`。
2. `ui/notifications/tool-result` 是否将结果 `_meta` 传给组件，且 Panel 能带 `X-Ambient-Session-Token` 读取 localhost Service。
3. 重开是否稳定；Service 重启后旧 Panel 是否收到 401 并要求重新初始化。
4. 宿主是否提供目标产品所需的持久侧边栏位置。

公开接口没有永久项目级 Codex chrome/侧边栏注册能力；因此宿主未渲染时继续使用 `pnpm dev:panel` 的 4318 页面降级，不使用 CDP 或非公开 UI 注入。
