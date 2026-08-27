import { strict as assert } from "node:assert";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyUnityCliRetrySummary,
  compactUnityTestSummary,
  defaultUnityTestReportFormats,
  deriveUnityCliEffectiveReportPath,
  determineUnityTestOutcome,
  getUnityTestRouteRequirements,
  normalizeUnityRunTestsRequest,
  normalizeUnityTestResult,
  parseUnityCliRetrySummary,
  resolveUnityCliBackendReportPaths,
  writeNormalizedUnityTestArtifact,
  type NormalizedUnityTestResult,
} from "../src/unity-tests";

const basic = normalizeUnityRunTestsRequest({ testPlatform: "EditMode", testFilters: [" Suite.One ", "Suite.One"] });
assert.deepEqual(basic.testFilters, ["Suite.One"]);
assert.equal(basic.execution, "auto");
assert.deepEqual(defaultUnityTestReportFormats("connected"), ["json"]);
assert.deepEqual(defaultUnityTestReportFormats("isolated"), ["json", "nunit"]);
assert.deepEqual(
  resolveUnityCliBackendReportPaths({ nunit: "C:/game/Logs/results.xml", junit: "C:/game/Logs/results.junit.xml", log: "C:/game/Logs/results.log" }, ["json"]),
  { nunit: "C:/game/Logs/results.xml", junit: undefined, log: "C:/game/Logs/results.log" },
  "JSON-only isolated tests still require native NUnit XML as normalized-result evidence.",
);
assert.deepEqual(
  resolveUnityCliBackendReportPaths({ nunit: "C:/game/Logs/results.xml", junit: "C:/game/Logs/results.junit.xml", log: "C:/game/Logs/results.log" }, ["json", "junit"]),
  { nunit: "C:/game/Logs/results.xml", junit: "C:/game/Logs/results.junit.xml", log: "C:/game/Logs/results.log" },
);
assert.throws(() => normalizeUnityRunTestsRequest({ testPlatform: "EditMode", testFilters: ["bad;filter"] }), /semicolons/);
assert.throws(() => normalizeUnityRunTestsRequest({ testPlatform: "EditMode", retries: -1 }), /non-negative/);
assert.throws(() => normalizeUnityRunTestsRequest({ testPlatform: "EditMode", shard: "1/2", rerunFailed: true }), /cannot be combined/);
assert.equal(deriveUnityCliEffectiveReportPath("C:/Logs/results.xml", { rerunFailed: true }), "C:/Logs/results.rerun.xml");
assert.equal(deriveUnityCliEffectiveReportPath("C:/Logs/results.xml", { shard: "1/4" }), "C:/Logs/results.shard-1-of-4.xml");
assert.throws(() => deriveUnityCliEffectiveReportPath("results.xml", { shard: "bad" }), /N\/M/);

const isolated = normalizeUnityRunTestsRequest({ testPlatform: "PlayMode", testFilters: ["A", "B"], retries: 1, coverage: true, reportFormats: ["nunit", "json", "nunit"] });
assert.deepEqual(isolated.reportFormats, ["nunit", "json"]);
assert.deepEqual(getUnityTestRouteRequirements(isolated).reasons, [
  "multiple test filters require isolated execution", "retries require isolated execution", "coverage requires isolated execution", "requested XML reports require isolated execution",
]);
assert.equal(getUnityTestRouteRequirements(basic).requiresIsolation, false);

assert.equal(determineUnityTestOutcome({ total: 2, passed: 2, failed: 0 }), "passed");
assert.equal(determineUnityTestOutcome({ total: 2, passed: 2, failed: 0, retryResolvedAllFailures: true }), "passed_with_flakes");
assert.equal(determineUnityTestOutcome({ total: 1, passed: 1, failed: 0, timedOut: true }), "timed_out");
assert.equal(determineUnityTestOutcome({ total: 0, passed: 0, failed: 0 }), "uncertain");
assert.equal(determineUnityTestOutcome({ total: 1, passed: 1 }), "uncertain");
assert.equal(determineUnityTestOutcome({ intentionalEmptySelection: true }), "empty_selection");
assert.equal(determineUnityTestOutcome({ failed: 1, runError: true }), "run_error");

const raw: NormalizedUnityTestResult = {
  schemaVersion: 1, source: "pipeline", projectRelativeId: "../private", platform: "EditMode",
  selection: { testFilters: ["Suite.One"], testCategories: [] }, outcome: "tests_failed",
  summary: { total: 1, passed: 0, failed: 1 },
  tests: [{ name: "Suite.One", status: "Failed", message: "x".repeat(4_100), stackTrace: "s".repeat(8_100) }],
  backendArtifacts: { nunit: "C:/private/results.xml", log: "Logs/result.log" },
};
const sanitized = normalizeUnityTestResult(raw);
assert.equal(sanitized.projectRelativeId, undefined);
assert.equal(sanitized.tests[0]!.message!.length, 4_000);
assert.equal(sanitized.tests[0]!.stackTrace!.length, 8_000);
assert.deepEqual(sanitized.backendArtifacts, { log: "Logs/result.log" });
assert.equal(compactUnityTestSummary(sanitized), "Unity EditMode tests failed: 1 failed of 1.");
const retry = parseUnityCliRetrySummary({ requested: 1, attempts: 2, passedFirstAttempt: 1, flaky: [{ test: "Suite.Flaky", attempts: 2 }], failed: [] });
assert(retry);
const reconciled = applyUnityCliRetrySummary({ ...sanitized, summary: { total: 2, passed: 1, failed: 1 }, tests: [{ name: "Suite.One", status: "Passed" }, { name: "Suite.Flaky", status: "Failed", message: "first attempt" }] }, retry);
assert.equal(reconciled.outcome, "passed_with_flakes");
assert.deepEqual(reconciled.summary, { total: 2, passed: 2, failed: 0 });
assert.deepEqual(reconciled.flakyTests, [{ name: "Suite.Flaky", attempts: 2 }]);
assert.equal(reconciled.tests[1]?.status, "Passed");
assert.equal(reconciled.tests[1]?.attempts, 2);
assert.equal(parseUnityCliRetrySummary({ requested: 1, attempts: 2, flaky: "invalid", failed: [] }), null);

const fixtureRoot = new URL("./fixtures/unity-tests/", import.meta.url);
for (const fixture of await readdir(fixtureRoot)) {
  const text = await readFile(new URL(fixture, fixtureRoot), "utf8");
  assert.doesNotMatch(text, /[A-Za-z]:\\|\/Users\/|\/home\//, `${fixture} must remain sanitized.`);
  assert.doesNotThrow(() => JSON.parse(text), `${fixture} must be valid JSON.`);
}

const root = await mkdtemp(path.join(os.tmpdir(), "pi-unity-tests-"));
try {
  const artifact = await writeNormalizedUnityTestArtifact(root, sanitized, { now: new Date("2026-08-26T01:02:03.123Z"), token: "abc-123" });
  assert.equal(artifact, "Logs/pi-unity-tests-editmode-20260826T010203123Z-abc123.json");
  const stored = JSON.parse(await readFile(path.join(root, artifact), "utf8"));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.backendArtifacts.log, "Logs/result.log");
  await assert.rejects(() => writeNormalizedUnityTestArtifact(root, sanitized, { now: new Date("2026-08-26T01:02:03.123Z"), token: "abc-123" }), /overwrite/);
} finally { await rm(root, { recursive: true, force: true }); }

console.log("pi-unity shared Unity test contract tests passed");