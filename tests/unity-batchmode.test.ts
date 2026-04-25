import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildUnityBatchmodeAgentText,
  formatParsedTestResultsForAgent,
  loadUnityBatchmodeArtifacts,
  parseUnityBatchmodeInvocation,
  parseUnityTestResultsXml,
  summarizeTextForAgent,
} from "../src/unity-batchmode.ts";

const invocation = parseUnityBatchmodeInvocation([
  "-batchmode",
  "-projectPath",
  "/repo/game",
  "-runTests",
  "-testPlatform",
  "EditMode",
  "-testFilter",
  "My.Namespace.Tests.PassingTest",
  "-testResults",
  "Logs/results.xml",
  "-logFile",
  "Logs/run.log",
]);
assert.equal(invocation.isTestRun, true);
assert.equal(invocation.usesNoGraphics, false);
assert.equal(invocation.testPlatform, "EditMode");
assert.equal(invocation.testFilter, "My.Namespace.Tests.PassingTest");
assert.equal(invocation.testResultsPath, "Logs/results.xml");
assert.equal(invocation.logFilePath, "Logs/run.log");

const headlessInvocation = parseUnityBatchmodeInvocation([
  "-batchmode",
  "-nographics",
  "-projectPath",
  "/repo/game",
]);
assert.equal(headlessInvocation.usesNoGraphics, true);

const xml = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" testcasecount="2" total="2" passed="2" failed="0" inconclusive="0" skipped="0" duration="1.234">
  <test-suite type="Assembly" name="Assembly-CSharp-Editor-tests.dll" executed="True" result="Passed">
    <test-case id="1" name="PassingTest" fullname="My.Namespace.Tests.PassingTest" result="Passed" />
  </test-suite>
</test-run>`;
const parsed = parseUnityTestResultsXml(xml);
assert(parsed, "Expected Unity test XML to parse.");
assert.equal(parsed?.total, 2);
assert.equal(parsed?.passed, 2);
assert.equal(parsed?.failed, 0);
assert.equal(parsed?.failedTests.length, 0);

const failedXml = `<?xml version="1.0" encoding="utf-8"?>
<test-run total="1" passed="0" failed="1" skipped="0" inconclusive="0">
  <test-case name="FailingTest" fullname="My.Namespace.Tests.FailingTest" result="Failed" success="False">
    <failure>
      <message><![CDATA[Expected true but was false]]></message>
      <stack-trace><![CDATA[line 12]]></stack-trace>
    </failure>
  </test-case>
</test-run>`;
const parsedFailed = parseUnityTestResultsXml(failedXml);
assert(parsedFailed, "Expected failed Unity test XML to parse.");
assert.equal(parsedFailed?.failed, 1);
assert.equal(parsedFailed?.failedTests[0]?.name, "My.Namespace.Tests.FailingTest");
assert.equal(parsedFailed?.failedTests[0]?.message, "Expected true but was false");

const formatted = formatParsedTestResultsForAgent(parsed!);
assert(formatted.some((line) => line.includes("passed=2")), "Expected formatted results summary.");

const excerpt = summarizeTextForAgent(["a", "b", "c", "d"].join("\n"), 2, 100);
assert.equal(excerpt, "[showing last 2 of 4 lines]\nc\nd");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "free-unity-pi-batchmode-"));
try {
  const cwd = path.join(tempRoot, "cwd");
  const projectRoot = path.join(tempRoot, "project");
  fs.mkdirSync(path.join(cwd, "Logs"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "Logs"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "Logs", "results.xml"), xml);
  fs.writeFileSync(path.join(projectRoot, "Logs", "run.log"), "line1\nline2\nline3\n");

  const artifacts = await loadUnityBatchmodeArtifacts(cwd, projectRoot, invocation);
  assert.equal(path.normalize(artifacts.testResultsPath ?? ""), path.normalize(path.join(projectRoot, "Logs", "results.xml")));
  assert.equal(path.normalize(artifacts.logFilePath ?? ""), path.normalize(path.join(projectRoot, "Logs", "run.log")));

  const summaryText = buildUnityBatchmodeAgentText({
    displayProjectPath: "ws1/game",
    unityVersion: "2022.3.18f1",
    editorPath: "/Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity",
    exitCode: 0,
    killed: false,
    invocation,
    artifacts,
    parsedTestResults: parsed,
    stdout: "",
    stderr: "",
    singleProcessWarning: "Unity allows only one process per project folder.",
  });

  assert(summaryText.includes("Unity (graphics) passed for ws1/game"), "Expected passing batchmode summary.");
  assert(summaryText.includes("Mode: Unity (graphics)"), "Expected graphics-mode marker.");
  assert(summaryText.includes("Run type: Unity Test Framework"), "Expected test-run marker.");
  assert(summaryText.includes("Results: total=2, passed=2, failed=0"), "Expected summarized test counts.");
  assert(!summaryText.includes("Relevant output:"), "Expected no raw output section when structured test results exist.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("free-unity-pi unity-batchmode tests passed");
