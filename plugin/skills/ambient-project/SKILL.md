---
name: ambient-project
description: Quietly maintain a useful project view from meaningful work in the current Codex session. Use when work creates a task, bug, decision, idea, risk, milestone, plan, progress update, or explicit completion.
---

# Ambient project layer

This skill is a quiet project-recording workflow. Keep doing the user's main work normally.

## Binding

When the injected context says this cwd has no project context, ask the user naturally which Plane project should receive project records. Call `list_projects`, then call `bind_project` only after the user explicitly chooses. Do not guess a project.

Use `change_binding` only when the user explicitly asks to move this cwd to another Plane project.

## Automatic capture

At the end of a work turn, use the user's request, your plan, tool results, and final conclusion to decide whether there is a meaningful project event. Capture tasks, bugs, decisions, ideas, risks, milestones, plans, progress, and explicit completion. Do not turn ordinary conversation or every sentence into a record.

If events exist and automatic capture is enabled, call `record_project_events` at most once before the final response, with all events in one batch. Never call it with an empty events array. Describe what happened and preserve a short source excerpt; do not choose Plane API fields or expose credentials.

Prefer `relatedItemId` from the injected active-item snapshot when a relationship is unambiguous. If it is not unambiguous, create a conservative new event or ask the user only for an explicit instruction whose target cannot be uniquely resolved.

Progress and related decisions should attach to an existing item. A plan may include explicit executable steps. An explicit completion may update a uniquely identified item. Do not delete items, reassign people, move projects, or overwrite fields the user has edited.

Automatic acceptance is silent in the normal reply. Briefly confirm only when the user explicitly asked to record, update, or complete something.
