import { redactUnityCredentials } from "./unity-redaction";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { hasUnityCommandLineFlag } from "./unity-core";

export type UnityBatchmodeInvocation = {
  isTestRun: boolean;
  usesNoGraphics: boolean;
  testPlatform?: string;
  testFilter?: string;
  testCategory?: string;
  testResultsPath?: string;
  logFilePath?: string;
};

export type UnityFailedTest = {
  name: string;
  message?: string;
  stackTrace?: string;
};

export type UnityParsedTestCase = { name: string; status: string; durationSeconds?: number; message?: string; stackTrace?: string };
export type UnityParsedTestResults = {
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  inconclusive?: number;
  durationSeconds?: number;
  failedTests: UnityFailedTest[];
  /** Complete bounded per-test evidence for normalized artifacts, never routine tool output. */
  tests: UnityParsedTestCase[];
  /** Observed XML record lower bounds, counted before record output is truncated. */
  testRecordCounts?: { total: number; passed: number; failed: number; skipped: number; inconclusive: number; other: number };
};

export type UnityBatchmodeArtifacts = {
  testResultsPath?: string;
  logFilePath?: string;
  testResultsXml?: string;
  logText?: string;
  testResultsBytes?: number;
  logBytes?: number;
  logExcerpt?: string;
  warnings: string[];
};

export function parseUnityBatchmodeInvocation(args: string[]): UnityBatchmodeInvocation {
  const getValue = (flag: string): string | undefined => {
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index];
      if (value === flag) {
        return args[index + 1];
      }
      if (value.startsWith(`${flag}=`)) {
        return value.slice(flag.length + 1);
      }
    }
    return undefined;
  };

  return {
    isTestRun: hasUnityCommandLineFlag(args, "-runTests"),
    usesNoGraphics: hasUnityCommandLineFlag(args, "-nographics"),
    testPlatform: getValue("-testPlatform"),
    testFilter: getValue("-testFilter"),
    testCategory: getValue("-testCategory"),
    testResultsPath: getValue("-testResults"),
    logFilePath: getValue("-logFile"),
  };
}

function decodeXmlText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const withoutCdata = trimmed.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/u, "$1");
  return withoutCdata
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseAttributes(tagSource: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributeRegex = /(\w[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tagSource.matchAll(attributeRegex)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? "";
    attributes[key] = value;
  }
  return attributes;
}

function truncateEvidence(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTestCount(value: string | undefined): number | undefined {
  // Only omission is unknown. Retain invalid supplied counters as NaN so the
  // inspection validator rejects them instead of silently treating them as absent.
  return value === undefined ? undefined : value.trim() ? Number(value) : Number.NaN;
}

export function parseUnityTestResultsXml(xml: string): UnityParsedTestResults | null {
  const testRunMatch = xml.match(/<test-run\b([^>]*)>/i);
  const testRunCloseIndex = xml.search(/<\/test-run\s*>/i);
  if (!testRunMatch || testRunCloseIndex < (testRunMatch.index ?? 0) + testRunMatch[0].length) {
    return null;
  }

  const rootAttributes = parseAttributes(testRunMatch[1] ?? "");
  const failedTests: UnityFailedTest[] = [];
  const tests: UnityParsedTestCase[] = [];
  const testRecordCounts = { total: 0, passed: 0, failed: 0, skipped: 0, inconclusive: 0, other: 0 };

  // Match the self-closing alternative first so it cannot consume the body of
  // the next paired record. Both forms carry authoritative failure evidence.
  const testCaseRegex = /<test-case\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/test-case\s*>)/gi;
  for (const match of xml.matchAll(testCaseRegex)) {
    const attributes = parseAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const result = String(attributes.result ?? attributes.label ?? "").toLowerCase();
    const success = String(attributes.success ?? "").toLowerCase();
    const isFailure = result === "failed" || success === "false";
    const status = isFailure ? "Failed" : attributes.result ?? attributes.label ?? "Unknown";
    const statusKey = isFailure ? "failed" : result === "passed" || result === "success" ? "passed" : result === "skipped" ? "skipped" : result === "inconclusive" ? "inconclusive" : "other";
    testRecordCounts.total++;
    testRecordCounts[statusKey]++;
    const failureMessage = body.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
    const stackTrace = body.match(/<stack-trace[^>]*>([\s\S]*?)<\/stack-trace>/i);
    const name = truncateEvidence(attributes.fullname ?? attributes.name ?? "(unknown test)", 1_000) ?? "(unknown test)";
    if (tests.length < 2_000) tests.push({ name, status, ...(parseOptionalNumber(attributes.duration) === undefined ? {} : { durationSeconds: parseOptionalNumber(attributes.duration) }), ...(truncateEvidence(decodeXmlText(failureMessage?.[1]), 4_000) ? { message: truncateEvidence(decodeXmlText(failureMessage?.[1]), 4_000) } : {}), ...(truncateEvidence(decodeXmlText(stackTrace?.[1]), 8_000) ? { stackTrace: truncateEvidence(decodeXmlText(stackTrace?.[1]), 8_000) } : {}) });
    if (!isFailure) continue;
    if (failedTests.length < 50) failedTests.push({ name, message: truncateEvidence(decodeXmlText(failureMessage?.[1]), 1_000), stackTrace: truncateEvidence(decodeXmlText(stackTrace?.[1]), 4_000) });
  }

  // These are separate counters. Synthesizing skipped from inconclusive makes
  // combined-count validation double-count one observed category.
  const skipped = parseTestCount(rootAttributes.skipped);

  const parsed: UnityParsedTestResults = {
    total: parseTestCount(rootAttributes.total) ?? parseTestCount(rootAttributes.testcasecount),
    passed: parseTestCount(rootAttributes.passed),
    failed: parseTestCount(rootAttributes.failed),
    skipped,
    inconclusive: parseTestCount(rootAttributes.inconclusive),
    durationSeconds: parseOptionalNumber(rootAttributes.duration),
    failedTests,
    tests,
    testRecordCounts,
  };
  if (parsed.total === undefined && parsed.passed === undefined && parsed.failed === undefined && parsed.failedTests.length === 0) {
    return null;
  }
  return parsed;
}

/** Missing counters and omitted/bounded records are unknown, not zero executions.
 * Supplied counters and observed record lower bounds must nevertheless agree.
 * An optional linked summary can fill missing XML counters, not replace them.
 */
export function hasConflictingUnityXmlTestEvidence(
  results: UnityParsedTestResults,
  linkedSummary?: Pick<UnityParsedTestResults, "total" | "passed" | "failed" | "skipped" | "inconclusive">,
): boolean {
  const keys = ["total", "passed", "failed", "skipped", "inconclusive"] as const;
  const counts = Object.fromEntries(keys.map(key => [key, results[key] ?? linkedSummary?.[key]])) as Pick<UnityParsedTestResults, typeof keys[number]>;
  if (keys.some(key => counts[key] !== undefined && (!Number.isSafeInteger(counts[key]) || counts[key]! < 0))) return true;
  const observed = results.testRecordCounts;
  if (keys.some(key => counts[key] !== undefined && (observed?.[key] ?? 0) > counts[key]!)) return true;
  const accounted = keys.slice(1).reduce((sum, key) => sum + Math.max(counts[key] ?? 0, observed?.[key] ?? 0), 0);
  return counts.total !== undefined && accounted > counts.total;
}

function buildArtifactCandidates(cwd: string, projectRoot: string, rawPath: string): string[] {
  if (path.isAbsolute(rawPath)) {
    return [path.normalize(rawPath)];
  }

  const candidates = [
    path.resolve(cwd, rawPath),
    path.resolve(projectRoot, rawPath),
  ].map((value) => path.normalize(value));

  return Array.from(new Set(candidates));
}

async function readFirstExistingText(pathsToTry: string[]): Promise<{ path?: string; text?: string }> {
  for (const candidate of pathsToTry) {
    try {
      const text = await fs.readFile(candidate, "utf8");
      return { path: candidate, text };
    } catch {
      // Try next candidate.
    }
  }
  return {};
}

export async function loadUnityBatchmodeArtifacts(
  cwd: string,
  projectRoot: string,
  invocation: UnityBatchmodeInvocation,
): Promise<UnityBatchmodeArtifacts> {
  const warnings: string[] = [];
  const artifacts: UnityBatchmodeArtifacts = { warnings };

  if (invocation.testResultsPath) {
    const result = await readFirstExistingText(buildArtifactCandidates(cwd, projectRoot, invocation.testResultsPath));
    if (result.path && result.text !== undefined) {
      artifacts.testResultsPath = result.path;
      artifacts.testResultsXml = result.text;
    } else {
      warnings.push(`Unity test results file was not found: ${invocation.testResultsPath}`);
    }
  }

  if (invocation.logFilePath && invocation.logFilePath !== "-") {
    const result = await readFirstExistingText(buildArtifactCandidates(cwd, projectRoot, invocation.logFilePath));
    if (result.path && result.text !== undefined) {
      artifacts.logFilePath = result.path;
      artifacts.logText = result.text;
    } else {
      warnings.push(`Unity log file was not found: ${invocation.logFilePath}`);
    }
  }

  return artifacts;
}

export function summarizeTextForAgent(value: string | undefined, maxLines = 40, maxChars = 4000): string | undefined {
  if (!value) return undefined;
  const trimmed = redactUnityCredentials(value).trim();
  if (!trimmed) return undefined;

  const lines = trimmed.split(/\r?\n/);
  const selected = lines.length > maxLines ? lines.slice(-maxLines) : lines;
  let text = selected.join("\n");
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars);
  }

  const omittedLines = lines.length - selected.length;
  const prefix = omittedLines > 0 ? `[showing last ${selected.length} of ${lines.length} lines]\n` : "";
  return `${prefix}${text}`;
}

export function formatParsedTestResultsForAgent(results: UnityParsedTestResults): string[] {
  const counts: string[] = [];
  if (results.total !== undefined) counts.push(`total=${results.total}`);
  if (results.passed !== undefined) counts.push(`passed=${results.passed}`);
  if (results.failed !== undefined) counts.push(`failed=${results.failed}`);
  if (results.skipped !== undefined) counts.push(`skipped=${results.skipped}`);
  if (results.inconclusive !== undefined) counts.push(`inconclusive=${results.inconclusive}`);
  if (results.durationSeconds !== undefined) counts.push(`duration=${results.durationSeconds}s`);

  const lines = counts.length > 0 ? [`Results: ${counts.join(", ")}`] : [];
  if (results.failedTests.length > 0) {
    lines.push("Failed tests:");
    for (const failed of results.failedTests.slice(0, 8)) {
      lines.push(`- ${failed.name}`);
      if (failed.message) {
        lines.push(`  ${failed.message.split(/\r?\n/)[0]}`);
      }
    }
    if (results.failedTests.length > 8) {
      lines.push(`- ... ${results.failedTests.length - 8} more failed tests`);
    }
  }
  return lines;
}

export type UnityBatchmodeAgentTextInput = {
  displayProjectPath: string;
  unityVersion: string;
  editorPath: string;
  exitCode: number;
  killed: boolean;
  invocation: UnityBatchmodeInvocation;
  artifacts: UnityBatchmodeArtifacts;
  parsedTestResults?: UnityParsedTestResults | null;
  stdout?: string;
  stderr?: string;
  warning?: string;
  singleProcessWarning: string;
};

export function hasKnownPositiveExecutedTestCount(
  parsedTestResults?: UnityParsedTestResults | null,
): boolean {
  return parsedTestResults?.total !== undefined
    && Number.isFinite(parsedTestResults.total)
    && parsedTestResults.total > 0;
}

export function isPassingUnityTestEvidence(
  parsedTestResults?: UnityParsedTestResults | null,
): boolean {
  return hasKnownPositiveExecutedTestCount(parsedTestResults)
    && (parsedTestResults?.failed ?? 0) === 0
    && (parsedTestResults?.failedTests.length ?? 0) === 0;
}

export function deriveUnityArtifactInspectionStatus(
  hasLoadedArtifacts: boolean,
  invocation: UnityBatchmodeInvocation,
  parsedTestResults?: UnityParsedTestResults | null,
): "passed" | "failed" {
  if (!hasLoadedArtifacts) return "failed";
  if (invocation.isTestRun && !isPassingUnityTestEvidence(parsedTestResults)) return "failed";
  return "passed";
}

export function deriveUnityBatchmodeStatus(
  exitCode: number,
  killed: boolean,
  invocation: UnityBatchmodeInvocation,
  parsedTestResults?: UnityParsedTestResults | null,
): "passed" | "failed" | "killed" {
  if (killed) return "killed";
  if (invocation.isTestRun && !isPassingUnityTestEvidence(parsedTestResults)) return "failed";
  if (parsedTestResults && ((parsedTestResults.failed ?? 0) > 0 || parsedTestResults.failedTests.length > 0)) {
    return "failed";
  }
  return exitCode === 0 ? "passed" : "failed";
}

function getOutcomeLabel(input: UnityBatchmodeAgentTextInput): "passed" | "failed" | "killed" {
  return deriveUnityBatchmodeStatus(input.exitCode, input.killed, input.invocation, input.parsedTestResults);
}

function getBatchmodeVariantLabel(invocation: UnityBatchmodeInvocation): "Unity (headless)" | "Unity (graphics)" {
  return invocation.usesNoGraphics ? "Unity (headless)" : "Unity (graphics)";
}

export function buildUnityBatchmodeAgentText(input: UnityBatchmodeAgentTextInput): string {
  const outcome = getOutcomeLabel(input);
  const batchmodeVariant = getBatchmodeVariantLabel(input.invocation);
  const lines = [
    `${batchmodeVariant} ${outcome} for ${input.displayProjectPath} using Unity ${input.unityVersion}.`,
    `Editor: ${input.editorPath}`,
    `Exit code: ${input.exitCode}`,
    `Mode: ${batchmodeVariant}`,
    input.singleProcessWarning,
  ];

  if (input.invocation.isTestRun) {
    lines.push("Run type: Unity Test Framework");
    if (input.invocation.testPlatform) lines.push(`Test platform: ${input.invocation.testPlatform}`);
    if (input.invocation.testFilter) lines.push(`Test filter: ${input.invocation.testFilter}`);
    if (input.invocation.testCategory) lines.push(`Test category: ${input.invocation.testCategory}`);
  }

  if (input.parsedTestResults) {
    lines.push(...formatParsedTestResultsForAgent(input.parsedTestResults));
  }
  if (input.invocation.isTestRun && !hasKnownPositiveExecutedTestCount(input.parsedTestResults)) {
    lines.push(input.parsedTestResults?.total === 0
      ? "Unity reported zero executed tests; this batch is not passing evidence."
      : "Unity did not report a known positive executed-test count; this batch is not passing evidence.");
  }

  if (input.artifacts.testResultsPath) lines.push(`Test results: ${input.artifacts.testResultsPath}`);
  if (input.artifacts.logFilePath) lines.push(`Log file: ${input.artifacts.logFilePath}`);
  for (const artifactWarning of input.artifacts.warnings) lines.push(artifactWarning);
  if (input.invocation.testResultsPath && input.artifacts.testResultsXml && !input.parsedTestResults) {
    lines.push(`Unity test results XML could not be parsed: ${input.artifacts.testResultsPath ?? input.invocation.testResultsPath}`);
  }
  if (input.warning) lines.push(input.warning);

  const preferredOutput = input.parsedTestResults
    ? undefined
    : summarizeTextForAgent(input.stderr) ?? summarizeTextForAgent(input.stdout) ?? summarizeTextForAgent(input.artifacts.logText);

  if (preferredOutput) {
    lines.push("Relevant output:");
    lines.push(preferredOutput);
  }

  return lines.join("\n");
}
