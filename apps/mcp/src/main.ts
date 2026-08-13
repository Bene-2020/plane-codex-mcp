import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startMcpRuntime } from "./index.js";
import type { McpRuntime } from "./index.js";
import { closeRuntimeAndExit } from "./shutdown.js";

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  let runtime: McpRuntime | undefined;
  let shuttingDown = false;
  const shutdown = () => {
    if (!runtime || shuttingDown) return;
    shuttingDown = true;
    void closeRuntimeAndExit(() => runtime!.close(), (code) => process.exit(code));
  };
  transport.onclose = shutdown;
  runtime = await startMcpRuntime({ transport });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
}

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
