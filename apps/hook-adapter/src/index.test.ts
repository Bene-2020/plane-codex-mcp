import { describe, expect, it } from "vitest";
import { handleHook } from "./index.js";
import { Storage } from "@ambient/storage";
import { projectBindingFinalDeliveryRule, projectBindingPostPromptDeferralRule, projectBindingPromptHeader, projectBindingPromptInstruction } from "@ambient/core";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

describe("hook adapter", () => {
  it("uses hookSpecificOutput.additionalContext for session context", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", planeProjectName: "Demo" });
    storage.cacheItem(context.id, { id: "parent", identifier: "P-1", title: "Parent", status: "planned" }, true);
    storage.cacheItem(context.id, { id: "child", identifier: "P-2", title: "Child", status: "planned", parentId: "parent" }, true);
    for (const eventName of ["SessionStart", "UserPromptSubmit"]) {
      const result = await handleHook(JSON.stringify({ hook_event_name: eventName, cwd: "/work", session_id: "s", turn_id: "t", source: "startup", prompt: "continue" }), storage);
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: expect.any(String),
        },
      });
      const additionalContext = (result.hookSpecificOutput as { additionalContext: string }).additionalContext;
      expect(additionalContext).toContain("Active Plane items (identifier | itemId | title | status | relationship):");
      expect(additionalContext).toContain("P-1 | parent | Parent | planned | parent");
      expect(additionalContext).toContain("P-2 | child | Child | planned | child of #P-1");
    }
    storage.close();
  });

  it("audits the canonical MCP tool name from PostToolUse", async () => {
    const storage = new Storage(":memory:");
    try {
      for (const [turnId, toolName] of [
        ["record", "mcp__ambient_project__record_project_events"],
        ["ack", "mcp__ambient_project__acknowledge_no_project_events"],
        ["decline", "mcp__ambient_project__decline_project_binding"],
        ["list", "mcp__ambient_project__list_projects"],
        ["restore", "mcp__ambient_project__restore_project_binding"],
      ]) {
        await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", session_id: "s", turn_id: turnId, tool_name: toolName }), storage);
      }
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", session_id: "s", turn_id: "combined", tool_name: "mcp__ambient_project__list_projects" }), storage);
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", session_id: "s", turn_id: "combined", tool_name: "mcp__ambient_project__record_project_events" }), storage);
      const audits = storage.db.prepare("SELECT turn_id, record_tool_called, binding_list_tool_called, capture_decision_recorded, binding_prompt_delivered FROM turn_audits WHERE session_id=? ORDER BY turn_id").all("s") as Array<{ turn_id: string; record_tool_called: number; binding_list_tool_called: number; capture_decision_recorded: number | null; binding_prompt_delivered: number | null }>;
      expect(audits).toEqual([
        { turn_id: "ack", record_tool_called: 0, binding_list_tool_called: 0, capture_decision_recorded: null, binding_prompt_delivered: null },
        { turn_id: "combined", record_tool_called: 1, binding_list_tool_called: 1, capture_decision_recorded: null, binding_prompt_delivered: null },
        { turn_id: "decline", record_tool_called: 0, binding_list_tool_called: 0, capture_decision_recorded: null, binding_prompt_delivered: null },
        { turn_id: "list", record_tool_called: 0, binding_list_tool_called: 1, capture_decision_recorded: null, binding_prompt_delivered: null },
        { turn_id: "record", record_tool_called: 1, binding_list_tool_called: 0, capture_decision_recorded: null, binding_prompt_delivered: null },
        { turn_id: "restore", record_tool_called: 0, binding_list_tool_called: 0, capture_decision_recorded: null, binding_prompt_delivered: null },
      ]);
    } finally {
      storage.close();
    }
  });

  it("actively guides the first unbound prompt once per session and includes the real cwd", async () => {
    const storage = new Storage(":memory:");
    const sessionStart = await handleHook(JSON.stringify({ hook_event_name: "SessionStart", cwd: "/unbound/work/src", session_id: "session-1" }), storage);
    expect(JSON.stringify(sessionStart)).toContain("SessionStart; it cannot interact");
    expect(JSON.stringify(sessionStart)).toContain("Current cwd: /unbound/work/src");
    expect(JSON.stringify(sessionStart)).toContain("When get_binding returns null for this cwd, do not call open_project_panel");

    const first = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/work/src", session_id: "session-1", turn_id: "turn-1" }), storage);
    expect(JSON.stringify(first)).toContain("first user prompt of this session");
    expect(JSON.stringify(first)).toContain("immediately call list_projects");
    expect(JSON.stringify(first)).toContain("a normal work request is not a current-session deferral");
    expect(JSON.stringify(first)).toContain("takes precedence over every onboarding instruction");
    expect(JSON.stringify(first)).toContain("temporary later/skip/this-time refusal");

    const deferred = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/work/src", session_id: "session-1", turn_id: "turn-2" }), storage);
    expect(JSON.stringify(deferred)).toContain("does not prove that onboarding was actually asked");
    expect(JSON.stringify(deferred)).toContain("If no actual onboarding question has appeared yet, now call list_projects");
    expect(JSON.stringify(deferred)).toContain("only after the visible conversation has already shown an actual binding question");
    expect((storage.db.prepare("SELECT COUNT(*) AS count FROM workspace_binding_preferences").get() as { count: number }).count).toBe(0);
    const resumed = await handleHook(JSON.stringify({ hook_event_name: "SessionStart", cwd: "/unbound/work/src", session_id: "session-1" }), storage);
    expect(JSON.stringify(resumed)).toContain("does not prove that onboarding was actually asked");

    const nextSession = await handleHook(JSON.stringify({ hook_event_name: "SessionStart", cwd: "/unbound/work/src", session_id: "session-2" }), storage);
    expect(JSON.stringify(nextSession)).toContain("On the next UserPromptSubmit");
    const nextFirst = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/work/src", session_id: "session-2", turn_id: "turn-1" }), storage);
    expect(JSON.stringify(nextFirst)).toContain("first user prompt of this session");
    storage.close();
  });

  it("keeps a current-session deferral quiet without persisting it, then reopens onboarding next session", async () => {
    const storage = new Storage(":memory:");
    try {
      const first = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/deferred", session_id: "defer-session", turn_id: "onboard-turn", prompt: "start" }), storage);
      expect(JSON.stringify(first)).toContain("immediately call list_projects");
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/unbound/deferred", session_id: "defer-session", turn_id: "onboard-turn", tool_name: "mcp__ambient_project__list_projects" }), storage);
      const delivered = "主任务继续。\n\n### " + projectBindingPromptHeader + "\n- **SMWC-1** | 真实项目\n" + projectBindingPromptInstruction;
      expect(await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/deferred", session_id: "defer-session", turn_id: "onboard-turn", last_assistant_message: delivered }), storage)).toEqual({});
      expect(storage.db.prepare("SELECT binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("defer-session", "onboard-turn")).toEqual({ binding_prompt_delivered: 1 });

      const deferred = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/deferred", session_id: "defer-session", turn_id: "defer-turn", prompt: "本轮不绑定" }), storage);
      expect(JSON.stringify(deferred)).toContain("current session");
      expect(JSON.stringify(deferred)).not.toContain(projectBindingFinalDeliveryRule);
      expect(JSON.stringify(deferred)).not.toContain(projectBindingPromptHeader);
      expect(JSON.stringify(deferred)).not.toContain(projectBindingPromptInstruction);
      expect(storage.getBindingPreference("/unbound/deferred")).toBeNull();
      expect((storage.db.prepare("SELECT COUNT(*) AS count FROM workspace_binding_preferences").get() as { count: number }).count).toBe(0);
      expect(await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/deferred", session_id: "defer-session", turn_id: "defer-turn", last_assistant_message: "本轮任务完成。" }), storage)).toEqual({});
      expect(storage.db.prepare("SELECT binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("defer-session", "defer-turn")).toEqual({ binding_prompt_delivered: null });

      const stillQuiet = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/deferred", session_id: "defer-session", turn_id: "quiet-turn", prompt: "继续当前任务" }), storage);
      expect(JSON.stringify(stillQuiet)).toContain("do not call list_projects or ask again this session");
      expect(JSON.stringify(stillQuiet)).not.toContain(projectBindingPromptHeader);

      const nextSession = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/deferred", session_id: "new-session", turn_id: "new-turn", prompt: "普通新会话任务" }), storage);
      expect(JSON.stringify(nextSession)).toContain("immediately call list_projects");
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/unbound/deferred", session_id: "new-session", turn_id: "new-turn", tool_name: "mcp__ambient_project__list_projects" }), storage);
      expect(await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/deferred", session_id: "new-session", turn_id: "new-turn", last_assistant_message: delivered }), storage)).toEqual({});
      expect(storage.db.prepare("SELECT binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("new-session", "new-turn")).toEqual({ binding_prompt_delivered: 1 });
    } finally {
      storage.close();
    }
  });

  it("only treats continuing work as a deferral after a binding question was visible", async () => {
    const storage = new Storage(":memory:");
    try {
      const first = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/continued", session_id: "continued-session", turn_id: "first-turn", prompt: "修复普通任务" }), storage);
      expect(JSON.stringify(first)).toContain("a normal work request is not a current-session deferral");
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/unbound/continued", session_id: "continued-session", turn_id: "first-turn", tool_name: "mcp__ambient_project__list_projects" }), storage);
      const delivered = "主任务继续。\n\n### " + projectBindingPromptHeader + "\n- **SMWC-1** | 真实项目\n" + projectBindingPromptInstruction;
      await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/continued", session_id: "continued-session", turn_id: "first-turn", last_assistant_message: delivered }), storage);

      const continued = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/continued", session_id: "continued-session", turn_id: "continued-turn", prompt: "继续修复普通任务" }), storage);
      expect(JSON.stringify(continued)).toContain(projectBindingPostPromptDeferralRule);
      expect(JSON.stringify(continued)).toContain("do not call list_projects or ask again this session");
      expect(JSON.stringify(continued)).not.toContain(projectBindingFinalDeliveryRule);
      expect(storage.getBindingPreference("/unbound/continued")).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("keeps a first-turn temporary refusal quiet without creating a preference", async () => {
    const storage = new Storage(":memory:");
    try {
      const deferred = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/first-defer", session_id: "first-defer-session", turn_id: "first-defer-turn", prompt: "这次先不绑定" }), storage);
      expect(JSON.stringify(deferred)).toContain("temporary later/skip/this-time refusal");
      expect(JSON.stringify(deferred)).not.toContain(projectBindingFinalDeliveryRule);
      expect(JSON.stringify(deferred)).not.toContain(projectBindingPromptHeader);
      expect(JSON.stringify(deferred)).not.toContain(projectBindingPromptInstruction);
      expect(storage.getBindingPreference("/unbound/first-defer")).toBeNull();
      expect((storage.db.prepare("SELECT COUNT(*) AS count FROM workspace_binding_preferences").get() as { count: number }).count).toBe(0);
      await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/first-defer", session_id: "first-defer-session", turn_id: "first-defer-turn", last_assistant_message: "任务完成。" }), storage);
      expect(storage.db.prepare("SELECT binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("first-defer-session", "first-defer-turn")).toEqual({ binding_prompt_delivered: null });
      const nextSession = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/first-defer", session_id: "first-defer-new", turn_id: "first-defer-new-turn", prompt: "新会话普通任务" }), storage);
      expect(JSON.stringify(nextSession)).toContain("immediately call list_projects");
    } finally {
      storage.close();
    }
  });

  it("marks binding delivery non-applicable after a same-turn successful decline and ignores HTML comments", async () => {
    const storage = new Storage(":memory:");
    try {
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/unbound/audit", session_id: "audit-session", turn_id: "comment-turn", tool_name: "mcp__ambient_project__list_projects" }), storage);
      const complete = "主任务继续。\n\n### " + projectBindingPromptHeader + "\n- **SMWC-1** | 真实项目\n" + projectBindingPromptInstruction;
      await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/audit", session_id: "audit-session", turn_id: "comment-turn", last_assistant_message: "<!--\n" + complete + "\n-->" }), storage);
      expect(storage.db.prepare("SELECT binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("audit-session", "comment-turn")).toEqual({ binding_prompt_delivered: 0 });
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/unbound/audit", session_id: "audit-session", turn_id: "visible-turn", tool_name: "mcp__ambient_project__list_projects" }), storage);
      await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/audit", session_id: "audit-session", turn_id: "visible-turn", last_assistant_message: complete }), storage);
      expect(storage.db.prepare("SELECT binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("audit-session", "visible-turn")).toEqual({ binding_prompt_delivered: 1 });

      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/unbound/audit", session_id: "audit-session", turn_id: "decline-turn", tool_name: "mcp__ambient_project__list_projects" }), storage);
      await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/audit", session_id: "audit-session", turn_id: "decline-turn", last_assistant_message: "<!--\n" + complete + "\n-->" }), storage);
      expect(storage.db.prepare("SELECT binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("audit-session", "decline-turn")).toEqual({ binding_prompt_delivered: 0 });
      storage.declineBinding("/unbound/audit");
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/unbound/audit", session_id: "audit-session", turn_id: "decline-turn", tool_name: "mcp__ambient_project__decline_project_binding" }), storage);
      await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/audit", session_id: "audit-session", turn_id: "decline-turn", last_assistant_message: "本轮不绑定。" }), storage);
      expect(storage.db.prepare("SELECT binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("audit-session", "decline-turn")).toEqual({ binding_prompt_delivered: null });
    } finally {
      storage.close();
    }
  });

  it("keeps Stop silent when binding delivery is missing and preserves the audit", async () => {
    const storage = new Storage(":memory:");
    try {
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/unbound/work", session_id: "binding-session", turn_id: "binding-turn", tool_name: "mcp__ambient_project__list_projects" }), storage);

      const missing = "主任务已完成，但这段秘密消息不应进入审计记录。";
      const missingDelivery = await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/work", session_id: "binding-session", turn_id: "binding-turn", stop_hook_active: false, last_assistant_message: missing }), storage);
      expect(missingDelivery).toEqual({});
      expect(JSON.stringify(missingDelivery)).not.toContain("请选择一个项目，或回复‘稍后再说’。");
      expect(JSON.stringify(storage.listAudits("binding-session"))).not.toContain(missing);
      expect(storage.db.prepare("SELECT record_tool_called, binding_list_tool_called, ended_at, hook_error FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='PostToolUse'").get("binding-session", "binding-turn")).toMatchObject({ record_tool_called: 0, binding_list_tool_called: 1, hook_error: null });
      expect(storage.db.prepare("SELECT record_tool_called, binding_list_tool_called, capture_decision_recorded, binding_prompt_delivered, ended_at, hook_error FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("binding-session", "binding-turn")).toMatchObject({ record_tool_called: 0, binding_list_tool_called: 0, capture_decision_recorded: null, binding_prompt_delivered: 0, ended_at: expect.any(String), hook_error: null });

      const complete = await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/work", session_id: "binding-session", turn_id: "binding-turn", stop_hook_active: false, last_assistant_message: "主任务已完成。\n\n### 项目绑定（待确认）\n- **SMWC-1** | 真实项目\n请选择一个项目，或回复‘稍后再说’。" }), storage);
      expect(complete).toEqual({});
      expect(storage.db.prepare("SELECT capture_decision_recorded, binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("binding-session", "binding-turn")).toEqual({ capture_decision_recorded: null, binding_prompt_delivered: 1 });

      const continued = await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/work", session_id: "binding-session", turn_id: "binding-turn", stop_hook_active: true, last_assistant_message: missing }), storage);
      expect(continued).toEqual({});

      const noList = await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/other", session_id: "no-list-session", turn_id: "no-list-turn", stop_hook_active: false, last_assistant_message: missing }), storage);
      expect(noList).toEqual({});
      expect(storage.db.prepare("SELECT capture_decision_recorded, binding_prompt_delivered, ended_at FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("no-list-session", "no-list-turn")).toMatchObject({ capture_decision_recorded: null, binding_prompt_delivered: null, ended_at: expect.any(String) });
    } finally {
      storage.close();
    }
  });

  it("keeps Stop silent for an already bound cwd", async () => {
    const storage = new Storage(":memory:");
    try {
      const context = storage.bindContext({ cwd: "/bound/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", autoCaptureEnabled: false });
      await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/bound/work", session_id: "bound-session", turn_id: "bound-turn", tool_name: "mcp__ambient_project__list_projects" }), storage);
      storage.acknowledgeNoProjectEvents({ projectContextId: context.id, sessionId: "bound-session", turnId: "bound-turn" });
      expect(await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/bound/work", session_id: "bound-session", turn_id: "bound-turn", stop_hook_active: false, last_assistant_message: "主任务已完成。" }), storage)).toEqual({});
      expect(storage.db.prepare("SELECT capture_decision_recorded, binding_prompt_delivered FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("bound-session", "bound-turn")).toEqual({ capture_decision_recorded: null, binding_prompt_delivered: null });
    } finally {
      storage.close();
    }
  });

  it("keeps permanent refusal quiet across sessions, leaves Stop unblocked, and restores on bind", async () => {
    const storage = new Storage(":memory:");
    storage.declineBinding("/unbound/work");
    const sessionStart = await handleHook(JSON.stringify({ hook_event_name: "SessionStart", cwd: "/unbound/work", session_id: "session-1" }), storage);
    expect(JSON.stringify(sessionStart)).toContain("explicit permanent do-not-ask-again preference");
    expect(JSON.stringify(sessionStart)).not.toContain("first UserPromptSubmit");
    const prompt = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/work", session_id: "session-2", turn_id: "turn-1" }), storage);
    expect(JSON.stringify(prompt)).toContain("restore_project_binding");
    expect(await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/unbound/work", session_id: "session-2", turn_id: "turn-1", stop_hook_active: false }), storage)).toEqual({});

    storage.bindContext({ cwd: "/unbound/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p" });
    expect(storage.getBindingPreference("/unbound/work")).toBeNull();
    const boundPrompt = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/unbound/work", session_id: "session-3", turn_id: "turn-1" }), storage);
    expect(JSON.stringify(boundPrompt)).toContain("binding root: /unbound/work");
    storage.close();
  });

  it("keeps Stop silent when record-or-ack is missing and audits the omission", async () => {
    const storage = new Storage(":memory:");
    storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", planeProjectName: "Demo" });

    const first = await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/work", session_id: "s", turn_id: "t", stop_hook_active: false, last_assistant_message: "Implemented and tested the fix." }), storage);

    expect(first).toEqual({});
    expect(JSON.stringify(first)).not.toContain("record_project_events");
      expect(storage.db.prepare("SELECT record_tool_called, binding_list_tool_called, capture_decision_recorded, binding_prompt_delivered, ended_at, hook_error FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("s", "t")).toMatchObject({ record_tool_called: 0, binding_list_tool_called: 0, capture_decision_recorded: 0, binding_prompt_delivered: null, ended_at: expect.any(String), hook_error: null });
    storage.close();
  });

  it("allows a satisfied record-or-ack turn to stop and keeps both audits accurate", async () => {
    const storage = new Storage(":memory:");
    const context = storage.bindContext({ cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", planeProjectName: "Demo" });
    await handleHook(JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/work", session_id: "s", turn_id: "t", tool_name: "mcp__ambient_project__record_project_events" }), storage);
    storage.enqueueBatch({ projectContextId: context.id, sessionId: "s", turnId: "t", events: [{ type: "bug", title: "白屏", summary: "登录偶尔白屏", userDirected: true, sourceExcerpt: "记录这个 Bug" }] });

    const result = await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/work", session_id: "s", turn_id: "t", stop_hook_active: false }), storage);

    expect(result).toEqual({});
    expect(storage.db.prepare("SELECT record_tool_called, binding_list_tool_called, ended_at, hook_error FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='PostToolUse'").get("s", "t")).toMatchObject({ record_tool_called: 1, binding_list_tool_called: 0, ended_at: null, hook_error: null });
    expect(storage.db.prepare("SELECT record_tool_called, binding_list_tool_called, capture_decision_recorded, binding_prompt_delivered, ended_at, hook_error FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("s", "t")).toMatchObject({ record_tool_called: 0, binding_list_tool_called: 0, capture_decision_recorded: 1, binding_prompt_delivered: null, ended_at: expect.any(String), hook_error: null });
    storage.close();
  });

  it("keeps an exceptional Stop computation fail-open without storing the message", async () => {
    const storage = new Storage(":memory:");
    const secret = "private final answer that must not be persisted";
    storage.getContextByCwd = () => { throw new Error("Stop audit computation failed"); };
    try {
      expect(await handleHook(JSON.stringify({ hook_event_name: "Stop", cwd: "/work", session_id: "exception-session", turn_id: "exception-turn", last_assistant_message: secret }), storage)).toEqual({});
      expect(JSON.stringify(storage.listAudits("exception-session"))).not.toContain(secret);
      expect(storage.db.prepare("SELECT capture_decision_recorded, binding_prompt_delivered, hook_error, ended_at FROM turn_audits WHERE session_id=? AND turn_id=? AND hook_event_name='Stop'").get("exception-session", "exception-turn")).toMatchObject({ capture_decision_recorded: null, binding_prompt_delivered: null, hook_error: "Stop audit computation failed", ended_at: expect.any(String) });
    } finally {
      storage.close();
    }
  });

  it("does not emit legacy top-level context fields", async () => {
    const storage = new Storage(":memory:");
    const result = await handleHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/work", session_id: "s", turn_id: "t" }), storage);
    expect(result).not.toHaveProperty("additionalContext");
    expect(result).not.toHaveProperty("statusMessage");
    expect(result).not.toHaveProperty("systemMessage");
    storage.close();
  });

  it("returns an empty fail-open response for malformed JSON", async () => {
    expect(await handleHook("not json")).toEqual({});
  });

  it("keeps plugin hooks silent", async () => {
    const hooksPath = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));
    const hooks = JSON.parse(await readFile(hooksPath, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> };
    const handlers = Object.values(hooks.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
    expect(handlers).toHaveLength(5);
    expect(handlers.every((handler) => !Object.hasOwn(handler, "statusMessage"))).toBe(true);
  });
});
