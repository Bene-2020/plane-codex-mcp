import { readFile } from "node:fs/promises";

type Turn = { shouldCapture: boolean; actualBatchId: string | null; falseRecord?: boolean };
async function main(): Promise<void> {
  const filename = process.argv[2] ?? "evals/turns.jsonl";
  const lines = (await readFile(filename, "utf8")).split(/\r?\n/).filter(Boolean);
  const turns = lines.map((line) => JSON.parse(line) as Turn);
  const expected = turns.filter((turn) => turn.shouldCapture);
  const noCapture = turns.filter((turn) => !turn.shouldCapture);
  const captured = expected.filter((turn) => Boolean(turn.actualBatchId));
  const falseRecords = noCapture.filter((turn) => Boolean(turn.actualBatchId) || turn.falseRecord);
  const duplicateIds = turns.map((turn) => turn.actualBatchId).filter((id, index, all) => id && all.indexOf(id) !== index);
  console.log(JSON.stringify({ turns: turns.length, captureRate: expected.length ? captured.length / expected.length : 1, falseRecordRate: noCapture.length ? falseRecords.length / noCapture.length : 0, explicitOperationSuccessRate: null, duplicateRecords: duplicateIds.length }, null, 2));
}

void main();
