# Demo 操作与验收记录

## 本地闭环

1. `pnpm install && pnpm build`。
2. 用默认 `PLANE_MODE=fake` 启动 service 和 panel。
3. 通过 MCP `list_projects` 查看 `Demo Project`，用户明确选择后调用 `bind_project`。
4. 在同一 cwd 的工作回合中，由当前 Codex 判断是否产生事件并至多调用一次 `record_project_events`。
5. service worker 每 5 秒取出 pending/retrying/failed 批次；`POST /api/worker/run` 可手动触发一次。
6. 打开 `http://127.0.0.1:4318` 查看记录、来源、同步失败和字段编辑。

## 关键故障路径

- Plane 不可用：`record_project_events` 仍快速返回 `accepted`；批次留在本地 Outbox，服务恢复后重试。
- Hook 输入坏 JSON 或 SQLite 出错：Hook 返回空/最小 `additionalContext`，不返回 `statusMessage`、`systemMessage`，不阻塞主任务。
- 自动捕获关闭：MCP `record_project_events` 拒绝新批次；Codex 主任务不受影响。
- 用户修改字段：面板编辑将字段标记为 `user`；自动协调器只追加活动或更新仍由系统拥有的字段。
- 面板删除/归档/合并：仅用户主动点击可触发，服务端限制自动生成项；自动 MCP 没有这些高风险能力。

## 真实会话评估

至少记录 3 个自然工作会话、15 个自然回合，覆盖计划、执行、Bug、决定、进展、显式完成和闲聊。在 `evals/turns.jsonl` 逐回合填写：

- `shouldCapture`、`expectedTypes`
- `actualBatchId`
- `falseRecord`
- 漏记、重复、错误关联或字段覆盖说明

评估脚本不替代人工标注，只计算已标注数据的捕获率、误记录率和重复记录数。MCP UI host experiment 只需记录目标 Codex 构建是否能读取 `ui://ambient-project/summary/v1.html`；不把该实验作为本地伴随面板的依赖。
