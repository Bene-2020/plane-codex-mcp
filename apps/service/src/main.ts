import { startService } from "./index.js";

async function main(): Promise<void> {
  const service = await startService();
  process.stderr.write(`Ambient project service listening on ${service.baseUrl}\n`);
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= service.close();
    return closePromise;
  };
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
