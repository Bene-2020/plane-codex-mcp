---
name: ambient-project
description: Quietly maintain a useful project view from meaningful work in the current Codex session. Use when work creates a task, bug, decision, idea, risk, milestone, plan, progress update, or explicit completion.
---

# Ambient project layer

This skill is a quiet project-recording workflow. Keep doing the user's main work normally.

## Binding

When the injected context says this cwd has no project context, follow its onboarding phase and the visible conversation. Always apply the current user's explicit branch before fallback onboarding. An explicit long-term do-not-bind/do-not-ask-again instruction takes precedence: call `mcp__ambient_project__decline_project_binding` without calling `mcp__ambient_project__list_projects`, do not ask about binding again, and do not emit the fixed project-binding block. An explicit temporary “later/skip/this time/this round/not now” refusal is quiet only for the current session: do not call `mcp__ambient_project__list_projects`, do not ask again, and do not write a binding preference; the next new session may ask once again. Continuing another task without choosing is a current-session deferral only after the visible conversation has already shown an actual binding question or `mcp__ambient_project__list_projects` result; before that, even a normal work request is the first onboarding prompt and must call `mcp__ambient_project__list_projects`, show the real returned Plane projects, and ask the user to choose. Only an explicit request to restore or resume binding authorizes `mcp__ambient_project__restore_project_binding`; after restoring, call `mcp__ambient_project__list_projects`, wait for an explicit project choice, and call `mcp__ambient_project__bind_project` only after that choice. Do not guess from a Codex Project name, directory name, Git remote, or conversation.

During Ambient Plane binding, use only `mcp__ambient_project__list_projects` as the candidate source. `codex_app__list_projects` may still be used for an explicit Codex Projects request, but never as Plane binding evidence. Binding candidates may only come from the real return of `mcp__ambient_project__list_projects` in this turn. Never show or accept `path`, `projectKind`, or `hostId`, and never use a Codex local project name as a Plane candidate. Before an explicit user choice, do not call `mcp__ambient_project__bind_project`; never guess from a directory name, Codex Project, Git remote, or history.

Only when this turn actually calls `mcp__ambient_project__list_projects` and the cwd remains unbound with no permanent refusal or current-session deferral does the final binding-delivery rule apply. Its tool output, commentary, and thought are not user delivery; the fixed block may contain only name+identifier pairs from that turn's real `mcp__ambient_project__list_projects` return. If the result is empty, exceptional, from another tool, or contains `path`/`projectKind`/`hostId`, do not deliver a binding prompt. Before the final reply, put the real returned projects into the final `last_assistant_message` under this fixed block, while continuing the user's main task normally:

```text
### 项目绑定（待确认）
- <真实返回的 Plane 项目>
请选择一个项目，或回复‘稍后再说’。
```

Use at least one Markdown project list item and do not guess projects or replace the real returned list with a reference to tool output.

If the user says to decide later, skip it, not this round, or not now, treat that explicit temporary refusal as a current-session deferral only. Do not write a preference, call `mcp__ambient_project__list_projects`, ask again, or show the fixed binding block in the current reply or later replies in that session; a new session may ask once again. If the visible conversation has already shown a binding question or `mcp__ambient_project__list_projects` result and the user ignores the choice or continues another task, also do not repeat the question in that session. If no binding question has been shown, a normal work request is not a deferral and must start onboarding with `mcp__ambient_project__list_projects`. If the user explicitly says not to bind this directory or not to ask again in the future, call `mcp__ambient_project__decline_project_binding` for the injected current cwd. This stores only a stable workspace identity and a declined status, never the user's wording. A permanently declined unbound cwd must remain quiet in later sessions; if the user explicitly asks to resume binding, call `mcp__ambient_project__restore_project_binding` first, then `mcp__ambient_project__list_projects`, wait for an explicit project choice, and call `mcp__ambient_project__bind_project` only after that choice. A successful `mcp__ambient_project__bind_project` clears or writes a readable exact `restored` override for the effective refusal identity. For non-Git paths, a declined root is inherited by descendants through the longest ancestor; declining an already-inherited child reuses the ancestor row, restoring or binding that child writes only the child's exact override, and siblings remain declined.

Do not call `mcp__ambient_project__record_project_events` or `mcp__ambient_project__acknowledge_no_project_events` while the cwd is unbound. A permanent refusal or current-session deferral is not a project binding and remains quiet. The `Stop` Hook only audits this turn and always allows it to end; it never blocks on missing capture or binding delivery, injects a follow-up message, or asks for a second reply. Continue the user's main task and let the five Hooks keep auditing normally.

When `mcp__ambient_project__get_binding` returns `null` for the cwd, do not call `mcp__ambient_project__open_project_panel`; call it only after `mcp__ambient_project__get_binding`, `mcp__ambient_project__bind_project`, or `mcp__ambient_project__change_binding` returns a real project context.

Use `mcp__ambient_project__change_binding` only when the user explicitly asks to move this cwd to another Plane project.

## Automatic capture

At the end of a work turn, use the user's request, your plan, tool results, and final conclusion to decide whether there is a meaningful project event. Capture tasks, bugs, decisions, ideas, risks, milestones, plans, progress, and explicit completion. Do not turn ordinary conversation or every sentence into a record.

If automatic capture is enabled, call exactly one tool before the final response: use `mcp__ambient_project__record_project_events` when events exist, with all events in one non-empty batch; otherwise use `mcp__ambient_project__acknowledge_no_project_events` for the current `projectContextId`, `sessionId`, and `turnId`. Do not call both tools for the same turn. The acknowledgement creates no Plane item and no outbox batch. Describe what happened and preserve a short source excerpt; do not choose Plane API fields or expose credentials.

The final-reply rule above is a pre-delivery instruction for the current Codex. `Stop` computes the in-memory `binding_prompt_delivered` result when applicable, never stores the message or generates a second assistant reply; if the rule was missed, the Hook records `0` and still returns an empty response. Bound auto-capture turns similarly record `capture_decision_recorded` as `0` or `1`; non-applicable cases stay `NULL`.

The injected active Plane item snapshot uses `identifier | itemId | title | status | relationship`; `identifier` is user-visible and `itemId` is the real Plane work-item UUID. Keep the MCP field name `relatedItemId`. When a relationship is unambiguous, default `relatedItemId` to the snapshot's `itemId`; the server also accepts the exact user-visible `identifier` for compatibility. Never guess a target from a title or fuzzy text. If the relationship is not unambiguous, create a conservative new event or ask the user only for an explicit instruction whose target cannot be uniquely resolved.

Progress and related decisions should attach to an existing item. A plan may include explicit executable steps. An explicit completion may update a uniquely identified item. Do not delete items, reassign people, move projects, or overwrite fields the user has edited.

When the user explicitly overturns, abandons, or replaces a plan, include `archiveAfterCompletion: true` on a user-directed `completed` event for every affected plan item and generated step item. This completes each item before archiving it so the abandoned plan does not remain in Backlog or Todo. Never delete these items.

Before completing, superseding, or archiving a parent item, inspect every known child item and resolve each child explicitly. Never leave planned or in-progress children behind only because their parent changed. Treat the injected `relationship` field as the source for parent/child closure during the current turn.

Automatic acceptance is silent in the normal reply. Briefly confirm only when the user explicitly asked to record, update, or complete something.

## Inline project card

After a work turn makes meaningful code, documentation, configuration, or project-data changes, record the project events first, then call `mcp__ambient_project__open_project_panel` for the bound `projectContextId` before the final response. This is a separate display action, not a second automatic-capture call.

Also call `mcp__ambient_project__open_project_panel` whenever the user explicitly asks to see it. Do not open it automatically after read-only inspection, explanation, status confirmation, or ordinary conversation that produced no change.
