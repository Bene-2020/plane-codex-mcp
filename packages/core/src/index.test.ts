import { describe, expect, it } from "vitest";
import { buildAdditionalContext, canonicalizeCwd, eventBatchSchema, hasCompleteProjectBindingPrompt, normalizeTitle, parentChildClosureRule, projectBindingFinalDeliveryRule, projectBindingPromptInstruction, projectBindingPromptHeader, remoteSourceId, supersededPlanRule } from "./index.js";

describe("core project contracts", () => {
  it("normalizes cwd without changing its identity", () => {
    expect(canonicalizeCwd(" C:\\work\\demo\\ ")).toBe("C:/work/demo");
    expect(canonicalizeCwd("/work/demo///")).toBe("/work/demo");
  });

  it("normalizes titles for conservative exact deduplication", () => {
    expect(normalizeTitle("  登录页面：偶尔会白屏。 ")).toBe("登录页面 偶尔会白屏");
  });

  it("rejects empty event batches at the MCP boundary", () => {
    expect(() => eventBatchSchema.parse({ projectContextId: "project_1", sessionId: "s", turnId: "t", events: [] })).toThrow();
  });

  it("only permits complete-then-archive for an explicit user-directed item", () => {
    const base = { title: "Retire old plan", summary: "The user replaced this plan", sourceExcerpt: "archive the old plan" };
    expect(eventBatchSchema.parse({ projectContextId: "project_1", sessionId: "s", turnId: "t", events: [{ ...base, type: "completed", relatedItemId: "item-1", userDirected: true, archiveAfterCompletion: true }] }).events[0]?.archiveAfterCompletion).toBe(true);
    expect(() => eventBatchSchema.parse({ projectContextId: "project_1", sessionId: "s", turnId: "t", events: [{ ...base, type: "plan", relatedItemId: "item-1", userDirected: true, archiveAfterCompletion: true }] })).toThrow();
    expect(() => eventBatchSchema.parse({ projectContextId: "project_1", sessionId: "s", turnId: "t", events: [{ ...base, type: "completed", relatedItemId: "item-1", archiveAfterCompletion: true }] })).toThrow();
  });

  it("builds a readable remote identity without using the local database row id", () => {
    expect(remoteSourceId("project_1", "session:one", "turn/one", 2)).toBe("project_1:session%3Aone:turn%2Fone:2");
  });

  it("keeps injected context compact and omits source content", () => {
    const context = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_1", turnId: "turn_1", currentCwd: "/work/src", context: { id: "project_1", canonicalCwd: "/work", cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", autoCaptureEnabled: true, createdAt: "now", updatedAt: "now" }, activeItems: [{ id: "p1", identifier: "DEMO-1", title: "Release", status: "planned" }, { id: "c1", identifier: "DEMO-2", title: "Fix login", status: "captured", parentId: "p1" }] });
    expect(context).toContain("DEMO-1 | Release | planned | parent");
    expect(context).toContain("DEMO-2 | Fix login | captured | child of #DEMO-1");
    expect(context).toContain(supersededPlanRule);
    expect(context).toContain(parentChildClosureRule);
    expect(context).toContain("acknowledge_no_project_events");
    expect(context).toContain("Stop Hook only audits this turn and always allows it to end");
    expect(context).toContain("Current cwd: /work/src; binding root: /work");
    expect(context).not.toContain("description");
    expect(context.length).toBeLessThan(9000);
  });

  it("resolves a rendered child's parent identifier from the full active set", () => {
    const activeItems = [
      { id: "child", identifier: "P-2", title: "Child", status: "planned", parentId: "parent" },
      ...Array.from({ length: 29 }, (_, index) => ({ id: `item-${index}`, identifier: `P-${index + 3}`, title: `Item ${index}`, status: "captured" })),
      { id: "parent", identifier: "P-1", title: "Parent", status: "planned" },
    ];
    const context = buildAdditionalContext({ eventName: "SessionStart", context: { id: "project_1", canonicalCwd: "/work", cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", autoCaptureEnabled: true, createdAt: "now", updatedAt: "now" }, activeItems });
    expect(context).toContain("P-2 | Child | planned | child of #P-1");
  });

  it("uses distinct unbound onboarding templates and never guesses a project", () => {
    const sessionStart = buildAdditionalContext({ eventName: "SessionStart", sessionId: "session_1", currentCwd: "/unbound/work", onboardingPhase: "session_start" });
    expect(sessionStart).toContain("SessionStart; it cannot interact");
    expect(sessionStart).toContain("first user-visible reply must immediately call list_projects");
    expect(sessionStart).toContain("Current cwd: /unbound/work");
    expect(sessionStart).toContain("When get_binding returns null for this cwd, do not call open_project_panel");
    expect(sessionStart).toContain("do not call bind_project before the user explicitly chooses");
    expect(sessionStart).not.toContain("If the user wants project capture");

    const firstPrompt = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_1", turnId: "turn_1", currentCwd: "/unbound/work", onboardingPhase: "first_user_prompt" });
    expect(firstPrompt).toContain("This is the first user prompt of this session");
    expect(firstPrompt).toContain("immediately call list_projects");
    expect(firstPrompt).toContain("explicit long-term do-not-bind/do-not-ask-again instruction calls decline_project_binding");
    expect(firstPrompt).toContain("ambiguous later/skip/continue is a current-session deferral");
    expect(firstPrompt).toContain("explicit request to restore or bind calls restore_project_binding");
    expect(firstPrompt).toContain("Only an explicit project choice authorizes bind_project");
    expect(firstPrompt).toContain("last_assistant_message");
    expect(firstPrompt).toContain("项目绑定（待确认）");
    expect(firstPrompt).toContain("请选择一个项目，或回复‘稍后再说’。");
    expect(firstPrompt).toContain("Stop Hook only audits this turn and always allows it to end");

    const continuing = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_1", turnId: "turn_2", currentCwd: "/unbound/work", onboardingPhase: "continuing_session" });
    expect(continuing).toContain("does not prove that onboarding was actually asked");
    expect(continuing).toContain("if no actual onboarding question has appeared yet, now call list_projects");
    expect(continuing).toContain("if onboarding was asked and the user only deferred");
    expect(continuing).toContain("explicit long-term do-not-bind/do-not-ask-again instruction calls decline_project_binding");
    expect(continuing).toContain("explicit request to restore or bind calls restore_project_binding");
    expect(continuing).not.toContain("This is the first user prompt");

    const declined = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_2", turnId: "turn_1", currentCwd: "/unbound/work", onboardingPhase: "permanently_declined" });
    expect(declined).toContain("explicit permanent do-not-ask-again preference");
    expect(declined).toContain("restore_project_binding");
    expect(declined).not.toContain("immediately call list_projects");
  });

  it("defines the final project-binding delivery contract", () => {
    const complete = `工作继续完成了。\n\n### ${projectBindingPromptHeader}\n- **SMWC-1** | Demo project\n${projectBindingPromptInstruction}`;
    expect(hasCompleteProjectBindingPrompt(complete)).toBe(true);
    expect(hasCompleteProjectBindingPrompt(`### ${projectBindingPromptHeader}\n${projectBindingPromptInstruction}`)).toBe(false);
    expect(projectBindingFinalDeliveryRule).toContain("tool output, commentary, and thought are internal context");
    expect(projectBindingFinalDeliveryRule).toContain(projectBindingPromptInstruction);
  });
});
