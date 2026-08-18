# 更新记录

本文件记录 Ambient Project Layer 的重要用户可见变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

[Unreleased]: https://github.com/Bene-2020/plane-codex-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Bene-2020/plane-codex-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/Bene-2020/plane-codex-mcp/releases/tag/v0.1.0
