# Codex Desktop 安装与真人验收

这份步骤用于正式 Codex Desktop 插件。仓库里的 `.env` 和 `PLANE_MODE=fake` 只服务本地开发与隔离 smoke；GUI 启动的 MCP 使用 Codex 用户级配置，不依赖终端启动时的 `export`。正式包当前只支持 macOS arm64，插件内的 Node 22.22.1 sidecar 控制运行时版本；用户不需要安装、切换或重新编译 Node。

## 构建和安装

在仓库根目录执行：

```bash
pnpm install
pnpm build
python3 /Users/<user>/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
node scripts/validate-plugin-runtime.mjs plugin
pnpm smoke:plugin
```

将构建后的 `plugin/` 发布到已配置的本地 marketplace 后安装或更新插件：

```bash
codex plugin add ambient-project-layer@ambient-local
codex mcp get ambient-project
```

安装命令成功只表示插件已启用。随后必须打开 Codex 的 Hook 管理界面，人工复核并信任 `SessionStart`、`UserPromptSubmit`、`PostToolUse`、`Stop` 和 `SessionEnd`，再新建 task。不要把 `enabled` 当成已信任；未信任或被判定为 `modified` 的 Hook 会在进程启动前被宿主拦截。

用户级 MCP 配置必须指向 marketplace 中不带版本号的稳定 runtime 路径，不要指向 `~/.codex/plugins/cache/.../<version>/`。插件升级会替换版本缓存，稳定 marketplace 路径不会失效。

## Codex Desktop 持久配置

插件 `.mcp.json` 中的 `env_vars` 只是宿主环境变量白名单。它不会替 GUI 创建 Plane 配置，所以正式 Desktop 运行必须为该 MCP 写入用户级 `~/.codex/config.toml`。使用 CLI 先创建完整的 stdio 配置；命令中的占位 key 不是真实凭据：

```bash
codex mcp add ambient-project \
  --env "AMBIENT_DB_PATH=$HOME/.codex/plugins/data/ambient-project-layer-ambient-local/ambient.sqlite" \
  --env "PLANE_MODE=sdk" \
  --env "PLANE_BASE_URL=https://api.plane.so" \
  --env "PLANE_WORKSPACE_SLUG=bene2020" \
  --env "PLANE_API_KEY=replace-in-user-config" \
  -- "/ABSOLUTE/MARKETPLACE_ROOT/plugins/ambient-project-layer/runtime/bin/ambient-node" "/ABSOLUTE/MARKETPLACE_ROOT/plugins/ambient-project-layer/runtime/mcp/index.js"
```

在本机用户配置文件中，把 `[mcp_servers.ambient-project.env]` 下的 `PLANE_API_KEY` 占位值替换为真实 key，并将文件权限限制为当前用户可读写。真实 key 只应存在于该用户级配置和 MCP 进程内存；不要把它写进仓库、Panel、SQLite、Hook 输出、MCP 普通 content、模型上下文或日志。不要在该配置中加入 `AMBIENT_SESSION_TOKEN` 或 `AMBIENT_SERVICE_BASE_URL`，这两个值由每个 MCP 进程运行时生成。

Hook 不继承 `[mcp_servers.ambient-project.env]`，而是直接使用 Codex 为插件提供的 `PLUGIN_DATA/ambient.sqlite`。MCP 配置只需把 `AMBIENT_DB_PATH` 指向同一文件；不要把 `PLANE_API_KEY`、session token 或其他秘密加入通用子进程环境。MCP 与 Hook 的实际命令都是插件内 `runtime/bin/ambient-node`，即使 PATH 中没有 node/pnpm/bun 也能启动；wrapper 会在非 macOS arm64 上直接退出并报告兼容性错误。

## 插件升级

首次安装时，先启动一次新 task，让 Hook 创建稳定的 `PLUGIN_DATA/ambient.sqlite`，再把 MCP 的 `AMBIENT_DB_PATH` 配成上面的同一文件并绑定项目。不要把数据库放在版本化的插件 cache 目录中。

每次升级按固定顺序执行：构建和验证；刷新 cachebuster；同步 `plugin/` 到 marketplace；运行 `codex plugin add ambient-project-layer@ambient-local`；确认 MCP 仍使用 marketplace 的稳定 runtime 路径且数据库仍是稳定的插件数据文件；打开 Codex 的 Hook 管理界面复核并信任当前版本的五个 Hook；完全退出并重启 Desktop；最后用新 task 做下述验收。升级不得新建或切换数据库，已有绑定会保留。

Hook 信任按解析后的定义哈希保存。除 `hooks.json` 内容外，版本化缓存路径和最终命令也会参与当前定义；因此即使 Hook 文本看起来没有变化，插件升级后仍可能显示 `modified`。把“重新信任当前版本”视为每次安装或升级的必做步骤，不要只在编辑 `hooks.json` 后执行。

重启后新建 task，验收必须同时满足：Hook 注入 `project_1` 而不是“未绑定”；`get_binding` 返回同一 `project_1`；`open_project_panel` 的真实面板通过 MCP Apps server-tool bridge 加载 summary 并显示项目数据（不是只看工具调用成功）；有事件时调用 `record_project_events` 后 `PostToolUse` 审计的 `record_tool_called=1`，无事件时调用 `acknowledge_no_project_events` 后 Stop 返回空结果且数据库没有新增 Outbox 批次。任一失败都不能判定升级成功。

生产 Desktop 面板不应再依赖 WebView 直接连接动态 `localhost`；若诊断时看到 sidecar 监听但面板失败后没有到该端口的连接，这是宿主本地 HTTP gate 的证据，不是 BFF CORS 响应头缺失。Panel 的 `ambient_project_panel_request` 只对组件可见，MCP 进程负责向同一动态 BFF 带 token 请求；4318 独立页面仍使用浏览器 fetch 作为开发路径。

配置完成后用 `codex mcp get ambient-project` 检查命令、数据库路径和非敏感变量；不要打印或复制 API key。完全退出并重新启动 Codex Desktop，然后新建一个 task。已有 MCP 子进程不会自动读取修改后的配置。

缺少 `PLANE_MODE`、数据库路径或 SDK 凭据时，MCP 会在打开数据库前明确失败；它不会回退到 fake，也不会把 `Demo Project` 伪装成正式项目。

如果 Codex Desktop 宿主环境带有 `https_proxy=http://...`，运行时会把配置中 Plane URL 的 HTTPS host 仅加入当前 MCP 进程的 `no_proxy`。这是针对 Plane SDK Axios 明文代理请求的传输修复，不会把代理配置、凭据或 session token 写入 Panel、SQLite、日志或模型 content；也不会改用 fake。直连 Plane 失败时会保留明确错误。

插件安装/升级检查：`plugin/runtime/runtime.json` 声明 `darwin/arm64` 与 Node 22.22.1；`pnpm validate:plugin` 会拒绝缺少 sidecar、错误版本、原生 `.node` 或宿主 `node` 命令。运行时 wrapper 还会在安装包被放到其他 OS/arch 时直接报错，而不是静默回退到系统 Node。

## Hook 信任排障

如果插件和 MCP 都显示 enabled，但新 task 没有注入项目上下文，先检查 Hook 管理界面，不要先迁移或重建数据库。以下组合通常表示信任尚未完成，而不是 Hook 代码或数据库损坏：

- 五个 Hook 已配置为 enabled，但当前版本显示未信任或 `modified`；
- `get_binding` 能读到项目，而正式插件数据库的 `turn_audits` 没有当前 session；
- 重启 Desktop 后仍没有 `SessionStart` 或 `UserPromptSubmit` 记录。

处理方式是人工信任当前版本的五个 Hook。不要手工复制哈希到 `config.toml`，也不要使用 `--dangerously-bypass-hook-trust` 作为日常安装步骤。重新信任后，当前 task 的下一条用户消息应产生 `UserPromptSubmit` 审计并注入项目上下文；已经错过的 `SessionStart` 不会追补，需要再新建 task 验证。只有信任完成后仍无审计记录，才继续检查 Hook 命令、`PLUGIN_DATA` 和数据库路径。

## 真人只读验收

在新的 Codex task 中，用当前工作目录 `/Users/bene/Agent/see-my-work` 验证：

1. `list_projects` 返回真实 Plane 项目 `see-my-work-codex`，而不是 `Demo Project`。
2. `get_binding` 返回已存在的 `project_1`。没有绑定时先列出项目并请用户选择；不要猜测项目，也不要调用绑定变更工具。
3. `open_project_panel` 的普通模型 content 不包含 session token；token 只在组件可见的结果 metadata 中。
4. Panel 能读取项目摘要，且浏览器端没有 Plane SDK/API key。
5. 在独立 4318 页面输入一个确认未绑定的 cwd 并点击 `Load project`，页面显示 `No project is bound to <cwd>`；在 Codex host 中重新调用 `open_project_panel`，Panel 应直接显示 bootstrap 项目，不要求或读取 cwd。
6. 若 Panel 仍显示 `No project context yet`，记录 Desktop 构建号、工具调用是否渲染资源、`ui/notifications/tool-result` 是否出现以及可见错误文案；不要复制 `_meta`、session token 或 Plane key。

## 非破坏性写入验收

确认上述只读结果后，只提交一条标题带当前日期的测试事件，例如 `Codex Desktop MCP config smoke 2026-08-12`，再手动运行一次 worker。检查该事件在本地批次变为 `synced`，并在 Plane 中出现对应的新测试工作项。不要编辑、删除、归档或移动现有 Plane 工作项；测试工作项保留，便于验收追踪。

如果 `list_projects` 仍返回 `Demo Project`，先停止写入，检查 `codex mcp get ambient-project` 的 `cwd`/runtime 路径和 `AMBIENT_DB_PATH`，完全退出 Codex Desktop 后再重启。不要通过设置 `PLANE_MODE=fake` 来绕过问题。
