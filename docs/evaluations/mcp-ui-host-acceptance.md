# MCP UI 宿主验收记录

日期：2026-08-10

## 已实现

MCP server 注册一个只读资源：

```text
ui://ambient-project/summary/v1.html
```

资源 MIME type 为 `text/html;profile=mcp-app`，内容明确提示编辑应使用本地伴随面板。它不持有 Plane 凭证，也不承担 Demo 主链路。

## 已验证

通过 STDIO JSON-RPC 初始化冒烟确认 MCP server 启动、固定 `instructions` 返回，且资源能力已声明。

## 待目标宿主人工记录

需要在目标 Codex Desktop 实机记录：是否能在内联、画中画或全屏显示该资源；重开是否稳定；资源是否保持只读。公开接口没有永久项目侧边栏注册能力，因此失败时继续使用 `pnpm dev:panel` 的本地伴随窗口。
