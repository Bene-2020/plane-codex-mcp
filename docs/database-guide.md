# 数据库关系与操作指南

本文用于区分仓库开发数据库与 Codex Desktop 已安装插件的运行数据库。除非任务明确要求迁移或修复数据，后续 agent 应先确认目标数据库，再执行任何会打开 `Storage`、绑定项目或写入事件的命令。

## 结论

本项目当前有两份彼此独立的 SQLite 数据库。它们由同一套 `Storage` 代码管理、目标 schema 相同，但各自独立迁移，不是主从、镜像、备份或自动同步关系。

| 角色 | 当前路径 | 谁使用 | 数据性质 |
| --- | --- | --- | --- |
| 仓库开发数据库 | `/Users/bene/Agent/see-my-work/ambient-project-demo.sqlite` | 从仓库启动且没有覆盖 `AMBIENT_DB_PATH` 的 MCP、Service 或开发命令 | 可丢弃的本地开发状态；当前没有项目上下文或 Outbox 数据，只残留旧 Hook 审计 |
| 已安装插件运行数据库 | `/Users/bene/.codex/plugins/data/ambient-project-layer-ambient-local/ambient.sqlite` | Codex Desktop 中安装的 `ambient-project-layer@ambient-local` 的 Hook 与 MCP | 本机插件的持久运行状态；当前真实试用应使用此库 |
| Plane | 远端 Plane 项目 | MCP 内的 Outbox worker 通过 Plane SDK 访问 | 用户可见项目数据的唯一真相源 |

“插件运行数据库”比“正式数据库”更准确。它保存本机插件的项目上下文、可靠同步状态和缓存，并不是 Plane 的替代品，也不代表多用户或服务器生产数据库。

## 路径是怎样决定的

### 仓库开发入口

`packages/storage/src/index.ts` 的 `Storage` 构造函数按以下顺序选库：

1. 使用进程环境变量 `AMBIENT_DB_PATH`；
2. 未设置时使用相对路径 `./ambient-project-demo.sqlite`。

相对路径按进程 `cwd` 解析。从仓库根目录运行开发 Service/MCP 时，它通常就是仓库根目录下的 `ambient-project-demo.sqlite`。`.env.example` 也把 `AMBIENT_DB_PATH` 设置为这个开发文件。

该文件符合仓库的 `*.sqlite` 忽略规则，不会随 Git 或插件包发布。删除后，下一次开发进程启动可以创建空库，但其中已有的开发审计和同步状态会丢失。

### 正式插件 Hook

`apps/hook-adapter/src/index.ts` 的选择顺序不同：

1. 优先读取宿主提供的 `PLUGIN_DATA`，兼容时读取 `CLAUDE_PLUGIN_DATA`；
2. 数据库固定为 `<PLUGIN_DATA>/ambient.sqlite`；
3. 只有宿主没有提供插件数据目录时，才退回 `AMBIENT_DB_PATH`；
4. 两者都没有时明确报错。

因此，Codex Desktop Hook 不应读写仓库数据库。在本机，`PLUGIN_DATA` 实际落到：

```text
/Users/bene/.codex/plugins/data/ambient-project-layer-ambient-local
```

### 正式插件 MCP

插件 `.mcp.json` 只声明允许宿主转发 `AMBIENT_DB_PATH`，不会自行推导 `PLUGIN_DATA`。本机 `~/.codex/config.toml` 当前明确配置：

```text
AMBIENT_DB_PATH=/Users/bene/.codex/plugins/data/ambient-project-layer-ambient-local/ambient.sqlite
```

这项配置必须与 Hook 的 `<PLUGIN_DATA>/ambient.sqlite` 完全相同。否则 Hook 审计/上下文注入与 MCP 的绑定、Outbox、Panel 会分叉到不同数据库，典型表现是 Hook 说“未绑定”，但 `get_binding` 或 Panel 又能找到绑定，或者反过来。

## 数据流和职责

正常链路是：

```text
Codex Hook ─┐
            ├─ 同一插件运行数据库 ── Outbox worker ── Plane
Codex MCP  ─┘        │                                  │
                     └──── 项目上下文、来源引用和缓存 ───┘
```

各表的职责：

- `project_contexts`：规范化工作目录到 Plane 项目的本地关联；`project_<rowid>` 只是该数据库内的 ID。
- `outbox_batches`：按 `project_context_id + session_id + turn_id` 幂等保存等待或已经完成的投射批次。
- `no_project_event_reviews`：记录某工作回合已审查但没有项目事件，不进入 Outbox。
- `source_references`：来源事件与 Plane 工作项/活动的追踪关系及投射状态。

`source_references.event_id` 是当前 SQLite 内部定位键（`event_<batch rowid>_<index>`）；`remote_source_id` 才能写入 Plane，其值由 `project_context_id + session_id + turn_id + event index` 组成。不要把本地自增 rowid 派生的 `event_id` 当成跨数据库幂等键。

### 上线前来源 ID 迁移

旧开发数据使用过 `event_*` 作为 Plane 来源标记。因为尚未上线，不保留这套错误标记或运行时兼容分支；使用一次性脚本把本地来源记录以及 Plane 工作项/评论中的旧标记原地改成新来源 ID：

```bash
# 默认只读检查
PLANE_API_KEY=... pnpm migrate:source-ids -- --db /absolute/path/to/ambient.sqlite

# 停止 Codex Desktop 后执行；备份目标必须不存在
PLANE_API_KEY=... pnpm migrate:source-ids -- \
  --db /absolute/path/to/ambient.sqlite \
  --apply \
  --backup /absolute/path/to/ambient.before-source-id.sqlite
```

脚本不删除 Plane 工作项、评论或 Outbox 内容，只修改来源标记与 `source_references.remote_source_id`。不要在 Codex Desktop 或 sidecar 仍写入数据库时执行；正式库执行前必须先看 dry-run 输出。
- `plane_item_cache`：Panel 和 Hook 使用的 Plane 精简缓存，不是真相源。
- `field_ownership`：记录系统或用户对受管理 Plane 字段的所有权。
- `turn_audits`：Hook 生命周期、工具调用及 Hook 错误审计。
- `schema_migrations`：预留的迁移版本表；当前实际迁移主要由 `CREATE TABLE IF NOT EXISTS` 和 `ensureColumn` 在 `Storage` 打开时执行。

两个数据库中的自增 ID 各自独立，所以不同文件中的 `project_1`、`batch_1` 或 `event_1_0` 没有跨库同一性。不要复制某一行或仅凭同名 ID 合并数据。

## 2026-08-13 只读盘点

仓库开发数据库：

- 完整性检查为 `ok`；
- `project_contexts`、`outbox_batches`、`source_references`、`plane_item_cache`、`field_ownership` 均为 0 行；
- `turn_audits` 为 59 行，时间范围是 2026-08-12 02:42Z 至 05:47Z，表明它曾被旧的 Hook/开发配置写入；
- 尚无 `no_project_event_reviews` 表，说明新增该表后还没有被当前 `Storage` 重新打开并迁移。

已安装插件运行数据库：

- 完整性检查为 `ok`，使用 WAL；
- 有两个项目上下文：仓库根目录是 `project_1`，一个 Codex worktree 是 `project_2`，都指向 `see-my-work-codex`；
- 有 26 个 Outbox 批次，全部为 `synced`；
- 有 44 条来源引用，全部为 `completed`；
- 有 21 条 Plane 缓存、85 条字段所有权和 34 条 Hook 审计；
- 当前没有失败或待同步批次，也没有无事件确认残留。

这些计数是时间点快照，插件继续运行后会变化，不能写成测试断言。

## 后续 agent 的操作规则

1. 先判断任务属于开发验证还是本机插件验收。不要因为当前 `cwd` 在仓库内，就假定应该使用仓库数据库。
2. 开发测试应使用明确的临时 `AMBIENT_DB_PATH`，测试结束后处理临时文件；不要依赖或污染仓库根目录的现有数据库。
3. Codex Desktop 插件验收必须同时确认：Hook 的 `PLUGIN_DATA/ambient.sqlite` 与 MCP 的 `AMBIENT_DB_PATH` 是同一绝对路径。
4. 安装或升级后先在 Codex Hook 管理界面人工信任当前版本的五个 Hook。`enabled` 不等于已信任；版本化缓存路径变化也可能令定义哈希变为 `modified`。
5. 不要把数据库放进版本化目录 `~/.codex/plugins/cache/.../<version>/`。升级会替换该目录；持久数据必须留在 `~/.codex/plugins/data/<plugin-id>/`。
6. 不要把 `PLANE_API_KEY`、Panel session token、完整 transcript、源码或终端输出写入任一数据库。
7. 只读排查不要实例化项目的 `Storage`：构造函数会执行迁移，并可能改变旧库结构。优先使用 `sqlite3` 只读查询或先制作一致性快照。
8. 活跃数据库使用 WAL。复制或备份时不能只复制主 `.sqlite` 文件；应使用 SQLite backup API/命令，或在进程完全停止后同时处理 `-wal` 与 `-shm`。只复制主文件可能漏掉尚未 checkpoint 的最新事务。
9. 不要删除、覆盖、重建或手工合并插件运行数据库。需要迁移时先停止 Codex Desktop/MCP，制作可恢复备份，明确源库和目标库，再实施专门迁移。
10. Plane 是最终真相源，但本地 Outbox、来源引用和字段所有权包含同步语义。不能通过“从 Plane 重新拉取”完整恢复这些本地状态。

## Hook 信任与零审计记录

正式插件数据库中没有当前 session 的 `turn_audits`，不一定表示 Hook 写错库。Codex 会在执行命令前校验 Hook 定义信任；当 Hook 为 enabled 但信任状态是 `modified` 时，适配器进程根本不会启动，因此正式库和开发库都不会出现该 session 的审计记录。

排查顺序应是：先在 Hook 管理界面确认当前版本的五个 Hook 已人工信任，再检查正式库是否出现 `SessionStart` 或 `UserPromptSubmit`，最后才检查 `PLUGIN_DATA` 与 `AMBIENT_DB_PATH` 是否分叉。重新信任后，当前 task 的下一次提示可以产生 `UserPromptSubmit`；已错过的 `SessionStart` 只能通过新建 task 验证。不要手工写入 `trusted_hash`，也不要通过重建 SQLite 解决信任问题。

## 安全排查清单

检查当前 MCP 的非敏感数据库配置时，只读取目标变量，不要输出整个配置文件：

```bash
awk -F= '/^AMBIENT_DB_PATH[[:space:]]*=/{print substr($0,index($0,"=")+1)}' ~/.codex/config.toml
```

定位数据库文件：

```bash
find /Users/bene/Agent/see-my-work /Users/bene/.codex/plugins/data \
  -type f \( -name '*.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' \) -print
```

在数据库不活跃或已经制作一致性快照后，执行最小只读检查：

```bash
sqlite3 -readonly /absolute/path/to/database.sqlite \
  'PRAGMA integrity_check;' \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

不要在诊断输出中打印 `events_json`、`source_excerpt`、完整配置或任何 API key。若修改了 `~/.codex/config.toml`，必须完全退出并重启 Codex Desktop；已有 MCP 子进程不会自动重新读取配置。

## 代码和配置入口

- 数据库默认值与 schema：`packages/storage/src/index.ts`
- SQLite 运行时封装：`packages/storage/src/database.ts`
- Hook 路径优先级：`apps/hook-adapter/src/index.ts`
- MCP 正式入口：`apps/mcp/src/main.ts`、`apps/mcp/src/index.ts`
- 独立开发 Service：`apps/service/src/index.ts`
- 插件环境变量白名单：`plugin/.mcp.json`
- 安装与升级：`docs/codex-desktop-installation.md`
- 数据边界：`README.md` 的“数据边界”章节
