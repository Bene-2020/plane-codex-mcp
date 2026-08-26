# 更新记录

本文件记录 Ambient Project Layer 的重要用户可见变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.4] - 2026-08-26

### Added

- 增加 `PLANE_TYPE_MODE=default|custom`：默认 Free 模式绕过付费 Work Item Types 目录，使用 Plane 默认类型并将分类写入 `[Bug]-` 等标题前缀；Pro / Business 用户可显式启用自定义类型。
- 后台同步 Worker 通过 SQLite 共享队列逐个接管历史 failed：Plane 请求默认间隔 2 秒、自动恢复批次间隔至少 10 秒；429 会按 `Retry-After` / `X-RateLimit-Reset` 全局暂停，且限流等待不消耗业务重试次数。

### Fixed

- 项目刷新与计数不再依赖 Work Item Types 目录，避免 Plane Free 返回 HTTP 402 后项目计数不可用。
- 自动恢复 Worker 未到调度时间时只读检查，不再因单进程或多进程重复轮询持续预订未来槽位，并会在出现可恢复批次时自愈旧版本遗留的异常远期槽位；取得执行权与激活单个失败批次在同一 SQLite 事务内完成。

## [0.1.3] - 2026-08-24

### Fixed

- 将失败批次从自动领取队列移出，避免永久失败的 Plane 引用阻塞后续事件。
- 为临时网络错误增加错误分类、指数退避、随机抖动和最大尝试次数，并保留完整投影与状态迁移审计。
- 增加正式 Retry、Correct 和 Dead-letter 管理路径，并为旧 SQLite 数据提供幂等迁移快照。

## [0.1.2] - 2026-08-20

### Changed

- 保留 SessionStart 的完整项目快照，同时将日常 UserPromptSubmit 缩减为轻量的项目、会话和回合标识及单次记录提醒。
- 仅在当前会话的活动工作项发生新增、更新或移除时注入有上限的增量变化，减少重复上下文消耗。

### Fixed

- 在 compact 后只从最近一次 UserPromptSubmit 审计恢复根回合标识，避免 PostToolUse、Stop 或子代理回合覆盖记录归属。
- 忽略仅有更新时间变化的活动工作项快照，并在 SessionEnd 清理会话快照。

## [0.1.1] - 2026-08-18

### Fixed

- 修复 Plane 项目、状态、工作项和活动读取的分页边界，并补充真实 SDK 链路回归覆盖。
- 规范化工作项引用并拒绝未解析的关联，避免完成事件静默落错目标。
- 修正项目绑定 onboarding 的拒绝与延后语义，以及使用界面编号时的状态同步。
- 将 Plane SDK 的 axios 依赖定向锁定到 1.18.0，降低公开版本的安全告警风险。

## [0.1.0] - 2026-08-17

### Added

- 为首次公开发布补充中英文 README、安装说明、安全政策、贡献指南和 Issue 模板。
- 增加产品 Panel 演示和五平台 Release 安装说明。
- 从 Codex 工作回合捕获任务、Bug、决定、想法、风险、里程碑、计划、进展和完成事件。
- 使用本地 SQLite Outbox 可靠接收事件并异步同步到 Plane。
- 支持项目目录与 Plane 项目的显式绑定、切换、暂缓和长期拒绝偏好。
- 提供 Codex Inline Panel，展示相关工作项、项目状态计数和同步健康状态。
- 支持通过拖拽或状态菜单更新 Backlog、Todo、In Progress 和 Done。
- 为 macOS arm64、macOS x64、Linux x64、Linux arm64 和 Windows x64 提供自带 Node.js 22.22.1 的平台专属插件包。
- 提供五种 Codex Hook 的会话上下文注入与最小审计。
- 隔离 Plane API Key、Panel 临时会话令牌和本地项目数据。

[Unreleased]: https://github.com/Bene-2020/plane-codex-mcp/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/Bene-2020/plane-codex-mcp/releases/tag/v0.1.4
[0.1.3]: https://github.com/Bene-2020/plane-codex-mcp/releases/tag/v0.1.3
[0.1.2]: https://github.com/Bene-2020/plane-codex-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/Bene-2020/plane-codex-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/Bene-2020/plane-codex-mcp/releases/tag/v0.1.0
