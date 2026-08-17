import { join } from "node:path";

export const NODE_SIDECAR_VERSION = "22.22.1";

const targetDefinitions = [
  {
    id: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    nodePlatform: "darwin",
    nodeArch: "arm64",
    archiveType: "tar.gz",
    archiveSidecarRelativePath: "bin/node",
    archiveLicenseRelativePath: "LICENSE",
    unameSystem: "Darwin",
    unameMachine: "arm64",
    displayName: "macOS arm64",
  },
  {
    id: "darwin-x64",
    platform: "darwin",
    arch: "x64",
    nodePlatform: "darwin",
    nodeArch: "x64",
    archiveType: "tar.gz",
    archiveSidecarRelativePath: "bin/node",
    archiveLicenseRelativePath: "LICENSE",
    unameSystem: "Darwin",
    unameMachine: "x86_64",
    displayName: "macOS x64",
  },
  {
    id: "linux-x64",
    platform: "linux",
    arch: "x64",
    nodePlatform: "linux",
    nodeArch: "x64",
    archiveType: "tar.gz",
    archiveSidecarRelativePath: "bin/node",
    archiveLicenseRelativePath: "LICENSE",
    unameSystem: "Linux",
    unameMachine: "x86_64",
    displayName: "Linux x64",
  },
  {
    id: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    nodePlatform: "linux",
    nodeArch: "arm64",
    archiveType: "tar.gz",
    archiveSidecarRelativePath: "bin/node",
    archiveLicenseRelativePath: "LICENSE",
    unameSystem: "Linux",
    unameMachine: "aarch64",
    displayName: "Linux arm64",
  },
  {
    id: "win32-x64",
    platform: "win32",
    arch: "x64",
    nodePlatform: "win",
    nodeArch: "x64",
    archiveType: "zip",
    archiveSidecarRelativePath: "node.exe",
    archiveLicenseRelativePath: "LICENSE",
    displayName: "Windows x64",
  },
];

function withDerivedFields(definition) {
  const archiveBaseName = `node-v${NODE_SIDECAR_VERSION}-${definition.nodePlatform}-${definition.nodeArch}`;
  const sidecarFile = definition.platform === "win32" ? "node.exe" : "node";
  const launcherFile = definition.platform === "win32" ? "ambient-node.cmd" : "ambient-node";
  return Object.freeze({
    ...definition,
    archiveBaseName,
    archiveName: `${archiveBaseName}.${definition.archiveType}`,
    extractDirectory: archiveBaseName,
    sidecarFile,
    launcherFile,
    sidecarRelativePath: `runtime/bin/${sidecarFile}`,
    launcherRelativePath: `runtime/bin/${launcherFile}`,
  });
}

export const NODE_SIDECAR_TARGETS = Object.freeze(targetDefinitions.map(withDerivedFields));
export const NODE_SIDECAR_TARGET_IDS = Object.freeze(NODE_SIDECAR_TARGETS.map((target) => target.id));

const targetsById = new Map(NODE_SIDECAR_TARGETS.map((target) => [target.id, target]));
const targetsByHost = new Map(NODE_SIDECAR_TARGETS.map((target) => [`${target.platform}/${target.arch}`, target]));

export function getNodeSidecarTarget(targetId) {
  const target = targetsById.get(targetId);
  if (!target) throw unsupportedTargetError(targetId, undefined);
  return target;
}

export function getNodeSidecarTargetForHost(platform = process.platform, arch = process.arch) {
  const target = targetsByHost.get(`${platform}/${arch}`);
  if (!target) throw unsupportedTargetError(platform, arch);
  return target;
}

export function getNodeSidecarTargetForInput(targetOrPlatform, arch) {
  if (targetOrPlatform === undefined) return getNodeSidecarTargetForHost();
  if (arch !== undefined) return getNodeSidecarTargetForHost(targetOrPlatform, arch);
  return getNodeSidecarTarget(targetOrPlatform);
}

export function getExtractedNodePaths(extractedRoot, target) {
  return {
    sidecar: join(extractedRoot, target.extractDirectory, target.archiveSidecarRelativePath),
    license: join(extractedRoot, target.extractDirectory, target.archiveLicenseRelativePath),
  };
}

export function supportedTargetSummary() {
  return NODE_SIDECAR_TARGETS.map((target) => `${target.platform}/${target.arch}`).join(", ");
}

export function unsupportedTargetError(platformOrTarget, arch) {
  const value = arch === undefined ? String(platformOrTarget) : `${platformOrTarget}/${arch}`;
  return new Error(`Unsupported Ambient Project Layer runtime target ${value}. Supported targets: ${supportedTargetSummary()}.`);
}

export function renderPosixLauncher(target) {
  if (target.platform === "win32") throw new Error(`Cannot render a POSIX launcher for ${target.id}`);
  return `#!/bin/sh
set -eu

if [ "$(/usr/bin/uname -s)" != "${target.unameSystem}" ] || [ "$(/usr/bin/uname -m)" != "${target.unameMachine}" ]; then
  echo "Ambient Project Layer plugin package ${target.id} requires ${target.displayName}; this installation cannot run on $(/usr/bin/uname -s)/$(/usr/bin/uname -m)." >&2
  exit 78
fi

script_dir=$(/usr/bin/dirname "$0")
script_dir=$(CDPATH= cd "$script_dir" && pwd -P)
unset NODE_PATH NODE_OPTIONS
exec "$script_dir/${target.sidecarFile}" "$@"
`;
}

export function renderWindowsLauncher(target) {
  if (target.platform !== "win32") throw new Error(`Cannot render a Windows launcher for ${target.id}`);
  return `@echo off
setlocal

if /I not "%OS%"=="Windows_NT" (
  >&2 echo Ambient Project Layer plugin package ${target.id} requires ${target.displayName}; this installation cannot run on %OS%/%PROCESSOR_ARCHITECTURE%.
  exit /b 78
)
if /I "%PROCESSOR_ARCHITECTURE%"=="AMD64" goto run
if /I "%PROCESSOR_ARCHITEW6432%"=="AMD64" goto run
>&2 echo Ambient Project Layer plugin package ${target.id} requires ${target.displayName}; this installation cannot run on Windows/%PROCESSOR_ARCHITECTURE%.
exit /b 78

:run
set "script_dir=%~dp0"
set "NODE_PATH="
set "NODE_OPTIONS="
"%script_dir%${target.sidecarFile}" %*
exit /b %ERRORLEVEL%
`;
}

export function renderLauncher(target) {
  return target.platform === "win32" ? renderWindowsLauncher(target) : renderPosixLauncher(target);
}
