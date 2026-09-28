import { execFile } from "node:child_process";
import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep, dirname, basename } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isUnityCliTimeout, redactUnityPlanningOutput, resolveUnityCliCommand, summarizeUnityCliText, type UnityCliExecutor, type UnityCliExecResult } from "./unity-cli";

const FORMAT = ["--format", "json", "--no-banner", "--non-interactive"];
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 100;

export type AssetResult = { outcome: "rejected" | "inspected" | "dispatched"; code?: string; message: string; details?: Record<string, unknown> };
/** Integration owns the existing exact-copy launch mutex and busy-state policy. The action MUST
 * execute inside the mutex, after fresh process, native-lock and uncertainty checks. Never
 * clear stale mutexes, close Editors, or dispatch if any check fails. */
export type AssetMutationGuard = (canonicalProjectRoot: string, action: () => Promise<AssetResult>) => Promise<AssetResult>;
export type AssetDependencies = {
  execute?: UnityCliExecutor;
  cliCommand?: string;
  /** Must use index's project candidate resolution; this module independently checks identity. */
  resolveProject?: (requestedPath: string) => Promise<string>;
  withSafeProjectLaunch?: AssetMutationGuard;
};

function reject(code: string, message: string): AssetResult { return { outcome: "rejected", code, message }; }
function diagnostic(value: string): string { return summarizeUnityCliText(redactUnityPlanningOutput(value), 1200, 10); }
function validString(value: string): boolean { return value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value); }
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
const defaultExecute: UnityCliExecutor = (command, args, options) => new Promise(done => {
  execFile(command, args, { timeout: options.timeout, signal: options.signal, windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => done({ stdout, stderr, error: error ?? undefined }));
});
function envelope(result: UnityCliExecResult): { data: Record<string, unknown>; warnings: unknown[] } | AssetResult {
  let payload: unknown;
  if (result.stdout.length > MAX_OUTPUT_BYTES || result.stderr.length > 8192) return reject("asset_output_oversized", "Unity CLI output exceeded the inspection limit; operation state may be uncertain.");
  try { payload = JSON.parse(result.stdout); } catch { /* fail closed */ }
  const obj = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const data = obj?.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data as Record<string, unknown> : null;
  if (result.error || obj?.success !== true || !data || !Array.isArray(obj?.errors) || !Array.isArray(obj?.warnings) || obj.errors.length > 0) {
    const reported = Array.isArray(obj?.errors) ? obj.errors.slice(0, 3).map(item => typeof item === "object" && item !== null && typeof (item as { message?: unknown }).message === "string" ? (item as { message: string }).message : "").join("; ") : "";
    return reject(isUnityCliTimeout(result) ? "asset_timeout" : "asset_cli_failed", `Unity CLI did not provide successful JSON evidence; post-dispatch effects may be uncertain. ${diagnostic(reported || result.stderr || result.error?.message || "")}`);
  }
  return { data, warnings: obj.warnings };
}
async function archive(file: string): Promise<{ path: string; bytes: number } | AssetResult> {
  if (!validString(file) || !/\.unitypackage$/i.test(file)) return reject("asset_file_invalid", "Supply a bounded .unitypackage file path.");
  try {
    const path = await realpath(resolve(file));
    const info = await stat(path);
    if (!info.isFile() || info.size === 0 || info.size > MAX_ARCHIVE_BYTES) throw new Error();
    // Verify gzip signature before any Editor dispatch. CLI inspect performs archive parsing.
    const { open } = await import("node:fs/promises");
    const handle = await open(path, "r");
    try {
      const header = Buffer.alloc(2);
      if ((await handle.read(header, 0, 2, 0)).bytesRead !== 2 || header[0] !== 0x1f || header[1] !== 0x8b) throw new Error();
    } finally { await handle.close(); }
    return { path, bytes: info.size };
  } catch { return reject("asset_file_invalid", "The .unitypackage must be an existing readable gzip archive within the size limit."); }
}
function entries(data: Record<string, unknown>): Record<string, unknown>[] | null {
  if (!Array.isArray(data.entries) || !Number.isSafeInteger(data.count) || (data.count as number) < 0 || !Number.isSafeInteger(data.totalSize) || (data.totalSize as number) < 0 || data.entries.length > MAX_ENTRIES || data.count !== data.entries.length) return null;
  const result: Record<string, unknown>[] = [];
  for (const item of data.entries) {
    if (!item || typeof item !== "object") return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== "string" || !validString(entry.path) || typeof entry.guid !== "string" || !/^[a-f0-9]{32}$/i.test(entry.guid) || !Number.isSafeInteger(entry.size) || (entry.size as number) < 0 || typeof entry.hasPreview !== "boolean") return null;
    result.push({ path: diagnostic(entry.path), guid: entry.guid, size: entry.size, hasPreview: entry.hasPreview });
  }
  return result;
}
async function invoke(args: string[], timeout: number, deps: AssetDependencies, signal?: AbortSignal): Promise<AssetResult | { data: Record<string, unknown>; warnings: unknown[] }> {
  let result: UnityCliExecResult;
  try { result = await (deps.execute ?? defaultExecute)(resolveUnityCliCommand({ cliCommand: deps.cliCommand }), [...FORMAT, "assets", ...args], { timeout, signal }); }
  catch { return reject("asset_cli_failed", "Unity CLI invocation failed; post-dispatch effects may be uncertain."); }
  return envelope(result);
}
export async function inspectUnitypackage(file: string, deps: AssetDependencies = {}, signal?: AbortSignal): Promise<AssetResult> {
  const checked = await archive(file);
  if ("outcome" in checked) return checked;
  const response = await invoke(["inspect", checked.path], 15000, deps, signal);
  if ("outcome" in response) return response;
  const listed = entries(response.data);
  if (!listed) return reject("asset_inspect_malformed", "Inspect returned unsupported or excessive entry evidence; no import was attempted.");
  if (response.warnings.length) return reject("asset_inspect_uncertain", `Inspect reported warnings; archive readability is uncertain: ${diagnostic(JSON.stringify(response.warnings.slice(0, 3)))}`);
  const warnings = response.warnings.slice(0, 5).map(w => diagnostic(typeof w === "object" && w !== null && typeof (w as { message?: unknown }).message === "string" ? (w as { message: string }).message : "Unity CLI warning"));
  return { outcome: "inspected", message: `Archive declares ${listed.length} entries; this does not prove import completion.`, details: { file: checked.path, archiveBytes: checked.bytes, declaredCount: response.data.count, declaredBytes: response.data.totalSize, entries: listed, warnings } };
}
async function project(path: string, deps: AssetDependencies): Promise<string | AssetResult> {
  if (!validString(path) || !isAbsolute(path) || !deps.resolveProject) return reject("asset_project_invalid", "An explicit absolute project path and exact-copy resolver are required.");
  try {
    const canonical = await realpath(path);
    const selected = await realpath(await deps.resolveProject(path));
    if (canonical !== selected || !(await stat(join(canonical, "ProjectSettings", "ProjectVersion.txt"))).isFile()) throw new Error();
    return canonical;
  } catch { return reject("asset_project_invalid", "The explicit exact Unity project copy could not be verified."); }
}
function timeoutSeconds(value: number | undefined): number | null {
  return value === undefined ? 300 : Number.isInteger(value) && value >= 10 && value <= 3600 ? value : null;
}
async function mutate(path: string, timeout: number | undefined, deps: AssetDependencies, prepare: (root: string) => Promise<string[] | AssetResult>, signal?: AbortSignal): Promise<AssetResult> {
  const seconds = timeoutSeconds(timeout);
  if (seconds === null) return reject("asset_timeout_invalid", "Timeout must be 10–3600 seconds.");
  const root = await project(path, deps);
  if (typeof root !== "string") return root;
  if (!deps.withSafeProjectLaunch) return reject("asset_guard_missing", "Exact-project mutex and fail-closed busy preflight are required before asset mutation.");
  let actionCalled = false;
  try {
    return await deps.withSafeProjectLaunch(root, async () => {
      if (actionCalled) return reject("asset_duplicate_dispatch", "Mutation callback was invoked more than once; refusing another dispatch.");
      actionCalled = true;
      if (signal?.aborted) return reject("asset_cancelled", "Operation cancelled before dispatch.");
      const refreshed = await project(path, deps);
      if (typeof refreshed !== "string" || refreshed !== root) return reject("asset_project_changed", "Project identity changed before dispatch.");
      const prepared = await prepare(root);
      if (!Array.isArray(prepared)) return prepared;
      const response = await invoke(prepared, seconds * 1000, deps, signal);
      if ("outcome" in response) return response;
      const warnings = response.warnings.slice(0, 5).map(w => diagnostic(typeof w === "object" && w !== null && typeof (w as { message?: unknown }).message === "string" ? (w as { message: string }).message : "Unity CLI warning"));
      return { outcome: "dispatched", message: "Unity CLI reported success; inspect the project/artifact independently before claiming completed effects.", details: { projectRoot: root, warnings } };
    });
  } catch { return reject("asset_preflight_failed", "Exact-project mutex or busy-state verification failed; dispatch was not confirmed. If dispatch began, effects may be uncertain."); }
}
export async function importUnitypackage(request: { path: string; file: string; timeoutSeconds?: number }, deps: AssetDependencies, signal?: AbortSignal): Promise<AssetResult> {
  return mutate(request.path, request.timeoutSeconds, deps, async root => {
    const checked = await archive(request.file);
    if ("outcome" in checked) return checked;
    const inspection = await inspectUnitypackage(checked.path, deps, signal);
    if (inspection.outcome !== "inspected") return inspection;
    return ["import", checked.path, "--project", root];
  }, signal);
}
export async function exportUnitypackage(request: { path: string; assetPaths: string[]; output: string; includeDependencies?: boolean; timeoutSeconds?: number }, deps: AssetDependencies, signal?: AbortSignal): Promise<AssetResult> {
  return mutate(request.path, request.timeoutSeconds, deps, async root => {
    if (!Array.isArray(request.assetPaths) || request.assetPaths.length < 1 || request.assetPaths.length > 50 || !validString(request.output) || !isAbsolute(request.output) || !/\.unitypackage$/i.test(request.output)) return reject("asset_export_invalid", "Supply 1–50 project-relative assets and an absolute .unitypackage output path.");
    const selected: string[] = [];
    for (const input of request.assetPaths) {
      if (typeof input !== "string" || !validString(input) || input.includes("\\") || isAbsolute(input) || !/^(Assets|Packages)\//.test(input) || input.split("/").some(part => part === "." || part === ".." || !part)) return reject("asset_path_invalid", "Asset paths must be canonical project-relative Assets/ or Packages/ paths.");
      try {
        const resolved = await realpath(join(root, input));
        if (!inside(root, resolved) || relative(root, resolved).split(sep).join("/") !== input || !(await stat(resolved)).isFile() && !(await stat(resolved)).isDirectory()) throw new Error();
      } catch { return reject("asset_path_invalid", "An asset is missing, aliases outside the project, or cannot be verified."); }
      selected.push(input);
    }
    if (new Set(selected).size !== selected.length) return reject("asset_path_invalid", "Duplicate asset paths are not allowed.");
    try {
      // lstat rejects existing files AND symlinks, including dangling links.
      await lstat(request.output);
      return reject("asset_output_collision", "Export output already exists; refusing to overwrite it.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return reject("asset_output_invalid", "Export output cannot be checked safely."); }
    try { if (!(await stat(await realpath(dirname(request.output)))).isDirectory() || !basename(request.output)) throw new Error(); }
    catch { return reject("asset_output_invalid", "Export output parent must be an existing accessible directory."); }
    return ["export", ...selected, "--output", request.output, "--project", root, ...(request.includeDependencies === false ? ["--no-dependencies"] : [])];
  }, signal);
}

const inspectParameters = Type.Object({ file: Type.String({ description: "Existing .unitypackage path" }) });
const importParameters = Type.Object({ path: Type.String({ description: "Explicit absolute Unity project root" }), file: Type.String(), timeoutSeconds: Type.Optional(Type.Number()) });
const exportParameters = Type.Object({ path: Type.String({ description: "Explicit absolute Unity project root" }), assetPaths: Type.Array(Type.String()), output: Type.String(), includeDependencies: Type.Optional(Type.Boolean({ default: true })), timeoutSeconds: Type.Optional(Type.Number()) });
function toolResult(result: AssetResult) { return { content: [{ type: "text" as const, text: result.message }], details: result }; }
/** Registration-ready: integration injects its own exact-project resolver and mutex/preflight guard. */
export function registerUnityAssetPackageTools(pi: ExtensionAPI, deps: AssetDependencies): void {
  pi.registerTool({ name: "unity_inspect_unitypackage", label: "Inspect Unity Package", description: "Read declared entries in a local .unitypackage without launching the Editor. Entries are not evidence of import.", parameters: inspectParameters, execute: async (_id, params, signal) => toolResult(await inspectUnitypackage(params.file, deps, signal)) });
  pi.registerTool({ name: "unity_import_unitypackage", label: "Import Unity Package", description: "Explicitly requested project mutation: import a readable package in batch mode. Refuses busy or uncertain exact-copy projects; never closes an Editor or retries.", parameters: importParameters, execute: async (_id, params, signal) => toolResult(await importUnitypackage(params, deps, signal)) });
  pi.registerTool({ name: "unity_export_unitypackage", label: "Export Unity Package", description: "Explicitly requested project mutation: export existing Assets/Packages paths to a new archive. Refuses busy or uncertain exact-copy projects; never overwrites or retries.", parameters: exportParameters, execute: async (_id, params, signal) => toolResult(await exportUnitypackage(params, deps, signal)) });
}
