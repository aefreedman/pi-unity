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

export type UnityParsedTestResults = {
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  inconclusive?: number;
  durationSeconds?: number;
  failedTests: UnityFailedTest[];
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
  const attributeRegex = /(\w[\w:-]*)\s*=\s*"([^"]*)"/g;
  for (const match of tagSource.matchAll(attributeRegex)) {
    const key = match[1];
    const value = match[2] ?? "";
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

export function parseUnityTestResultsXml(xml: string): UnityParsedTestResults | null {
  const testRunMatch = xml.match(/<test-run\b([^>]*)>/i);
  const testRunCloseIndex = xml.search(/<\/test-run\s*>/i);
  if (!testRunMatch || testRunCloseIndex < (testRunMatch.index ?? 0) + testRunMatch[0].length) {
    return null;
  }

  const rootAttributes = parseAttributes(testRunMatch[1] ?? "");
  const failedTests: UnityFailedTest[] = [];

  const testCaseRegex = /<test-case\b([^>]*)>([\s\S]*?)<\/test-case>/gi;
  for (const match of xml.matchAll(testCaseRegex)) {
    const attributes = parseAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const result = String(attributes.result ?? attributes.label ?? "").toLowerCase();
    const success = String(attributes.success ?? "").toLowerCase();
    const isFailure = result === "failed" || success === "false";
    if (!isFailure) continue;

    const failureMessage = body.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
    const stackTrace = body.match(/<stack-trace[^>]*>([\s\S]*?)<\/stack-trace>/i);
    if (failedTests.length < 50) {
      failedTests.push({
        name: truncateEvidence(attributes.fullname ?? attributes.name ?? "(unknown test)", 500) ?? "(unknown test)",
        message: truncateEvidence(decodeXmlText(failureMessage?.[1]), 1_000),
        stackTrace: truncateEvidence(decodeXmlText(stackTrace?.[1]), 4_000),
      });
    }
  }

  const skipped = parseOptionalNumber(rootAttributes.skipped) ?? parseOptionalNumber(rootAttributes.inconclusive);

  const parsed: UnityParsedTestResults = {
    total: parseOptionalNumber(rootAttributes.total) ?? parseOptionalNumber(rootAttributes.testcasecount),
    passed: parseOptionalNumber(rootAttributes.passed),
    failed: parseOptionalNumber(rootAttributes.failed),
    skipped,
    inconclusive: parseOptionalNumber(rootAttributes.inconclusive),
    durationSeconds: parseOptionalNumber(rootAttributes.duration),
    failedTests,
  };
  if (parsed.total === undefined && parsed.passed === undefined && parsed.failed === undefined && parsed.failedTests.length === 0) {
    return null;
  }
  return parsed;
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
  const trimmed = value.trim();
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

export function deriveUnityBatchmodeStatus(
  exitCode: number,
  killed: boolean,
  invocation: UnityBatchmodeInvocation,
  parsedTestResults?: UnityParsedTestResults | null,
): "passed" | "failed" | "killed" {
  if (killed) return "killed";
  if (invocation.isTestRun && invocation.testResultsPath && !parsedTestResults) return "failed";
  if (invocation.isTestRun && parsedTestResults?.total === 0) return "failed";
  if (parsedTestResults && (parsedTestResults.failed ?? parsedTestResults.failedTests.length ?? 0) > 0) {
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
    if (input.parsedTestResults.total === 0) {
      lines.push("Unity reported zero executed tests; this batch is not passing evidence.");
    }
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
