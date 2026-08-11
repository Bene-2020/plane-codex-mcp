# Ambient Project Layer Demo

这是一个按 `docs/specs/ambient-project-layer-demo.md` 和 `docs/plans/ambient-project-layer-demo-implementation-plan.md` 实现的可运行 Demo：Codex 通过 MCP 将当前工作回合的项目事件可靠写入本地 SQLite Outbox，服务进程异步投射到 Plane，并提供本机伴随面板查看和修正。

## 快速启动

需要 Node.js 22 和 Corepack。项目通过 `package.json` 的 `packageManager` 固定使用 pnpm 10.34.5。

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
pnpm build

# 终端 1：本地服务和 Outbox worker
pnpm dev:service

# 终端 2：伴随面板
pnpm dev:panel
```

默认使用 `PLANE_MODE=fake`，Fake Plane 会提供一个 `Demo Project`，适合完成端到端 Demo。面板地址是 <http://127.0.0.1:4318>，服务健康检查是 <http://127.0.0.1:4317/health>。

接入真实 Plane 时，在 `.env` 中设置 `PLANE_MODE=sdk`、`PLANE_BASE_URL`、`PLANE_API_KEY` 和 `PLANE_WORKSPACE_SLUG`，再启动服务和 MCP。真实 Plane 连接统一通过官方 `@makeplane/plane-node-sdk` 完成；API key 只由服务端读取，不进入 SQLite、Hook 上下文或浏览器。

## Codex 插件

`plugin/` 包含 `.codex-plugin/plugin.json`、`.mcp.json`、五种 Hook 配置和 `ambient-project` Skill。`pnpm build` 会自动刷新 `plugin/runtime/`：`runtime/mcp/index.js` 和 `runtime/hook-adapter/index.js` 是 Node 22 bundle，`runtime/node_modules/` 只包含 `better-sqlite3` 的 JS/native runtime closure 和 Plane SDK 的生产运行时依赖。插件配置只使用 `${PLUGIN_ROOT}` 内路径，Hook 的命令路径带引号以支持含空格的插件安装目录。

MCP 只暴露五个高层工具：`list_projects`、`get_binding`、`bind_project`、`change_binding`、`record_project_events`。没有自动删除、跨项目移动或分配人员的工具。`ui://ambient-project/summary/v1.html` 是独立的只读 MCP UI 宿主验收资源，主界面仍是本地伴随面板。

## 验证

```bash
pnpm test
pnpm lint
pnpm build
pnpm eval
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
