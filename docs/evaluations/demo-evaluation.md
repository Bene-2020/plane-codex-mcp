# Demo 评估报告

日期：2026-08-10

## 当前可重复结果

- `pnpm test`：5 个测试文件、12 个测试通过。
- `pnpm lint`：通过。
- `pnpm build`：core、storage、plane、MCP、service、Hook adapter、panel 均构建成功。
- Fake Plane 服务测试覆盖：批次入队、异步投射、面板摘要、重复 Bug 合并、Plane 故障留在 Outbox、字段所有权保护、Hook fail-open。
- MCP STDIO 初始化冒烟：返回 `2025-06-18` 协议响应、5 个高层工具能力、固定 `instructions`。

## 指标数据

`evals/turns.jsonl` 是真实会话标注文件，`evals/evaluate.ts` 只对已标注回合计算指标。仓库初始化时没有伪造真实 Codex 会话，因此当前模板输出为：

```json
{
  "turns": 2,
  "captureRate": 0,
  "falseRecordRate": 0,
  "explicitOperationSuccessRate": null,
  "duplicateRecords": 0
}
```

交付 Demo 前仍需在目标 Codex Desktop 中完成至少 3 个真实工作会话、15 个自然回合，并把 `actualBatchId`、显式操作结果和人工 `shouldCapture` 标注回填到 JSONL。该数据不能由固定脚本替代。

## 尚未宣称的外部验收

- 未配置真实 Plane API key，因此没有宣称 Cloud 或自托管 Plane 冒烟通过。
- 未在当前 Codex Desktop 宿主中宣称永久侧边栏或 MCP UI iframe 已渲染。
- 未调用第二个 OpenAI 或 OpenAI-Compatible 语义模型。
