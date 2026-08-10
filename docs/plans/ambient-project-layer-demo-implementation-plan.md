# 环境式项目管理层 Demo 实施计划

**状态：** 可执行  
**日期：** 2026-08-10  
**规格基线：** [环境式项目管理层 Demo 规格说明](../specs/ambient-project-layer-demo.md)  
**预计周期：** 3 个专注开发日  
**目标环境：** Codex 桌面端、Node.js 22、Plane Cloud 或已确认版本的自托管 Plane

## 1. 实施目标

在三天内做出一个可以真实使用和测量的 Demo，验证下面这条完整链路：

```text
Codex 正常工作
  -> Hook 静默注入项目上下文
  -> 当前 Codex 判断是否出现项目事件
  -> record_project_events 可靠入队
  -> 后台同步到 Plane
  -> 用户在伴随面板中查看和修正
```

本轮不追求正式发布、多人账号体系或精致 UI。是否成功只看已确认的核心指标：不打断工作、捕获率至少 80%、误记录率不超过 10%、显式操作成功率 100%、健康网络下 30 秒内可见。

## 2. 技术路线

### 2.1 默认技术栈

- TypeScript，Node.js 22，pnpm workspace。
- MCP：官方 TypeScript MCP SDK，使用本地 STDIO 传输。
- 数据校验：Zod，所有 Hook 输入和 MCP 参数先校验再进入领域逻辑。
- 本地可靠队列：SQLite + `better-sqlite3`。
- Plane 接入：优先官方 `plane-node-sdk`；用薄适配器隔离 Cloud、自托管以及 `/work-items/` 兼容差异。
- 本地服务：Fastify，同一进程承载面板 API、缓存刷新和 Outbox worker。
- 面板：React + Vite + TanStack Query；只访问本地服务，不直接持有 Plane API Key。
- 测试：Vitest；Plane 集成测试使用可替换的 Fake Adapter，最后再对真实 Plane 做冒烟测试。

### 2.2 代码目录

```text
see-my-work/
├── plugin/
│   ├── .codex-plugin/plugin.json
│   ├── .mcp.json
│   ├── hooks/hooks.json
│   └── skills/ambient-project/
│       ├── SKILL.md
│       └── agents/openai.yaml
├── apps/
│   ├── service/                 # MCP、HTTP API、worker 的启动入口
│   └── panel/                   # React 伴随面板
├── packages/
│   ├── core/                    # 领域类型、投射规则、幂等和所有权
│   ├── storage/                 # SQLite、迁移、Outbox 和缓存
│   ├── plane/                   # 官方 SDK 的薄适配器
│   └── hook-adapter/            # 五种 Hook 的统一 stdin/stdout 处理器
├── fixtures/                    # Hook、MCP 和评估样本
└── docs/
```

插件只负责把 Skill、Hooks 和 MCP 连接打包到 Codex。业务规则放在 `packages` 中，避免将来更换宿主或后端时重写核心逻辑。

### 2.3 实现约束

- 使用满足当前 Demo 的最简单直接实现，不写过度防御性代码。
- 只处理规格明确要求或测试实际复现的失败；不为假想情况增加分支、包装层、自动降级和推测性兼容。
- 数据只在 Hook、MCP、HTTP 和 Plane 等系统边界校验一次，内部模块不重复校验。
- 不使用 SHA 或其他加密哈希生成 ID、幂等键、去重键或字段所有权标记。
- 不设置 go/no-go、阶段准入、审批、功能或 capability gate。测试用于发现问题，不作为阻止后续开发的代码关卡。
- 除规格要求的“自动捕获开关”外，不增加 feature flag。
- 不预先实现 Plane API 自动探测或多级 fallback；只针对目标 Plane 实例的实际接口开发。
- 完整约束以仓库根目录的 [`AGENTS.md`](../../AGENTS.md) 为准。

## 3. 前两小时最小闭环

开发开始时先用 2 小时完成一个最小闭环，用实际结果固定当前 Codex 构建的接口形状。它是正常开发任务，不是 go/no-go gate。

### 要验证的内容

1. 插件能被当前 Codex 构建发现并完成一次信任。
2. `SessionStart` 和 `UserPromptSubmit` 返回的 `additionalContext` 能进入当前模型上下文，且不显示 `statusMessage` 或 `systemMessage`。
3. Hook 能获得预期的 `cwd`、`session_id` 和回合范围内的 `turn_id`。
4. 当前 Codex 能依据注入规则，在有项目事件时主动调用一个假的 `record_project_events`，普通闲聊时不调用。
5. `PostToolUse` 能观察该 MCP 调用；`Stop` 能记录本回合是否调用过。
6. 完成一次信任后，自动记录工具不会每次要求用户确认。

### 验证结果的使用方式

- 直接记录每项在当前 Codex 构建中的实际表现，并按已验证的接口继续实现。
- 如果插件内 Hooks 不可用，Demo 直接采用仓库级 `.codex/hooks.json`，不额外构建运行时能力探测和两套自动切换逻辑。
- 如果自动工具出现逐次确认，直接修正工具元数据和权限配置，并在评估报告中记录仍存在的宿主限制；不把判断写成开发 gate。

## 4. 工作包与顺序

### 第一天：宿主闭环、项目绑定和本地可靠写入

#### D1-1 项目骨架

- 建立 pnpm workspace、TypeScript 严格配置、lint、Vitest 和统一构建命令。
- 使用官方插件结构创建 manifest、Skill、`.mcp.json` 和 `hooks/hooks.json`。
- 提供 `.env.example`，只列 Plane URL、Workspace、API Key 等配置名，不包含真实密钥。

可见结果：全新目录执行一次安装和构建后，插件、MCP server、Hook handler 都有可运行产物。

#### D1-2 领域契约

- 定义 `ProjectContext`、`SourceEvent`、`ProjectEventBatch`、`SourceReference`、`FieldOwnership` 和 `SyncStatus`。
- 实现并冻结五个 MCP 工具的 Zod schema：
  - `list_projects`
  - `get_binding`
  - `bind_project`
  - `change_binding`
  - `record_project_events`
- `record_project_events` 成功返回：

```json
{
  "status": "accepted",
  "batchId": "batch_...",
  "duplicate": false
}
```

- 服务端按 SQLite 批次行号和事件序号分配 `event_id`，不接受模型提供数据库主键。

可见结果：契约测试覆盖合法参数、缺少绑定、空事件、重复批次和本地持久化失败。

#### D1-3 SQLite 基础

建立以下最小表，不建立第二套用户可见项目记录表：

| 表 | 作用 |
|---|---|
| `project_contexts` | `canonical_cwd` 到 Plane workspace/project 的唯一绑定及捕获开关 |
| `outbox_batches` | 事件批次、工作回合组合唯一约束、重试状态和错误摘要 |
| `source_references` | Plane 对象与 `session_id`、`turn_id`、最小来源摘要的关系 |
| `plane_item_cache` | Hook 注入和面板只读所需的精简 Plane 快照 |
| `field_ownership` | 每个 Plane 字段的 `system`/`user` 所有权和最后系统值摘要 |
| `turn_audits` | 本回合是否调用记录工具、Hook 是否异常、结束时间 |

项目事件批次直接使用可读的组合唯一键：

```text
projectContextId + sessionId + turnId
```

数据库直接对 `(project_context_id, session_id, turn_id)` 建立组合唯一约束，因为每个工作回合最多提交一个批次，不再生成单独的幂等键。同一批次重放返回原 `batchId` 和 `duplicate: true`，不重复同步。批次 ID 使用 `batch_<rowid>`，事件 ID 使用 `event_<batch_rowid>_<index>`，不使用 SHA、其他加密哈希或 UUID/ULID。

#### D1-4 五种 Hook

用一个轻量 handler 按 `hook_event_name` 分发：

| Hook | 实现动作 |
|---|---|
| `SessionStart` | 规范化 `cwd`，读取绑定和缓存，注入固定规则与项目快照 |
| `UserPromptSubmit` | 注入 `session_id`、`turn_id`、当前绑定和活跃工作项快照 |
| `PostToolUse` | 只观察项目 MCP 调用结果，更新本地审计与同步提示 |
| `Stop` | 结束回合审计；不要求继续、不启动第二个模型 |
| `SessionEnd` | 结束会话审计并唤醒 worker；不等待 Plane 网络 |

Hook 请求路径禁止访问 Plane 网络。注入内容按“编号、标题、状态”排序，最多 30 个活跃项，并设置约 1,500 token 上限；超限时优先保留最近更新和显式关联项。

性能目标：缓存命中时单次 Hook P95 小于 100ms。任何异常都返回允许 Codex 继续的结果。

#### D1-5 Skill 和固定 MCP instructions

- Skill 描述自然项目工作流：首次绑定、显式记录/更新/完成、安静自动捕获。
- Skill 不把“项目、任务、看板”等狭窄关键词当成唯一触发条件。
- `additionalContext` 每回合提醒：结合本轮用户要求、计划、工具结果和最终结论判断是否产生项目事件；有事件时最终回复前至多批量调用一次。
- MCP 全局 instructions 只放稳定规则和工具边界，不放动态项目列表。
- 自动成功不写入用户最终回复；只有用户显式要求记录/更新/完成时才简短确认。

第一天完成结果：在 Fake Plane 下，用户完成一次自然绑定；一个有意义回合可靠进入 Outbox；普通闲聊不写入；重复提交不产生第二条批次。

### 第二天：Plane 投射、去重、字段所有权和失败恢复

#### D2-1 目标 Plane 接口确认

- 用目标 Plane 实例验证列项目、列状态、列工作项、创建工作项、评论、更新状态。
- 记录 Plane 版本、Cloud/自托管类型以及实际使用的 API 路径。
- 优先使用官方 Node SDK。如果目标自托管版本实际不兼容，就在 `packages/plane` 中直接实现该目标版本所需的 REST 路径；不做自动能力探测、多版本分支或 fallback 链。

可见结果：真实 Plane 中可创建一个测试工作项、追加一条活动、更新一次状态并清理测试数据；清理由用户显式执行，不进入自动捕获路径。

#### D2-2 事件协调器

按以下确定顺序处理每个事件：

1. 有 `relatedItemId`：精确关联。
2. 有相同工作回合组合标识或来源引用：更新原记录。
3. 同项目中存在系统创建且标题规范化后完全相同的活动项：追加来源或进度。
4. 其余情况：保守创建，不用模糊匹配覆盖已有工作。

事件投射：

- `task`、`bug`、`idea`、`risk`、`milestone` -> Plane 工作项。
- `plan` -> 一个父项，明确步骤成为子项。
- `progress`、有关联的 `decision` -> 评论/活动。
- 无可靠关联但值得独立保存的 `decision` -> 带 Decision 标签的工作项。
- `completed` -> 仅更新可唯一解析的关联项状态。

Demo 的去重以“宁可出现一个可合并的新卡片，也不错误覆盖用户卡片”为原则。

#### D2-3 字段所有权

- 系统每次写入字段时保存规范化值摘要。
- 下一次刷新 Plane 时，如果远端字段值与最后系统值不同，则标记为 `user` 所有。
- 用户创建的项默认所有字段归用户，只允许系统追加活动。
- 自动流程不得改用户所有的标题、描述、负责人、优先级或截止日期。
- 对话中的明确状态变更通过 `userDirected: true` 表示授权；仍要求目标可唯一解析。

可见结果：测试中用户手动改标题后，后续自动同步只追加进度，不恢复旧标题。

#### D2-4 Outbox worker

- `record_project_events` 只负责 SQLite 事务入队，成功后立即返回。
- worker 独立取出 `pending/retrying` 批次并投射 Plane。
- worker 每 5 秒处理一次未同步批次。失败时保存最近错误并留在队列，下次继续处理；不引入指数退避、抖动、重试次数 gate 或通用重试框架。
- 每个 Plane 写操作携带本地 `batchId/eventId` 作为来源尾注，保证网络超时后的重放仍可识别。
- 日志只记录 ID、事件类型、耗时和错误码，不记录完整对话或密钥。

第二天完成结果：关闭 Plane 网络时 Codex 仍正常完成工作且事件留在 Outbox；恢复网络后自动同步；重复重试不产生明显重复卡片；用户接管字段不被覆盖。

### 第三天：伴随面板、真实会话评估和宿主 UI 实验

#### D3-1 本地面板 API

只暴露本机回环地址，提供：

- 项目摘要、工作项分类、最近活动、来源引用和同步失败查询。
- 编辑标题、描述、种类、状态和截止日期。
- 合并系统生成的重复项。
- 归档或删除系统自动创建的项。
- 手动重试失败批次。
- 开关当前项目上下文的自动捕获。
- 返回 Plane 对象 URL 和可用的 Codex 来源标识。

所有修改经服务端写 Plane；浏览器代码不接触 Plane API Key。

#### D3-2 面板 UI

做一页即可，不做完整 Kanban：

- 顶部：当前项目、捕获开关、最后同步状态。
- 左侧：Captured、进行中、Bug、决定、想法/风险、失败数量。
- 中间：所选分类的项目记录列表。
- 右侧详情：可编辑字段、最近活动、来源摘要、Plane 链接、合并/归档/删除操作。

所有破坏性面板操作都由用户主动点击并二次确认；自动链路仍不拥有删除权限。

#### D3-3 评估工具

建立一份本地 JSONL 标注文件，每个真实回合记录：

```json
{
  "sessionId": "...",
  "turnId": "...",
  "shouldCapture": true,
  "expectedTypes": ["bug", "progress"],
  "actualBatchId": "...",
  "falseRecord": false,
  "notes": "..."
}
```

评估脚本计算：

- 捕获率 = 应记录且实际记录的回合 / 应记录回合。
- 误记录率 = 不应记录但产生记录的回合 / 不应记录回合。
- 显式操作成功率。
- 重复记录数。
- 接受到 Plane 可见的 P50/P95 延迟。
- 被用户接管字段的误覆盖次数。

至少运行 3 个真实工作会话、15 个未预编排自然回合，覆盖计划、执行、Bug、决定、进展、显式完成和闲聊。

#### D3-4 MCP UI 独立实验

- 只做一个只读的最小资源，验证目标 Codex 构建是否能显示 MCP UI。
- 记录是否支持内联、画中画或全屏，以及是否能稳定重新打开。
- 不把 MCP UI 结果作为 Demo 主链路；失败时继续使用本地伴随面板。
- 不使用 CDP，也不尝试永久侧边栏注入。

第三天完成结果：完成规格中的全部量化验收并生成评估报告；若指标不达标，报告必须能区分是“Codex 漏调用”“事件协调错误”“Plane 同步错误”还是“UI 展示错误”。

## 5. 测试矩阵

| 层级 | 必测内容 |
|---|---|
| 单元测试 | cwd 规范化、事件 schema、组合唯一约束、投射规则、所有权判断、固定周期重试、上下文截断 |
| Hook 契约测试 | 五种官方 payload fixture、缺字段、坏 JSON、数据库被锁、无绑定、捕获关闭 |
| MCP 契约测试 | 五个工具的权限边界、空批次、重复批次、本地落盘失败、明确完成的歧义处理 |
| 集成测试 | SQLite 事务、worker 崩溃恢复、Fake Plane 超时/429/500、重复网络响应 |
| Plane 冒烟测试 | 列项目、创建/更新/评论/状态、Cloud 或目标自托管版本兼容 |
| Codex 端到端 | 信任、首次绑定、自动记录、显式完成、闲聊不记录、Hook/MCP/Plane 故障不阻塞 |
| 人工验收 | 3 个真实会话、15 个自然回合、指标计算和来源检查 |

只测试规格明确要求的关键路径和已经实际出现的故障，不扩展理论性的组合测试矩阵；真实会话不能完全用固定脚本替代。

## 6. 安全与隐私约束

- Plane API Key 只从服务端环境变量或本机安全配置读取，不写 SQLite、不进入 Hook 上下文、不发送到面板。
- 不读取或复制完整 Codex transcript；官方也说明 transcript 格式不是稳定 Hook 接口。
- 来源引用仅保存 `session_id`、`turn_id`、事件摘要和必要的短摘录。
- Hook 输出不包含源码、终端原始输出、完整 Plane 描述、评论、附件或密钥。
- HTTP 服务默认只监听 `127.0.0.1`，写接口使用随机本机会话令牌。
- 自动 MCP 不提供删除、跨项目移动、修改负责人等高风险工具。

## 7. 交付物

完成 Demo 时应存在：

1. 可安装和启用的 Codex 插件目录。
2. 可运行的 STDIO MCP server 和五种 Hook。
3. SQLite migration、Outbox worker 和 Plane adapter。
4. 本地伴随项目面板。
5. `.env.example`、安装说明、启动说明和故障排查说明。
6. 自动测试与 Hook/MCP fixture。
7. 真实会话评估数据和一页结论报告。
8. MCP UI 宿主验收记录。

## 8. 明确不进入三天主线的内容

- 永久 Codex 侧边栏、CDP 注入或修改 Codex 客户端。
- 第二个 OpenAI/OpenAI-Compatible 模型和语义补偿 worker。
- 多用户、OAuth、团队权限、云端部署。
- 纠错记忆、个性化规则学习。
- Git、PR、CI、Worktree 编排。
- 完整 Kanban 拖拽、复杂筛选、通知系统和移动端。

如果时间不足，优先级从高到低为：宿主闭环、可靠入队、Plane 投射、字段所有权、真实评估、面板外观、MCP UI 实验。不可为了做漂亮面板而跳过真实会话评估。

## 9. 关键风险与判定方法

| 风险 | 判定方法 | 处理 |
|---|---|---|
| Codex 经常漏调 MCP | 真实回合捕获率低于 80% | 先缩短和重写注入规则；仍不达标则否定“只依靠当前 Codex”的假设，不偷偷增加第二模型 |
| 自动工具逐次确认 | 最小闭环第 6 项失败 | 直接修正工具元数据和权限，并如实记录当前宿主限制 |
| Hook 影响主任务 | Hook 延迟、异常或可见提示 | 严格本地缓存、100ms 目标、fail-open；禁用所有网络调用和状态消息 |
| Plane API 版本不匹配 | 真实冒烟出现接口错误 | 按目标实例固定一个实际可用路径，不实现自动探测和 fallback 链 |
| 重试造成重复卡片 | 超时后重放测试 | 工作回合组合唯一约束 + Plane 来源尾注 + 创建后再读取核对 |
| 误覆盖用户字段 | 人工修改后重放自动事件 | 字段级所有权；无法确认时只追加活动 |
| 本地缓存变成第二真相源 | 面板与 Plane 不一致 | 面板以 Plane/刷新缓存为准；SQLite 不保存独立用户项目记录 |

## 10. 开始实施时的第一批任务

按以下顺序开工，不并行扩张范围：

1. 初始化 workspace 和测试框架。
2. 用官方插件脚手架生成最小插件结构。
3. 完成“假 `record_project_events` + 五种 Hook”最小闭环。
4. 固化 MCP schema 和 Hook fixture。
5. 建 SQLite migration 和幂等入队测试。
6. 完成项目绑定闭环。
7. 接入 Fake Plane 后再连接真实 Plane。

按这个顺序推进是为了尽早拿到真实接口反馈，不设置阻断后续工作的开发 gate。

## 11. 依据

- [OpenAI Codex Hooks](https://developers.openai.com/codex/hooks)：Hook 生命周期、`additionalContext`、`session_id`、`turn_id`、工具覆盖和信任流程。
- [OpenAI Codex Skills](https://developers.openai.com/codex/skills)：Skill 的显式/隐式调用和 `agents/openai.yaml`。
- [OpenAI Codex MCP](https://developers.openai.com/codex/mcp)：STDIO MCP、instructions 和工具权限。
- [OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins)：`.codex-plugin/plugin.json`、`.mcp.json`、Skill 与 Hook 打包结构。
- [Plane 生态调研](../research/plane-frontend-bridge-ecosystem.md)：官方 SDK、API 兼容风险和社区实现参考。
