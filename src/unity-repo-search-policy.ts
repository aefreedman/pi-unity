import { access, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type {
  RepoSearchExecutionContextV1,
  RepositoryPolicyRequestV1,
  RepositoryPolicyResultV1,
  RepositoryPolicyV1,
} from "@aefree/pi-repo-search/contracts/v1";

export const UNITY_REPOSITORY_POLICY_ID_V1 = "unity.generated-directories.v1" as const;
export const UNITY_GENERATED_DIRECTORIES = Object.freeze(["Library", "Temp", "Logs", "obj", "Build", "Builds", "UserSettings", ".vs"] as const);
export type UnityRepositoryPolicyOptionsV1 = Readonly<{ includeGenerated?: boolean }>;

export function createUnityRepositoryPolicyV1(): RepositoryPolicyV1 {
  return Object.freeze({
    contractVersion: 1,
    id: UNITY_REPOSITORY_POLICY_ID_V1,
    kind: "repository-search-policy",
    owner: Object.freeze({ packageName: "@aefree/pi-unity", packageVersion: "0.8.3", packageRoot: path.resolve(fileURLToPath(new URL("..", import.meta.url))), registeredBy: "index.ts" }),
    async evaluate(context, request) { return await evaluateUnityRepositoryPolicyV1(context, request); },
  });
}

export async function evaluateUnityRepositoryPolicyV1(
  context: RepoSearchExecutionContextV1,
  request: RepositoryPolicyRequestV1,
): Promise<RepositoryPolicyResultV1> {
  if (context.signal !== request.signal) return { outcome: "error", code: "unity_signal_mismatch", retryable: false };
  if (request.signal.aborted) return { outcome: "unavailable", code: "aborted", retryable: true };
  const options: UnityRepositoryPolicyOptionsV1 = isUnityOptions(request.options) ? request.options ?? {} : {};
  const unityRoots = await discoverUnityRoots(request.workspaceRoot, request.roots, request.signal);
  if (unityRoots.length === 0) return { outcome: "not_applicable" };
  const roots = request.roots.map((searchRoot) => {
    const absoluteSearchRoot = path.resolve(request.workspaceRoot, searchRoot);
    const globs = new Set<string>();
    let generatedRoot = false;
    for (const unityRoot of unityRoots) {
      if (isInside(unityRoot, absoluteSearchRoot)) {
        const first = path.relative(unityRoot, absoluteSearchRoot).split(path.sep).filter(Boolean)[0];
        if (first && UNITY_GENERATED_DIRECTORIES.some((entry) => entry.toLowerCase() === first.toLowerCase())) generatedRoot = true;
      }
      if (!isInside(absoluteSearchRoot, unityRoot)) continue;
      const prefix = normalize(path.relative(absoluteSearchRoot, unityRoot));
      for (const directory of UNITY_GENERATED_DIRECTORIES) globs.add(`!${prefix ? `${prefix}/` : ""}${directory}/**`);
    }
    if (generatedRoot) globs.add("!**");
    return Object.freeze({
      root: searchRoot,
      ...(options.includeGenerated === true ? {} : { excludeGlobs: Object.freeze([...globs].sort()) }),
      disclosures: Object.freeze([options.includeGenerated === true
        ? "Unity generated/cache/output directories explicitly included by unity.generated-directories.v1."
        : generatedRoot
          ? "Search root is inside a Unity generated/cache/output directory and is excluded by unity.generated-directories.v1."
          : "Unity generated/cache/output directories excluded: Library, Temp, Logs, obj, Build, Builds, UserSettings, .vs."]),
    });
  });
  return Object.freeze({ outcome: "applied", roots: Object.freeze(roots) });
}

function isUnityOptions(value: unknown): value is UnityRepositoryPolicyOptionsV1 {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => key === "includeGenerated") && ((value as { includeGenerated?: unknown }).includeGenerated === undefined || typeof (value as { includeGenerated?: unknown }).includeGenerated === "boolean");
}
async function discoverUnityRoots(workspaceRoot: string, searchRoots: readonly string[], signal: AbortSignal): Promise<string[]> {
  const workspace = path.resolve(workspaceRoot);
  const found = new Set<string>();
  for (const rawRoot of searchRoots) {
    if (signal.aborted) return [];
    const root = path.resolve(workspace, rawRoot);
    for (let current = root; isInside(workspace, current); current = path.dirname(current)) {
      if (await isUnityProject(current)) { found.add(current); break; }
      if (current === workspace) break;
    }
    if (!isInside(workspace, root)) continue;
    await discoverBelow(root, found, signal, 0);
  }
  return [...found].sort((left, right) => normalize(left).localeCompare(normalize(right)));
}
async function discoverBelow(root: string, found: Set<string>, signal: AbortSignal, depth: number): Promise<void> {
  if (depth > 8 || signal.aborted || found.size >= 64) return;
  if (await isUnityProject(root)) { found.add(root); return; }
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (signal.aborted || found.size >= 64) return;
    if (!entry.isDirectory() || entry.isSymbolicLink() || UNITY_GENERATED_DIRECTORIES.some((name) => name.toLowerCase() === entry.name.toLowerCase()) || entry.name === ".git" || entry.name === "node_modules") continue;
    await discoverBelow(path.join(root, entry.name), found, signal, depth + 1);
  }
}
async function isUnityProject(root: string): Promise<boolean> { try { await access(path.join(root, "ProjectSettings", "ProjectVersion.txt")); await access(path.join(root, "Assets")); return true; } catch { return false; } }
function normalize(value: string): string { return value.replaceAll("\\", "/"); }
function isInside(parent: string, child: string): boolean { const relative = path.relative(path.resolve(parent), path.resolve(child)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
