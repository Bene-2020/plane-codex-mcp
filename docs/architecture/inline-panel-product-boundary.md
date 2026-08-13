# Inline 项目卡片产品边界

## 状态

当前有效决策，2026-08-13 确认；最终 UI 同日确认。本文是 Ambient 项目 UI 范围的权威说明；后续实现、评审和验收若与旧计划、旧面板行为或早期 Superdesign 分支冲突，以本文和下述最终稿为准。

本决策取代“由 Ambient MCP App 提供 Fullscreen 完整看板”的方案。Plane 继续承担完整项目管理，Ambient 不实现第二套完整看板或独立 Web 管理端。

## 一句话边界

Ambient MCP App 是对话内的轻量项目卡片：展示少量相关工作项并允许直接修改状态；任何完整浏览和管理都通过 **“在 Plane 中打开 ↗”** 进入 Plane。

## 最终 UI 基线

最终确认的正常态 Superdesign 稿件为 **Ambient Project Inline A 版**：

- Draft ID：`2f45e055-ac0d-4035-b761-ce539f0229de`
- [可交互 Prototype](https://p.superdesign.dev/draft/2f45e055-ac0d-4035-b761-ce539f0229de)
- [Superdesign 项目画布](https://superdesign.dev/teams/2f961313-72e8-45b3-b595-2a458f4b8e6f/projects/ccd6d904-eb50-46ed-9365-2006254639bf)

该稿是实现与视觉验收的最终基线，不再采用早期探索分支、临时状态轨道或左对齐的小型“全部”按钮。Superdesign 预览只用于设计与交互说明，不是运行时依赖，也不应直接替代项目中的 React 实现。

最终筛选区比例：

- “全部 + 总数”独占一整行，宽度与下方四状态轨道的整体宽度完全一致。
- “全部”按钮高度为 `32px`，文字与数量水平、垂直居中并保持紧凑间距。
- “全部”与四状态轨道之间保持约 `8px` 垂直间距。
- `Backlog`、`Todo`、`In Progress`、`Done` 四个状态等分一行，各自保留名称与计数两层信息。
- 选中的“全部”或状态使用 Plane accent 边框与浅色背景；未选中项使用统一 surface、border 和圆角。

### Loading 状态基线

Loading 状态采用用户确认的 **Plane 风格 5 条同构骨架**：

- Draft ID：`bcc6772c-84fb-4894-92c9-f15279fac4e1`
- [Loading Prototype](https://p.superdesign.dev/draft/bcc6772c-84fb-4894-92c9-f15279fac4e1)

Loading 不是独立状态页，而是最终 Inline card 的临时骨架状态：

- 保持与正常态一致的 `100%` 响应式宽度、`720px` 最大宽度、外框、圆角、边框、内边距和内容顺序。
- 按正常态结构预留项目头、全宽 `32px`“全部”控件、四状态轨道、列表摘要、5 张约 `68px` 高的工作项卡片和底部 CTA 区域，避免加载完成时发生明显布局跳动。
- 项目名称、同步状态、项目总数、四状态计数和工作项内容未知时只显示低对比骨架，不显示推测值、缓存子集或虚假数字。
- 列表摘要可以显示“正在读取相关工作项”；底部只显示不可交互的按钮骨架，在 Plane 项目 URL 尚未加载前不渲染可点击 CTA。
- 不再使用居中的大号 `Loading project panel…` 提示卡、`AMBIENT PROJECT LAYER` eyebrow 或大段说明文字。
- 骨架动画使用约 `1.2–1.6s` 的低对比 shimmer/pulse；命中 `prefers-reduced-motion` 时停用动画并保留静态骨架。
- Loading 状态不提供操作、不产生内部滚动，也不改变 Inline card 的产品边界。

## Inline card 必须承担

- 展示当前 Plane 项目名称和同步健康状态。
- 展示约 3–5 个与当前工作最相关的工作项，而不是完整项目列表。
- 使用 Plane 的语义层级和 Kanban 卡片语言呈现标识、标题和状态。
- 在四状态上方提供“全部”查看选项；点击“全部”展示所有相关卡片，点击某个状态只展示该状态卡片。
- 四状态轨道与工作项列表之间显示低层级摘要行：全部筛选为“相关工作项 / 显示 N / 项目共 T”，状态筛选为“{状态} 相关工作项 / 显示 N / 该状态共 T”。`N` 是当前实际渲染的相关项数且最多为 5；`T` 来自 Plane 项目全部非归档且映射到四个标准状态的工作项，不能由截断后的相关项数组计算。四状态计数之和必须等于项目总数；权威刷新失败时明确显示计数暂不可用，不用缓存子集伪装总数。
- 支持把可见工作项拖到 `Captured`、`Planned`、`In progress` 或 `Done`。
- 为鼠标拖拽提供点击状态菜单，为键盘和窄屏提供等价操作。
- 状态变更在本地先反馈 `保存中`；成功显示 `已同步`，失败回到原状态并显示明确错误。
- 底部保留一个主要 CTA：**“在 Plane 中打开 ↗”**。当前 Plane Cloud 目标由已绑定的 `workspaceSlug` 和 `planeProjectId` 拼为 `https://app.plane.so/{workspaceSlug}/projects/{planeProjectId}/issues`；`planeBaseUrl` 是 API 基址，不能直接作为 Web 页面地址。

## Inline card 不承担

- 不提供 Ambient Fullscreen 完整看板。
- 不提供独立 localhost/Web 完整管理页面；`4318` 仅是开发和宿主降级入口。
- 不展示完整工作项集合、完整 Done 历史或需要内部滚动的多列 Kanban。
- 不提供高级/自定义筛选器、分析、工作项创建、批量操作或多视图导航；仅保留内置的“全部 + 四状态”查看切换。
- 不在 Inline 中编辑标题、描述、种类、截止日期、来源历史或负责人。
- 不在 Inline 中提供合并、归档或删除。
- 不复制 Plane 已经提供的项目管理功能。

## 响应式与拖拽规则

Plane 的桌面 Kanban 列宽和横向滚动不适合对话卡片，因此 Inline 不缩放复刻完整四列看板。

- 宽屏：顶部常驻 `Backlog`、`Todo`、`In Progress`、`Done` 四状态概览/落点轨道，下方保持紧凑工作项列表；不展开为四列 Kanban。
- 窄屏：保持纵向列表，四状态轨道折为 2×2；状态 Chip/菜单提供等价操作，不引入内部横向滚动。
- 状态轨道固定在列表区域、始终可见，不放进被拖动的卡片内部；每个状态显示当前计数。
- 四个状态同时是可点击的列表筛选器和拖拽落点；“全部”只负责切换查看范围，不接收拖拽。
- 拖动卡片降低透明度；有效目标使用 accent 边框或 2px 落点指示。
- 放下后立即把项目级计数按源状态减一、目标状态加一，项目总数保持不变，再显示保存中/已同步反馈；失败则整体回滚。
- 当前查看“全部”时，移动后的卡片继续显示；当前查看单一状态时，移出该状态的卡片在本地更新后从列表消失。
- 卡片本身不是 CTA；拖拽和状态菜单属于直接编辑。

## Plane 设计语言来源

实现应参考 Plane 官方开源仓库中的真实设计系统和 Kanban 源码，而不是只凭截图取色：

- [语义颜色、字体、字号和阴影 Token](https://github.com/makeplane/plane/blob/preview/packages/tailwind-config/variables.css)
- [Kanban 布局](https://github.com/makeplane/plane/blob/preview/apps/web/core/components/base-layouts/kanban/layout.tsx)
- [Kanban 分组列](https://github.com/makeplane/plane/blob/preview/apps/web/core/components/base-layouts/kanban/group.tsx)
- [Work item 卡片与拖拽反馈](https://github.com/makeplane/plane/blob/preview/apps/web/core/components/issues/issue-layouts/kanban/block.tsx)
- [拖拽落点指示器](https://github.com/makeplane/plane/blob/preview/packages/ui/src/drop-indicator.tsx)

本项目的设计摘要保存在 [`.superdesign/design-system.md`](../../.superdesign/design-system.md)。Plane 源码采用 AGPL-3.0；实现可以参考交互和语义体系，若直接复制源码必须遵守许可证。

## 当前代码与目标状态

`apps/panel/src/main.tsx` 当前仍是桌面三栏面板，包含筛选、完整详情编辑、合并、归档和删除；`apps/panel/src/styles.css` 还强制 `min-width: 1040px`。这是本决策之前的遗留实现，不是继续扩展的产品方向。

接手者改造面板时应：

1. 保留现有 MCP App bootstrap、server-tool bridge、会话鉴权和 Plane URL 数据链路。
2. 将主界面收敛为本文定义的 Inline card。
3. 为状态拖拽补充最小的服务端状态更新路径和用户可观察测试。
4. 将主要 CTA 连接到 Plane 项目页面，不请求 MCP App Fullscreen。
5. 保留 `4318` 作为同一 Inline UI 的开发/降级入口，不把它扩展成独立产品。
6. 不为旧三栏页面增加新功能；删除旧能力前先调整对应测试和验收文档。

## 验收标准

- Inline 宿主中不需要内部滚动即可看到项目头、3–5 个工作项和 Plane CTA。
- 首次加载时显示与正常态同构的 5 条骨架，不显示伪造项目数据或可交互 CTA；切换到正常态时没有明显宽度或结构跳动。
- 实现的筛选区尺寸、对齐和层级与最终 Superdesign 稿一致，尤其是全宽 `32px` 的“全部”按钮和下方四状态等分轨道。
- 鼠标、点击和键盘均可完成状态变更。
- “全部”和四状态点击后展示正确的工作项集合，状态计数不受当前筛选影响。
- 成功、失败和回滚均有直接可见反馈。
- CTA 打开正确的 Plane 项目/Work items 页面，而不是 Ambient Fullscreen 或 localhost 管理页。
- Panel 前端仍不持有 Plane API Key，所有写入继续通过现有 MCP/Service 边界执行。
