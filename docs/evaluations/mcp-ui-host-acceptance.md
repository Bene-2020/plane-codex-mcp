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

自动测试覆盖 MCP tools/list 的 App metadata、工具结果 metadata 与 content 隔离、缺失 bootstrap 安全行为、动态 BFF 启动/实际 URL/授权请求/重启令牌轮换、Panel bootstrap 解析、统一请求头、401 清理且不重试；Service 覆盖匿名 health、缺失/错误/正确令牌、未授权写无副作用、令牌轮换和精确 CORS。插件隔离冒烟覆盖正式入口在无会话环境变量下启动、动态 BFF 和新增 `open_project_panel` 工具列表。

## 待目标宿主人工记录

需要在目标 Codex Desktop 实机记录：

1. 调用 `open_project_panel` 后是否在内联、画中画或全屏渲染 `ui://ambient-project/panel/v1.html`。
2. `ui/notifications/tool-result` 是否将结果 `_meta` 传给组件，且 Panel 能带 `X-Ambient-Session-Token` 读取 localhost Service。
3. 重开是否稳定；Service 重启后旧 Panel 是否收到 401 并要求重新初始化。
4. 宿主是否提供目标产品所需的持久侧边栏位置。

公开接口没有永久项目级 Codex chrome/侧边栏注册能力；因此宿主未渲染时继续使用 `pnpm dev:panel` 的 4318 页面降级，不使用 CDP 或非公开 UI 注入。
