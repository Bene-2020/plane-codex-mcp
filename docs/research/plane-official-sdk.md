# Plane 官方 SDK 调研：UI 能力与完整公开 API 清单

调研日期：2026-08-10（Asia/Shanghai）

## 结论

**Plane 官方 SDK 不包含 UI、页面、React 组件或可嵌入的 Kanban/Issue 视图。** `makeplane/plane-node-sdk` 是 TypeScript/JavaScript API client：`PlaneClient` 只组装资源对象，资源方法通过 `BaseResource` 发 HTTP 请求。Node 包的发布文件也只有 `dist/**/*` 与 `README.md`，运行时依赖是 `axios`；源码中没有 UI 组件层。官方 Python SDK 同样是同步 HTTP client，底层是 `requests`，数据模型使用 Pydantic，不提供 UI。

因此，若需要面板或表单，应单独实现前端；SDK 可放在服务端/BFF/MCP 工具层。API key 不应交给浏览器端代码。

本文的“公开 API”定义为：

- Node：从 `src/index.ts` 导出，或由 `PlaneClient` / 资源的公开属性可达的资源类；列出资源类中的公开 `async` 方法，以及公开的 `OAuthClient` 和 `Configuration.validate()`。
- Python：从 `PlaneClient` 可达的资源和嵌套资源；列出 `plane/api` 中公开资源方法，以及 `OAuthClient` 的公开方法。
- 不把构造函数、模型/Pydantic DTO、错误类、内部 HTTP 传输方法算作业务资源方法；这些边界在文末单独记录，避免把“内部实现”误报为 SDK 业务能力。

## 官方仓库与版本快照

为避免默认分支继续变化，下面的源码链接固定到本次调研读取的 commit。

| SDK | 包版本 | commit | 官方来源 |
|---|---:|---|---|
| Node | `@makeplane/plane-node-sdk` `0.2.12` | [`8d0c71ce4535178186280049ae17e4589c73bb5d`](https://github.com/makeplane/plane-node-sdk/tree/8d0c71ce4535178186280049ae17e4589c73bb5d) | [README](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/README.md)、[`package.json`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/package.json) |
| Python（交叉核对） | `plane-sdk` `0.2.22` | [`b17befbd6c806418c53183aab1a5377e8b1d4582`](https://github.com/makeplane/plane-python-sdk/tree/b17befbd6c806418c53183aab1a5377e8b1d4582) | [README](https://github.com/makeplane/plane-python-sdk/blob/b17befbd6c806418c53183aab1a5377e8b1d4582/README.md)、[`pyproject.toml`](https://github.com/makeplane/plane-python-sdk/blob/b17befbd6c806418c53183aab1a5377e8b1d4582/pyproject.toml) |

## 为什么确定没有 UI

1. Node README 将项目定义为 “TypeScript/JavaScript SDK for the Plane API”，示例是 `new PlaneClient(...)`、`client.projects.list()` 和 `client.projects.create(...)`；其 Features 也只有类型安全、集中 HTTP、认证和 async/await。[README](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/README.md#L191-L237)
2. `PlaneClient` 的公开成员全部是 `projects`、`workItems`、`cycles` 等 API 资源对象；构造函数只创建 `Configuration` 和这些 resource instances。[`src/client/plane-client.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/client/plane-client.ts#L501-L617)
3. Node 的 `BaseResource` 只封装 `GET/POST/PUT/PATCH/DELETE`、认证 header、URL 拼接和错误处理，且这些 HTTP 方法是 `protected`；没有组件、渲染、路由或 UI runtime。[`src/api/BaseResource.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/BaseResource.ts#L1-L208)
4. Node 包只发布 `dist/**/*` 和 `README.md`，生产依赖只有 `axios`；这与 UI/component package 的发布形态不同。[`package.json`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/package.json#L1-L72)
5. Python README 的架构说明是以 `PlaneClient` 访问 resource classes；Python `BaseResource` 只封装 `requests.Session` 和 HTTP verbs。[Python README](https://github.com/makeplane/plane-python-sdk/blob/b17befbd6c806418c53183aab1a5377e8b1d4582/README.md#L199-L242)、[`plane/api/base_resource.py`](https://github.com/makeplane/plane-python-sdk/blob/b17befbd6c806418c53183aab1a5377e8b1d4582/plane/api/base_resource.py#L1-L105)

## Node SDK：公开入口与资源树

### 包入口

[`src/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/index.ts) 导出：

- 基础入口：`PlaneClient`、`OAuthClient`、`Configuration`、`BaseResource`。
- 直接 API resource exports：`Projects`、`WorkItems`、`WorkItemTypes`、`WorkItemProperties`、`Links`、`Customers`、`Pages`、`Labels`、`States`、`Modules`、`Cycles`、`Users`、`Workspace`、`Estimates`、`Roles`、`Collections`、`Epics`、`Intake`、`Stickies`、`Teamspaces`、`Milestones`、`Initiatives`、`AgentRuns`、`WorkspaceTemplates`、`WorkspaceWorkItemTypes`、`WorkspaceWorkItemProperties`、`WorkspaceProjectLabels`、`WorkspaceProjectStates`、`WorkItemRelationDefinitions`、`Releases`、`Workflows`、`ProjectTemplates`、`WorkLogs`。
- 子资源 alias：`WorkItemRelations`、`WorkItemAttachments`、`WorkItemComments`、`WorkItemActivities`、`WorkItemPropertyOptions`、`WorkItemDependencies`、`WorkItemCustomRelations`、`WorkItemPages`、`CollectionMembersResource`、`CollectionPagesResource`、`WorkItemPropertyValues`、`CustomerProperties`、`CustomerRequests`、`TeamspaceProjects`、`TeamspaceMembers`、`InitiativeLabels`、`InitiativeProjects`、`InitiativeEpics`、`AgentRunActivities`、`WorkspaceWorkItemTemplates`、`WorkspaceProjectTemplates`、`WorkspacePageTemplates`、`WorkspaceWorkItemTypeProperties`、`WorkspaceWorkItemPropertyOptions`、`ReleaseTags`、`ReleaseLabels`、`ReleaseItemLabels`、`ReleaseChangelogResource`、`ReleaseComments`、`ReleaseLinks`、`ReleaseWorkItems`、`WorkflowStates`、`WorkflowTransitions`、`ProjectWorkItemTemplates`、`ProjectPageTemplates`。

`PlaneClient` 实际可达的 32 个顶层资源属性（属性名保持源码原样）是：

`workItems`、`workItemTypes`、`workItemProperties`、`links`、`customers`、`pages`、`projects`、`labels`、`states`、`modules`、`cycles`、`users`、`workspace`、`estimates`、`roles`、`collections`、`epics`、`intake`、`stickies`、`teamspaces`、`milestones`、`initiatives`、`agentRuns`、`workspaceTemplates`、`workspaceWorkItemTypes`、`workspaceWorkItemProperties`、`workspaceProjectLabels`、`workspaceProjectStates`、`workItemRelationDefinitions`、`releases`、`workflows`、`projectTemplates`。[`src/client/plane-client.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/client/plane-client.ts#L501-L617)

资源树中的嵌套属性：

- `client.workItems`: `links`、`relations`、`attachments`、`comments`、`activities`、`workLogs`、`dependencies`、`customRelations`、`pages`。[`src/api/WorkItems/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/index.ts#L39-L73)
- `client.collections`: `members`、`pages`。[`src/api/Collections/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Collections/index.ts#L1-L23)
- `client.customers`: `properties`、`requests`。[`src/api/Customers/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Customers/index.ts#L1-L30)
- `client.teamspaces`: `projects`、`members`。[`src/api/Teamspaces/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Teamspaces/index.ts#L1-L23)
- `client.initiatives`: `labels`、`projects`、`epics`。[`src/api/Initiatives/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Initiatives/index.ts#L1-L25)
- `client.agentRuns`: `activities`。[`src/api/AgentRuns/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/AgentRuns/index.ts#L1-L22)
- `client.workspaceTemplates`: `workItems`、`projects`、`pages`；`client.projectTemplates`: `workItems`、`pages`。[`WorkspaceTemplates/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceTemplates/index.ts)、[`ProjectTemplates/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/ProjectTemplates/index.ts)
- `client.workspaceWorkItemTypes`: `properties`；`client.workspaceWorkItemProperties`: `options`。[`WorkspaceWorkItemTypes/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceWorkItemTypes/index.ts)、[`WorkspaceWorkItemProperties/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceWorkItemProperties/index.ts)
- `client.releases`: `tags`、`labels`、`itemLabels`、`changelog`、`comments`、`links`、`workItems`；`client.workflows`: `states`、`transitions`。[`Releases/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/index.ts)、[`Workflows/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Workflows/index.ts)

### Node 顶层 API resource 方法

以下方法名按源码原样列出；`del`、`unArchive` 等看似不统一的拼写也是当前公开方法名。

| resource / client path | 所有公开方法 | 对应官方源码 |
|---|---|---|
| `projects` | `create`, `retrieve`, `update`, `delete`, `list`, `listLite`, `getMembers`, `getMembersLite`, `getTotalWorkLogs`, `retrieveFeatures`, `updateFeatures`, `archive`, `unArchive` | [`src/api/Projects.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Projects.ts) |
| `workItems` | `create`, `retrieve`, `update`, `delete`, `list`, `listWorkspace`, `countWorkspace`, `listArchived`, `archive`, `unarchive`, `retrieveByIdentifier`, `search`, `advancedSearch` | [`src/api/WorkItems/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/index.ts) |
| `workItemTypes` | `create`, `retrieve`, `update`, `delete`, `list`, `importToProject` | [`src/api/WorkItemTypes.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItemTypes.ts) |
| `workItemProperties` | `create`, `retrieve`, `update`, `delete`, `list`, `listProject`, `createProject`, `retrieveProject`, `updateProject`, `deleteProject`, `attachToType`, `detachFromType` | [`src/api/WorkItemProperties/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItemProperties/index.ts) |
| `links` | `create`, `retrieve`, `update`, `delete`, `list` | [`src/api/Links.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Links.ts) |
| `customers` | `create`, `retrieve`, `update`, `delete`, `deleteByExternalId`, `list`, `listCustomerIssues`, `linkIssuesToCustomer`, `unlinkIssueFromCustomer` | [`src/api/Customers/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Customers/index.ts) |
| `pages` | `createWorkspacePage`, `getWorkspacePage`, `listWorkspacePages`, `createProjectPage`, `getProjectPage`, `listProjectPages`, `retrieveWorkspacePage`, `retrieveProjectPage` | [`src/api/Pages.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Pages.ts) |
| `labels` | `create`, `retrieve`, `update`, `delete`, `list` | [`src/api/Labels.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Labels.ts) |
| `states` | `create`, `retrieve`, `update`, `delete`, `list` | [`src/api/States.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/States.ts) |
| `modules` | `create`, `retrieve`, `update`, `delete`, `list`, `listLite`, `listWorkItemsInModule`, `addWorkItemsToModule`, `removeWorkItemFromModule`, `listArchivedModules`, `archiveModule`, `unArchiveModule` | [`src/api/Modules.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Modules.ts) |
| `cycles` | `create`, `retrieve`, `update`, `delete`, `list`, `listLite`, `listArchived`, `unArchive`, `archive`, `listWorkItemsInCycle`, `addWorkItemsToCycle`, `removeWorkItemFromCycle`, `transferWorkItemsToAnotherCycle` | [`src/api/Cycles.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Cycles.ts) |
| `users` | `me`, `uploadAsset` | [`src/api/Users.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Users.ts) |
| `workspace` | `getMembers`, `getMembersLite`, `getProjectRoleDistribution`, `retrieveFeatures`, `updateFeatures` | [`src/api/Workspace.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Workspace.ts) |
| `estimates` | `create`, `retrieve`, `update`, `delete`, `linkToProject`, `listPoints`, `createPoints`, `updatePoint`, `deletePoint` | [`src/api/Estimates.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Estimates.ts) |
| `roles` | `list`, `retrieve` | [`src/api/Roles.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Roles.ts) |
| `collections` | `list`, `create`, `retrieve`, `update`, `delete` | [`src/api/Collections/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Collections/index.ts) |
| `epics` | `create`, `retrieve`, `update`, `delete`, `list`, `listIssues`, `addIssues` | [`src/api/Epics.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Epics.ts) |
| `intake` | `retrieve`, `list`, `create`, `update`, `updateStatus`, `delete` | [`src/api/Intake.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Intake.ts) |
| `stickies` | `create`, `retrieve`, `update`, `delete`, `list` | [`src/api/Stickies.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Stickies.ts) |
| `teamspaces` | `create`, `retrieve`, `update`, `delete`, `list` | [`src/api/Teamspaces/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Teamspaces/index.ts) |
| `milestones` | `create`, `retrieve`, `update`, `delete`, `list`, `addWorkItems`, `removeWorkItems`, `listWorkItems` | [`src/api/Milestones.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Milestones.ts) |
| `initiatives` | `create`, `retrieve`, `update`, `delete`, `list` | [`src/api/Initiatives/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Initiatives/index.ts) |
| `agentRuns` | `create`, `retrieve` | [`src/api/AgentRuns/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/AgentRuns/index.ts) |
| `workspaceWorkItemTypes` | `list`, `create`, `retrieve`, `update`, `delete` | [`src/api/WorkspaceWorkItemTypes/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceWorkItemTypes/index.ts) |
| `workspaceWorkItemProperties` | `list`, `create`, `retrieve`, `update`, `del` | [`src/api/WorkspaceWorkItemProperties/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceWorkItemProperties/index.ts) |
| `workspaceProjectLabels` | `list`, `create`, `update`, `del` | [`src/api/WorkspaceProjectLabels.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceProjectLabels.ts) |
| `workspaceProjectStates` | `list`, `create`, `update`, `del` | [`src/api/WorkspaceProjectStates.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceProjectStates.ts) |
| `workItemRelationDefinitions` | `list`, `create`, `update`, `del` | [`src/api/WorkItemRelationDefinitions.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItemRelationDefinitions.ts) |
| `releases` | `list`, `retrieve`, `create`, `update`, `delete` | [`src/api/Releases/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/index.ts) |
| `workflows` | `list`, `create`, `update` | [`src/api/Workflows/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Workflows/index.ts) |

### Node 嵌套 resource 方法

| resource / client path | 所有公开方法 | 对应官方源码 |
|---|---|---|
| `workItems.links` | `create`, `retrieve`, `update`, `delete`, `list` | [`src/api/Links.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Links.ts) |
| `workItems.relations` | `create`, `delete`, `list` | [`src/api/WorkItems/Relations.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/Relations.ts) |
| `workItems.attachments` | `retrieve`, `list`, `create`, `update`, `delete` | [`src/api/WorkItems/Attachments.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/Attachments.ts) |
| `workItems.comments` | `retrieve`, `list`, `create`, `update`, `delete` | [`src/api/WorkItems/Comments.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/Comments.ts) |
| `workItems.activities` | `list`, `retrieve` | [`src/api/WorkItems/Activities.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/Activities.ts) |
| `workItems.workLogs` | `list`, `create`, `update`, `delete` | [`src/api/WorkItems/WorkLogs.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/WorkLogs.ts) |
| `workItems.dependencies` | `list`, `create`, `remove` | [`src/api/WorkItems/Dependencies.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/Dependencies.ts) |
| `workItems.customRelations` | `list`, `create`, `remove` | [`src/api/WorkItems/CustomRelations.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/CustomRelations.ts) |
| `workItems.pages` | `list`, `retrieve`, `create`, `delete` | [`src/api/WorkItems/Pages.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItems/Pages.ts) |
| `workItemProperties.options` | `retrieve`, `list`, `create`, `update`, `delete` | [`src/api/WorkItemProperties/Options.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItemProperties/Options.ts) |
| `workItemProperties.values` | `retrieve`, `list`, `create`, `update`, `delete` | [`src/api/WorkItemProperties/Values.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkItemProperties/Values.ts) |
| `customers.properties` | `listPropertyDefinitions`, `createPropertyDefinition`, `retrievePropertyDefinition`, `updatePropertyDefinition`, `deletePropertyDefinition`, `listValues`, `createValues`, `retrieveValue`, `updateValue` | [`src/api/Customers/Properties.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Customers/Properties.ts) |
| `customers.requests` | `list`, `create`, `retrieve`, `update`, `delete` | [`src/api/Customers/Requests.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Customers/Requests.ts) |
| `collections.members` | `list`, `add`, `update`, `remove` | [`src/api/Collections/Members.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Collections/Members.ts) |
| `collections.pages` | `list`, `add`, `search`, `update`, `remove` | [`src/api/Collections/Pages.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Collections/Pages.ts) |
| `teamspaces.projects` | `list`, `add`, `remove` | [`src/api/Teamspaces/Projects.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Teamspaces/Projects.ts) |
| `teamspaces.members` | `list`, `add`, `remove` | [`src/api/Teamspaces/Members.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Teamspaces/Members.ts) |
| `initiatives.labels` | `create`, `retrieve`, `update`, `delete`, `list`, `addLabels`, `removeLabels`, `listLabels` | [`src/api/Initiatives/Labels.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Initiatives/Labels.ts) |
| `initiatives.projects` | `list`, `add`, `remove` | [`src/api/Initiatives/Projects.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Initiatives/Projects.ts) |
| `initiatives.epics` | `list`, `add`, `remove` | [`src/api/Initiatives/Epics.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Initiatives/Epics.ts) |
| `agentRuns.activities` | `list`, `retrieve`, `create` | [`src/api/AgentRuns/Activities.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/AgentRuns/Activities.ts) |
| `workspaceTemplates.workItems` | `list`, `create`, `update`, `del` | [`src/api/WorkspaceTemplates/WorkItems.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceTemplates/WorkItems.ts) |
| `workspaceTemplates.projects` | `list`, `create`, `update`, `del` | [`src/api/WorkspaceTemplates/Projects.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceTemplates/Projects.ts) |
| `workspaceTemplates.pages` | `list`, `create`, `update`, `del` | [`src/api/WorkspaceTemplates/Pages.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceTemplates/Pages.ts) |
| `projectTemplates.workItems` | `list`, `create`, `update`, `del` | [`src/api/ProjectTemplates/WorkItems.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/ProjectTemplates/WorkItems.ts) |
| `projectTemplates.pages` | `list`, `create`, `update`, `del` | [`src/api/ProjectTemplates/Pages.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/ProjectTemplates/Pages.ts) |
| `workspaceWorkItemTypes.properties` | `list`, `create`, `del` | [`src/api/WorkspaceWorkItemTypes/Properties.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceWorkItemTypes/Properties.ts) |
| `workspaceWorkItemProperties.options` | `list`, `create`, `retrieve`, `update`, `delete` | [`src/api/WorkspaceWorkItemProperties/Options.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/WorkspaceWorkItemProperties/Options.ts) |
| `releases.tags` | `list`, `create`, `retrieve`, `update`, `delete` | [`src/api/Releases/Tags.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/Tags.ts) |
| `releases.labels` | `list`, `create`, `retrieve`, `update`, `delete` | [`src/api/Releases/Labels.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/Labels.ts) |
| `releases.itemLabels` | `list`, `create`, `delete`, `del` | [`src/api/Releases/ItemLabels.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/ItemLabels.ts) |
| `releases.changelog` | `retrieve`, `update` | [`src/api/Releases/Changelog.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/Changelog.ts) |
| `releases.comments` | `list`, `retrieve`, `create`, `update`, `delete` | [`src/api/Releases/Comments.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/Comments.ts) |
| `releases.links` | `list`, `retrieve`, `create`, `update`, `delete` | [`src/api/Releases/Links.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/Links.ts) |
| `releases.workItems` | `list`, `create`, `delete` | [`src/api/Releases/WorkItems.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Releases/WorkItems.ts) |
| `workflows.states` | `attach`, `detach` | [`src/api/Workflows/States.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Workflows/States.ts) |
| `workflows.transitions` | `list`, `create`, `update`, `del` | [`src/api/Workflows/Transitions.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/api/Workflows/Transitions.ts) |

### Node OAuth 与配置方法

| class | 所有公开方法 | 对应官方源码 |
|---|---|---|
| `OAuthClient` | `getAuthorizationUrl`, `exchangeCodeForToken`, `getRefreshToken`, `getBotToken`, `getAppInstallations` | [`src/client/oauth-client.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/client/oauth-client.ts) |
| `Configuration` | `validate` | [`src/Configuration.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/Configuration.ts) |
| `PlaneClient` | 无业务方法；构造时初始化 `Configuration` 与上述资源属性 | [`src/client/plane-client.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/client/plane-client.ts) |

### Node README 与源码的差异

Node README 的 API Resources 还列有 `Features`。但当前 `src/index.ts` 没有 `Features` export，`PlaneClient` 也没有 `features` 属性；功能实际拆在 `workspace.retrieveFeatures/updateFeatures` 和 `projects.retrieveFeatures/updateFeatures`。所以本清单没有把 `Features` 当成一个可实例化 resource。[README](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/README.md#L238-L271)、[`src/index.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/index.ts#L1-L120)、[`src/client/plane-client.ts`](https://github.com/makeplane/plane-node-sdk/blob/8d0c71ce4535178186280049ae17e4589c73bb5d/src/client/plane-client.ts#L501-L617)
