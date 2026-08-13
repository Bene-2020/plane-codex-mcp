export async function closeRuntimeAndExit(closeRuntime: () => Promise<void>, exit: (code: number) => void, timeoutMs = 5_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<number>((resolve) => { timer = setTimeout(() => resolve(0), timeoutMs); });
  const result = await Promise.race([closeRuntime().then(() => 0, () => 1), timeout]);
  if (timer) clearTimeout(timer);
  exit(result);
}
