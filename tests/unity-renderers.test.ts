import { strict as assert } from "node:assert";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import type { UnityToolDetails } from "../index";
import { renderUnityPipelineCall, renderUnityToolCall, renderUnityToolResult } from "../src/unity-renderers";

initTheme("dark");
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const plain = (component: Text, width = 80) => component.render(width).map(line => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trimEnd()).join("\n");
const base = { projectRoot: "C:/Projects/MyGame", unityVersion: "6000.3.0f1", editorPath: "" };
const testDetails: UnityToolDetails = {
  ...base, mode: "tests", status: "passed", route: "connected", artifactPath: "Logs/run.json",
  testResult: { schemaVersion: 1, source: "pipeline", platform: "EditMode", selection: { testFilters: ["Game.InventoryTests"], testCategories: [] }, outcome: "passed", durationSeconds: 2.4, summary: { total: 21, passed: 21, failed: 0 }, tests: [] },
};
const result = (details: UnityToolDetails) => ({ content: [{ type: "text", text: "Bounded original evidence" }], details });
const components: Text[] = [];
const call = renderUnityToolCall("unity_run_tests", { path: base.projectRoot, testPlatform: "EditMode", testCategories: ["Smoke"] }, theme);
assert.match(plain(call), /EditMode tests[\s\S]*category: Smoke/);
assert(!plain(call).includes("C:/Projects"), "Compact headers show project names, not repeated absolute paths.");
components.push(call);
const passed = renderUnityToolResult(result(testDetails), false, theme);
assert.match(plain(passed), /21 passed · 0 failed · 2.4s · connected/);
assert(!plain(passed).includes("graphics"));
components.push(passed);
for (const outcome of ["tests_failed", "uncertain", "empty_selection", "timed_out", "cancelled", "passed_with_flakes"] as const) {
  const details: UnityToolDetails = { ...testDetails, testResult: { ...testDetails.testResult!, outcome, tests: [{ name: "Game.InventoryTests.Remove", status: "failed", message: "Expected 1 but got 0" }] } };
  const rendered = renderUnityToolResult(result(details), false, theme);
  assert(plain(rendered).includes(outcome.replace(/_/g, " ")));
  assert.match(plain(rendered), /Expected 1 but got 0/);
  assert(!plain(rendered).startsWith("✓"), "Non-passing and flaky outcomes must not get an unqualified success icon.");
  components.push(rendered);
}
const artifacts = renderUnityToolResult(result({ ...base, mode: "artifacts", status: "passed", testOutcome: "tests_failed" }), false, theme);
assert.match(plain(artifacts), /Inspection passed · Tests: tests failed/);
components.push(artifacts);
const mixedStatusDetails: UnityToolDetails = {
  ...testDetails,
  status: "failed",
  testResult: {
    ...testDetails.testResult!,
    outcome: "tests_failed",
    tests: [
      ...Array.from({ length: 8 }, (_, index) => ({ name: `Skipped${index}`, status: "Skipped", message: "not selected" })),
      { name: "RealFailure", status: "Failed", message: "critical diagnostic" },
      { name: "RealError", status: "Error", message: "fatal diagnostic" },
    ],
  },
};
const collapsedMixed = renderUnityToolResult(result(mixedStatusDetails), false, theme);
assert.match(plain(collapsedMixed), /RealFailure: critical diagnostic/);
assert(!plain(collapsedMixed).includes("Skipped0"), "Collapsed output gives failures priority over skipped diagnostics.");
const expandedMixed = renderUnityToolResult(result(mixedStatusDetails), true, theme);
const expandedMixedText = plain(expandedMixed, 240);
assert.match(expandedMixedText, /RealFailure: critical diagnostic[\s\S]*RealError: fatal diagnostic/);
assert.match(expandedMixedText, /Skipped0: not selected/);
assert(!expandedMixedText.includes("Skipped6: not selected"), "Expanded output limits diagnostics after prioritizing failures.");
components.push(collapsedMixed, expandedMixed);
const status = renderUnityToolResult(result({ ...base, mode: "status", status: "passed", projectState: { nativeLockfileExists: true, runningProcessCount: 0, processVerificationIncomplete: false, staleLockSuspected: true } }), false, theme);
assert.match(plain(status), /lock may be stale/);
assert(!plain(status).startsWith("✓"));
components.push(status);
for (const [outcome, expected] of [
  ["completed", "CLI open completed · Editor readiness unverified"],
  ["failed", "CLI open failed or refused"],
  ["timeout", "CLI open timed out · launch uncertain"],
  ["cancelled", "CLI open cancelled · launch uncertain"],
] as const) {
  const details: UnityToolDetails = { ...base, mode: "gui", status: outcome === "completed" ? "passed" : "failed",
    guiLaunch: { command: "unity", args: ["open", base.projectRoot], cliPid: 123,
      outcome, diagnostics: outcome === "failed" ? "PROJECT_UPGRADE_REQUIRED" : "" } };
  for (const expanded of [false, true]) {
    const rendered = renderUnityToolResult({ content: [{ type: "text", text: details.guiLaunch!.diagnostics }], details }, expanded, theme);
    const text = plain(rendered, 240);
    assert(text.includes(expected), `GUI ${outcome} must report the observed CLI outcome.`);
    assert(!text.includes("Editor launched"), "CLI completion is not verified Editor launch.");
    assert(!text.includes("PID 123"), "The CLI PID must not be presented as an Editor PID.");
    assert(text.startsWith(outcome === "completed" ? "✓" : outcome === "failed" ? "✗" : "!"));
    if (expanded && outcome === "failed") assert(text.includes("PROJECT_UPGRADE_REQUIRED"));
    components.push(rendered);
  }
}
const directGui = renderUnityToolResult(result({ ...base, mode: "gui", status: "passed", pid: 456 }), false, theme);
assert.match(plain(directGui), /Editor launched · PID 456/);
components.push(directGui);
const args = { path: base.projectRoot, file: "Assets/Editor/BuildScene.cs", entry: "Main", dryRun: true };
const script = renderUnityPipelineCall("unity_pipeline_run_script", args, theme, {});
assert.match(plain(script), /Run script[\s\S]*BuildScene.cs · Main · compile only/);
assert(!plain(script).includes("recompile"));
components.push(script);
const evalArgs = { code: 'var password = "private value";\nreturn 42;' };
const evalDetails: UnityToolDetails = { ...base, mode: "pipeline_eval", status: "passed", pipelineEval: { outcome: "dispatched", command: "eval", output: '{"answer":42}', truncated: true } };
const expanded = renderUnityToolResult(result(evalDetails), true, theme, { args: evalArgs });
assert.match(plain(expanded), /Project\nC:\/Projects\/MyGame[\s\S]*C#[\s\S]*Result \(truncated\)[\s\S]*"answer": 42/);
assert(!plain(expanded).includes("private value"), "Expanded code must retain redaction.");
assert.match(plain(expanded), /Bounded original evidence/, "Expanded view preserves original bounded evidence.");
components.push(expanded);
const exactOutput = '{"id":9007199254740993,"decimal":1.2300e+5,"negativeZero":-0,"duplicate":"first","duplicate":"second","escaped":"\\u0061\\n"}';
const exactEval = renderUnityToolResult({ content: [{ type: "text", text: `Bounded original evidence\n${exactOutput}` }], details: { ...evalDetails, pipelineEval: { outcome: "dispatched", command: "eval", output: exactOutput, truncated: false } } }, true, theme);
const exactText = plain(exactEval, 240);
assert.match(exactText, /"id": 9007199254740993/);
assert.match(exactText, /"decimal": 1\.2300e\+5/);
assert.match(exactText, /"negativeZero": -0/);
assert.equal((exactText.match(/"duplicate":/g) ?? []).length, 4, "Formatted output and raw evidence retain duplicate JSON keys.");
assert(exactText.includes('"escaped": "\\u0061\\n"'), "Formatting must retain escaped string lexemes.");
assert(exactText.includes(`Evidence\nBounded original evidence\n${exactOutput}`), "Evidence retains the exact original output suffix.");
components.push(exactEval);
const evidence = renderUnityToolResult(result(testDetails), true, theme);
assert.match(plain(evidence), /Artifacts\nLogs\/run.json/);
components.push(evidence);
const partial = renderUnityToolResult({ content: [{ type: "text", text: "Compiling; 1.0s elapsed" }] }, false, theme, {}, true);
assert(!plain(partial).includes("✓"));
const failure = renderUnityToolResult({ content: [{ type: "text", text: "Compiler error CS1002: expected semicolon" }] }, false, theme, { isError: true, lastComponent: partial });
assert.equal(failure, partial);
assert.match(plain(failure), /Compiler error CS1002/);
components.push(failure);
for (const width of [24, 40, 80, 120]) {
  for (const component of components) {
    for (const line of component.render(width)) assert(visibleWidth(line) <= width, `Overflow at width ${width}`);
  }
}
console.log("Unity tool presentation: outcomes, evidence, redaction, progress, and terminal widths passed.");
if (process.argv.includes("--preview")) {
  console.log("\nCollapsed tests\n" + plain(call) + "\n" + plain(passed));
  console.log("\nScript call\n" + plain(script));
  console.log("\nExpanded eval\n" + plain(expanded));
}
