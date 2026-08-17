import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { posix, win32 } from "node:path";

export type WorkspaceIdentityKind = "git" | "path";

export interface WorkspaceIdentity {
  kind: WorkspaceIdentityKind;
  value: string;
  canonicalPath: string;
}

type PathFlavor = "posix" | "windows";
type PathApi = { parse: (value: string) => { root: string }; resolve: (...values: string[]) => string };

function pathFlavor(value: string): PathFlavor | null {
  if (process.platform === "win32") {
    if (win32.isAbsolute(value)) return "windows";
    if (posix.isAbsolute(value)) return "posix";
  } else {
    if (posix.isAbsolute(value)) return "posix";
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) return "windows";
  }
  return null;
}

function pathApi(flavor: PathFlavor): PathApi { return flavor === "windows" ? win32 : posix; }

function normalizePath(value: string, flavor: PathFlavor): string {
  const api = pathApi(flavor);
  const normalized = flavor === "windows" ? win32.normalize(value).replace(/\\/g, "/") : posix.normalize(value);
  const root = api.parse(normalized).root.replace(/\\/g, "/");
  if (normalized === root || normalized === `${root}/`) return root;
  return normalized.replace(/\/+$/, "");
}

function normalizeIdentityPath(value: string, flavor: PathFlavor): string {
  const normalized = normalizePath(value, flavor);
  return flavor === "windows" ? normalized.toLowerCase() : normalized;
}

function absolutePath(value: string, flavor: PathFlavor): string {
  if (flavor === "windows") return win32.resolve(value).replace(/\\/g, "/");
  return posix.resolve(value);
}

function realPathOrNormalized(input: string, flavor: PathFlavor): string {
  try {
    return normalizePath(realpathSync.native(input), flavor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
    return normalizePath(absolutePath(input, flavor), flavor);
  }
}

function gitFailureMeansNotRepository(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") return true;
  if (typeof error !== "object" || error === null) return false;
  const stderr = "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
  return /not a git repository|outside a repository|cannot change to/i.test(stderr);
}

function gitCommonDirectory(cwd: string, flavor: PathFlavor): string | null {
  let output: string;
  try {
    output = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (gitFailureMeansNotRepository(error)) return null;
    throw error;
  }
  if (!output) return null;
  const api = pathApi(flavor);
  const outputIsAbsolute = flavor === "windows" ? win32.isAbsolute(output) : posix.isAbsolute(output);
  const commonPath = outputIsAbsolute ? output : api.resolve(cwd, output);
  return normalizeIdentityPath(realpathSync.native(commonPath), flavor);
}

export function isWorkspacePathAncestor(ancestor: string, candidate: string): boolean {
  const ancestorFlavor = pathFlavor(ancestor);
  const candidateFlavor = pathFlavor(candidate);
  if (!ancestorFlavor || ancestorFlavor !== candidateFlavor) return false;
  const normalizedAncestor = normalizeIdentityPath(ancestor, ancestorFlavor);
  const normalizedCandidate = normalizeIdentityPath(candidate, candidateFlavor);
  if (normalizedCandidate === normalizedAncestor) return true;
  if (normalizedAncestor === "/" || normalizedAncestor.endsWith("/")) return normalizedCandidate.startsWith(normalizedAncestor);
  return normalizedCandidate.startsWith(`${normalizedAncestor}/`);
}

export function pathFromWorkspaceIdentity(identity: string): string | null {
  return identity.startsWith("path:") ? identity.slice("path:".length) : null;
}

export function resolveWorkspaceIdentity(cwd: string): WorkspaceIdentity {
  const trimmed = cwd.trim();
  if (!trimmed) throw new Error("cwd must not be empty");
  const flavor = pathFlavor(trimmed);
  if (!flavor) throw new Error("cwd must be an absolute path; identity resolution never uses the process cwd");
  const canonicalPath = realPathOrNormalized(trimmed, flavor);
  const commonDir = gitCommonDirectory(canonicalPath, flavor);
  if (commonDir) return { kind: "git", value: `git:${commonDir}`, canonicalPath };
  return { kind: "path", value: `path:${normalizeIdentityPath(canonicalPath, flavor)}`, canonicalPath };
}
