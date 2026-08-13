import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getNodeSidecarTarget } from "../node-sidecar-targets.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected artifact validation argument: ${argument}`);
    if (argument === "--require-native") {
      options["require-native"] = true;
      continue;
    }
    const separator = argument.indexOf("=");
    if (separator >= 0) {
      options[argument.slice(2, separator)] = argument.slice(separator + 1);
      continue;
    }
    options[argument.slice(2)] = argumentsList[index + 1];
    index += 1;
  }
  for (const required of ["root", "target", "report"]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }
  return options;
}

async function collectEntries(root, current = root, entries = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = join(current, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    entries.push({ relativePath, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" });
    if (entry.isDirectory()) await collectEntries(root, absolutePath, entries);
  }
  return entries;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runValidator(command, argumentsList) {
  try {
    const result = await execFileAsync(command, argumentsList, { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return { status: "passed", command: [command, ...argumentsList].join(" ") };
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    return {
      status: "failed",
      command: [command, ...argumentsList].join(" "),
      error: error.message,
    };
  }
}

async function restoreUnixExecutableModes(packageRoot, target) {
  if (target.platform === "win32") return { status: "not-required", files: [] };
  const files = [
    join(packageRoot, "runtime/bin", target.sidecarFile),
    join(packageRoot, "runtime/bin", target.launcherFile),
  ];
  await Promise.all(files.map((path) => chmod(path, 0o755)));
  return { status: "passed", files: files.map((path) => relative(packageRoot, path).split(sep).join("/")) };
}

const options = parseArguments(process.argv.slice(2));
const packageRoot = resolve(options.root);
const target = getNodeSidecarTarget(options.target);
const reportPath = resolve(options.report);
const isNativeTarget = target.platform === process.platform && target.arch === process.arch;
const expectedHiddenManifestFiles = [".mcp.json", ".codex-plugin/plugin.json"];
const requiredFiles = [
  ".mcp.json",
  ".codex-plugin/plugin.json",
  "hooks/hooks.json",
  "panel/dist/index.html",
  "runtime/package.json",
  "runtime/runtime.json",
  "runtime/LICENSE.nodejs",
  "runtime/mcp/index.js",
  "runtime/hook-adapter/index.js",
  `runtime/bin/${target.launcherFile}`,
  `runtime/bin/${target.sidecarFile}`,
];

const report = {
  schemaVersion: 1,
  status: "failed",
  target: options.target,
  packageRoot: "downloaded plugin artifact",
  source: "actions/download-artifact@v4",
  requiredFiles: { status: "failed", expected: requiredFiles, missing: [] },
  hiddenManifestFiles: {
    status: "failed",
    expected: expectedHiddenManifestFiles,
    present: [],
    missing: [],
    unexpected: [],
  },
  sensitiveFiles: { status: "failed", unexpected: [] },
  validators: {},
};

try {
  const entries = await collectEntries(packageRoot);
  const entryPaths = new Set(entries.map((entry) => entry.relativePath));
  const missingFiles = requiredFiles.filter((path) => !entryPaths.has(path) || entries.find((entry) => entry.relativePath === path)?.type !== "file");
  report.requiredFiles = { status: missingFiles.length === 0 ? "passed" : "failed", expected: requiredFiles, missing: missingFiles };

  const hiddenEntries = entries.filter((entry) => entry.relativePath.split("/").some((part) => part.startsWith(".")));
  const unexpectedHidden = hiddenEntries.map((entry) => entry.relativePath).filter((path) => ![".codex-plugin", ".codex-plugin/plugin.json", ".mcp.json"].includes(path));
  const presentHiddenManifestFiles = expectedHiddenManifestFiles.filter((path) => entryPaths.has(path));
  const missingHiddenManifestFiles = expectedHiddenManifestFiles.filter((path) => !entryPaths.has(path));
  report.hiddenManifestFiles = {
    status: missingHiddenManifestFiles.length === 0 && unexpectedHidden.length === 0 ? "passed" : "failed",
    expected: expectedHiddenManifestFiles,
    present: presentHiddenManifestFiles,
    missing: missingHiddenManifestFiles,
    unexpected: unexpectedHidden,
  };

  const sensitivePattern = /(^|\/)(\.env(?:\..*)?|credentials?\.(?:json|ya?ml|txt)?|secrets?\.(?:json|ya?ml|txt)?|tokens?\.(?:json|ya?ml|txt)?|[^/]+\.(?:sqlite|sqlite3|db|pem|key))$/i;
  const sensitiveFiles = entries.map((entry) => entry.relativePath).filter((path) => sensitivePattern.test(path));
  report.sensitiveFiles = { status: sensitiveFiles.length === 0 ? "passed" : "failed", unexpected: sensitiveFiles };

  if (report.requiredFiles.status === "passed" && report.hiddenManifestFiles.status === "passed" && report.sensitiveFiles.status === "passed") {
    const manifest = await readJson(join(packageRoot, ".codex-plugin/plugin.json"));
    const mcpConfig = await readJson(join(packageRoot, ".mcp.json"));
    const hooksConfig = await readJson(join(packageRoot, "hooks/hooks.json"));
    const runtime = await readJson(join(packageRoot, "runtime/runtime.json"));
    const mcpServer = mcpConfig.mcpServers?.["ambient-project"];
    const expectedEvents = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"];
    if (manifest.name !== "ambient-project-layer") throw new Error("Downloaded artifact manifest has the wrong plugin name");
    if (!mcpServer || mcpServer.command !== target.launcherRelativePath || JSON.stringify(mcpServer.args) !== JSON.stringify(["runtime/mcp/index.js"]) || mcpServer.cwd !== ".") {
      throw new Error("Downloaded artifact .mcp.json does not point at the target launcher");
    }
    if (JSON.stringify(Object.keys(hooksConfig.hooks ?? {})) !== JSON.stringify(expectedEvents)) throw new Error("Downloaded artifact hooks are incomplete");
    if (runtime.target !== target.id || runtime.sidecar !== target.sidecarRelativePath || runtime.nodeVersion !== "22.22.1") {
      throw new Error("Downloaded artifact runtime metadata does not match the target");
    }
    for (const file of requiredFiles) {
      if ((await stat(join(packageRoot, file))).size === 0) throw new Error(`Downloaded artifact file is empty: ${file}`);
    }
    report.manifestAndLayout = { status: "passed", mcp: "passed", hooks: "passed", runtime: "passed", license: "passed", launcher: "passed" };
  } else {
    report.manifestAndLayout = { status: "failed" };
  }
} catch (error) {
  report.manifestAndLayout = { status: "failed", error: error.message };
}

if (report.manifestAndLayout?.status === "passed") {
  try {
    report.downloadedPermissions = await restoreUnixExecutableModes(packageRoot, target);
  } catch (error) {
    report.downloadedPermissions = { status: "failed", files: [], error: error.message };
  }
  if (report.downloadedPermissions.status === "passed" || report.downloadedPermissions.status === "not-required") {
    const python = process.platform === "win32" ? "python" : "python3";
    report.validators.pluginManifest = await runValidator(python, [join(repositoryRoot, "scripts/plugin-creator/validate_plugin.py"), packageRoot]);
    report.validators.runtime = await runValidator(process.execPath, [join(repositoryRoot, "scripts/validate-plugin-runtime.mjs"), packageRoot]);
    report.validators.bundledNode = isNativeTarget
      ? await runValidator(process.execPath, [join(repositoryRoot, "scripts/check-bundled-node.mjs"), packageRoot])
      : { status: "not-run", reason: `target ${options.target} is not native to this verifier` };
  } else {
    report.validators = {
      pluginManifest: { status: "not-run" },
      runtime: { status: "not-run" },
      bundledNode: { status: "not-run" },
    };
  }
} else {
  report.downloadedPermissions = { status: "not-run", files: [] };
  report.validators = {
    pluginManifest: { status: "not-run" },
    runtime: { status: "not-run" },
    bundledNode: { status: "not-run" },
  };
}

const validatorStatuses = Object.values(report.validators).map((validator) => validator.status);
const validatorsPassed = validatorStatuses.every((status) => status === "passed" || (!options["require-native"] && status === "not-run"));
const permissionsPassed = report.downloadedPermissions?.status === "passed" || report.downloadedPermissions?.status === "not-required";
report.artifactIntegrity = {
  status: [report.requiredFiles.status, report.hiddenManifestFiles.status, report.sensitiveFiles.status, report.manifestAndLayout?.status].every((status) => status === "passed") && permissionsPassed && validatorsPassed && (!options["require-native"] || isNativeTarget) ? "passed" : "failed",
  downloadedAndValidated: true,
  requiredFiles: report.requiredFiles.status,
  hiddenManifestFiles: report.hiddenManifestFiles.status,
  sensitiveFiles: report.sensitiveFiles.status,
  manifestAndLayout: report.manifestAndLayout?.status ?? "failed",
  downloadedPermissions: report.downloadedPermissions?.status ?? "not-run",
  validators: report.validators,
};
report.status = report.artifactIntegrity.status;

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "passed") throw new Error(`Uploaded plugin artifact integrity failed for ${options.target}`);
process.stdout.write(`Uploaded plugin artifact integrity passed: ${options.target}, hidden manifest files retained, no unexpected hidden or sensitive files.\n`);
