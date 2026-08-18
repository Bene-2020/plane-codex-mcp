# 参与贡献

感谢你考虑改进 Ambient Project Layer。项目优先接受范围明确、可验证且保持实现直接的改动。

## 开始之前

- Bug 和功能建议请先搜索现有 Issue，避免重复讨论。
- 较大的功能或行为变化建议先开 Issue，说明用户问题、预期行为和范围。
- 安全问题不要公开提交，请按 [SECURITY.md](SECURITY.md) 报告。

## 本地环境

需要 Node.js 22、Corepack 和 Git。仓库固定使用 `pnpm@10.34.5`。

```bash
git clone https://github.com/Bene-2020/plane-codex-mcp.git
cd plane-codex-mcp
corepack enable pnpm
pnpm install --frozen-lockfile
cp .env.example .env
```

`.env.example` 默认使用 `PLANE_MODE=fake`。除非正在验证真实 Plane 集成，否则请保留 fake 模式。不要提交 `.env`、API Key、SQLite 数据库或本地日志。

## 开发命令

```bash
pnpm test
pnpm lint
pnpm build
pnpm validate:plugin
pnpm smoke:plugin
```

单独启动开发用 Service 和 Panel：

```bash
# 终端 1
export AMBIENT_SESSION_TOKEN="$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("base64url"))')"
pnpm dev:service

# 终端 2
pnpm dev:panel
```

独立 Panel 默认位于 `http://127.0.0.1:4318`。这只是开发入口；正式产品入口是 Codex 中的 MCP App。

## 实现原则

- 优先解决明确的用户问题，不为假想场景增加复杂抽象或多层兜底。
- 数据只在系统边界校验一次，内部模块保持直接。
- 错误应清楚暴露，不静默吞错或自动切换到 fake 模式。
- 测试用户可观察行为和关键数据流；每个真实故障保留一个最小回归测试即可。
- 数据库主键和事件标识保持可读，不使用加密哈希生成业务 ID。
- Panel 保持轻量：展示相关工作项、修改状态并跳转 Plane，不复制完整项目管理功能。

## 数据库注意事项

开发数据库与已安装插件的运行数据库互相独立。测试必须使用 `:memory:` 或明确的临时 `AMBIENT_DB_PATH`，不要污染仓库中的开发库或用户插件数据。

未经用户明确要求，不要删除、覆盖、重建、迁移或手工合并已有数据库。只读检查也不要实例化可能自动迁移 Schema 的 Storage。

## Pull Request

提交 PR 前请确认：

- 改动只覆盖一个清晰主题；
- 新行为有对应的最小测试或明确的人工验证步骤；
- `pnpm test`、`pnpm lint` 和相关构建命令通过；
- 未提交生成目录、数据库、日志、`.env` 或凭据；
- 用户可见变化已更新 README 或 `CHANGELOG.md`；
- PR 描述说明了问题、解决方式、验证结果和已知限制。

## 发布版本

正式版本通过 [CI and Release](.github/workflows/ci-release.yml) 工作流发布：

1. 在 `release/v<version>` 分支完成版本号、更新日志和文档，推送后等待五个平台的原生构建与 smoke test 全部通过。
2. 合并到 `main` 后再次确认 CI 通过。
3. 创建与 `package.json` 完全一致的标签（例如 `v0.1.1`）并推送。标签不匹配时工作流会直接失败，不会创建 Release。
4. 标签工作流会重新构建并验证 `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64` 和 `win32-x64`，随后创建 GitHub Release、上传五个安装包及 `SHA256SUMS`。
5. 发布后按 README 的安装步骤抽查下载、解压和 Codex 安装流程。

不要手工上传未经对应 Runner 原生验证的安装包，也不要在 CI 通过前推送正式标签。

项目采用 MIT License。提交贡献即表示你有权提交该内容，并同意按仓库许可证分发。
