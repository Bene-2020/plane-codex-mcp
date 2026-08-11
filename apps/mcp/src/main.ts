import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startMcpRuntime } from "./index.js";

async function main(): Promise<void> {
  const runtime = await startMcpRuntime({ transport: new StdioServerTransport() });
  const shutdown = () => { void runtime.close(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
}

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
