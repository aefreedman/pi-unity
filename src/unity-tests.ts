import { randomUUID } from "node:crypto";
import { mkdir, link, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

export const UNITY_TEST_RESULT_SCHEMA_VERSION = 1;
export const UNITY_TEST_MAX_MESSAGE_CHARS = 4_000;
export const UNITY_TEST_MAX_STACK_CHARS = 8_000;
export const UNITY_TEST_MAX_TESTS = 2_000;
export const UNITY_TEST_MAX_ARTIFACT_BYTES = 2_000_000;

export type UnityTestPlatform = "EditMode" | "PlayMode";
export type UnityTestExecution = "auto" | "connected" | "isolated";
export type UnityTestIsolatedLauncher = "auto" | "unity-cli" | "editor-executable";
export type UnityTestReportFormat = "json" | "nunit" | "junit";
export type NormalizedUnityTestOutcome = "passed" | "passed_with_flakes" | "tests_failed" | "empty_selection" | "run_error" | "timed_out" | "cancelled" | "uncertain";
export type UnityTestSource = "pipeline" | "unity-cli" | "editor-executable";

export type UnityRunTestsRequest = {
  path?: string;
  testPlatform: UnityTestPlatform;
  testFilters?: string[];
  testCategories?: string[];
  execution?: UnityTestExecution;
  isolatedLauncher?: UnityTestIsolatedLauncher;
  retries?: number;
  rerunFailed?: boolean;
  shard?: string;
  shardInventoryPath?: string;
  reportFormats?: UnityTestReportFormat[];
  coverage?: boolean;
  coverageOptions?: string;
  useGraphics?: boolean;
  timeoutSeconds?: number;
  closeBlockingUnityProcess?: boolean;
};

export type NormalizedUnityRunTestsRequest = Omit<Required<Pick<UnityRunTestsRequest, "testPlatform" | "execution" | "isolatedLauncher" | "retries" | "rerunFailed" | "coverage" | "useGraphics" | "closeBlockingUnityProcess">>, never> & {
  path?: string;
  testFilters: string[];
  testCategories: string[];
  shard?: string;
  shardInventoryPath?: string;
  reportFormats?: UnityTestReportFormat[];
  coverageOptions?: string;
  timeoutSeconds?: number;
};

export type NormalizedUnityTest = { name: string; status: string; durationSeconds?: number; message?: string; stackTrace?: string; attempts?: number };
export type NormalizedUnityTestResult = {
  schemaVersion: typeof UNITY_TEST_RESULT_SCHEMA_VERSION;
  source: UnityTestSource;
  projectRelativeId?: string;
  platform: UnityTestPlatform;
  selection: { testFilters: string[]; testCategories: string[] };
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  outcome: NormalizedUnityTestOutcome;
  summary: { total?: number; passed?: number; failed?: number; skipped?: number; inconclusive?: number };
  tests: NormalizedUnityTest[];
  flakyTests?: Array<{ name: string; attempts: number }>;
  backendArtifacts?: Record<string, string>;
};

export type UnityTestRouteRequirements = { requiresIsolation: boolean; reasons: string[] };
export type UnityTestOutcomeEvidence = {
  cancelled?: boolean;
  timedOut?: boolean;
  uncertain?: boolean;
  runError?: boolean;
  intentionalEmptySelection?: boolean;
  total?: number;
  passed?: number;
  failed?: number;
  inconclusive?: number;
  retryResolvedAllFailures?: boolean;
};

function selectors(values: string[] | undefined, label: string): string[] {
  const result: string[] = []; const seen = new Set<string>();
  for (const [index, raw] of (values ?? []).entries()) {
    if (typeof raw !== "string") throw new Error(`${label}[${index}] must be a string.`);
    const value = raw.trim();
    if (!value || /[\0\r\n;]/.test(value)) throw new Error(`${label}[${index}] must be non-empty and contain no NUL, newlines, or semicolons.`);
    if (!seen.has(value)) { seen.add(value); result.push(value); }
  }
  return result;
}
function optionalText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || /[\0\r\n]/.test(normalized)) throw new Error(`${label} must be non-empty and contain no NUL or newlines.`);
  return normalized;
}

/** Validates public input without deciding a backend or launching Unity. */
export function normalizeUnityRunTestsRequest(input: UnityRunTestsRequest): NormalizedUnityRunTestsRequest {
  if (input.testPlatform !== "EditMode" && input.testPlatform !== "PlayMode") throw new Error("testPlatform must be EditMode or PlayMode.");
  const execution = input.execution ?? "auto";
  const isolatedLauncher = input.isolatedLauncher ?? "auto";
  if (!["auto", "connected", "isolated"].includes(execution)) throw new Error("execution must be auto, connected, or isolated.");
  if (!["auto", "unity-cli", "editor-executable"].includes(isolatedLauncher)) throw new Error("isolatedLauncher must be auto, unity-cli, or editor-executable.");
  if (!Number.isInteger(input.retries ?? 0) || (input.retries ?? 0) < 0) throw new Error("retries must be a non-negative integer.");
  if (input.timeoutSeconds !== undefined && (!Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds <= 0)) throw new Error("timeoutSeconds must be a positive number.");
  const formats = input.reportFormats?.map(value => value.toLowerCase() as UnityTestReportFormat);
  if (formats && formats.some(value => !["json", "nunit", "junit"].includes(value))) throw new Error("reportFormats may contain only json, nunit, or junit.");
  return {
    path: optionalText(input.path, "path"), testPlatform: input.testPlatform, execution, isolatedLauncher,
    testFilters: selectors(input.testFilters, "testFilters"), testCategories: selectors(input.testCategories, "testCategories"),
    retries: input.retries ?? 0, rerunFailed: input.rerunFailed ?? false, shard: optionalText(input.shard, "shard"),
    shardInventoryPath: optionalText(input.shardInventoryPath, "shardInventoryPath"),
    reportFormats: formats ? [...new Set(formats)] : undefined, coverage: input.coverage ?? false,
    coverageOptions: optionalText(input.coverageOptions, "coverageOptions"), useGraphics: input.useGraphics ?? false,
    timeoutSeconds: input.timeoutSeconds, closeBlockingUnityProcess: input.closeBlockingUnityProcess ?? false,
  };
}

export function defaultUnityTestReportFormats(route: "connected" | "isolated"): UnityTestReportFormat[] {
  return route === "isolated" ? ["json", "nunit"] : ["json"];
}

/** Identifies options Pipeline cannot faithfully perform in one connected run. */
export function getUnityTestRouteRequirements(request: NormalizedUnityRunTestsRequest): UnityTestRouteRequirements {
  const reasons: string[] = [];
  if (request.testFilters.length > 1) reasons.push("multiple test filters require isolated execution");
  if (request.testCategories.length > 1) reasons.push("multiple test categories require isolated execution");
  if (request.testFilters.length > 0 && request.testCategories.length > 0) reasons.push("mixed test filters and categories require isolated execution");
  if (request.retries > 0) reasons.push("retries require isolated execution");
  if (request.rerunFailed) reasons.push("rerunFailed requires isolated execution");
  if (request.shard) reasons.push("sharding requires isolated execution");
  if (request.shardInventoryPath) reasons.push("shardInventoryPath requires isolated execution");
  if (request.coverage || request.coverageOptions) reasons.push("coverage requires isolated execution");
  if ((request.reportFormats ?? []).some(format => format !== "json")) reasons.push("requested XML reports require isolated execution");
  return { requiresIsolation: reasons.length > 0, reasons };
}

/** Applies strict evidence precedence; successful transport alone is deliberately insufficient. */
export function determineUnityTestOutcome(evidence: UnityTestOutcomeEvidence): NormalizedUnityTestOutcome {
  if (evidence.cancelled) return "cancelled";
  if (evidence.timedOut) return "timed_out";
  if (evidence.uncertain) return "uncertain";
  if (evidence.runError) return "run_error";
  if (evidence.intentionalEmptySelection) return "empty_selection";
  if ((evidence.failed ?? 0) > 0) return "tests_failed";
  if (evidence.failed !== 0) return "uncertain";
  const total = evidence.total;
  const passed = evidence.passed;
  if (!Number.isFinite(total) || total! <= 0 || !Number.isFinite(passed) || passed! < total!) return "uncertain";
  if ((evidence.inconclusive ?? 0) > 0) return "uncertain";
  return evidence.retryResolvedAllFailures ? "passed_with_flakes" : "passed";
}

function bound(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  const clean = value.replace(/\0/g, "").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}
function numberOrUndefined(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function projectRelative(value: string): string | undefined {
  const clean = value.replace(/\\/g, "/").replace(/^\.\//, "");
  return !clean || path.isAbsolute(clean) || /^[A-Za-z]:\//.test(clean) || clean.split("/").includes("..") ? undefined : clean;
}

/** Bounds and redacts the durable, backend-neutral evidence shape before serialization. */
export function normalizeUnityTestResult(result: NormalizedUnityTestResult): NormalizedUnityTestResult {
  const tests = result.tests.slice(0, UNITY_TEST_MAX_TESTS).map(test => ({
    name: bound(test.name, 1_000) || "Unnamed test", status: bound(test.status, 100) || "unknown",
    ...(numberOrUndefined(test.durationSeconds) === undefined ? {} : { durationSeconds: numberOrUndefined(test.durationSeconds) }),
    ...(bound(test.message, UNITY_TEST_MAX_MESSAGE_CHARS) ? { message: bound(test.message, UNITY_TEST_MAX_MESSAGE_CHARS) } : {}),
    ...(bound(test.stackTrace, UNITY_TEST_MAX_STACK_CHARS) ? { stackTrace: bound(test.stackTrace, UNITY_TEST_MAX_STACK_CHARS) } : {}),
    ...(Number.isInteger(test.attempts) && test.attempts! > 0 ? { attempts: test.attempts } : {}),
  }));
  const artifacts = Object.fromEntries(Object.entries(result.backendArtifacts ?? {}).flatMap(([key, value]) => {
    const safe = projectRelative(value); return safe ? [[bound(key, 100) || "artifact", safe]] : [];
  }));
  return { ...result, projectRelativeId: result.projectRelativeId ? projectRelative(result.projectRelativeId) : undefined,
    selection: { testFilters: selectors(result.selection.testFilters, "selection.testFilters"), testCategories: selectors(result.selection.testCategories, "selection.testCategories") },
    summary: Object.fromEntries(Object.entries(result.summary).flatMap(([key, value]) => numberOrUndefined(value) === undefined ? [] : [[key, numberOrUndefined(value)!]])),
    tests, ...(result.flakyTests ? { flakyTests: result.flakyTests.slice(0, UNITY_TEST_MAX_TESTS).map(item => ({ name: bound(item.name, 1_000) || "Unnamed test", attempts: Math.max(1, Math.floor(item.attempts)) })) } : {}),
    ...(Object.keys(artifacts).length ? { backendArtifacts: artifacts } : {}),
  };
}

export function compactUnityTestSummary(result: NormalizedUnityTestResult): string {
  const count = result.summary.total ?? result.tests.length;
  switch (result.outcome) {
    case "passed": return `Unity ${result.platform} tests passed: ${count} executed.`;
    case "passed_with_flakes": return `Unity ${result.platform} tests passed with ${result.flakyTests?.length ?? 0} flaky test(s): ${count} executed.`;
    case "empty_selection": return `Unity ${result.platform} test selection was empty; no Editor run was required.`;
    case "tests_failed": return `Unity ${result.platform} tests failed: ${result.summary.failed ?? "unknown"} failed of ${count}.`;
    default: return `Unity ${result.platform} test run ${result.outcome.replace(/_/g, " ")}.`;
  }
}

export async function writeNormalizedUnityTestArtifact(projectRoot: string, result: NormalizedUnityTestResult, options: { now?: Date; token?: string } = {}): Promise<string> {
  const normalized = normalizeUnityTestResult(result);
  const stamp = (options.now ?? new Date()).toISOString().replace(/[-:.]/g, "");
  const token = (options.token ?? randomUUID()).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  if (!token) throw new Error("Artifact token must contain an ASCII letter or digit.");
  const logs = path.join(path.resolve(projectRoot), "Logs");
  const fileName = `pi-unity-tests-${normalized.platform.toLowerCase()}-${stamp}-${token}.json`;
  const destination = path.join(logs, fileName);
  const temporary = path.join(logs, `.${fileName}.${randomUUID()}.tmp`);
  const json = `${JSON.stringify(normalized)}\n`;
  if (Buffer.byteLength(json) > UNITY_TEST_MAX_ARTIFACT_BYTES) throw new Error("Normalized Unity test artifact exceeds its size limit.");
  await mkdir(logs, { recursive: true });
  await writeFile(temporary, json, { encoding: "utf8", flag: "wx" });
  try { await link(temporary, destination); } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Refusing to overwrite an existing normalized Unity test artifact.");
    throw error;
  } finally { await rm(temporary, { force: true }); }
  return path.relative(path.resolve(projectRoot), destination).replace(/\\/g, "/");
}