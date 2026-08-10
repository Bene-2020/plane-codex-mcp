# Codex 内嵌 Jira/Kanban 面板：GitHub 实证检索

更新时间：2026-08-10

## 结论先行

**有人已经在做几乎完全相同的方案，但还不能据此认定它已在目标 Codex Desktop 中稳定可用。**

- 最接近目标的是 [`Zuwei-Wang/codex-kanban`](https://github.com/Zuwei-Wang/codex-kanban)：它不是普通 Web 看板，而是一个真实的 Codex 插件，带 `.codex-plugin/plugin.json`、MCP server、React 看板和 `ui://codex-kanban/board/v1.html` MCP Apps 资源。源码通过 `registerAppResource` / `registerAppTool` 把 `board_render` 与 UI 关联，四列看板可通过 MCP 工具读写任务。[插件清单](https://github.com/Zuwei-Wang/codex-kanban/blob/02b28af3909a6cb63134fa6e7a36e0cf305bd87c/.codex-plugin/plugin.json)；[MCP Apps 注册源码](https://github.com/Zuwei-Wang/codex-kanban/blob/02b28af3909a6cb63134fa6e7a36e0cf305bd87c/apps/mcp-server/src/ui/board.ts)
- 但该项目 README 明确称其为 prerelease，并说明目标 Codex Desktop 中的 MCP Apps 内嵌渲染、全屏、`ui/message` 等尚未验证；其宿主验收矩阵截至检索日所有项目均为 `UNVERIFIED`。[README](https://github.com/Zuwei-Wang/codex-kanban/blob/02b28af3909a6cb63134fa6e7a36e0cf305bd87c/README.md)；[HOST_ACCEPTANCE.md](https://github.com/Zuwei-Wang/codex-kanban/blob/02b28af3909a6cb63134fa6e7a36e0cf305bd87c/docs/HOST_ACCEPTANCE.md)
- 没有找到一个同时满足“真实 Jira 数据源 + Codex plugin.json + 已提供 Codex Desktop 内嵌 UI 实机证据”的公开项目。
- 最成熟的同构 UI 参考是 [`jztan/redmine-mcp-server`](https://github.com/jztan/redmine-mcp-server)：其 MCP App 可把 Redmine Issue 渲染为聊天内拖拽 Kanban，并通过工具调用写回状态；但仓库对 Codex 给出的证据主要是 CLI/MCP 接入，并没有证明 Codex Desktop 已渲染该 UI。[看板实现](https://github.com/jztan/redmine-mcp-server/blob/96519174bec00dbbd873004c809feac0e2b4d5ed/src/redmine_mcp_server/apps/triage_board.py)；[README](https://github.com/jztan/redmine-mcp-server/blob/96519174bec00dbbd873004c809feac0e2b4d5ed/README.md)

因此，第一个方案的判断应是：**技术路线成立、已有高度相似实现，但 Codex Desktop 宿主兼容性仍是必须先做实机验收的风险项。**

## 官方能力边界

OpenAI 官方当前把插件描述为可通过 skills、MCP server 和可选 UI 扩展 ChatGPT 与 Codex；UI 指南要求用 `_meta.ui.resourceUri` 关联资源，并建议工具在不支持 UI 的宿主中仍可独立完成工作。[OpenAI Developers 首页](https://developers.openai.com/)；[Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)

不过，公开 Codex 源码中的 `enable_mcp_apps` 仍标为 `UnderDevelopment` 且默认关闭；公开 issue #21019 也记录过 Codex Desktop 能收到 `mcp_app_resource_uri`、却不读取并渲染 iframe 的情况。[Codex feature 定义](https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs)；[openai/codex#21019](https://github.com/openai/codex/issues/21019)

这两组一手资料并不完全矛盾：插件规范允许携带 UI，但具体 Codex 版本、账号/远端 feature gate、插件来源和 MCP transport 是否真的触发宿主渲染，仍需在目标构建上验证。不能只凭协议测试或浏览器 mock 宣布完成。

## GitHub 项目分类

| 类别 | 项目 | 证据与判断 |
|---|---|---|
| A：Codex 插件 + MCP Apps UI | [`Zuwei-Wang/codex-kanban`](https://github.com/Zuwei-Wang/codex-kanban) | **最接近目标。** 有真实 `plugin.json`、本地 SQLite、结构化任务工具、React UI、`registerAppResource` / `registerAppTool`；但目标 Codex Desktop 的宿主验收全部未完成，尚非稳定 Marketplace 发布。 |
| A：通用 MCP Apps Kanban 示例 | [`AndurilCode/kanban-mcp-example`](https://github.com/AndurilCode/kanban-mcp-example) | 有内存任务库、创建/移动/更新工具和 Kanban UI，是学习 MCP Apps 组件协议的直接样例；不是 Jira 集成，也不是 Codex 插件包。[服务端源码](https://github.com/AndurilCode/kanban-mcp-example/blob/5d033d64321fc0c7c4bb397cc9a605e26bbbef5e/src/index.ts) |
| A：真实 Issue 系统 + MCP Apps UI | [`jztan/redmine-mcp-server`](https://github.com/jztan/redmine-mcp-server) | `ui://redmine/triage-board.html`、`text/html;profile=mcp-app`、拖拽状态写回、Refresh 专用 app tool 均有源码；是把 Jira 换成 Redmine 后几乎同构的实现，但没有目标 Codex Desktop UI 验收证据。 |
| A：工作规划 UI | [`technosheen/technotracker`](https://github.com/technosheen/technotracker) | 同一 React UI 同时发布为 MCP Apps resource 与 ChatGPT Apps SDK `openai/outputTemplate`，支持 Jira/Linear 等作为输入来源；它不直接持有 Jira 凭证，也不向 Jira 写回。[README](https://github.com/technosheen/technotracker/blob/08dac01cfb2295b21ece8347431a598b6956199b/README.md)；[注册代码](https://github.com/technosheen/technotracker/blob/08dac01cfb2295b21ece8347431a598b6956199b/src/server.ts) |
| 邻近 A：Codex Jira 插件但无 UI | [`bradduy/sdlc-agents`](https://github.com/bradduy/sdlc-agents) | 有真实 Codex `plugin.json`，通过 `.mcp.json` 连接 Atlassian 官方远程 MCP，提供 Jira/Confluence skills；源码中没有 `ui://`、`ui.resourceUri` 或 `openai/outputTemplate`，所以是“Jira 工具型插件”，不是内嵌面板。[plugin.json](https://github.com/bradduy/sdlc-agents/blob/c9aac8e1f53fa634be4695e3cde905ca3801ace1/plugins/sdlc-agents/.codex-plugin/plugin.json)；[.mcp.json](https://github.com/bradduy/sdlc-agents/blob/c9aac8e1f53fa634be4695e3cde905ca3801ace1/plugins/sdlc-agents/.mcp.json) |
| B：Headless Jira MCP | [`sooperset/mcp-atlassian`](https://github.com/sooperset/mcp-atlassian) | 成熟的 Jira/Confluence MCP server，支持 Cloud 和 Server/DC，提供搜索、创建、更新、transition 等工具；没有 MCP Apps UI 元数据，是很合适的数据/动作后端。[README](https://github.com/sooperset/mcp-atlassian/blob/12fb6fa9e75de20fa70f56ae0d896a79c5a38c4e/README.md) |
| B：Headless、本地 Kanban + 独立 Web UI | [`multidimensionalcats/kanban-mcp`](https://github.com/multidimensionalcats/kanban-mcp) | 明确支持 Codex CLI MCP 配置，另带独立 Web UI；两者共享任务库，但 Web UI 不是通过 MCP Apps 嵌入 Codex。[README](https://github.com/multidimensionalcats/kanban-mcp/blob/49061b866ad6020b9eee9d9c43fa304061952960/README.md) |
| B：Headless、本地任务系统 + 独立 Web UI | [`tcarac/taskboard`](https://github.com/tcarac/taskboard) | 单二进制、SQLite、拖拽 Web 看板和 22 个 MCP tools；UI 与 MCP server 是并列入口，不是对话内 iframe。[README](https://github.com/tcarac/taskboard/blob/c3db6eba367edce32c9942362f707dd7f91ea689/README.md) |
| C：独立客户端 + Codex SDK | [`YoniRaviv/Relay`](https://github.com/YoniRaviv/Relay) | Electron Kanban build loop，直接依赖 `@openai/codex-sdk`，用 `Codex().startThread()` 运行任务；证明“自己做面板客户端、Codex 作为执行引擎”已经有人采用。[package.json](https://github.com/YoniRaviv/Relay/blob/8752302cdfc74f6165c99a4c2e872fa384cd7437/package.json)；[Codex engine](https://github.com/YoniRaviv/Relay/blob/8752302cdfc74f6165c99a4c2e872fa384cd7437/electron/agent/engines/codexEngine.ts) |
| C：独立 Web 看板 + Codex SDK | [`DanWahlin/ai-agent-board`](https://github.com/DanWahlin/ai-agent-board) | 拖拽任务到 In Progress 后选择 Codex 等 coding agent 执行，服务端依赖 `@openai/codex-sdk`，通过 WebSocket 流式回传进度；它管理 coding tasks，而非 Jira。[README](https://github.com/DanWahlin/ai-agent-board/blob/8623761293bd290c7e2e08f609613f9138e159c8/README.md)；[server package](https://github.com/DanWahlin/ai-agent-board/blob/8623761293bd290c7e2e08f609613f9138e159c8/packages/server/package.json) |
| D：CDP/补丁注入 | [`friuns2/codex-web-ui`](https://github.com/friuns2/codex-web-ui) | 会解包/补丁 Codex Electron bundle，并开启 `--remote-debugging-port`；这是逆向和 Web/SSH 桥接工具，不是 Jira/Kanban 面板。检索中没有发现完成度相当的 CDP 注入 Jira 面板。[README](https://github.com/friuns2/codex-web-ui/blob/ed9c4fdd4323c19e72f6f4e5ee11f1c79db035b7/README.md)；[启动脚本](https://github.com/friuns2/codex-web-ui/blob/ed9c4fdd4323c19e72f6f4e5ee11f1c79db035b7/launch_codex_unpacked.sh) |

## 对方案选择的影响

若目标是“在对话中临时打开、浏览、拖拽和编辑 Jira Issue”，继续选择 **Codex plugin + MCP Apps UI** 是合理的。建议直接借鉴两套边界：

1. 用 `codex-kanban` 的插件打包、render-only tool、无 UI fallback 和宿主验收矩阵；
2. 用 `redmine-mcp-server` 的 Issue 卡片建模、刷新工具、拖拽 transition 写回和 read-only 降级；
3. Jira 层优先复用 Atlassian 官方远程 MCP 或 `mcp-atlassian`，不要让 iframe 直接持有 Jira token；
4. 首个里程碑不是继续堆功能，而是在目标 Codex Desktop 构建上跑通：插件安装后重启、新任务中 `board_render` 内嵌渲染、UI 内 `tools/call`、拖拽写回、重新渲染后状态仍在。

若要求“永久固定在 Codex 右侧、随时可见”，MCP Apps 的对话内 iframe 不是可靠的固定 chrome 扩展点；应选择 C 类独立客户端，用 Codex SDK/App Server 驱动。CDP 适合短期原型或研究，不适合作为正式集成边界。

## 检索说明与限制

本次覆盖 GitHub repository search、网页索引和源码全文检查，组合了 `codex`、`plugin.json`、`Jira`、`Linear`、`issue`、`kanban`、`task board`、`MCP Apps`、`MCP UI`、`ui://`、`_meta.ui.resourceUri`、`openai/outputTemplate`、`Codex SDK`、`app-server`、`CDP`、`remote-debugging-port` 等关键词。结论仅采用项目仓库源码/README、OpenAI 官方文档和 `openai/codex` 官方仓库；“未找到”不等于私有仓库或未被 GitHub/搜索引擎索引的项目不存在。
