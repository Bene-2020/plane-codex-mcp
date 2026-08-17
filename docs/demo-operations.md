# Demo 操作与验收记录

## 本地闭环

1. `pnpm install && pnpm build`。
2. 正式 Codex 插件不需要手工启动 Service，也不需要设置 `AMBIENT_SESSION_TOKEN`/`AMBIENT_SERVICE_BASE_URL`。每个 MCP 进程在内部生成 32-byte CSPRNG、43 位 base64url 令牌，并以动态端口 `0` 启动自己的 localhost BFF/worker；进程重启后旧令牌失效。
3. 本地 fake smoke 必须显式设置 `PLANE_MODE=fake`，此时 `list_projects` 才会返回 `Demo Project`。正式 Codex Desktop 按 [Codex Desktop 安装与真人验收](codex-desktop-installation.md) 配置 `PLANE_MODE=sdk`、真实数据库和 Plane 凭据；正式入口缺少模式时会失败，不会伪装成 Demo。
4. 未绑定 cwd 的新 session 在首次 `UserPromptSubmit` 前由 Hook 注入主动 onboarding 规则：当前 Codex 必须根据当前消息和可见对话判断分支；尚未实际询问时先调用 `list_projects`、展示真实返回的 Plane 项目并询问选择，明确长期拒绝时只调用 `decline_project_binding`，明确恢复/绑定时按需 restore 后 list，模糊暂缓时本 session 不重复且不写偏好。SessionStart 只注入规则，不能交互。调用 `list_projects` 后，工具输出、commentary 和思考过程不算交付；最终 `last_assistant_message` 必须包含“项目绑定（待确认）”、至少一个真实项目 Markdown 列表项和“请选择一个项目，或回复‘稍后再说’。”，同时继续主任务。
5. 选择前不能调用 `bind_project`，不得按 Codex Project 名、目录名、Git remote 或对话猜测。新 session 会再次询问一次。只有明确“这个目录不要绑定/以后不要再问”等长期指令才调用 `decline_project_binding`。Git root/subdir/linked worktree 共享，独立 clone 不共享；非 Git root 拒绝由 child/sibling 按最长祖先继承，child 上重复 decline 复用 root 记录，child restore/bind 写精确 override，不静默影响 sibling；恢复后 `getBindingPreference(child)` 必须为空。成功 bind 会清理或覆盖当前 identity 的拒绝状态。
6. 正式环境通过 MCP `list_projects` 查看真实项目；用户明确选择后调用 `bind_project`。没有绑定时不猜测目标项目，也不写入 Plane。绑定上下文同时展示真实 current cwd 与 binding root。
7. 永久拒绝的未绑定 cwd 仍运行五个 Hook：SessionStart/UserPromptSubmit 注入精简“保持安静、用户主动要求可恢复”规则，PostToolUse/SessionEnd 继续审计；Stop 只写结束审计及适用的 `binding_prompt_delivered` 结果，始终允许回合结束，不阻断主任务或补发提示。`record_tool_called=1` 只由 `record_project_events` 产生，`binding_list_tool_called=1` 只由精确 `list_projects` 产生；两个 Stop 结果列不适用时为 `NULL`。未绑定同回合即使列过项目且最终消息缺少固定绑定区块，Stop 也保持静默；最终交付规则由 Skill、SessionStart/UserPromptSubmit 和 MCP instructions 负责。
8. 在同一 cwd 的工作回合中，由当前 Codex 判断是否产生事件：有事件时至多调用一次 `record_project_events`，无事件时调用一次 `acknowledge_no_project_events`；Stop 将绑定自动捕获结果写为 0/1，未绑定或自动捕获关闭时为 `NULL`，始终返回空响应。
9. Codex 需要展示面板时调用 `open_project_panel`，它通过官方 MCP Apps `_meta.ui.resourceUri` 加载 `ui://ambient-project/panel/v1.html`；结果 `_meta["ambient-project/bootstrap"]` 只给组件 `serviceBaseUrl`、临时令牌和 `projectContextId`。模型可见 content 不包含令牌。
   UI 产品边界：组件以内联卡片展示约 3–5 个相关工作项并允许状态变更；底部 CTA 打开 Plane。不得将它扩展为 Ambient Fullscreen 或独立 Web 完整看板，详见 [Inline 项目卡片产品边界](architecture/inline-panel-product-boundary.md)。
10. service worker 每 5 秒原子 claim 一个 pending/retrying/failed 批次，并在 Plane 同步期间用 claim token heartbeat 续租；`POST /api/worker/run` 可手动触发一次，processed 返回本次 claim/尝试的批次数（不代表成功同步数）。该 POST 也需要会话头。
11. Codex App 宿主不支持组件渲染时，才运行独立开发降级：先显式设置 `AMBIENT_SESSION_TOKEN`，再运行 `pnpm dev:service` 和 `pnpm dev:panel`，打开 `http://127.0.0.1:4318` 手工输入 cwd/令牌。Vite proxy 不会注入有效令牌。

## 关键故障路径

- Plane 不可用：`record_project_events` 仍快速返回 `accepted`；批次留在本地 Outbox，服务恢复后重试。
- 批次在 Plane 投射前按 `event_<batchRowId>_<index>` 保存事件检查点；完整事件重试时跳过，只有所有事件完成才标记批次 `synced`。租约过期后可由另一个 worker 接管，旧 claim 不能覆盖新状态。
- heartbeat 无法续租时当前同步明确失败并停止后续事件；手动 retry 不会清除或窃取仍活跃的 claim。
- 同一事件的工作项描述和活动带有稳定来源标记；计划父项和步骤、活动重放先按该标记恢复，避免远端已成功但客户端未收到响应时重复写入。
- Hook 输入坏 JSON 或 SQLite 出错：Hook 返回空/最小 `additionalContext`，不返回 `statusMessage`、`systemMessage`，不阻塞主任务。
- 自动捕获关闭：MCP `record_project_events` 拒绝新批次；Codex 主任务不受影响。
- 无事件确认：MCP `acknowledge_no_project_events` 只写入当前 `project_context_id + session_id + turn_id` 的幂等审查标记，不创建 Plane 项目或 Outbox 批次；后续同回合成功记录事件会清除该标记。
- 用户修改状态：只由 Inline 拖拽或状态菜单触发；失败时回滚并明确提示。自动协调器只追加活动或更新仍由系统拥有的字段。
- 完整编辑、删除、归档和合并不进入 Inline；用户在 Plane 中完成这些操作。自动 MCP 没有这些高风险能力。
- 手动 retry 仅接受 URL 项目上下文所属且尚未 `synced` 的批次。
- 缺少或错误的 `X-Ambient-Session-Token` 统一返回 401，且写请求在 Fastify `onRequest` 鉴权前不会触及存储；401 后 Panel 清除内存会话，不会无限重试。
- 允许的 CORS 来源包括 Codex MCP App 的 `https://web-sandbox.oaiusercontent.com`、Desktop 沙盒的 `codex-sandbox://<mcp-server-subdomain>.web-sandbox.oaiusercontent.com`、MCP App 沙盒的 `null`、`http://127.0.0.1:4318` 和 `http://localhost:4318`；其他 Origin 被拒绝，CORS 不是认证替代，summary 仍必须带 session token。
- 正式插件按宿主选择平台专属 Node 22.22.1 sidecar：macOS arm64、macOS x64、Linux x64、Linux arm64 使用 POSIX `runtime/bin/ambient-node`，Windows x64 使用 `runtime/bin/ambient-node.cmd` 与 `node.exe`。SQLite 使用 `node:sqlite`，不携带 `better-sqlite3.node`；错装包会明确报告 OS/架构不兼容，不回退系统 Node。Panel 的 fetch/CORS、bridge、HTTP、网络和会话错误统一显示通用异常卡片，不向用户透传服务访问诊断或绑定原因。

## 真实会话评估

至少记录 3 个自然工作会话、15 个自然回合，覆盖计划、执行、Bug、决定、进展、显式完成和闲聊。在 `evals/turns.jsonl` 逐回合填写：

- `shouldCapture`、`expectedTypes`
- `actualBatchId`
- `falseRecord`
- 漏记、重复、错误关联或字段覆盖说明

评估脚本不替代人工标注，只计算已标注数据的捕获率、误记录率和重复记录数。MCP App 验收需记录目标 Codex 构建是否能调用 `open_project_panel`、读取 `ui://ambient-project/panel/v1.html` 并把组件私有 `_meta` 传给 UI；公开接口没有永久固定项目侧边栏注册能力，因此宿主未渲染时继续使用 4318 降级页面，不把它作为项目数据链路依赖。
