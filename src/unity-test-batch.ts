import { randomUUID } from "node:crypto";
import * as path from "node:path";

export type UnityTestPlatform = "EditMode" | "PlayMode";

export type UnityTestBatchPlanInput = {
  projectRoot: string;
  testPlatform: UnityTestPlatform;
  testFilters?: string[];
  testCategories?: string[];
  now?: Date;
  token?: string;
  pathApi?: Pick<typeof path, "resolve" | "join" | "isAbsolute" | "relative" | "sep">;
};

export type UnityTestBatchPlan = {
  testPlatform: UnityTestPlatform;
  testFilters: string[];
  testCategories: string[];
  testResultsPath: string;
  logFilePath: string;
  args: string[];
};

function normalizeSelectors(values: string[] | undefined, label: string): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of (values ?? []).entries()) {
    const value = raw.trim();
    if (!value) throw new Error(`${label}[${index}] must not be empty or whitespace-only.`);
    if (/[\0\r\n;]/.test(value)) {
      throw new Error(`${label}[${index}] must not contain NUL, newlines, or semicolons; pass separate selectors as separate array entries.`);
    }
    if (!seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }
  return normalized;
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, "");
}

function safeToken(value: string): string {
  const token = value.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  if (!token) throw new Error("Unity test batch token must contain at least one ASCII letter or digit.");
  return token;
}

export function createUnityTestBatchPlan(input: UnityTestBatchPlanInput): UnityTestBatchPlan {
  const pathApi = input.pathApi ?? path;
  const projectRoot = pathApi.resolve(input.projectRoot);
  const logsRoot = pathApi.join(projectRoot, "Logs");
  const testFilters = normalizeSelectors(input.testFilters, "testFilters");
  const testCategories = normalizeSelectors(input.testCategories, "testCategories");
  const token = safeToken(input.token ?? randomUUID());
  const platformSlug = input.testPlatform.toLowerCase();
  const basename = `unity-tests-${platformSlug}-${safeTimestamp(input.now ?? new Date())}-${token}`;
  const testResultsPath = pathApi.join(logsRoot, `${basename}.xml`);
  const logFilePath = pathApi.join(logsRoot, `${basename}.log`);
  const args = ["-runTests", "-testPlatform", input.testPlatform];
  if (testFilters.length > 0) args.push("-testFilter", testFilters.join(";"));
  if (testCategories.length > 0) args.push("-testCategory", testCategories.join(";"));
  args.push("-testResults", testResultsPath, "-logFile", logFilePath);

  if (!pathApi.isAbsolute(testResultsPath) || !pathApi.isAbsolute(logFilePath)) {
    throw new Error("Unity test batch artifact paths must be absolute.");
  }
  for (const artifactPath of [testResultsPath, logFilePath]) {
    const relative = pathApi.relative(logsRoot, artifactPath);
    if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
      throw new Error("Unity test batch artifact path escaped the project Logs directory.");
    }
  }
  if (args.some((arg) => arg.toLowerCase() === "-quit" || arg.toLowerCase().startsWith("-quit="))) {
    throw new Error("Unity test batch arguments must not contain -quit.");
  }

  return { testPlatform: input.testPlatform, testFilters, testCategories, testResultsPath, logFilePath, args };
}
