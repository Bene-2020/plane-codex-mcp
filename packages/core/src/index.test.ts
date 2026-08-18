import { describe, expect, it } from "vitest";
import { buildAdditionalContext, canonicalizeCwd, codexDesktopListProjectsToolName, eventBatchSchema, hasCompleteProjectBindingPrompt, normalizeTitle, parentChildClosureRule, projectBindingFinalDeliveryRule, projectBindingListProjectsToolName, projectBindingPermanentRefusalRule, projectBindingPostPromptDeferralRule, projectBindingPromptInstruction, projectBindingPromptHeader, projectBindingRestoreRule, projectBindingSessionDeferralRule, projectBindingToolName, projectBindingToolSourceRule, relatedItemIdContract, remoteSourceId, supersededPlanRule } from "./index.js";

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
    const context = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_1", turnId: "turn_1", currentCwd: "/work/src", context: { id: "project_1", canonicalCwd: "/work", cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", autoCaptureEnabled: true, createdAt: "now", updatedAt: "now" }, activeItems: [{ itemId: "uuid-parent", identifier: "DEMO-1", title: "Release", status: "planned" }, { itemId: "uuid-child", identifier: "DEMO-2", title: "Fix login", status: "captured", parentId: "uuid-parent" }] });
    expect(context).toContain("Active Plane items (identifier | itemId | title | status | relationship):");
    expect(context).toContain("DEMO-1 | uuid-parent | Release | planned | parent");
    expect(context).toContain("DEMO-2 | uuid-child | Fix login | captured | child of #DEMO-1");
    expect(context).toContain(relatedItemIdContract);
    expect(context).toContain(supersededPlanRule);
    expect(context).toContain(parentChildClosureRule);
    expect(context).toContain("mcp__ambient_project__acknowledge_no_project_events");
    expect(context).toContain("Stop Hook only audits this turn and always allows it to end");
    expect(context).toContain("Current cwd: /work/src; binding root: /work");
    expect(context).not.toContain("description");
    expect(context.length).toBeLessThan(9000);
  });

  it("resolves a rendered child's parent identifier from the full active set", () => {
    const activeItems = [
      { itemId: "child", identifier: "P-2", title: "Child", status: "planned", parentId: "parent" },
      ...Array.from({ length: 29 }, (_, index) => ({ itemId: `item-${index}`, identifier: `P-${index + 3}`, title: `Item ${index}`, status: "captured" })),
      { itemId: "parent", identifier: "P-1", title: "Parent", status: "planned" },
    ];
    const context = buildAdditionalContext({ eventName: "SessionStart", context: { id: "project_1", canonicalCwd: "/work", cwd: "/work", planeBaseUrl: "https://plane.test", workspaceSlug: "ws", planeProjectId: "p", autoCaptureEnabled: true, createdAt: "now", updatedAt: "now" }, activeItems });
    expect(context).toContain("P-2 | child | Child | planned | child of #P-1");
  });

  it("uses distinct unbound onboarding templates and never guesses a project", () => {
    const sessionStart = buildAdditionalContext({ eventName: "SessionStart", sessionId: "session_1", currentCwd: "/unbound/work", onboardingPhase: "session_start" });
    expect(sessionStart).toContain("SessionStart; it cannot interact");
    expect(sessionStart).toContain(`even a normal work request must call ${projectBindingListProjectsToolName}`);
    expect(sessionStart).toContain("Current cwd: /unbound/work");
    expect(sessionStart).toContain("When mcp__ambient_project__get_binding returns null for this cwd, do not call mcp__ambient_project__open_project_panel");
    expect(sessionStart).toContain("do not call mcp__ambient_project__bind_project before the user explicitly chooses");
    expect(sessionStart).not.toContain("If the user wants project capture");

    const firstPrompt = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_1", turnId: "turn_1", currentCwd: "/unbound/work", onboardingPhase: "first_user_prompt" });
    expect(firstPrompt).toContain("This is the first user prompt of this session");
    expect(firstPrompt).toContain(`immediately call ${projectBindingListProjectsToolName}`);
    expect(firstPrompt).toContain("takes precedence over every onboarding instruction");
    expect(firstPrompt).toContain("temporary later/skip/this-time refusal");
    expect(firstPrompt).toContain("Only an explicit request to restore or resume binding authorizes mcp__ambient_project__restore_project_binding");
    expect(firstPrompt).toContain(`Only an explicit project choice authorizes ${projectBindingToolName}`);
    expect(firstPrompt).toContain(projectBindingPermanentRefusalRule);
    expect(firstPrompt).toContain(projectBindingSessionDeferralRule);
    expect(firstPrompt).toContain(projectBindingRestoreRule);
    expect(firstPrompt).not.toContain(projectBindingPostPromptDeferralRule);
    expect(firstPrompt).toContain("a normal work request is not a current-session deferral");
    expect(firstPrompt).toContain(`fixed final binding block is required only after ${projectBindingListProjectsToolName} actually runs`);
    expect(firstPrompt).not.toContain("last_assistant_message");
    expect(firstPrompt).not.toContain(projectBindingFinalDeliveryRule);
    expect(firstPrompt).toContain("Stop Hook only audits this turn and always allows it to end");

    const continuing = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_1", turnId: "turn_2", currentCwd: "/unbound/work", onboardingPhase: "continuing_session" });
    expect(continuing).toContain("does not prove that onboarding was actually asked");
    expect(continuing).toContain(`If no actual onboarding question has appeared yet, now call ${projectBindingListProjectsToolName}`);
    expect(continuing).toContain("takes precedence over every onboarding instruction");
    expect(continuing).toContain(projectBindingPostPromptDeferralRule);
    expect(continuing).toContain("Only an explicit request to restore or resume binding authorizes mcp__ambient_project__restore_project_binding");
    expect(continuing).not.toContain("This is the first user prompt");

    const declined = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "session_2", turnId: "turn_1", currentCwd: "/unbound/work", onboardingPhase: "permanently_declined" });
    expect(declined).toContain("explicit permanent do-not-ask-again preference");
    expect(declined).toContain("mcp__ambient_project__restore_project_binding");
    expect(declined).not.toContain(`immediately call ${projectBindingListProjectsToolName}`);
    expect(declined).not.toContain(projectBindingFinalDeliveryRule);
    expect(declined).not.toContain(projectBindingPromptHeader);
    expect(declined).not.toContain(projectBindingPromptInstruction);
  });

  it("defines the final project-binding delivery contract", () => {
    const complete = "工作继续完成了。\n\n### " + projectBindingPromptHeader + "\n- **SMWC-1** | Demo project\n" + projectBindingPromptInstruction;
    expect(hasCompleteProjectBindingPrompt(complete)).toBe(true);
    expect(hasCompleteProjectBindingPrompt("### " + projectBindingPromptHeader + "\n" + projectBindingPromptInstruction)).toBe(false);
    expect(hasCompleteProjectBindingPrompt("<!--\n" + complete + "\n-->")).toBe(false);
    expect(hasCompleteProjectBindingPrompt("工作继续完成了。\n<!-- " + complete + " -->")).toBe(false);
    expect(projectBindingFinalDeliveryRule).toContain("tool output, commentary, and thought are internal context");
    expect(projectBindingFinalDeliveryRule).toContain("- **<identifier>** | <name>");
    expect(projectBindingFinalDeliveryRule).toContain("Reject prefixes, suffixes, labels, extra separators, extra fields");
    expect(projectBindingFinalDeliveryRule).toContain(projectBindingPromptInstruction);
  });

  it("locks binding rules to the canonical Ambient host tool and rejects local project metadata", () => {
    const context = buildAdditionalContext({ eventName: "UserPromptSubmit", sessionId: "s", turnId: "t", currentCwd: "/unbound/work", onboardingPhase: "first_user_prompt" });
    for (const rule of [context, projectBindingPermanentRefusalRule, projectBindingSessionDeferralRule, projectBindingPostPromptDeferralRule, projectBindingFinalDeliveryRule, projectBindingToolSourceRule]) {
      expect(rule).toContain(projectBindingListProjectsToolName);
      expect(rule).not.toContain("call list_projects");
    }
    expect(context).toContain(codexDesktopListProjectsToolName);
    expect(context).toContain("may still be used for an explicit Codex Projects request, but never as Plane binding evidence");
    expect(context).toContain("path, projectKind, or hostId");
  });

  it("matches binding block projects to the saved name and identifier source", () => {
    const candidates = [{ name: "Demo", identifier: "P1" }, { name: "演示项目", identifier: "项目-1" }];
    const complete = "工作继续完成了。\n\n### " + projectBindingPromptHeader + "\n- **P1** | Demo\n- 项目-1 | `演示项目`\n" + projectBindingPromptInstruction;
    expect(hasCompleteProjectBindingPrompt(complete, candidates)).toBe(true);
    expect(hasCompleteProjectBindingPrompt("### " + projectBindingPromptHeader + "\n- P10 | Demo\n" + projectBindingPromptInstruction, candidates)).toBe(false);
    expect(hasCompleteProjectBindingPrompt("### " + projectBindingPromptHeader + "\n- P1 | Demo Local\n" + projectBindingPromptInstruction, candidates)).toBe(false);
    expect(hasCompleteProjectBindingPrompt("### " + projectBindingPromptHeader + "\n- prefix P1 | Demo\n" + projectBindingPromptInstruction, candidates)).toBe(false);
    expect(hasCompleteProjectBindingPrompt("### " + projectBindingPromptHeader + "\n- P1 | Demo suffix\n" + projectBindingPromptInstruction, candidates)).toBe(false);
    for (const metadata of ["path: /tmp/project", "projectKind: local", "hostId: desktop"]) {
      expect(hasCompleteProjectBindingPrompt("### " + projectBindingPromptHeader + "\n- P1 | Demo | " + metadata + "\n" + projectBindingPromptInstruction, candidates)).toBe(false);
    }
    expect(hasCompleteProjectBindingPrompt("### " + projectBindingPromptHeader + "\n- P1 | Demo\nsource: local\n" + projectBindingPromptInstruction, candidates)).toBe(false);
    expect(hasCompleteProjectBindingPrompt("### " + projectBindingPromptHeader + "\n- **DEMO** | Demo Project\n" + projectBindingPromptInstruction, [])).toBe(false);
  });
});
