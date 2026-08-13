import { describe, expect, it, vi } from "vitest";
import { closeRuntimeAndExit } from "./shutdown.js";

describe("MCP process shutdown", () => {
  it("forces process exit after the grace period when an in-flight worker never closes", async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const shutdown = closeRuntimeAndExit(() => new Promise<void>(() => undefined), exit, 25);

      await vi.advanceTimersByTimeAsync(25);
      await shutdown;

      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
