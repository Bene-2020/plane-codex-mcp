# Plane 作为后端的外置前端与 AI/Codex 桥接生态

调研日期：2026-08-10。仅采用 Plane 官方文档、GitHub 仓库 README 与源码；活跃度以默认分支最后提交日期为准。

## 结论

Plane 已有很完整的“后端能力层”（REST、OAuth、Webhook、官方 Node/Python SDK、官方 MCP），但独立前端生态仍比较小。当前最贴近“Plane ↔ Codex + 类 Jira 面板”的公开实现是 **[RishiGitH/codex-fleet](https://github.com/RishiGitH/codex-fleet)**：它以本地自托管 Plane 及浅层品牌化 Plane UI 为控制面，轮询 Plane work item，启动真实 Codex CLI，在隔离 worktree 中工作，并把证明与状态写回 Plane。这不是 Codex 内嵌面板，也不是 MCP Apps UI；它是“Plane UI + 本地 Codex 编排器”的完整参考实现。

如果要在 Codex 内做自己的面板，最稳妥的组合是：**Codex/MCP UI → 自己的 BFF/MCP 工具层 → 官方 Node SDK → Plane REST API**。API key 不应放进浏览器或 iframe；事件驱动部分可复用官方 `prd-agent` 的 OAuth/Webhook/Agent Run 生命周期。若只需让 Codex 操作 Plane，不需要面板，官方 `plane-mcp-server` 已是首选。

## 一手事实与架构边界

- Plane 公共 REST API 的默认基址是 `https://api.plane.so/`，使用 `X-API-Key`，资源位于 `/api/v1/workspaces/{workspace_slug}/...`。官方还明确要求不要在客户端代码暴露 API key，并已将 `/issues/` 迁移为 `/work-items/`（旧端点支持截至 2026-03-31）。见 [Plane API Introduction](https://developers.plane.so/api-reference/introduction)。
- Plane 官方开发者入口提供 180+ REST endpoints、Webhooks、OAuth Apps、MCP Server 和 Agents，说明 Plane 官方已把第三方 UI、自动化和 agent 集成作为稳定扩展面。见 [Plane Developers](https://developers.plane.so/)。
- 自托管版本存在 API 漂移风险：官方 MCP 的公开 issue 记录了较旧自托管 Plane 仍使用 `/issues/`、而新 SDK 请求 `/work-items/` 得到 404 的案例。桥接层应对 Cloud 与目标自托管版本分别做 smoke test，见 [makeplane/plane-mcp-server#126](https://github.com/makeplane/plane-mcp-server/issues/126)。

## 最值得复用的候选

| 项目 | 类型与活跃度 | 是否真的调用 Plane | 可复用价值 |
|---|---|---|---|
| [RishiGitH/codex-fleet](https://github.com/RishiGitH/codex-fleet) | Plane + Codex CLI 完整控制面；最后提交 2026-05-27 | 是。其客户端构造 `/api/v1/workspaces/.../work-items/`，并读写 work item/comment；见 [`plane.py`](https://github.com/RishiGitH/codex-fleet/blob/206c5a6df9c078bddd3dab579b07f8e6b5522a02/src/codex_fleet/plane.py#L35-L52) 与 [work-item 操作](https://github.com/RishiGitH/codex-fleet/blob/206c5a6df9c078bddd3dab579b07f8e6b5522a02/src/codex_fleet/plane.py#L120-L220) | **最强参考**。可复用 Plane 状态机、任务/子任务映射、worktree 隔离、Codex 运行记录、人工审批和回写证明；它的 UI 是浅层品牌化 Plane，而非 Codex 插件面板，且许可证标为 source-available，复用前需审查条款。设计说明明确称其不是自建 Kanban，而是 Plane 浅层 fork：[product-design.md](https://github.com/RishiGitH/codex-fleet/blob/206c5a6df9c078bddd3dab579b07f8e6b5522a02/docs/product-design.md#L23-L67)。 |
| [montagao/pti](https://github.com/montagao/pti) | Rust Plane TUI + Codex task brief；最后提交 2026-07-03 | 是。直接发送 `X-API-Key`，请求 projects/states/labels/work-items；见 [`main.rs`](https://github.com/montagao/pti/blob/9f8f9b44a08b8b456e2bfb74cf8eb001a7e51339/src/main.rs#L286-L310) 与 [资源路径](https://github.com/montagao/pti/blob/9f8f9b44a08b8b456e2bfb74cf8eb001a7e51339/src/main.rs#L370-L435) | 最适合借鉴键盘优先 board/list、WIP limit、批量 triage，以及“选中 Plane item → Codex 生成 brief → 评论回写”的轻量交互。 |
| [Arcodify/obsidian-plane-plugin](https://github.com/Arcodify/obsidian-plane-plugin) | Obsidian 内 Kanban/同步插件；最后提交 2026-01-30 | 是。默认 `https://api.plane.so`，发送 `x-api-key`，通过 `/api/v1/workspaces/.../work-items/` CRUD；见 [`planeClient.ts`](https://github.com/Arcodify/obsidian-plane-plugin/blob/dd220831029399c204adfab9472c27d407146a8d/src/planeClient.ts#L40-L70) 与 [请求/auth](https://github.com/Arcodify/obsidian-plane-plugin/blob/dd220831029399c204adfab9472c27d407146a8d/src/planeClient.ts#L100-L140) | 是“宿主应用内嵌 Plane 面板”的直接类比：Kanban view、本地缓存、模块过滤、Plane item ↔ 本地 note 双向关联。注意它把 API key 配在插件客户端，不能原样用于不可信 iframe。 |
| [iSolorak/plane-todo-application](https://github.com/iSolorak/plane-todo-application) | Expo/React Native 移动客户端 + TS core + webhook notifier；最后提交 2026-07-15 | 是。core 支持 API key/OAuth，固定公共 `/api/v1` 与 `/work-items/`；见 [`auth.ts`](https://github.com/iSolorak/plane-todo-application/blob/d860c8ff732849337b672b18a2249cf8bf0ddb63/plane-todo/packages/core/src/auth.ts#L1-L24) 和 [`client.ts`](https://github.com/iSolorak/plane-todo-application/blob/d860c8ff732849337b672b18a2249cf8bf0ddb63/plane-todo/packages/core/src/client.ts#L190-L210) | 目前最清晰的“Plane 作为后端、另做产品化前端”样板：可复用 Expo UI、typed client、API key/OAuth 双认证、设备安全存储、Webhook 通知服务。 |
| [andrewkomkov/plane-mobile](https://github.com/andrewkomkov/plane-mobile) + [plane-mobile-api](https://github.com/andrewkomkov/plane-mobile-api) | Flutter 客户端 + sidecar；最后提交 2026-07-28 | 是，但主功能通过 sidecar 将 token 换 Plane session cookie，再代理 Plane 的内部 `/api/...`，不只依赖公共 API；架构由 [README](https://github.com/andrewkomkov/plane-mobile/blob/c674c70611743b006ae79b25c4eaf5030a1af2fd/README.md#L27-L56) 明示 | 功能覆盖最广的独立移动 UI（board/list/table/calendar、离线读、写队列、评论、附件、关系等），适合研究产品体验。它强依赖自托管 Plane 与内部 API，升级耦合和安全审计成本远高于公共 SDK 方案。 |
| [sanket007/northstar](https://github.com/sanket007/northstar) | Plane 驱动的多角色 Claude Code 编排器；最后提交 2026-06-25 | 是。`X-API-Key` + `/api/v1/.../work-items/`，读取评论、变更状态和关系；见 [`orchestrator/plane.py`](https://github.com/sanket007/northstar/blob/cb886dee21bbd5cc99b55f0c8a9165f13f0f54b2/orchestrator/plane.py#L20-L110) | 虽不是 Codex，但可复用“Plane 为唯一事实源、每任务独立 worktree/session、build→review→QA→merge、依赖门禁与 rework cap”的 agent 编排模型。 |

## 官方基础设施

| 项目 | 源码证据 | 建议用途 |
|---|---|---|
| [makeplane/plane-node-sdk](https://github.com/makeplane/plane-node-sdk)（最后提交 2026-07-29） | `BaseResource` 实际发送 `X-Api-Key` 或 Bearer token；见 [`BaseResource.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/BaseResource.ts#L130-L151)。`PlaneClient` 暴露 work items、comments、cycles、modules、pages 等资源，见 [`plane-client.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/client/plane-client.ts#L1-L105)。 | **TypeScript BFF/MCP 工具层首选**，不要再手写 HTTP client。 |
| [makeplane/plane-python-sdk](https://github.com/makeplane/plane-python-sdk)（最后提交 2026-08-04） | 真实请求认证见 [`base_resource.py`](https://github.com/makeplane/plane-python-sdk/blob/b17befbd6c806418c53183aab1a5377e8b1d4582/plane/api/base_resource.py#L84-L97)，完整资源组合见 [`plane_client.py`](https://github.com/makeplane/plane-python-sdk/blob/b17befbd6c806418c53183aab1a5377e8b1d4582/plane/client/plane_client.py#L1-L93)。 | Python 编排器/服务首选。 |
| [makeplane/plane-mcp-server](https://github.com/makeplane/plane-mcp-server)（最后提交 2026-07-22） | 直接使用官方 Python SDK，根据 API key/access token 建 client，并支持自定义 Plane URL；见 [`client.py`](https://github.com/makeplane/plane-mcp-server/blob/96cf4d51d65cfa5e47d10ff7a4a4caba3b7a98d1/plane_mcp/client.py#L1-L72)。 | 让 Codex/其他 MCP host 直接读写 Plane 的首选；README 提供 stdio、远端 OAuth、PAT HTTP 模式。它提供工具，不提供 Jira/Kanban UI。 |
| [makeplane/prd-agent](https://github.com/makeplane/prd-agent)（最后提交 2026-02-15） | 用 OAuth token 创建 SDK client，[读取 work item](https://github.com/makeplane/prd-agent/blob/1cda0ff35c3afd892b8f3b5d49d89de45980633e/src/lib/agent/tools.ts#L1-L22)，再[创建 Plane page](https://github.com/makeplane/prd-agent/blob/1cda0ff35c3afd892b8f3b5d49d89de45980633e/src/lib/agent/tools.ts#L104-L115)。 | 官方 AI agent 参考：OAuth app、Webhook、token refresh、Agent Run activity、进度回写。很适合作为事件驱动 Plane↔Codex worker 模板。 |
| [makeplane/plane-claude-plugin](https://github.com/makeplane/plane-claude-plugin)（最后提交 2026-04-23） | 仓库只含 Claude 插件 manifest/MCP 配置，指向官方 hosted MCP；[README](https://github.com/makeplane/plane-claude-plugin/blob/e9979e3e8fc354aca6af3ae0e70686fe6a8b4375/README.md) 明示当前仅 Plane Cloud。 | 可参考“AI 宿主插件 → hosted MCP”的打包方式；没有自定义 UI 或业务 wrapper。 |

## 次级参考

- [omert11/plane-cli](https://github.com/omert11/plane-cli)（Rust，最后提交 2026-07-24）是真实公共 API client，`X-Api-Key`、`/api/v1` 与 URL 归一化见 [`client.rs`](https://github.com/omert11/plane-cli/blob/bf1db259639b9a1e8ed8bb707587705571d21edf/src/client.rs#L1-L84)；附件代码还探测旧/新端点变体，适合作为自托管兼容层参考。
- [cpatrickalves/plane-cli](https://github.com/cpatrickalves/plane-cli)（Python，最后提交 2026-07-03）确实包装官方 Python SDK，见 [`client.py`](https://github.com/cpatrickalves/plane-cli/blob/eccad4fcbff3985b6dca9fbcce2f993bd75d963c/src/planecli/api/client.py#L1-L40)；可借鉴 CLI UX，不必复用 HTTP 层。
- [zylos-ai/zylos-plane-client](https://github.com/zylos-ai/zylos-plane-client)（最后提交 2026-08-02）是紧凑的 agent-facing JS client，实际发送 `X-API-Key` 并做 secret redaction，见 [`plane.js`](https://github.com/zylos-ai/zylos-plane-client/blob/68d68263ac73228b5fb79a736d327fe99431790b/plane.js#L390-L420)。
- 社区 MCP 如 [ZethicTech/plane-mcp-server](https://github.com/ZethicTech/plane-mcp-server)、[cmet7/plane-mcp](https://github.com/cmet7/plane-mcp)、[gu3gu3/websavvy-plane-mcp](https://github.com/gu3gu3/websavvy-plane-mcp) 均有真实 API 请求源码，但与官方 MCP 重叠；除非需要更小的 TypeScript/Python 样例，否则不建议作为主线。

## 推荐落地顺序

1. **最快验证**：先将官方 `plane-mcp-server` 接到 Codex，验证 work item 查询、状态更新、评论回写和自托管版本兼容性。
2. **Codex 内面板**：做一个薄 Kanban/issue MCP UI，所有写操作落到自己的 Node BFF/MCP tools；BFF 用官方 Node SDK。不要让 UI 直接持有 `X-API-Key`。
3. **任务执行桥**：从 `codex-fleet` 抽取状态机、worktree、run/proof/人工审批模型，但重新实现 UI 层以适配 Codex；许可证先审查。
4. **事件驱动**：复用 `prd-agent` 的 OAuth/Webhook/Agent Run activity 模式，减少纯轮询；对 Cloud 和目标自托管版本分别做契约测试。
5. **产品体验**：从 `pti` 借鉴桌面键盘工作流，从 Obsidian 插件借鉴宿主内 Kanban/本地映射，从 `plane-todo` 借鉴移动端与通知；不要复制旧官方 `makeplane/plane-mobile` 的内部 `/api/.../issues/` 客户端。

## 排除与风险说明

- GitHub 中大量项目的 “plane” 指 control plane/data plane/airplane，并非 Plane.so；只有出现 Plane API host、`X-API-Key`、`/api/v1/workspaces/...` 或官方 SDK 调用的项目才纳入。
- [makeplane/plane-mobile](https://github.com/makeplane/plane-mobile) 是真实项目但已归档，最后提交 2024-01-10；源码使用内部 `/api/workspaces/.../issues/` 与 Bearer session 风格，见 [`apis.dart`](https://github.com/makeplane/plane-mobile/blob/619f3af9847e01b1c4b896ce66b323de8baa46f2/lib/config/apis.dart#L3-L52)。只能作为旧 Flutter UI 灵感，不能作为当前公共 API 客户端。
- 没有发现成熟、维护活跃、可直接嵌入 Codex 的 Plane MCP Apps/Kanban UI。现有强项分别是“工具接入”（官方 MCP）、“外部控制面”（codex-fleet）、“独立客户端”（pti/Obsidian/移动端），因此仍需要一层 Codex 专用 UI 适配。
