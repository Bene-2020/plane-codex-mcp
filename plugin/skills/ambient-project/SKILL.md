---
name: ambient-project
description: Quietly maintain a useful project view from meaningful work in the current Codex session. Use when work creates a task, bug, decision, idea, risk, milestone, plan, progress update, or explicit completion.
---

# Ambient project layer

This skill is a quiet project-recording workflow. Keep doing the user's main work normally.

## Binding

When the injected context says this cwd has no project context, follow its onboarding phase and the visible conversation. On the first user prompt of a new session, the first user-visible reply must inspect the current user message: an explicit long-term do-not-bind/do-not-ask-again instruction calls `decline_project_binding` without listing; an ambiguous later/skip/continue is a current-session deferral without a preference or repeated question; an explicit restore/bind request calls `restore_project_binding` if needed and then lists; otherwise call `list_projects`, show the real returned Plane projects, and ask the user to choose one. On later prompts, a lifecycle hint that a UserPromptSubmit already occurred is not proof that the question was actually asked: if the visible conversation has no onboarding question, list and ask now; if it was asked and the user only deferred, skipped, ignored it, or continued another task, do not repeat in this session. Do not guess from a Codex Project name, directory name, Git remote, or conversation. Call `bind_project` only after the user explicitly chooses a returned project.

After calling `list_projects`, its tool output, commentary, and thought are not user delivery. Before the final reply, put the real returned projects into the final `last_assistant_message` under this fixed block, while continuing the user's main task normally:

```text
### 项目绑定（待确认）
- <真实返回的 Plane 项目>
请选择一个项目，或回复‘稍后再说’。
```

Use at least one Markdown project list item and do not guess projects or replace the real returned list with a reference to tool output.

If the user says to decide later, skip it, or continues with another task, treat that as a deferral for the current session only. Do not write a preference and do not ask again in that session; the next new session may ask once again. If the user explicitly says not to bind this directory or not to ask again in the future, call `decline_project_binding` for the injected current cwd. This stores only a stable workspace identity and a declined status, never the user's wording. A permanently declined unbound cwd must remain quiet in later sessions; if the user explicitly asks to resume binding, call `restore_project_binding` if needed, then `list_projects`, and call `bind_project` only after an explicit choice. A successful `bind_project` clears or writes a readable exact `restored` override for the effective refusal identity. For non-Git paths, a declined root is inherited by descendants through the longest ancestor; declining an already-inherited child reuses the ancestor row, restoring or binding that child writes only the child's exact override, and siblings remain declined.

Do not call `record_project_events` or `acknowledge_no_project_events` while the cwd is unbound. The `Stop` Hook only audits the turn and always allows it to end; it never blocks on missing capture or binding delivery, injects a follow-up prompt, or asks for a second reply. Continue the user's main task and let the five Hooks keep auditing normally.

When `get_binding` returns `null` for the cwd, do not call `open_project_panel`; call it only after `get_binding`, `bind_project`, or `change_binding` returns a real project context.

Use `change_binding` only when the user explicitly asks to move this cwd to another Plane project.

## Automatic capture

At the end of a work turn, use the user's request, your plan, tool results, and final conclusion to decide whether there is a meaningful project event. Capture tasks, bugs, decisions, ideas, risks, milestones, plans, progress, and explicit completion. Do not turn ordinary conversation or every sentence into a record.

If automatic capture is enabled, call exactly one tool before the final response: use `record_project_events` when events exist, with all events in one non-empty batch; otherwise use `acknowledge_no_project_events` for the current `projectContextId`, `sessionId`, and `turnId`. Do not call both tools for the same turn. The acknowledgement creates no Plane item and no outbox batch. Describe what happened and preserve a short source excerpt; do not choose Plane API fields or expose credentials.

The final-reply rule above is a pre-delivery instruction for the current Codex. `Stop` computes the in-memory `binding_prompt_delivered` result when applicable, never stores the message or generates a second assistant reply; if the rule was missed, the Hook records `0` and still returns an empty response. Bound auto-capture turns similarly record `capture_decision_recorded` as `0` or `1`; non-applicable cases stay `NULL`.

The injected active Plane item snapshot uses `identifier | itemId | title | status | relationship`; `identifier` is user-visible and `itemId` is the real Plane work-item UUID. Keep the MCP field name `relatedItemId`. When a relationship is unambiguous, default `relatedItemId` to the snapshot's `itemId`; the server also accepts the exact user-visible `identifier` for compatibility. Never guess a target from a title or fuzzy text. If the relationship is not unambiguous, create a conservative new event or ask the user only for an explicit instruction whose target cannot be uniquely resolved.

Progress and related decisions should attach to an existing item. A plan may include explicit executable steps. An explicit completion may update a uniquely identified item. Do not delete items, reassign people, move projects, or overwrite fields the user has edited.

When the user explicitly overturns, abandons, or replaces a plan, include `archiveAfterCompletion: true` on a user-directed `completed` event for every affected plan item and generated step item. This completes each item before archiving it so the abandoned plan does not remain in Backlog or Todo. Never delete these items.

Before completing, superseding, or archiving a parent item, inspect every known child item and resolve each child explicitly. Never leave planned or in-progress children behind only because their parent changed. Treat the injected `relationship` field as the source for parent/child closure during the current turn.

Automatic acceptance is silent in the normal reply. Briefly confirm only when the user explicitly asked to record, update, or complete something.

## Inline project card

After a work turn makes meaningful code, documentation, configuration, or project-data changes, record the project events first, then call `open_project_panel` for the bound `projectContextId` before the final response. This is a separate display action, not a second automatic-capture call.

Also open the panel whenever the user explicitly asks to see it. Do not open it automatically after read-only inspection, explanation, status confirmation, or ordinary conversation that produced no change.
