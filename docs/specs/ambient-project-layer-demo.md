# 环境式项目管理层 Demo 规格说明

**状态：** 已确认，可进入实施  
**版本：** 0.2  
**日期：** 2026-08-10  
**首选后端：** Plane  
**首选宿主：** Codex 桌面端

## 1. 概述

环境式项目管理层是 Codex 的一个可选项目管理能力。它利用当前 Codex 已经拥有的对话、计划和执行上下文，识别其中有意义的项目信息，通过一个高层 MCP 工具提交结构化项目事件，并同步到 Plane，而不要求用户改变原有工作方式。

本产品不是一个等待命令的“Plane 操作工具”，也不是一个审批收件箱。记录过程自动且安静。用户可按需打开 Inline 项目卡片查看相关工作和修改状态；需要项目全貌、完整编辑、合并、重新组织或删除时进入 Plane。

本规格定义一个可丢弃的 Demo，它主要回答一个问题：

> Codex 能否在不打断用户的情况下，根据日常工作安静地维护一份有用、可信的项目全貌？

Demo 同时验证一个更具体的技术假设：当前正在工作的 Codex 是否能够直接完成语义判断并调用项目 MCP，而不需要额外调用第二个语义模型重新理解同一轮工作。

## 2. 产品原则

以下原则是 Demo 及后续产品不可破坏的约束：

1. **Codex 的正常工作方式保持不变。** 用户不需要特殊命令、表单或项目管理术语。
2. **自动捕获。** 系统不要求用户逐条确认，而是自动记录有意义的工作。
3. **界面由用户主动查看。** 项目面板不通过审批弹窗或常规通知打断对话。
4. **自动化必须可逆。** 用户可以在 Plane 中编辑、合并、重新分类、归档或删除系统生成的记录；Inline 只承担轻量状态修改。
5. **所有记录必须可追溯。** 用户可以看到记录或更新来自哪个工作会话、哪段来源摘要。
6. **项目知识不只有任务。** 决策、想法、风险、里程碑、Bug、承诺和进度都是一等信息。
7. **Plane 是适配器，而不是产品边界。** 领域模型不能依赖 Plane 专有名称或标识符。
8. **Demo 以验证认知为目标。** 身份认证、多用户管理、精致 UI 和完整异常处理不属于本轮重点。
9. **用户修改优先。** 自动化不得覆盖用户已经接管或亲自修改的字段。
10. **主任务优先。** 上下文注入、MCP 或 Plane 失败时，Codex 的原始工作必须继续完成。

## 3. 目标

Demo 必须能够：

- 通过自然对话把当前工作目录绑定到一个 Plane 工作区和项目。
- 使用五种 Codex Hook 注入最小项目上下文、追踪执行结果并审计回合。
- 让当前 Codex 从日常工作中识别零个或多个来源事件，并直接调用高层 MCP 工具提交。
- 合并相关来源事件，而不是为每条消息创建一个新工作项。
- 自动创建或更新项目记录。
- 自动把支持的项目记录同步到 Plane。
- 在可选的 Inline 项目卡片中展示约 3–5 个相关工作项，并可跳转 Plane 查看全部记录。
- 允许用户事后修正，不要求用户返回原始对话处理。
- 为每次自动变更保留最小必要的来源引用。
- 允许用户关闭功能；关闭后不改变 Codex 的正常工作方式。
- 在 Demo 中不调用额外的 OpenAI 或 OpenAI-Compatible 语义模型。

## 4. 非目标

Demo 不会：

- 要求用户逐条评审或接受识别出的内容。
- 构建一个完整的 Plane 替代品。
- 实现团队管理、高级权限、计费或企业认证。
- 自动把工作分配给其他人。
- 仅凭推断删除工作项，或关闭由用户管理的 Plane 工作项。
- 为每一轮对话强制调用一次空 MCP 工具。
- 使用第二个模型重新分析 Codex 已经理解过的对话。
- 实现跨会话的纠错记忆或个性化记忆。
- 深度集成 Git、Pull Request、CI 或 Worktree 编排。
- 通过非公开 UI 注入保证 Codex 永久侧边栏。
- 使用 CDP 修改 Codex 应用。
- 针对移动端优化。

## 5. 用户与主要场景

主要用户是使用 Codex 持续完成工作，并希望项目状态自然地成为工作副产物的个人。工作可以是软件开发、研究、规划、写作、运营或其他项目型活动。

示例会话：

1. 用户与 Codex 讨论产品方向。
2. 用户提到明天需要确定任务方案。
3. Codex 随后完成代码，并说明单元测试通过，但浏览器测试尚未完成。
4. 用户报告一个新发现的 Bug，并要求 Codex 继续排查。
5. 除首次自然绑定项目外，整个对话中用户没有打开任何项目管理表单。
6. 用户打开 Inline 项目卡片时，最相关的任务和状态已经可见；进入 Plane 后可以查看截止日期、Bug、决策历史和完整项目全貌。

## 6. 领域模型

统一术语定义见 [`CONTEXT.md`](../../CONTEXT.md)。

### 6.1 项目上下文

项目上下文包含：

- 用于展示和兼容历史绑定的规范化 Codex 工作目录 `cwd`
- 可读、稳定的工作区身份 `workspace_identity`
- Plane 基础 URL
- Plane 工作区标识
- Plane 项目标识
- 自动捕获的启用状态
- 同步配置

Codex Hook 不提供可直接使用的项目标识，只提供显式 `cwd`、`session_id` 和回合范围内的 `turn_id`。工作区身份先解析软链接取得真实路径；Git 工作区使用真实 `git common dir`，因此仓库根目录、子目录和 linked worktree 共享绑定，独立 clone 保持不同身份；非 Git 目录使用真实绑定根路径，并按路径段做最长祖先匹配。解析不依赖当前进程 `cwd`，也不按 Codex Project、目录名或 Plane 项目名猜测。

旧数据库保留 `project_contexts` 自增 ID、`canonical_cwd`、Outbox、来源引用和历史绑定；打开时只为缺少身份的旧行补写可读身份，迁移可重复执行，不合并项目上下文。

首次进入未绑定目录时，`SessionStart` 只注入 onboarding 规则，不能交互；`UserPromptSubmit` 必须优先观察当前用户消息和可见对话：如果尚未实际询问，首个用户可见回复立即调用 `list_projects`，展示真实返回的 Plane 项目并询问选择；当前消息若是明确长期拒绝则调用 `decline_project_binding` 且不列项目；若只是“之后再想想/跳过/继续任务”则仅本 session 暂缓、不写数据库；若明确要求恢复/绑定则先按需 `restore_project_binding` 再列项目。后续 `UserPromptSubmit` 不能仅因已出现过 Hook 审计就假设询问完成：对话中仍未实际询问时要补问，已经询问且用户仅暂缓/忽略/继续时本 session 不重复。选择前不得调用 `bind_project`。不得根据 Codex Project 名、目录名、Git remote 或对话猜测目标项目；新 session 对同一未绑定 identity 再主动询问一次。

调用 `list_projects` 后，工具输出、commentary 和思考过程不算用户交付。最终 `last_assistant_message` 必须包含固定的“项目绑定（待确认）”区块、至少一个真实返回项目的 Markdown 列表项和精确操作句“请选择一个项目，或回复‘稍后再说’。”；同一回合继续完成用户主任务。该交付规则由 Skill、SessionStart/UserPromptSubmit 和 MCP instructions 在最终答复前提供；`Stop` 只在内存中检查最终消息并写入 `binding_prompt_delivered=0/1`，不阻断、不补问、不注入二次提示，始终静默允许结束。最终消息不写入数据库、日志或网络。

只有明确的“这个目录不要绑定/以后不要再问”等长期指令才调用 `decline_project_binding`。它在本地插件 SQLite 的独立 `workspace_binding_preferences` 表中按稳定 `workspace_identity` 保存可读的 `declined` 状态，不保存用户原话，不创建伪 `project_contexts`；Git root/subdir/linked worktree 共享，独立 clone 不共享，非 Git 路径采用与绑定相同的最长祖先语义。非 Git root 的拒绝由 child 和 sibling 继承；对已继承拒绝再次 decline 直接复用 root 记录，不创建 child 行。对 child 明确 restore 或 bind 时只写 child 精确 `restored` override，child 的拒绝恢复后 sibling 仍保持 root 拒绝；明确恢复或绑定 root 才影响 root 下没有更具体 override 的路径。永久拒绝时五个 Hook 仍运行：SessionStart/UserPromptSubmit 注入“未绑定但保持安静、用户主动要求可恢复”的精简上下文，PostToolUse/SessionEnd 继续审计，Stop 不要求 record/ack。用户后来明确要求恢复时调用 `restore_project_binding`，成功 `bind_project` 清理或覆盖当前 identity 的拒绝状态。

### 6.2 来源事件

来源事件是当前 Codex 判断出的最小有意义项目信号。Demo 支持以下类型：

- `task`：任务、承诺或待办
- `bug`：Bug 报告
- `decision`：决策
- `idea`：想法
- `risk`：风险或阻塞
- `milestone`：里程碑
- `progress`：进度
- `completed`：明确完成
- `plan`：包含一个或多个可执行步骤的计划

用户明确推翻、放弃或替换计划时，Codex 对受影响的计划父项和其生成步骤分别提交用户指示的 `completed` 事件，并设置 `archiveAfterCompletion: true`。投射端必须先将每项更新为 Done，再调用 Plane 归档；只允许归档系统创建项，不授予或调用删除权限。

父子工作项必须作为同一闭环处理。注入上下文明确标记每个活动工作项是父项、子项或独立项；完成、推翻或归档父项前，Codex 必须检查全部已知子项并逐项处理，不能只更新主项而把 Todo / In Progress 子项遗留在项目中。

每个来源事件包含：

```json
{
  "eventId": "event_123",
  "projectContextId": "project_123",
  "sessionId": "session_123",
  "turnId": "turn_456",
  "type": "bug",
  "title": "登录页面偶尔出现白屏",
  "summary": "登录页面偶尔出现白屏",
  "relatedItemId": null,
  "userDirected": true,
  "sourceExcerpt": "登录页面偶尔会白屏，记录下来。",
  "observedAt": "2026-08-10T12:00:00Z"
}
```

`sessionId` 和 `turnId` 来自 Codex Hook。因为每个工作回合最多提交一个批次，服务端直接对 `projectContextId`、`sessionId`、`turnId` 建立数据库组合唯一约束，不生成 SHA 或其他哈希式幂等键。`event_id` 使用批次数据库行号和事件序号。没有有意义项目信息的回合不会产生来源事件，也不会为了证明“没有事件”而调用空写入工具；启用自动捕获时，当前 Codex 通过 `acknowledge_no_project_events` 保存该回合已完成审查的本地标记。该标记不创建 Plane 项目记录、不进入 Outbox，并使用 `project_context_id + session_id + turn_id` 幂等。

### 6.3 项目记录

项目记录由一个或多个来源事件形成。Plane 是所有用户可见项目数据的唯一真相源。Demo 支持以下种类：

- `task`：任务
- `bug`：Bug
- `decision`：决策
- `idea`：想法
- `risk`：风险
- `milestone`：里程碑

项目记录包含种类、标题、描述、生命周期状态、来源引用、时间戳、可选截止日期和 Plane 标识。本地只保存绑定、待同步事件、来源引用、工作回合组合唯一约束和同步元数据，不维护一套与 Plane 竞争的用户可见项目记录数据库。

六种项目记录映射为同名的 Plane Work Item Type：`Task`、`Bug`、`Decision`、`Idea`、`Risk`、`Milestone`。适配器在项目内复用已有同名类型，缺少时按需创建，并在 Work Item 的 `type` 字段写入类型 ID。远端刷新先读取项目 Work Item Types，再按 Work Item 的 type ID 恢复本地 `kind`；分类不依赖仅存在于 SQLite 的缓存字段。

进度通常不会创建新的项目记录，而是作为活动条目附加到最相关的已有记录上。

### 6.4 生命周期与同步状态

项目生命周期和同步生命周期是两个独立维度。

项目生命周期：

```text
captured（已捕获） -> planned（已规划） -> in_progress（进行中） -> done（已完成）
       |                    |                       |
       +---------------> dropped（已放弃） <-------+
```

同步生命周期：

```text
pending（待同步） -> synced（已同步） -> corrected（已修正）
       |
       +----> failed（失败） -> retrying（重试中）
```

系统明确不存在 `awaiting_confirmation`（等待确认）状态。

## 7. 捕获行为

### 7.1 总体规则

当前 Codex 本来就拥有本轮的用户要求、显式计划、工具调用和工作结果。Demo 不把完整对话交给第二个模型，而是通过 Skill 和 Hook 向当前 Codex 提供项目规则、绑定、来源标识和精简 Plane 快照。Codex 在形成最终回复前判断本轮是否产生有意义的项目事件；存在事件时，最多批量调用一次 `record_project_events`，否则调用一次无事件审查确认工具。

“记录所有工作”指保留所有被当前 Codex 识别出的项目工作，而不是把每条消息原样复制到 Plane。Demo 接受当前 Codex 偶尔漏调用 MCP 的可能性，并把漏记率作为核心验收指标；`Stop` 不启动第二个模型或强迫 Codex 继续执行来补偿。

### 7.2 精简项目上下文

动态项目上下文来源于本地缓存的 Plane 数据，并通过 `SessionStart` 或 `UserPromptSubmit` 的 `additionalContext` 注入当前 Codex。它不是 MCP 全局 `instructions` 的一部分。

注入内容仅包括：

- 当前项目绑定
- 本次 Hook 提供的真实 current cwd；已绑定时同时区分 binding root
- `session_id` 与当前 `turn_id`
- 自动记录的简短规则
- 活跃 Plane 工作项的编号、标题和状态

未绑定时，`SessionStart` 与首次 `UserPromptSubmit` 使用不同 onboarding 模板；后续同 session 的 `UserPromptSubmit` 只说明已询问过，不重复询问。持久拒绝时模板只说明保持安静以及用户主动恢复路径。

MCP `instructions` 和 Skill 只保存固定工作流规则。动态快照不包含完整工作项描述、评论、源码、终端原始输出、密钥或附件。

为了保持无感：

- Hook 不配置 `statusMessage`
- Hook 不返回 `systemMessage`
- Hook 使用本地缓存，不在请求路径等待 Plane 网络
- Hook 失败时继续 Codex 主任务，并在本地审计中记录异常；Inline 只展示必要的同步健康状态
- 额外上下文保持精简，避免挤占主任务上下文

### 7.3 自动行为

系统可以在不提示用户的情况下：

- 创建处于 `captured` 状态的新项目记录。
- 添加来源引用。
- 为已有记录添加进度。
- 合并对同一工作的重复描述。
- 在后续上下文更清晰时改进系统生成的标题或描述。
- 把系统创建的记录同步到 Plane。
- 重试失败的同步。
- 对系统创建且尚未被用户接管的记录更新状态。

### 7.4 字段所有权与受保护行为

字段所有权规则：

- 系统自动创建的工作项，其系统生成字段可以继续自动更新。
- 用户手动修改某个字段后，该字段转为用户所有，系统不再覆盖。
- 用户原本创建的工作项默认只追加进展，不自动修改标题、负责人、优先级或截止日期。
- 用户在对话中明确要求修改状态时，可以修改用户所有字段；这是用户授权的操作，不是自动推断。
- 当“这个任务”等指代无法唯一解析时，Codex 才询问用户。

Demo 不得自动：

- 删除并非由本系统创建的 Plane 对象。
- 把记录分配给其他人。
- 仅根据模糊语言把用户管理的 Plane 工作项标记为完成。
- 用生成内容覆盖用户亲自编写的描述。
- 删除 Plane 工作项、移动到其他项目或改变负责人。

这些限制用于避免不可逆或扩大权限范围的操作，但不会把正常捕获变成审批流程。

### 7.5 合并示例

连续输入：

```text
“登录页面有时会白屏。”
“看起来是在 Token 过期后发生的。”
“修复已经实现，但还没有做浏览器测试。”
```

预期结果：

- 只产生一个 Bug 记录，而不是三个工作项。
- 把可能与 Token 过期有关的条件添加到描述或活动中。
- 把实现完成记录为活动条目。
- 在适当时创建并关联一个待完成的浏览器测试任务。

## 8. Plane 投射规则

Demo 使用 Plane 作为持久项目后端。

| 项目信息 | Plane 表示方式 |
|---|---|
| 任务、Bug、想法、风险 | 使用同名 Plane Work Item Type 的工作项 |
| 里程碑 | 使用 `Milestone` Work Item Type；独立 Plane Milestone 实体映射延后 |
| 进度 | 已有工作项的评论或活动 |
| 决策 | 优先作为关联工作项的活动；无关联且值得独立追踪时创建 `Decision` Work Item Type 的工作项 |
| 计划 | 一个父工作项，明确的执行步骤作为子工作项 |
| 明确完成 | 更新关联工作项的状态 |
| 被明确推翻的计划与步骤 | 先更新为 Done，再归档；不删除 |
| 来源引用 | 自动创建对象中的结构化尾注或元数据 |

所有自动生成的可执行工作都进入专用的 `Captured` 工作流状态，或等价的 Plane Intake 状态。该状态用于说明记录来源并支持用户日后整理，而不要求创建前审批。

Plane 适配器使用官方 SDK 的 `workItems` 和 `workItemTypes` 资源。当前 Demo 只支持目标 Plane Cloud 的 `/work-items/` 与 `/work-item-types/` 路径，不实现 `/issues/` 探测或 fallback。

自动投射遵循以下保守顺序：

1. `relatedItemId` 存在时精确更新。
2. 无精确关联时，服务端使用项目、来源引用和工作回合组合标识查找已有记录。
3. 无法可靠匹配时创建新记录，不模糊覆盖已有记录。
4. `progress` 与 `decision` 优先追加活动，不为每句话创建新卡片。

## 9. 项目面板

项目面板不是审批收件箱，也不是 Plane 的完整替代品。正式产品形态是对话内 Inline card；完整浏览和管理通过 Plane 完成。权威边界见 [`docs/architecture/inline-panel-product-boundary.md`](../architecture/inline-panel-product-boundary.md)。

Demo 面板必须展示：

- 当前 Plane 项目名称和同步健康状态
- 约 3–5 个与当前工作最相关的工作项
- 每个可见工作项的标识、标题和状态
- `Captured`、`Planned`、`In progress`、`Done` 四个状态目标
- 状态保存中、同步成功或失败回滚反馈

面板必须支持：

- 鼠标拖拽修改可见工作项状态
- 点击状态菜单和键盘完成等价状态变更
- 通过唯一主要 CTA “在 Plane 中打开 ↗”进入当前 Plane 项目或 Work items 页面

Inline card 不提供完整筛选、详情编辑、创建、合并、归档、删除、分析或批量操作；这些能力保留在 Plane。面板不得显示要求用户立即处理的常规弹窗或通知角标，也不得通过内部滚动塞入完整 Kanban。

## 10. Codex UI 限制

目标体验是项目卡片在 Codex 对话中以内联形式出现。当前实现的正式入口是 MCP Apps `open_project_panel` 工具和 `ui://ambient-project/panel/v1.html` 组件资源，Panel 通过工具结果的组件私有 `_meta` 获取 localhost Service 会话。即使宿主支持 Fullscreen，本产品也不使用它承载完整 Ambient 看板；完整管理统一跳转 Plane。公开文档没有提供注册永久项目侧边栏的接口。

因此，Demo 不依赖永久侧边栏能力。

推荐的 Demo 展示方式：

1. 主要验证使用 Codex MCP App 宿主加载自制 React Inline card。
2. 宿主不支持组件渲染或会话 metadata 传递时，使用 4318 本地 Web 面板降级；降级页面要求手工输入临时令牌。
3. 不使用 CDP 注入，也不把令牌放入模型可见结果、Hook 输出或 Vite proxy。

不规划永久项目侧边栏、Ambient Fullscreen 或独立完整管理客户端；完整项目管理继续使用 Plane。

Panel 会话的具体边界和验收步骤见 [`docs/architecture/ambient-panel-session-security.md`](../architecture/ambient-panel-session-security.md)。

## 11. Demo 架构

```text
SessionStart / UserPromptSubmit
    |
    | additionalContext：绑定、来源标识、精简项目快照、记录规则
    v
当前 Codex 正常完成用户工作
    |
    | 最终回复前执行 record-or-ack：有事件记录非空批次，无事件确认审查
    v
record_project_events / acknowledge_no_project_events（高层 MCP 工具）
    |
    | 可靠写入本地 Outbox 后立即返回 accepted
    v
事件协调器：组合唯一约束、关联、去重、字段所有权、Plane 映射
    |
    +----> PostToolUse / Stop / SessionEnd 审计与刷新
    |
    v
Plane 适配器 -> Plane API（完整浏览与管理）
本地查询服务 -> Inline 项目卡片（少量相关工作项与状态操作）
```

### 11.1 组件

**项目 Skill**

- 定义哪些信息值得成为项目事件。
- 指导 Codex 在最终回复前执行 `record_project_events` 或 `acknowledge_no_project_events`。
- 未绑定时允许自然询问用户，并调用绑定工具。
- 自动写入成功时不要求 Codex 在回复中说明；用户明确要求的操作应简短确认。

**Hook 上下文适配器**

- 接收五种已选 Codex Hook。
- 读取 Codex 提供的 `cwd`、`session_id`、`turn_id` 和可选 `tool_use_id`。
- 从本地缓存生成精简 `additionalContext`。
- 不调用语义模型，不等待 Plane 网络，不阻塞主任务。

**高层 MCP 服务**

- 暴露绑定、读取项目上下文和记录项目事件的窄接口。
- 接收 Codex 已完成语义判断后的事件批次。
- 在本地 Outbox 持久化成功后快速返回 `accepted`。
- 不把 Plane 底层 CRUD 细节暴露给自动记录 Skill。

**事件协调器**

- 使用工作回合组合唯一约束防止重复。
- 根据 `relatedItemId`、来源引用和已有映射创建或更新记录。
- 执行字段所有权和用户修改优先规则。
- 将进度与决策优先投射为活动条目。

**Plane 适配器**

- 把项目记录映射到 Plane 资源。
- 负责身份认证、重试和 API 版本兼容。
- 不向面板 iframe 或浏览器代码暴露 Plane 凭据。

**项目面板**

- 从服务端读取约 3–5 个相关工作项和同步健康状态。
- 通过本地服务执行用户发起的状态修改，并提供失败回滚与等价的状态菜单。
- 通过唯一主要 CTA 打开 Plane 项目或工作项页面。
- 把 Plane 视为唯一用户可见真相源，而不是依赖浏览器或本地项目记录副本。

### 11.2 五种 Hook

| Hook | Codex 提供的来源标识 | Demo 职责 |
|---|---|---|
| `SessionStart` | `session_id`，无 `turn_id` | 解析项目绑定；未绑定时只注入首次 onboarding 规则，不直接交互；绑定时注入 current cwd 与 binding root |
| `UserPromptSubmit` | `session_id`、`turn_id` | 未绑定时按当前消息和可见对话分支：尚未实际询问则主动 `list_projects`，明确拒绝则 decline，明确恢复则 restore/list，模糊暂缓只在本 session 不重复；绑定时注入当前回合来源标识与缓存 |
| `PostToolUse` | `session_id`、`turn_id`、`tool_use_id` | 审计 `list_projects`、record/ack 和两个绑定偏好工具结果；`turn_audits.record_tool_called=1` 只表示精确调用过 `record_project_events`，`binding_list_tool_called=1` 只表示同回合精确调用过 `list_projects`，其余调用保持为 0 |
| `Stop` | `session_id`、`turn_id`、`last_assistant_message` | 读取当前 context、同回合 list/record/ack 审计与内存中的最终消息，写入可空的 `capture_decision_recorded`/`binding_prompt_delivered` 结果；始终放行，不返回用户可见反馈或二次提示，不保存最终消息，不启动第二个模型 |
| `SessionEnd` | `session_id`，无 `turn_id` | 通知后台调度仍在队列中的任务并结束会话审计；未绑定也继续审计，不等待网络 |

Codex 直接提供 `session_id` 和回合范围内的 `turn_id`。服务端按数据库行号和事件序号分配 `event_id`，并使用 `project_context_id`、`session_id`、`turn_id` 的组合唯一约束防止重复。`SessionStart` 与 `SessionEnd` 没有 `turn_id`，因为它们属于整个工作会话。

### 11.3 原型存储

Demo 可以使用名称明确的临时 SQLite 数据库，例如 `ambient-project-demo.sqlite`。它只保存项目绑定、未绑定偏好、Outbox 事件、无事件审查确认、来源引用、工作回合组合唯一约束、字段所有权和 Plane 同步元数据。

该数据库不保存第二套用户可见项目记录，也不保存完整对话。它仅用于可靠交付和溯源，不代表正式产品的存储决策。

## 12. Skill、Hook 与 MCP 的职责

Demo 采用“双通道”设计：

- **Skill + MCP** 负责自然交互：首次绑定、切换项目、显式查询和用户明确要求的立即记录。
- **Hook + 当前 Codex + MCP** 负责可靠自动化：把规则与动态项目上下文送入当前回合，由当前 Codex 直接提交事件。

Skill 的隐式触发不是唯一可靠入口。`SessionStart` 与 `UserPromptSubmit` 必须通过开发者上下文提醒当前 Codex 使用项目记录规则。MCP 服务器的全局 `instructions` 只包含固定工作流和工具约束，不包含动态项目列表。

### 12.1 MCP 工具范围

| 工具 | 作用 | 默认权限 |
|---|---|---|
| `list_projects` | 列出可绑定的 Plane 项目 | 只读，可自动调用 |
| `get_binding` | 查询当前 `cwd` 的项目上下文 | 只读，可自动调用 |
| `bind_project` | 保存首次项目选择 | 仅在用户明确选择后调用 |
| `change_binding` | 切换当前目录关联的项目 | 仅在用户明确要求后调用 |
| `decline_project_binding` | 保存明确的长期“不绑定/不要再问”偏好 | 仅在用户明确长期拒绝后调用 |
| `restore_project_binding` | 清理长期拒绝，恢复项目选择流程 | 仅在用户明确要求恢复绑定后调用 |
| `record_project_events` | 批量提交本轮项目事件 | 绑定并启用自动记录后可自动调用 |
| `acknowledge_no_project_events` | 确认本轮已审查且没有项目事件；不创建 Plane 项目或 Outbox 批次 | 绑定并启用自动记录后，无事件时自动调用 |

Demo 不向自动化暴露删除工作项、移动项目、改变负责人等高风险 MCP 工具。首次安装和每次插件升级都必须遵循 Codex 的 Hook 信任流程，人工信任当前版本的五个 Hook；`enabled` 不等于已信任，解析后的命令或版本化缓存路径变化也可能使已有信任变为 `modified`。完成当前版本的信任和项目绑定后，`record_project_events` 与 `acknowledge_no_project_events` 不应逐次要求确认；两个绑定偏好工具只在用户明确给出对应指令时调用。

### 12.2 `record_project_events` 契约

示例输入：

```json
{
  "projectContextId": "project_123",
  "sessionId": "session_123",
  "turnId": "turn_456",
  "events": [
    {
      "type": "progress",
      "title": "Demo 技术方案已确定",
      "summary": "确定使用当前 Codex 直接调用高层 MCP，不使用第二个语义模型。",
      "relatedItemId": "PLANE-18",
      "userDirected": false,
      "sourceExcerpt": "同意"
    }
  ]
}
```

约束：

- 每个有意义的回合至多调用一次，并把多个事件放在同一批次。
- 没有事件时调用 `acknowledge_no_project_events`，不调用空 `record_project_events` 批次。
- 无事件确认按 `project_context_id + session_id + turn_id` 幂等保存；重复确认不产生新行。若同回合已有事件批次，确认返回 `already_recorded`；确认后再记录事件时，成功入队会删除确认标记。
- Codex 只描述“发生了什么”，不选择 Plane API、底层字段或重试策略。
- MCP 在 Outbox 持久化成功后立即返回 `accepted`，Plane 同步异步执行。
- 本地 Outbox 无法持久化时才返回真正失败。
- 自动成功不进入正常回复；用户明确要求的操作应简短确认已记录或正在同步。

### 12.2.1 `acknowledge_no_project_events` 契约

该工具只接受当前绑定项目的 `projectContextId`、Hook 提供的 `sessionId` 和 `turnId`。成功后返回 `status: "acknowledged"`；相同组合键重复调用返回 `duplicate: true`，不新增数据库行。若该回合已经有事件批次，返回 `status: "already_recorded"`，不写入审查标记。它不接受事件数组、不创建 Plane 项目、不进入 Outbox。

### 12.3 失败与漏记

- 上下文注入失败：继续 Codex 主任务，本轮不自动写入，面板显示异常。
- Plane 不可用：Outbox 保留事件并后台重试，不阻塞 Codex。
- Codex 未调用任一 record-or-ack 工具：`Stop` 仍返回空结果，并在绑定且自动捕获开启时写入 `capture_decision_recorded=0`；记录事件或无事件审查后写入 1。未绑定 cwd（包括永久拒绝）同样直接放行；同回合调用过 `list_projects` 时，`binding_prompt_delivered` 按最终消息固定区块写入 0/1，消息缺失或未列项目时不强制返工，交付责任留在 Skill、SessionStart/UserPromptSubmit 和 MCP instructions。两个字段只保存布尔结果，异常时仍 fail-open 且不保存最终消息。
- Demo 不以第二个模型补偿漏记；漏记率是验证当前方案是否成立的核心指标。

## 13. Demo 场景

以下场景用作开发期冒烟测试，但不能代替真实、未预先编排的 Codex 会话验收：

| 对话 | 预期项目结果 |
|---|---|
| “我明天需要确定任务方案。” | 创建截止日期为明天的任务 |
| “登录页面偶尔会白屏，记录下来。” | 创建处于 Captured 状态的 Bug |
| “第一版不开发移动端。” | 创建决策，而不是任务 |
| “以后也许可以增加国际化。” | 创建想法，而不是已承诺任务 |
| “为这个 Demo 制定一个实施计划。” | 创建父工作项，并把明确执行步骤映射为子工作项 |
| “实现已完成，单元测试通过，但浏览器测试还没做。” | 更新当前工作的进度，并记录剩余测试工作 |
| “把 PLANE-18 标记为完成。” | 作为用户明确授权的状态修改执行，并简短确认 |
| 重复描述同一个 Bug，并补充更多信息 | 更新已有 Bug，不创建重复项 |
| 不产生项目影响的日常对话 | 不创建项目记录 |

## 14. Demo 验收标准

Demo 在满足以下条件时视为成功：

1. 使用至少 3 个真实 Codex 工作会话和 15 个自然回合；用户不为测试提前编写固定台词。
2. 真实回合覆盖制定计划、执行工作、发现 Bug、产生决定、更新进展、明确完成和普通闲聊。
3. 经人工回看标注，应该记录的项目事件捕获率至少达到 80%。
4. 无项目价值的普通对话误记录率不超过 10%。
5. 用户明确要求记录、更新或标记完成的成功率达到 100%。
6. 同一工作不产生明显重复的 Plane 工作项。
7. 不覆盖用户手动修改或接管的字段。
8. 除首次项目绑定或无法唯一解析用户明确指令外，不主动要求用户确认。
9. 未绑定 cwd 的新 session 首次用户回复主动列出真实 Plane 项目并询问选择；模糊暂缓只在当前 session 生效；明确长期拒绝跨 session 保持安静且可显式恢复。
10. Hook、MCP 或 Plane 失败不阻塞 Codex 的主任务。
11. 健康网络下，MCP 接受的事件在 30 秒内出现在 Plane 和项目面板中。
12. 每条自动记录都能显示最小来源引用；本地不保存完整对话副本。
13. Demo 不调用额外的 OpenAI 或 OpenAI-Compatible 语义模型。
14. 关闭捕获后停止提交新项目事件，Codex 的普通行为保持不变。

## 15. 交付计划

### 第一天：插件骨架、绑定与工具契约

- 建立 Skill、五种 Hook 和 MCP 服务骨架。
- 实现 `list_projects`、`get_binding`、`bind_project` 和 `change_binding`。
- 实现项目上下文、来源标识与精简 `additionalContext`。
- 定义并验证 `record_project_events` 输入契约。

### 第二天：事件协调与 Plane 投射

- 实现 Outbox、工作回合组合唯一约束、来源引用和后台重试。
- 实现字段所有权、关联、去重和事件到 Plane 的投射。
- 接入目标 Plane 实例并验证 SDK/API 版本。
- 运行开发期冒烟场景。

### 第三天：项目面板与真实会话验收

- 构建 MCP App Inline 项目卡片，并保留 4318 开发/降级入口。
- 添加轻量状态拖拽、等价状态菜单、保存/失败反馈和“在 Plane 中打开”CTA。
- 运行至少 3 个真实工作会话、15 个自然回合并完成人工标注。
- 在不把它作为 Demo 依赖的前提下，测试目标 Codex 版本中的 MCP UI 渲染。
- 根据捕获率、误记录率、显式操作成功率和同步延迟记录最终结论。

## 16. 已确认的决策与已知风险

1. **真相源：** Plane 是唯一用户可见项目真相源；本地只保存绑定、Outbox、溯源和同步元数据。
2. **语义判断：** 当前 Codex 直接判断并调用 MCP；Demo 不使用第二个语义模型。
3. **自动写入入口：** 自动事件记录只使用高层 `record_project_events`；无事件回合使用独立的 `acknowledge_no_project_events` 审查确认，不向 Skill 暴露 Plane 底层 CRUD。
4. **项目识别：** Codex Hook 不提供项目 ID；用户首次自然选择 Plane 项目，系统按 `cwd` 复用绑定。
5. **Hook 范围：** 暂时使用 `SessionStart`、`UserPromptSubmit`、`PostToolUse`、`Stop` 和 `SessionEnd`。
6. **动态上下文：** 精简项目快照通过 Hook `additionalContext` 注入；MCP `instructions` 只保存固定规则。
7. **异步同步：** MCP 在本地可靠入队后返回，Plane 后台同步；健康网络目标为 30 秒内可见。
8. **用户修改优先：** 用户接管的字段不被自动覆盖；用户在对话中的明确指令可以授权状态修改。
9. **权限：** 自动化不能删除、跨项目移动、改变负责人或修改其他高风险字段。
10. **事件投射：** 任务、Bug、风险、想法成为工作项；计划成为父子工作项；进度和决策优先成为活动；里程碑在 Demo 中使用标签工作项。
11. **无感边界：** 首次安装和每次升级后的 Hook 信任，以及首次项目绑定，可以被用户感知；当前版本完成信任后不显示状态消息、不逐项确认、不阻塞主任务。MCP 调用仍可能出现在 Codex 可检查的活动记录中。
12. **漏记风险：** 不强制空 MCP 调用，也不在 `Stop` 后启动第二个模型。Demo 接受可能漏记，并用真实会话捕获率判断方案是否成立。
13. **记忆：** Demo 不实现纠错记忆或个性化记忆。
14. **面板：** 正式入口是 Codex MCP App 中的自制 React Inline card；它不提供 Fullscreen 完整看板，完整管理跳转 Plane。4318 本地页面只作为同一 UI 的开发/宿主不支持时的降级路径。
15. **本地会话：** Service 使用进程级 32-byte CSPRNG base64url 临时令牌保护 `/api/*`；bootstrap 只通过组件私有结果 `_meta` 传递，令牌不进入模型 content、Hook、SQLite、Plane 或日志。
16. **周期：** 使用三个专注开发日，不使用非公开永久侧边栏注入。

## 17. 相关资料

- [Plane 生态调研](../research/plane-frontend-bridge-ecosystem.md)
- [Codex/Jira 面板调研](../research/codex-jira-panel-github.md)
- [OpenAI 插件 UI 文档](https://developers.openai.com/plugins/build/chatgpt-ui)
- [OpenAI Codex Hooks 文档](https://developers.openai.com/codex/hooks)
- [OpenAI Codex Skills 文档](https://developers.openai.com/codex/skills)
- [OpenAI Codex MCP 文档](https://developers.openai.com/codex/mcp)
- [Plane MCP Server](https://github.com/makeplane/plane-mcp-server)
