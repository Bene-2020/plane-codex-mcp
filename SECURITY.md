# 安全政策

## 支持范围

安全更新以当前最新 Release 为准。项目仍处于早期版本阶段，旧版本通常不会长期并行维护；遇到安全问题时，请先确认能否在最新版本复现。

## 报告漏洞

请不要通过公开 Issue、Discussion、Pull Request 或日志附件披露未修复的漏洞、Plane API Key、Panel 会话令牌或其他凭据。

优先使用 GitHub 仓库 Security 页面中的 **Report a vulnerability** 私下提交报告。报告中请包含：

- 受影响版本与平台；
- 问题类型和可能影响；
- 最小复现步骤；
- 你已经尝试过的缓解措施；
- 必要的截图或日志，但必须先移除凭据、绝对个人路径和真实项目数据。

如果仓库尚未启用 Private Vulnerability Reporting，请只提交一个不含漏洞细节的公开 Issue，说明“需要私下报告安全问题”，等待维护者提供私密沟通渠道。

## 凭据泄露

如果 Plane API Key 已经出现在提交、Issue、日志、截图或其他公开位置，请立即在 Plane 中撤销并重新生成 Key。仅从 Git 历史中删除文本不足以使已经泄露的 Key 恢复安全。

## 安全边界

Ambient Project Layer 将 Plane API Key 保存在 Codex 用户级配置和 MCP 进程内存中，不应把它写入 SQLite、Panel、Hook 输出、模型上下文或日志。安全报告若发现这一边界被破坏，请按漏洞处理。
