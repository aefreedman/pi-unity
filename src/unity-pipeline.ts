import { realpath } from "node:fs/promises";
import { projectPathsMatch } from "./unity-core";
import { resolveUnityCliCommand, type UnityCliExecResult, type UnityCliExecutor, type UnityCliProjectCapabilities } from "./unity-cli";

/** Public limits are deliberately small enough that connected work cannot create an unbounded agent wait loop. */
export const UNITY_PIPELINE_COMPILE_TIMEOUT_SECONDS = 180;
export const UNITY_PIPELINE_TEST_TIMEOUT_SECONDS = 600;
export const UNITY_PIPELINE_MAX_TIMEOUT_SECONDS = 3600;
export const UNITY_PIPELINE_BACKOFF_SECONDS = Object.freeze([1, 2, 3, 5, 8]);
export const UNITY_PIPELINE_MAX_DIAGNOSTICS = 8;
export const UNITY_PIPELINE_MAX_STACK_CHARS = 600;

export type UnityPipelineCompileRequest = { projectRoot: string; unityVersion: string; timeoutSeconds?: number };
export type UnityPipelineTestRequest = { projectRoot: string; unityVersion: string; testPlatform: "EditMode" | "PlayMode"; testFilter?: string; timeoutSeconds?: number };
export type UnityPipelineProgress = (message: string) => void;
export type UnityPipelineOperationDetails = {
  projectRoot: string;
  operation: "recompile" | "tests";
  terminalState: "up_to_date" | "completed";
  elapsedSeconds: number;
  compilationTriggered?: boolean;
  testPlatform?: "EditMode" | "PlayMode";
  testFilter?: string;
  counts?: { total: number; passed?: number; failed: number; inconclusive?: number };
};
export type UnityPipelineOperationResult = { text: string; details: UnityPipelineOperationDetails };

type RecordValue = Record<string, unknown>;
type ParsedEnvelope = { result: RecordValue; outerSuccess: boolean; malformed?: string };
type NormalizedCompile = { state: "up_to_date" | "triggered" | "compiling" | "completed" | "failed" | "uncertain"; diagnostics: string[]; failed: boolean };
type NormalizedTest = {
  state: "starting" | "running" | "completed" | "failed" | "cancelled" | "uncertain";
  total?: number; passed?: number; failed?: number; inconclusive?: number; failures: string[];
  correlation: Record<string, string>;
};

type PipelineDependencies = {
  execute: UnityCliExecutor;
  inspect: (projectRoot: string, unityVersion: string, signal?: AbortSignal) => Promise<UnityCliProjectCapabilities>;
  canonicalize?: (projectRoot: string) => Promise<string>;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  cliCommand?: string;
};

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}
function string(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return undefined;
}
function field(value: RecordValue, ...names: string[]): unknown {
  for (const [key, item] of Object.entries(value)) if (names.includes(key.toLowerCase())) return item;
  return undefined;
}
function bounded(value: string, limit = UNITY_PIPELINE_MAX_STACK_CHARS): string {
  const oneLine = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine;
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Unity Pipeline operation aborted; its Editor operation may still be running.");
}
async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Unity Pipeline operation aborted; its Editor operation may still be running."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Only package-owned argument arrays are produced; callers cannot select arbitrary Pipeline commands. */
export function createUnityPipelineCommand(projectRoot: string, command: "editor_status" | "recompile" | "recompile_status" | "run_tests" | "test_status", args: string[] = [], options: { timeoutSeconds?: number; cliCommand?: string } = {}) {
  return {
    command: resolveUnityCliCommand({ cliCommand: options.cliCommand }),
    args: ["--format", "json", "--no-banner", "--non-interactive", "command", "--project-path", projectRoot, "--timeout", String(options.timeoutSeconds ?? 12), command, ...args],
  };
}

/** Parses the CLI envelope and its documented object-or-JSON-string data.result form. */
export function parseUnityPipelineEnvelope(output: string): ParsedEnvelope {
  let outer: RecordValue | undefined;
  try { outer = record(JSON.parse(output)); } catch { return { result: {}, outerSuccess: false, malformed: "Unity Pipeline returned malformed JSON." }; }
  if (!outer) return { result: {}, outerSuccess: false, malformed: "Unity Pipeline returned a non-object JSON envelope." };
  const data = record(outer.data);
  const rawResult = data?.result ?? data;
  if (typeof rawResult === "string") {
    try {
      const parsed = record(JSON.parse(rawResult));
      if (!parsed) return { result: {}, outerSuccess: outer.success === true, malformed: "Unity Pipeline returned a non-object nested result." };
      return { result: parsed, outerSuccess: outer.success === true };
    } catch { return { result: {}, outerSuccess: outer.success === true, malformed: "Unity Pipeline returned malformed nested JSON." }; }
  }
  const result = record(rawResult);
  return result ? { result, outerSuccess: outer.success === true } : { result: {}, outerSuccess: outer.success === true, malformed: "Unity Pipeline response omitted data.result." };
}

function walk(value: unknown, visitor: (item: RecordValue) => void, depth = 0): void {
  if (depth > 5) return;
  const item = record(value);
  if (item) {
    visitor(item);
    for (const child of Object.values(item)) walk(child, visitor, depth + 1);
  } else if (Array.isArray(value)) for (const child of value.slice(0, 200)) walk(child, visitor, depth + 1);
}
function statusOf(result: RecordValue): string | undefined {
  const value = field(result, "status", "state", "phase", "result");
  return string(value)?.toLowerCase().replace(/[\s-]+/g, "_");
}
function hasSemanticFailure(result: RecordValue): boolean {
  let failed = field(result, "success") === false || field(result, "failed") === true;
  // `success: false` is failure; `failed: false` is not.
  walk(result, item => { if (field(item, "success") === false || field(item, "failed") === true) failed = true; });
  return failed;
}
function diagnostics(result: RecordValue): string[] {
  const values: string[] = [];
  walk(result, item => {
    for (const key of ["compilererrors", "diagnostics", "errors"]) {
      const raw = field(item, key);
      if (!Array.isArray(raw)) continue;
      for (const entry of raw) {
        const itemEntry = record(entry);
        const message = itemEntry ? string(field(itemEntry, "message", "error", "text")) : string(entry);
        if (message) values.push(bounded(message));
      }
    }
  });
  return [...new Set(values)].slice(0, UNITY_PIPELINE_MAX_DIAGNOSTICS);
}
export function normalizeUnityPipelineCompile(output: string): NormalizedCompile {
  const parsed = parseUnityPipelineEnvelope(output);
  if (parsed.malformed) return { state: "uncertain", diagnostics: [], failed: false };
  const compilerDiagnostics = diagnostics(parsed.result);
  const failed = !parsed.outerSuccess || hasSemanticFailure(parsed.result) || compilerDiagnostics.length > 0;
  const raw = statusOf(parsed.result);
  const state = failed || raw === "failed" || raw === "error" ? "failed" : raw === "up_to_date" || raw === "uptodate" ? "up_to_date"
    : raw === "triggered" ? "triggered" : raw === "compiling" || raw === "running" ? "compiling"
      : raw === "completed" || raw === "complete" || raw === "success" ? "completed" : "uncertain";
  return { state, diagnostics: compilerDiagnostics, failed };
}
function summary(result: RecordValue): RecordValue | undefined {
  let found: RecordValue | undefined;
  walk(result, item => { if (!found && record(field(item, "summary"))) found = record(field(item, "summary")); });
  return found;
}
function testFailures(result: RecordValue): string[] {
  const values: string[] = [];
  walk(result, item => {
    for (const key of ["tests", "results", "testresults"]) {
      const entries = field(item, key);
      if (!Array.isArray(entries)) continue;
      for (const entry of entries.slice(0, 200)) {
        const test = record(entry); if (!test) continue;
        const outcome = string(field(test, "result", "status", "outcome"))?.toLowerCase();
        if (!outcome || /pass|success/.test(outcome)) continue;
        const name = string(field(test, "name", "fullname", "testname")) ?? "Unnamed test";
        const message = string(field(test, "message", "error", "failuremessage"));
        const stack = string(field(test, "stacktrace", "stack", "trace"));
        values.push(bounded(`${name}${message ? `: ${message}` : ""}${stack ? ` (${bounded(stack, UNITY_PIPELINE_MAX_STACK_CHARS)})` : ""}`));
      }
    }
  });
  return [...new Set(values)].slice(0, UNITY_PIPELINE_MAX_DIAGNOSTICS);
}
function normalizedMode(value: string): string {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, "");
  return normalized === "editor" || normalized === "editmode" ? "EditMode" : normalized === "play" || normalized === "playmode" ? "PlayMode" : value;
}
function correlation(result: RecordValue): Record<string, string> {
  const found: Record<string, string> = {};
  walk(result, item => {
    for (const [name, keys] of Object.entries({ mode: ["mode", "testplatform", "platform"], filter: ["filter", "testfilter"], runId: ["runid", "id", "testrunid"], statusPath: ["statuspath", "status_path"] })) {
      if (found[name]) continue;
      const value = string(field(item, ...keys));
      if (value) found[name] = name === "mode" ? normalizedMode(value) : bounded(value, 200);
    }
  });
  return found;
}
export function normalizeUnityPipelineTest(output: string): NormalizedTest {
  const parsed = parseUnityPipelineEnvelope(output);
  if (parsed.malformed) return { state: "uncertain", failures: [], correlation: {} };
  const sum = summary(parsed.result);
  const total = number(field(sum ?? parsed.result, "total"));
  const passed = number(field(sum ?? parsed.result, "passed", "pass"));
  const failedCount = number(field(sum ?? parsed.result, "failed", "fail"));
  const inconclusive = number(field(sum ?? parsed.result, "inconclusive", "skipped"));
  const raw = statusOf(parsed.result);
  const semanticFailed = !parsed.outerSuccess || hasSemanticFailure(parsed.result) || (failedCount ?? 0) > 0;
  const state = semanticFailed || raw === "failed" || raw === "error" ? "failed" : raw === "cancelled" || raw === "canceled" ? "cancelled"
    : raw === "running" ? "running" : raw === "starting" || raw === "queued" ? "starting"
      : raw === "completed" || raw === "complete" || raw === "success" ? "completed" : "uncertain";
  return { state, total, passed, failed: failedCount, inconclusive, failures: testFailures(parsed.result), correlation: correlation(parsed.result) };
}

function lifecycleIsIncompatible(output: string): boolean {
  const parsed = parseUnityPipelineEnvelope(output);
  if (parsed.malformed || !parsed.outerSuccess) throw new Error("Unity Pipeline editor_status evidence is malformed or unavailable; operation not started.");
  const state = statusOf(parsed.result);
  return state === "playmode" || state === "playing" || state === "paused" || field(parsed.result, "isplaying") === true || field(parsed.result, "ispaused") === true;
}
function capabilityError(capabilities: UnityCliProjectCapabilities, required: string[]): string | undefined {
  if (!capabilities.cliAvailable) return "Unity CLI is unavailable; operation not started.";
  if (capabilities.pipelineDiscovery !== "available" || !capabilities.matchingInstances.some(instance => instance.reachable === true)) return "No reachable Pipeline instance exists for the exact Unity project copy; operation not started.";
  if (!capabilities.commandDiscoverySucceeded) return "Pipeline command availability is uncertain; operation not started.";
  const missing = required.filter(command => !capabilities.advertisedCommands.includes(command));
  return missing.length ? `The exact Pipeline copy does not advertise ${missing.join(", ")}; operation not started.` : undefined;
}
function knownPids(capabilities: UnityCliProjectCapabilities): number[] { return capabilities.matchingInstances.flatMap(instance => Number.isInteger(instance.pid) && (instance.pid ?? 0) > 0 ? [instance.pid!] : []).sort((a, b) => a - b); }
function sameIdentity(initial: UnityCliProjectCapabilities, current: UnityCliProjectCapabilities, projectRoot: string): boolean {
  const pathsMatch = current.matchingInstances.some(instance => projectPathsMatch(instance.projectPath, projectRoot));
  const before = knownPids(initial); const after = knownPids(current);
  return pathsMatch && (before.length === 0 || after.length === 0 || before.join(",") === after.join(","));
}
/** Domain reload can temporarily remove the exact-copy Pipeline; a different path or changed known PID is never retried. */
function pollingIdentity(initial: UnityCliProjectCapabilities, current: UnityCliProjectCapabilities, projectRoot: string): "same" | "temporary_disconnect" | "changed" {
  if (current.matchingInstances.some(instance => !projectPathsMatch(instance.projectPath, projectRoot))) return "changed";
  const before = knownPids(initial); const after = knownPids(current);
  if (before.length > 0 && after.length > 0 && before.join(",") !== after.join(",")) return "changed";
  if (current.matchingInstances.length === 0 || current.matchingInstances.every(instance => instance.reachable !== true)) return "temporary_disconnect";
  return sameIdentity(initial, current, projectRoot) ? "same" : "changed";
}
async function inspectWithDeadline(deps: PipelineDependencies, projectRoot: string, unityVersion: string, signal: AbortSignal | undefined, deadline: number, now: () => number, operation: string): Promise<UnityCliProjectCapabilities> {
  throwIfAborted(signal); ensureBeforeDeadline(deadline, now, operation);
  const remaining = deadline - now();
  const controller = new AbortController();
  let deadlineElapsed = false;
  const forwardAbort = () => controller.abort();
  const timer = setTimeout(() => { deadlineElapsed = true; controller.abort(); }, remaining);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const result = await deps.inspect(projectRoot, unityVersion, controller.signal);
    throwIfAborted(signal);
    if (deadlineElapsed) throw timeoutMessage(operation);
    ensureBeforeDeadline(deadline, now, operation);
    return result;
  } catch (error) {
    throwIfAborted(signal);
    if (deadlineElapsed || now() >= deadline) throw timeoutMessage(operation);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

async function executeCommand(deps: PipelineDependencies, projectRoot: string, command: Parameters<typeof createUnityPipelineCommand>[1], args: string[], signal: AbortSignal | undefined, deadline?: number, now: () => number = Date.now): Promise<UnityCliExecResult> {
  throwIfAborted(signal);
  const remaining = deadline === undefined ? 15_000 : deadline - now();
  if (remaining <= 0) throw timeoutMessage(command);
  const request = createUnityPipelineCommand(projectRoot, command, args, { timeoutSeconds: Math.max(1, Math.ceil(Math.min(15_000, remaining) / 1000)), cliCommand: deps.cliCommand });
  const result = await deps.execute(request.command, request.args, { timeout: Math.max(1, Math.min(15_000, remaining)), signal });
  throwIfAborted(signal);
  if (deadline !== undefined) ensureBeforeDeadline(deadline, now, command);
  return result;
}
async function requirePreflight(deps: PipelineDependencies, projectRoot: string, unityVersion: string, commands: string[], signal: AbortSignal | undefined, deadline: number, now: () => number): Promise<UnityCliProjectCapabilities> {
  const capabilities = await inspectWithDeadline(deps, projectRoot, unityVersion, signal, deadline, now, "preflight");
  const error = capabilityError(capabilities, commands); if (error) throw new Error(error);
  const editor = await executeCommand(deps, projectRoot, "editor_status", [], signal, deadline, now);
  if (editor.error) throw new Error("Unity Pipeline editor_status failed; operation not started.");
  if (lifecycleIsIncompatible(editor.stdout)) throw new Error("Unity Editor is in Play Mode or paused; operation not started without lifecycle mutation.");
  const refreshed = await inspectWithDeadline(deps, projectRoot, unityVersion, signal, deadline, now, "preflight");
  if (capabilityError(refreshed, commands) || !sameIdentity(capabilities, refreshed, projectRoot)) throw new Error("Unity Pipeline identity changed before dispatch; operation not started.");
  return refreshed;
}
function checkCorrelation(expected: Record<string, string>, actual: Record<string, string>): boolean {
  return Object.entries(expected).every(([key, value]) => !actual[key] || actual[key] === value);
}
function passingCounts(state: NormalizedTest): { total: number; passed: number; failed: number; inconclusive?: number } | undefined {
  if (state.total === undefined || state.total <= 0 || state.passed === undefined || state.failed !== 0 || (state.inconclusive ?? 0) > 0) return undefined;
  if (state.passed + state.failed + (state.inconclusive ?? 0) !== state.total) return undefined;
  return { total: state.total, passed: state.passed, failed: state.failed, inconclusive: state.inconclusive };
}
function elapsed(start: number, now: () => number): number { return Math.max(0, (now() - start) / 1000); }
function timeoutMessage(operation: string): Error { return new Error(`Unity Pipeline ${operation} timed out; result is uncertain and may still be running. No cancellation, retry, or route switch was performed.`); }
function ensureBeforeDeadline(deadline: number, now: () => number, operation: string): void {
  if (now() >= deadline) throw timeoutMessage(operation);
}

export async function runUnityPipelineRecompile(request: UnityPipelineCompileRequest, deps: PipelineDependencies, options: { signal?: AbortSignal; onUpdate?: UnityPipelineProgress } = {}): Promise<UnityPipelineOperationResult> {
  const now = deps.now ?? Date.now; const sleep = deps.sleep ?? defaultSleep; const signal = options.signal;
  const timeoutSeconds = request.timeoutSeconds ?? UNITY_PIPELINE_COMPILE_TIMEOUT_SECONDS;
  if (timeoutSeconds < 1 || timeoutSeconds > UNITY_PIPELINE_MAX_TIMEOUT_SECONDS) throw new Error(`timeoutSeconds must be between 1 and ${UNITY_PIPELINE_MAX_TIMEOUT_SECONDS}.`);
  const projectRoot = await (deps.canonicalize ?? realpath)(request.projectRoot); const start = now(); const deadline = start + timeoutSeconds * 1000;
  const identity = await requirePreflight(deps, projectRoot, request.unityVersion, ["editor_status", "recompile", "recompile_status"], signal, deadline, now);
  ensureBeforeDeadline(deadline, now, "recompile before dispatch");
  throwIfAborted(signal);
  const dispatched = await executeCommand(deps, projectRoot, "recompile", [], signal, deadline, now);
  if (dispatched.error) throw new Error("Unity Pipeline recompile dispatch failed; operation may not have started.");
  let state = normalizeUnityPipelineCompile(dispatched.stdout);
  if (state.state === "uncertain") throw new Error("Unity Pipeline recompile dispatch returned malformed or uncertain evidence; operation may have started.");
  if (state.state === "failed") throw new Error(`Unity recompile failed: ${state.diagnostics.join("; ") || "compiler failure reported"}`);
  if (state.state === "up_to_date") return { text: `Unity scripts are up to date for ${projectRoot}; no compilation was triggered.`, details: { projectRoot, operation: "recompile", terminalState: "up_to_date", elapsedSeconds: elapsed(start, now), compilationTriggered: false } };
  for (let poll = 0; now() < deadline; poll += 1) {
    options.onUpdate?.(`Unity recompile ${state.state}; ${elapsed(start, now).toFixed(1)}s elapsed.`);
    const delay = Math.min(UNITY_PIPELINE_BACKOFF_SECONDS[Math.min(poll, UNITY_PIPELINE_BACKOFF_SECONDS.length - 1)]! * 1000, deadline - now());
    if (delay <= 0) break;
    await sleep(delay, signal); throwIfAborted(signal); ensureBeforeDeadline(deadline, now, "recompile");
    const current = await inspectWithDeadline(deps, projectRoot, request.unityVersion, signal, deadline, now, "recompile");
    const identityState = pollingIdentity(identity, current, projectRoot);
    if (identityState === "changed") throw new Error("Unity Pipeline identity changed during recompile; operation state is uncertain.");
    if (identityState === "temporary_disconnect") continue;
    const response = await executeCommand(deps, projectRoot, "recompile_status", [], signal, deadline, now);
    if (response.error) continue; // Domain reload can briefly disconnect the same exact copy.
    state = normalizeUnityPipelineCompile(response.stdout);
    if (state.state === "failed") throw new Error(`Unity recompile failed: ${state.diagnostics.join("; ") || "compiler failure reported"}`);
    if (state.state === "completed" || state.state === "up_to_date") return { text: `Unity recompile completed for ${projectRoot} in ${elapsed(start, now).toFixed(1)}s; 0 compiler errors.`, details: { projectRoot, operation: "recompile", terminalState: state.state, elapsedSeconds: elapsed(start, now), compilationTriggered: true } };
    if (state.state === "uncertain") throw new Error("Unity Pipeline recompile status is malformed or uncertain; operation may still be running.");
  }
  throw timeoutMessage("recompile");
}

export async function runUnityPipelineTests(request: UnityPipelineTestRequest, deps: PipelineDependencies, options: { signal?: AbortSignal; onUpdate?: UnityPipelineProgress } = {}): Promise<UnityPipelineOperationResult> {
  const now = deps.now ?? Date.now; const sleep = deps.sleep ?? defaultSleep; const signal = options.signal;
  const timeoutSeconds = request.timeoutSeconds ?? UNITY_PIPELINE_TEST_TIMEOUT_SECONDS;
  if (timeoutSeconds < 1 || timeoutSeconds > UNITY_PIPELINE_MAX_TIMEOUT_SECONDS) throw new Error(`timeoutSeconds must be between 1 and ${UNITY_PIPELINE_MAX_TIMEOUT_SECONDS}.`);
  const projectRoot = await (deps.canonicalize ?? realpath)(request.projectRoot); const start = now(); const deadline = start + timeoutSeconds * 1000;
  const identity = await requirePreflight(deps, projectRoot, request.unityVersion, ["editor_status", "run_tests", "test_status"], signal, deadline, now);
  ensureBeforeDeadline(deadline, now, "tests before dispatch");
  const before = await executeCommand(deps, projectRoot, "test_status", [], signal, deadline, now);
  if (before.error) throw new Error("Unity Pipeline test status is unavailable; test run not started.");
  const existing = normalizeUnityPipelineTest(before.stdout);
  if (existing.state === "starting" || existing.state === "running") throw new Error("A pre-existing connected Unity test run is active; test run not started.");
  if (existing.state === "uncertain") throw new Error("Unity Pipeline test status is uncertain; test run not started.");
  const args = ["--mode", request.testPlatform === "EditMode" ? "editor" : "playmode", ...(request.testFilter ? ["--filter", request.testFilter, "--filter_type", "testName"] : []), "--async_tests", "true"];
  ensureBeforeDeadline(deadline, now, "tests before dispatch"); throwIfAborted(signal);
  const dispatched = await executeCommand(deps, projectRoot, "run_tests", args, signal, deadline, now);
  if (dispatched.error) throw new Error("Unity Pipeline test dispatch failed; test run may not have started.");
  let state = normalizeUnityPipelineTest(dispatched.stdout);
  if (state.state === "uncertain") throw new Error("Unity Pipeline test dispatch returned malformed or uncertain evidence; test run may have started.");
  if (state.state === "failed" || state.state === "cancelled") throw new Error(`Unity ${request.testPlatform} tests failed: ${state.failures.join("; ") || state.state}.`);
  const requestedCorrelation = { mode: request.testPlatform, ...(request.testFilter ? { filter: request.testFilter } : {}) };
  if (!checkCorrelation(requestedCorrelation, state.correlation)) throw new Error("Unity Pipeline test dispatch reported a different mode or filter; operation state is uncertain.");
  const expected = { ...requestedCorrelation, ...state.correlation };
  // Some Pipeline versions return a complete result directly from asynchronous dispatch.
  if (state.state === "completed") {
    const counts = passingCounts(state);
    if (!counts) throw new Error("Unity test result is terminal but lacks passing evidence (consistent positive total, passed count, and reported zero failures).");
    return { text: `Unity ${request.testPlatform} tests passed for ${projectRoot}: ${counts.total} executed, ${counts.passed} passed, 0 failed in ${elapsed(start, now).toFixed(2)}s.`, details: { projectRoot, operation: "tests", terminalState: "completed", elapsedSeconds: elapsed(start, now), testPlatform: request.testPlatform, testFilter: request.testFilter, counts } };
  }
  for (let poll = 0; now() < deadline; poll += 1) {
    options.onUpdate?.(`Unity ${request.testPlatform} tests ${state.state}; ${elapsed(start, now).toFixed(1)}s elapsed.`);
    const delay = Math.min(UNITY_PIPELINE_BACKOFF_SECONDS[Math.min(poll, UNITY_PIPELINE_BACKOFF_SECONDS.length - 1)]! * 1000, deadline - now());
    if (delay <= 0) break;
    await sleep(delay, signal); throwIfAborted(signal); ensureBeforeDeadline(deadline, now, "tests");
    const current = await inspectWithDeadline(deps, projectRoot, request.unityVersion, signal, deadline, now, "tests");
    const identityState = pollingIdentity(identity, current, projectRoot);
    if (identityState === "changed") throw new Error("Unity Pipeline identity changed during tests; operation state is uncertain.");
    if (identityState === "temporary_disconnect") continue;
    const response = await executeCommand(deps, projectRoot, "test_status", [], signal, deadline, now);
    if (response.error) continue;
    state = normalizeUnityPipelineTest(response.stdout);
    if (!checkCorrelation(expected, state.correlation)) throw new Error("Unity Pipeline test status was displaced by a different run; operation state is uncertain.");
    if (state.state === "failed" || state.state === "cancelled") throw new Error(`Unity ${request.testPlatform} tests failed: ${state.failures.join("; ") || state.state}.`);
    if (state.state === "uncertain") throw new Error("Unity Pipeline test status is malformed or uncertain; operation may still be running.");
    if (state.state !== "completed") continue;
    const counts = passingCounts(state);
    if (!counts) throw new Error("Unity test result is terminal but lacks passing evidence (consistent positive total, passed count, and reported zero failures).");
    return { text: `Unity ${request.testPlatform} tests passed for ${projectRoot}: ${counts.total} executed, ${counts.passed} passed, 0 failed in ${elapsed(start, now).toFixed(2)}s.`, details: { projectRoot, operation: "tests", terminalState: "completed", elapsedSeconds: elapsed(start, now), testPlatform: request.testPlatform, testFilter: request.testFilter, counts } };
  }
  throw timeoutMessage("tests");
}
