import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected evidence argument: ${argument}`);
    const separator = argument.indexOf("=");
    if (separator >= 0) {
      options[argument.slice(2, separator)] = argument.slice(separator + 1);
      continue;
    }
    options[argument.slice(2)] = argumentsList[index + 1];
    index += 1;
  }
  for (const required of ["target", "package-root", "evidence-dir"]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }
  return options;
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function outcome(name) {
  const value = process.env[`CHECK_${name.toUpperCase().replaceAll("-", "_")}`] ?? "failure";
  return { status: value === "success" ? "passed" : value, outcome: value };
}

const options = parseArguments(process.argv.slice(2));
const packageRoot = resolve(options["package-root"]);
const evidenceDir = resolve(options["evidence-dir"]);
const runtime = await readJsonIfPresent(resolve(packageRoot, "runtime/runtime.json"));
const smoke = options["smoke-evidence"] ? await readJsonIfPresent(resolve(options["smoke-evidence"])) : undefined;
const runId = process.env.GITHUB_RUN_ID ?? "local";
const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repository = process.env.GITHUB_REPOSITORY ?? "local/repository";
const runUrl = runId === "local" ? undefined : `${serverUrl}/${repository}/actions/runs/${runId}`;
const checks = {
  diffCheck: outcome("diff-check"),
  install: outcome("install"),
  buildPackages: outcome("build-packages"),
  buildApps: outcome("build-apps"),
  validatorDependency: outcome("validator-dependency"),
  package: outcome("package"),
  manifestValidation: outcome("manifest"),
  packageValidation: outcome("runtime"),
  bundledNodeVersion: outcome("bundled-node"),
  mcpSmoke: outcome("smoke"),
};
const evidence = {
  schemaVersion: 1,
  status: Object.values(checks).every((check) => check.status === "passed") ? "passed" : "failed",
  commitSha: process.env.GITHUB_SHA ?? "local",
  workflow: {
    name: process.env.GITHUB_WORKFLOW ?? "local",
    runId,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
    runUrl,
  },
  runner: {
    os: process.env.RUNNER_OS ?? process.platform,
    architecture: process.env.RUNNER_ARCH ?? process.arch,
    node: smoke?.runner?.node ?? process.version,
  },
  target: options.target,
  bundledNodeVersion: runtime?.nodeVersion ?? "unknown",
  runtimeMetadata: runtime ? {
    packageType: runtime.packageType,
    target: runtime.target,
    platform: runtime.platform,
    arch: runtime.arch,
    sidecar: runtime.sidecar,
    sqlite: runtime.sqlite,
  } : undefined,
  checks,
  smoke: smoke ? {
    mcp: smoke.checks?.mcp,
    hooks: smoke.checks?.hooks,
    pathWithoutSystemNodePnpmBun: smoke.checks?.pathWithoutSystemNodePnpmBun,
    pathWithSpaces: smoke.checks?.pathWithSpaces,
  } : undefined,
  commands: [
    "git diff --check",
    "pnpm install --frozen-lockfile",
    "pnpm run build:packages",
    "pnpm run build:apps",
    "python -m pip install --disable-pip-version-check --user -r scripts/plugin-creator/requirements.txt",
    `node scripts/package-plugin.mjs --target ${options.target} --output dist/plugins/ambient-project-layer/${options.target}`,
    `python scripts/plugin-creator/validate_plugin.py dist/plugins/ambient-project-layer/${options.target}`,
    `node scripts/validate-plugin-runtime.mjs dist/plugins/ambient-project-layer/${options.target}`,
    `node scripts/check-bundled-node.mjs dist/plugins/ambient-project-layer/${options.target}`,
    `node scripts/smoke-plugin.mjs --plugin-root dist/plugins/ambient-project-layer/${options.target} --evidence-output evidence/smoke.json`,
  ],
  artifact: {
    plugin: `ambient-project-layer-${options.target}-plugin`,
    evidence: `ambient-project-layer-${options.target}-evidence`,
    retentionDays: 30,
  },
  sensitiveDataExcluded: ["credentials", "database files", "session tokens", "full process transcripts"],
};
const markdown = `# Native plugin validation — ${options.target}\n\n` +
  `- Result: **${evidence.status}**\n` +
  `- Runner: ${evidence.runner.os} / ${evidence.runner.architecture}\n` +
  `- Target: ${options.target}\n` +
  `- Bundled Node: ${evidence.bundledNodeVersion} (${checks.bundledNodeVersion.status})\n` +
  `- Commit: ${evidence.commitSha}\n` +
  `- Workflow run: ${runUrl ?? "local"}\n\n` +
  `| Check | Result |\n| --- | --- |\n` +
  `| MCP STDIO handshake and tool smoke | ${checks.mcpSmoke.status} |\n` +
  `| Five Hook fixtures | ${smoke?.checks?.hooks?.status ?? "not recorded"} |\n` +
  `| PATH excludes system node/pnpm/bun | ${smoke?.checks?.pathWithoutSystemNodePnpmBun?.status ?? "not recorded"} |\n` +
  `| Package copied/executed from path with spaces | ${smoke?.checks?.pathWithSpaces?.status ?? "not recorded"} |\n` +
  `| Runtime metadata, LICENSE, layout, launcher and package validation | ${checks.packageValidation.status} |\n` +
  `| Plugin-creator validator dependency | ${checks.validatorDependency.status} |\n` +
  `| Plugin manifest validation | ${checks.manifestValidation.status} |\n` +
  `| diff-check | ${checks.diffCheck.status} |\n\n` +
  `## Commands\n\n${evidence.commands.map((command) => `- \`${command}\``).join("\n")}\n\n` +
  `Artifacts: \`${evidence.artifact.plugin}\`, \`${evidence.artifact.evidence}\` (retention ${evidence.artifact.retentionDays} days).\n` +
  `Sensitive data excluded: credentials, database files, session tokens, and full process transcripts.\n`;

await mkdir(evidenceDir, { recursive: true });
await writeFile(resolve(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await writeFile(resolve(evidenceDir, "summary.md"), markdown);
await writeFile(resolve(evidenceDir, "checks.log"), Object.entries(checks).map(([name, check]) => `${name}: ${check.status}`).join("\n") + "\n");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
