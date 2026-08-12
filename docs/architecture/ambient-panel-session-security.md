# Panel 架构与临时会话安全边界

## 产品边界

Plane SDK/API 只提供后端项目管理能力，Plane 是用户可见项目数据的最终真相源。正式路径由 `apps/mcp` 在同一进程内启动 localhost Fastify BFF、Outbox worker 和 MCP；独立 `apps/service` 只服务开发降级。Hook 负责 Codex 集成；`apps/panel` 是自制的轻量 React Panel，目标是在 Codex MCP App 宿主中作为侧边栏/组件 UI 展示。Panel 不直接加载 Plane SDK，也不接触 Plane API Key。

```text
Codex model
   │  open_project_panel
   ▼
MCP server ── tools/call result._meta["ambient-project/bootstrap"]
   │          (component-visible metadata only)
   ▼
MCP process: Fastify BFF + Outbox worker ◄── X-Ambient-Session-Token ── MCP App Panel
                                              │
                                              ├─ node:sqlite cache / Outbox
                                              └─ Plane SDK/API ──► Plane
```

正式资源遵循官方 MCP Apps 形状：工具声明 `_meta.ui.resourceUri`，资源使用 `text/html;profile=mcp-app`，组件通过 `App.ontoolresult` 读取工具结果 `_meta`。本项目的应用私有 key 是 `ambient-project/bootstrap`；它不是 MCP 或 Codex 新增的协议字段，而是放在官方结果 metadata 容器中的应用命名空间。

## 会话令牌

- 正式 `apps/mcp` 入口每进程生成一次 32-byte CSPRNG 并编码为 43 字符 base64url，再直接注入同进程的 Service 和 MCP；令牌不是 JWT，也不包含可解码身份或权限。独立 `apps/service` 开发入口才支持显式 `AMBIENT_SESSION_TOKEN` 或自行生成令牌。
- 正式令牌只保存在 MCP/Service 进程内存。它不经过环境注入、文件、SQLite、Plane、Hook 输出、MCP 全局 instructions、`additionalContext`、普通工具 `content`、HTTP 日志或响应错误文本。
- `/health` 匿名可用且只返回 `{ "ok": true }`。所有 `/api/*` 统一经过 Fastify `onRequest` hook，读取固定 `X-Ambient-Session-Token`，先做长度检查，再用 `timingSafeEqual` 比较；缺失、长度错误和错误值都返回同一个 401。
- 每个正式 MCP 进程拥有自己的动态 BFF 端口和新令牌。旧令牌不能访问重启后的新 BFF；Service 不提供匿名 token 揭示端点。
- Panel 只在内存保存会话。401 时清除 bootstrap、API client 和项目摘要，提示从 Codex 重新初始化，不自动重试。

## CORS 与开发降级

默认 CORS 精确允许 Codex MCP App 默认来源 `https://web-sandbox.oaiusercontent.com`、MCP App 的 `null` origin、`http://127.0.0.1:4318` 和 `http://localhost:4318`。其他 Origin 没有 `Access-Control-Allow-Origin`；没有 `origin:true` 或通配符。CORS 只是浏览器来源约束，不能替代令牌鉴权，summary 仍必须带 `X-Ambient-Session-Token`。

浏览器 fetch/CORS 失败时，Panel 显示“无法访问动态 localhost 面板服务”及 CORS 诊断，不显示“未绑定”或要求重新绑定；401 仍表示 MCP 进程会话已过期，只有此时提示从 Codex 重新初始化。

4318 独立页面是明确隔离的开发/宿主降级：独立 Service 使用固定 `SERVICE_PORT`，开发者显式设置并手工输入当前临时令牌；Vite proxy 转发 `/api` 但不会无条件注入令牌。正式 Panel bootstrap 不从 URL、localStorage、Vite proxy、环境变量或模型上下文读取令牌。

## 宿主验收边界

MCP Apps 标准规定了对话内/宿主内组件资源和 `App` bridge，但没有公开的永久项目级 Codex chrome/侧边栏注册接口。需要在目标 Codex Desktop 实机验证 `open_project_panel` 的资源渲染、`ui/notifications/tool-result` 的 `_meta` 传递和重新打开行为；未通过时使用 4318 页面，不把非公开注入或 CDP 作为替代。

参考：

- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [`registerAppTool` / `_meta.ui.resourceUri`](https://apps.extensions.modelcontextprotocol.io/api/functions/server-helpers.registerAppTool.html)
- [MCP Apps tool result metadata](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiToolResultNotification.html)
