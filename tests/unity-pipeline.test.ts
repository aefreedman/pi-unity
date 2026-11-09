import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UNITY_PIPELINE_BACKOFF_SECONDS,
  createUnityPipelineCommand,
  isUnityPipelineInitialSettlingBusy,
  normalizeUnityPipelineCompile,
  normalizeUnityPipelineTest,
  normalizeUnityScriptChangesWhilePlaying,
  parseUnityPipelineEnvelope,
  runUnityPipelineRecompile,
  runUnityPipelineTests,
  UnityPipelineTerminalTestEvidenceError,
} from "../src/unity-pipeline";
import type { UnityCliProjectCapabilities } from "../src/unity-cli";

const envelope = (result: unknown, success = true) => JSON.stringify({ success, data: { result } });
const capabilities = (root: string, pid = 42): UnityCliProjectCapabilities => ({
  cliAvailable: true, projectSupportsPipeline: true, pipelinePackageDeclared: true,
  matchingInstances: [{ projectPath: root, pid, reachable: true }],
  advertisedCommands: ["editor status", "editor.playmode stop", "script recompile", "script recompile_status", "test run", "test status"],
  advertisedCommandCount: 6, advertisedCommandsTruncated: false, commandDiscoveryAttempted: true,
  commandDiscoverySucceeded: true, pipelineDiscovery: "available", commandDiscovery: "available", warnings: [],
});

assert.deepEqual(createUnityPipelineCommand("/Game", "run_tests", ["--mode", "editor"]).args, [
  "--format", "json", "--no-banner", "--non-interactive", "command", "--project-path", "/Game", "--timeout", "12", "--result-only", "test run", "--mode", "editor",
]);
assert.deepEqual(UNITY_PIPELINE_BACKOFF_SECONDS, [1, 2, 3, 5, 8]);
assert.equal(normalizeUnityPipelineCompile(envelope({ status: "up_to_date" })).state, "up_to_date");
assert.equal(normalizeUnityPipelineCompile(envelope({ status: "up_to_date", compilationFailed: false })).state, "up_to_date", "An explicit false compilationFailed flag remains compatible with older successful payloads.");
assert.equal(normalizeUnityPipelineCompile(envelope({ status: "completed" })).state, "completed", "A missing compilationFailed flag remains compatible with older successful payloads.");
assert.equal(normalizeUnityPipelineCompile(envelope({ status: "completed", compilationFailed: true })).state, "failed", "Pipeline 0.7 compilationFailed overrides a terminal compile status.");
assert.equal(normalizeUnityPipelineCompile(JSON.stringify({ success: true, result: { status: "up_to_date" }, warnings: [{ message: "corrected option" }] })).state, "up_to_date", "Compact 0.6 warnings are not compiler errors.");
const failedCompile = normalizeUnityPipelineCompile(envelope({ status: "completed", failed: true, compilerErrors: [{ message: "CS1001" }, { message: "CS1001" }] }));
assert.equal(failedCompile.state, "failed");
assert.deepEqual(failedCompile.diagnostics, ["CS1001"], "Compiler diagnostics must dedupe.");
assert.equal(normalizeUnityPipelineCompile(envelope({ status: "completed", compilerErrors: [{ message: "CS2001" }] })).state, "failed", "Compiler diagnostics contradict compile success even without a failure flag.");
assert.equal(normalizeUnityPipelineCompile(envelope("{not json")).state, "uncertain", "Malformed nested JSON is never success.");
const settlingBusy = JSON.stringify({ success: false, data: { error: "Server Busy", status: "busy", retryable: true } });
assert.equal(isUnityPipelineInitialSettlingBusy(settlingBusy), false, "Pipeline 0.6 modal busy is indistinguishable from this legacy envelope and must not be retried.");
assert.equal(isUnityPipelineInitialSettlingBusy(JSON.stringify({ success: true, data: { error: "Server Busy", status: "busy", retryable: true } })), false, "A successful outer envelope is never a safe redispatch signal.");
assert.equal(isUnityPipelineInitialSettlingBusy(JSON.stringify({ success: false, data: { result: { error: "Server Busy", status: "busy", retryable: true } } })), false, "A nested busy result is ambiguous and must not be redispatched.");
assert.equal(isUnityPipelineInitialSettlingBusy(JSON.stringify({ success: false, data: { error: "Server Busy", status: "busy", retryable: false } })), false);
assert.equal(isUnityPipelineInitialSettlingBusy(JSON.stringify({ success: false, data: { error: "Server Busy", retryable: true } })), false);
assert.equal(isUnityPipelineInitialSettlingBusy(JSON.stringify({ success: false, data: { status: "busy", retryable: true } })), false);
assert.equal(isUnityPipelineInitialSettlingBusy(JSON.stringify({ success: false, data: { error: "Server Busy", status: "busy" } })), false);
assert.equal(parseUnityPipelineEnvelope(envelope(JSON.stringify({ status: "running" }))).result.status, "running");
assert.equal(normalizeUnityPipelineTest(envelope({ result: "running", Summary: { Total: 0 } })).state, "running", "Starting zero tests is nonterminal.");
assert.equal(normalizeUnityPipelineTest(envelope({ status: "no_tests", message: "No test run in progress" })).state, "inactive", "Pipeline 0.4 no_tests is a safe inactive preflight state.");
assert.equal(normalizeUnityPipelineTest(envelope(JSON.stringify({ status: "no_tests" }))).state, "inactive", "Stringified no_tests is also inactive.");
assert.equal(normalizeUnityPipelineTest(envelope({ status: "idle" })).state, "inactive");
assert.equal(normalizeUnityPipelineTest(envelope({ status: "not_started" })).state, "inactive");
const compilationFlagTest = normalizeUnityPipelineTest(envelope({ status: "completed", compilationFailed: true, summary: { total: 1, passed: 1, failed: 0 } }));
assert.equal(compilationFlagTest.state, "completed", "compilationFailed is compile-only evidence and must not alter test normalization.");
assert.equal(compilationFlagTest.runnerError, false, "compilationFailed must not be interpreted as a test runner failure.");
assert.equal(normalizeUnityScriptChangesWhilePlaying("RecompileAndContinuePlaying"), "recompile_and_continue");
assert.equal(normalizeUnityScriptChangesWhilePlaying("StopPlayingAndRecompile"), "stop_and_recompile");
assert.equal(normalizeUnityScriptChangesWhilePlaying("RecompileAfterFinishedPlaying"), "defer");
assert.equal(normalizeUnityScriptChangesWhilePlaying(0), "recompile_and_continue");
assert.equal(normalizeUnityScriptChangesWhilePlaying(1), "defer");
assert.equal(normalizeUnityScriptChangesWhilePlaying(2), "stop_and_recompile");
assert.equal(normalizeUnityScriptChangesWhilePlaying("future-policy"), "unknown");
const passing33 = normalizeUnityPipelineTest(envelope(JSON.stringify({ status: "completed", summary: { total: 33, passed: 33, failed: 0 }, tests: Array.from({ length: 33 }, (_, i) => ({ name: `Passing.${i}`, result: "Passed" })) })));
assert.equal(passing33.state, "completed");
assert.equal(passing33.total, 33);
assert.equal(passing33.testRecords?.length, 33, "Complete terminal records are retained only for immediate artifact persistence.");
assert.deepEqual(passing33.failures, [], "Passing test names must not be retained.");
for (const status of ["Skipped", "Inconclusive", "Unknown"]) {
  const partial = normalizeUnityPipelineTest(envelope({ status: "completed", summary: { total: 1, passed: 0, failed: 0 }, tests: [{ name: `Synthetic.${status}`, result: status }] }));
  assert.equal(partial.state, "completed", `${status} remains a terminal result, not a fabricated test failure.`);
  assert.equal(partial.testFailureEstablished, false, `${status} is not recognized failed-test evidence.`);
  const active = normalizeUnityPipelineTest(envelope({ status: "running", summary: { total: 2, passed: 0, failed: 0, skipped: 1 }, tests: [{ name: `Synthetic.${status}`, result: status }] }));
  assert.equal(active.state, "running", `${status} partial record never overrides active state.`);
}
const twoFailures = normalizeUnityPipelineTest(envelope({ status: "completed", summary: { total: 2, passed: 0, failed: 2 }, tests: [{ name: "A", result: "Failed", message: "nope", stackTrace: "stack" }, { name: "B", result: "Inconclusive", message: "maybe" }] }));
assert.equal(twoFailures.state, "failed");
assert.equal(twoFailures.failures.length, 2);
assert.deepEqual(twoFailures.testRecords?.map(test => test.name), ["A", "B"], "Failure records retain names for normalized evidence.");
const boundedFailures = normalizeUnityPipelineTest(envelope({ status: "completed", summary: { total: 20, passed: 0, failed: 20 }, tests: Array.from({ length: 20 }, (_, i) => ({ name: `Failure.${i}`, result: "Failed", message: "x".repeat(1000), stackTrace: "s".repeat(1000) })) }));
assert.equal(boundedFailures.failures.length, 8, "Failed-test diagnostics must remain count-bounded.");
assert(boundedFailures.failures.every(value => value.length <= 600), "Failed-test diagnostics must remain character-bounded.");

// Raw --result-only responses derive from Pipeline 0.10 models, not live captures.
assert.equal(normalizeUnityPipelineCompile(JSON.stringify({ status: "up_to_date", message: "No scripts needed recompilation." })).state, "up_to_date");
assert.equal(normalizeUnityPipelineCompile(JSON.stringify({ status: "completed", compilationFailed: true, errors: [] })).state, "failed");
assert.equal(normalizeUnityPipelineTest(JSON.stringify({ success: true, result: "running", summary: { total: 0 }, results: [], mode: "EditMode" })).state, "running", "Raw TestExecutionResponse result is not a transport wrapper");
assert.equal(normalizeUnityPipelineTest(JSON.stringify({ status: "completed", summary: { total: 1, passed: 1, failed: 0 }, results: [{ name: "Fixture.Pass", result: "Passed" }] })).state, "completed");
assert.equal(normalizeUnityPipelineCompile('{}').state, "uncertain");
assert.equal(normalizeUnityPipelineCompile('{"status":"completed"}\n{"status":"completed"}').state, "uncertain");
const nativeCompile = await runUnityPipelineRecompile({ projectRoot: "/fixture/current", unityVersion: "6000" }, {
  canonicalize: async root => root, inspect: async root => capabilities(root),
  execute: async (_command, args) => {
    assert(args.includes("--result-only"));
    return { stdout: JSON.stringify(args.includes("editor status") ? { status: "ready", playMode: "stopped", compiling: false } : { status: "up_to_date" }), stderr: "" };
  },
});
assert.equal(nativeCompile.details.terminalState, "up_to_date");
for (const payload of [{}, { success: true }, { status: "ready" }, { status: "compiling", playMode: "stopped", compiling: true }, { status: "ready", playMode: "stopped", compiling: false, success: false }]) {
  let calls = 0;
  await assert.rejects(runUnityPipelineRecompile({ projectRoot: "/fixture/current", unityVersion: "6000" }, {
    canonicalize: async root => root, inspect: async root => capabilities(root),
    execute: async () => { calls++; return { stdout: JSON.stringify(payload), stderr: "" }; },
  }), /malformed|busy|unavailable/);
  assert.equal(calls, 1, "Invalid raw Editor status cannot authorize compile or lifecycle dispatch");
}
const flatSurface = (root: string): UnityCliProjectCapabilities => ({ ...capabilities(root), advertisedCommands: ["editor_status", "editor_stop", "recompile", "recompile_status", "run_tests", "test_status"] });
const flatCalls: string[][] = [];
const flatTests = await runUnityPipelineTests({ projectRoot: "/fixture/flat", unityVersion: "6000", testPlatform: "EditMode", testFilter: "Fixture.One" }, {
  canonicalize: async root => root, inspect: async root => flatSurface(root),
  execute: async (_command, args) => {
    flatCalls.push(args);
    if (args.includes("editor_status")) return { stdout: envelope({ status: "ready", playMode: "stopped" }), stderr: "" };
    if (args.includes("test_status")) return { stdout: envelope({ status: "no_tests" }), stderr: "" };
    assert(args.includes("run_tests") && args.includes("--filter_type") && args.includes("--async_tests"));
    assert(!args.includes("--async-tests") && !args.includes("test run"));
    return { stdout: envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } }), stderr: "" };
  },
});
assert.equal(flatTests.details.counts?.total, 1);
assert.equal(flatCalls.length, 3, "Existing flat commands remain usable without a project package upgrade");
let changedSurfaceInspections = 0;
let changedSurfaceCalls = 0;
await assert.rejects(runUnityPipelineRecompile({ projectRoot: "/fixture/current", unityVersion: "6000" }, {
  canonicalize: async root => root, inspect: async root => ++changedSurfaceInspections === 1 ? capabilities(root) : flatSurface(root),
  execute: async () => { changedSurfaceCalls++; return { stdout: envelope({ status: "ready", playMode: "stopped" }), stderr: "" }; },
}), /identity changed/);
assert.equal(changedSurfaceCalls, 1, "A changed command surface blocks compile after status preflight");

for (const code of [14, 17, 18, 102]) {
  let calls = 0;
  await assert.rejects(runUnityPipelineRecompile({ projectRoot: "/fixture/current", unityVersion: "6000" }, {
    canonicalize: async root => root, inspect: async root => capabilities(root), execute: async () => {
      calls++;
      return { stdout: '{"status":"ready","playMode":"stopped","compiling":false}', stderr: "", error: Object.assign(new Error("native refusal"), { code }) };
    },
  }), /failed/);
  assert.equal(calls, 1, "Busy/dialog/timeout process exits never pass or retry despite success-shaped output");
}

const root = await mkdtemp(join(tmpdir(), "pi-unity-pipeline-"));
try {
  let clock = 0;
  const responses = new Map<string, string[]>([
    ["editor status", [envelope({ status: "idle" })]],
    ["script recompile", [envelope({ status: "triggered" })]],
    ["script recompile_status", [envelope({ status: "compiling" }), envelope({ status: "completed" })]],
  ]);
  const execute = async (_command: string, args: string[]) => {
    const command = args[args.indexOf("--result-only") + 1]!;
    const queue = responses.get(command) ?? [];
    return { stdout: queue.shift() ?? envelope({ status: "completed" }), stderr: "" };
  };
  const result = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000.1.0f1" }, {
    execute, inspect: async () => capabilities(root), canonicalize: async value => value,
    now: () => clock, sleep: async ms => { clock += ms; },
  });
  assert.match(result.text, /completed/);
  assert.equal(result.details.compilationTriggered, true);

  // Pipeline 0.7's explicit compiler flag must reject an otherwise successful direct response.
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000.1.0f1" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : envelope({ status: "up_to_date", compilationFailed: true }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value,
  }), /Unity recompile failed/);

  // The same flag on a completed poll must never produce a successful compile result.
  clock = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000.1.0f1" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : args.includes("script recompile") && !args.includes("script recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "completed", compilationFailed: true }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value,
    now: () => clock, sleep: async ms => { clock += ms; },
  }), /Unity recompile failed/);

  // A temporary domain-reload disconnect is rediscovered only for the same canonical copy.
  clock = 0; let discovery = 0;
  const recovered = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000.1.0f1" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : args.includes("script recompile") && !args.includes("script recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "completed" }), stderr: "" }),
    inspect: async () => ++discovery === 3 ? { ...capabilities(root), matchingInstances: [] } : capabilities(root),
    canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  });
  assert.match(recovered.text, /completed/);

  // Pipeline 0.6 modal busy and legacy settling envelopes are indistinguishable here;
  // pi-unity must surface the first rejection instead of blindly redispatching.
  let busyRecompileDispatches = 0; clock = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000.1.0f1" }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--result-only") + 1]!;
      if (command === "editor status") return { stdout: envelope({ status: "idle" }), stderr: "" };
      if (command === "script recompile") { busyRecompileDispatches += 1; return { stdout: settlingBusy, stderr: "", error: new Error("503") }; }
      return { stdout: envelope({ status: "completed" }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /dispatch failed/);
  assert.equal(busyRecompileDispatches, 1, "Ambiguous busy must not duplicate a main-thread dispatch.");

  // A successful or nested busy triple is ambiguous and must never cause a redispatch.
  let ambiguousBusyDispatches = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--result-only") + 1]!;
      if (command === "editor status") return { stdout: envelope({ status: "idle" }), stderr: "" };
      ambiguousBusyDispatches += 1;
      return { stdout: JSON.stringify({ success: true, data: { result: { error: "Server Busy", status: "busy", retryable: true } } }), stderr: "", error: new Error("ambiguous response") };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value,
  }), /dispatch failed/);
  assert.equal(ambiguousBusyDispatches, 1, "An ambiguous busy response must not duplicate a main-thread dispatch.");

  clock = 0;
  const testResponses = new Map<string, string[]>([
    ["editor status", [envelope({ status: "idle" })]],
    ["test status", [envelope(JSON.stringify({ status: "no_tests", message: "No test run in progress" })), envelope(JSON.stringify({ status: "completed", summary: { total: 21, passed: 21, failed: 0 } }))]],
    ["test run", [envelope({ result: "running", Summary: { Total: 0 }, Mode: "EditMode", FilterApplied: "testname: Game.Fast", StatusPath: "Temp/pipeline_test_status.json" })]],
  ]);
  const testResult = await runUnityPipelineTests({ projectRoot: root, unityVersion: "6000.1.0f1", testPlatform: "EditMode", testFilter: "Game.Fast" }, {
    execute: async (_command, args) => { const command = args[args.indexOf("--result-only") + 1]!; return { stdout: testResponses.get(command)?.shift() ?? envelope({ status: "completed", summary: { total: 21, passed: 21, failed: 0 } }), stderr: "" }; },
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  });
  assert.match(testResult.text, /21 executed, 21 passed, 0 failed/);
  assert.equal(JSON.stringify(testResult.details).includes("Passing."), false);

  let busyTestDispatches = 0; clock = 0;
  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000.1.0f1", testPlatform: "EditMode" }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--result-only") + 1]!;
      if (command === "editor status") return { stdout: envelope({ status: "idle" }), stderr: "" };
      if (command === "test status") return { stdout: envelope({ status: "no_tests" }), stderr: "" };
      busyTestDispatches += 1; return { stdout: settlingBusy, stderr: "", error: new Error("503") };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /dispatch failed/);
  assert.equal(busyTestDispatches, 1, "Tests do not blindly redispatch modal/ambiguous busy responses.");

  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : envelope({ status: "running", Summary: { Total: 0 } }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, sleep: async () => {},
  }), /pre-existing connected Unity test run/);

  // Terminal zero or incomplete counts are never promoted to a pass, even when dispatch says completed.
  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : args.includes("test status") ? envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } }) : envelope({ status: "completed", summary: { total: 0, passed: 0, failed: 0 } }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, sleep: async () => {},
  }), /lacks passing evidence/);
  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : args.includes("test status") ? envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } }) : envelope({ status: "completed", summary: { total: 3 } }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, sleep: async () => {},
  }), /lacks passing evidence/, "Unknown passed/failed counts must not be invented.");

  // Requested mode/filter seed correlation even when dispatch returns no correlation fields.
  let correlationStatusCalls = 0; clock = 0;
  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode", testFilter: "Game.Fast" }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--result-only") + 1]!;
      if (command === "editor status") return { stdout: envelope({ status: "idle" }), stderr: "" };
      if (command === "test run") return { stdout: envelope({ status: "running", Summary: { Total: 0 } }), stderr: "" };
      correlationStatusCalls += 1;
      return { stdout: correlationStatusCalls === 1
        ? envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } })
        : envelope({ status: "completed", mode: "playmode", filter: "Other.Test", summary: { total: 1, passed: 1, failed: 0 } }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /displaced by a different run/);

  // The absolute deadline prevents a late dispatch and bounds nonterminal polling.
  let dispatchedTests = false; clock = 0;
  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode", timeoutSeconds: 1 }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--result-only") + 1]!;
      if (command === "editor status") return { stdout: envelope({ status: "idle" }), stderr: "" };
      if (command === "test status") { clock = 1000; return { stdout: envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } }), stderr: "" }; }
      dispatchedTests = true; return { stdout: envelope({ status: "running" }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /timed out/);
  assert.equal(dispatchedTests, false, "Tests must not dispatch after the absolute deadline.");

  clock = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000", timeoutSeconds: 1 }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : args.includes("script recompile") && !args.includes("script recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "compiling" }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /timed out/);

  let lifecycleDispatch = false;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000", allowAutonomousExitPlayMode: false }, {
    execute: async (_command, args) => {
      if (args.includes("editor status")) return { stdout: envelope({ status: "playing" }), stderr: "" };
      lifecycleDispatch = true; return { stdout: envelope({ status: "up_to_date" }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value,
  }), /Play Mode exit is disabled/);
  assert.equal(lifecycleDispatch, false, "An explicit lifecycle restriction must reject before dispatch.");

  const lifecycleCommands: string[] = []; clock = 0;
  const unknownPolicyRecompile = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--result-only") + 1]!; lifecycleCommands.push(command);
      if (command === "editor status") return { stdout: envelope({ status: "ready", playMode: "playing" }), stderr: "" };
      return { stdout: envelope({ status: "up_to_date" }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  });
  assert.equal(lifecycleCommands.filter(command => command === "editor.playmode stop").length, 0, "Recompile never preemptively sends editor_stop when policy is unavailable.");
  assert.equal(unknownPolicyRecompile.details.exitedPlayMode, false);
  assert.equal(unknownPolicyRecompile.details.playModeHandling, "policy_unknown");
  assert.equal(unknownPolicyRecompile.details.scriptChangesWhilePlaying, "unknown");

  const policyCommands: string[] = [];
  const policyRecompile = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--result-only") + 1]!; policyCommands.push(command);
      if (command === "editor status") return { stdout: envelope({ status: "playing", scriptChangesWhilePlaying: "RecompileAndContinuePlaying" }), stderr: "" };
      return { stdout: envelope({ status: "up_to_date" }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value,
  });
  assert.equal(policyCommands.includes("editor.playmode stop"), false, "Continue-playing policy must not require exit authorization or editor_stop.");
  assert.equal(policyRecompile.details.playModeHandling, "unity_policy_continue");
  assert.match(policyRecompile.text, /did not send editor_stop/);

  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000", allowAutonomousExitPlayMode: false }, {
    execute: async (_command, args) => args.includes("editor status")
      ? { stdout: envelope({ status: "playing", scriptChangesWhilePlaying: "StopPlayingAndRecompile" }), stderr: "" }
      : { stdout: envelope({ status: "up_to_date" }), stderr: "" },
    inspect: async () => capabilities(root), canonicalize: async value => value,
  }), /policy may stop Play Mode.*disabled/);

  const stopPolicyCommands: string[] = [];
  const stopPolicyRecompile = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000", allowAutonomousExitPlayMode: true }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--result-only") + 1]!; stopPolicyCommands.push(command);
      return { stdout: command === "editor status"
        ? envelope({ status: "playing", scriptChangesWhilePlaying: "StopPlayingAndRecompile" })
        : envelope({ status: "up_to_date" }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value,
  });
  assert.equal(stopPolicyCommands.includes("editor.playmode stop"), false, "Authorized stop-and-recompile still leaves Play Mode exit to Unity's policy.");
  assert.equal(stopPolicyRecompile.details.playModeHandling, "unity_policy_may_exit");

  const deferredRecompile = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => args.includes("editor status")
      ? { stdout: envelope({ status: "playing", scriptChangesWhilePlaying: "RecompileAfterFinishedPlaying" }), stderr: "" }
      : { stdout: envelope({ status: "up_to_date" }), stderr: "" },
    inspect: async () => capabilities(root), canonicalize: async value => value,
  });
  assert.equal(deferredRecompile.details.playModeHandling, "unity_policy_defer");

  let inspections = 0; clock = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000", timeoutSeconds: 5 }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : args.includes("script recompile") && !args.includes("script recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "compiling" }), stderr: "" }),
    inspect: async () => capabilities(root, ++inspections > 2 ? 99 : 42), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /identity changed/);

  let dispatchAttempts = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => {
      if (args.includes("editor status")) return { stdout: envelope({ status: "idle" }), stderr: "" };
      dispatchAttempts += 1;
      return { stdout: JSON.stringify({ success: false, data: { error: "Pipeline 0.6.0-exp.1 or newer is required" } }), stderr: "", error: new Error("native failure") };
    }, inspect: async () => capabilities(root), canonicalize: async value => value,
  }), /0\.6\.0-exp\.1 or newer/);
  assert.equal(dispatchAttempts, 1, "Native required-version diagnostics do not cause redispatch.");

  const warningRecompile = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => args.includes("editor status") ? { stdout: envelope({ status: "idle" }), stderr: "" } : { stdout: JSON.stringify({ success: true, warnings: [{ message: "nonfatal guidance" }], result: { status: "up_to_date" } }), stderr: "" },
    inspect: async () => capabilities(root), canonicalize: async value => value,
  });
  assert.equal(warningRecompile.details.terminalState, "up_to_date");
  assert.deepEqual(warningRecompile.details.warnings, ["nonfatal guidance"]);
  assert.match(warningRecompile.text, /nonfatal guidance/);

  let modalDispatches = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => {
      if (args.includes("editor status")) return { stdout: envelope({ status: "idle" }), stderr: "" };
      modalDispatches++;
      return { stdout: JSON.stringify({ success: false, data: { error: "Server Busy", errorDetails: "A modal dialog is blocking commands" } }), stderr: "", error: new Error("native failure") };
    }, inspect: async () => capabilities(root), canonicalize: async value => value,
  }), /Server Busy; A modal dialog is blocking commands/);
  assert.equal(modalDispatches, 1);

  let warningClock = 0;
  const polledWarnings = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => {
      if (args.includes("editor status")) return { stdout: envelope({ status: "idle" }), stderr: "" };
      return { stdout: JSON.stringify({ success: true, data: { warnings: [args.includes("script recompile_status") ? "poll warning" : "dispatch warning"], result: { status: args.includes("script recompile_status") ? "completed" : "triggered" } } }), stderr: "" };
    }, inspect: async () => capabilities(root), canonicalize: async value => value,
    now: () => warningClock, sleep: async ms => { warningClock += ms; },
  });
  assert.deepEqual(polledWarnings.details.warnings, ["dispatch warning", "poll warning"]);
  assert.match(polledWarnings.text, /dispatch warning; poll warning/);

  const warningTests = await runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode" }, {
    execute: async (_command, args) => {
      if (args.includes("editor status")) return { stdout: envelope({ status: "idle" }), stderr: "" };
      if (args.includes("test status")) return { stdout: envelope({ status: "idle" }), stderr: "" };
      return { stdout: JSON.stringify({ success: true, data: { warnings: ["test guidance"], result: { status: "completed", summary: { total: 2, passed: 2, failed: 0 } } } }), stderr: "" };
    }, inspect: async () => capabilities(root), canonicalize: async value => value,
  });
  assert.equal(warningTests.details.counts?.passed, 2);
  assert.deepEqual(warningTests.details.warnings, ["test guidance"]);
  assert.match(warningTests.text, /test guidance/);

  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async () => { throw new Error("must not dispatch after incomplete discovery"); },
    inspect: async () => ({ ...capabilities(root), commandDiscoverySucceeded: false, commandDiscovery: "unavailable", warnings: ["Requires Pipeline 0.6.0-exp.1; token=secret"] }),
    canonicalize: async value => value,
  }), /Requires Pipeline 0\.6\.0-exp\.1; token= \[redacted\]/);

  // Terminal evidence is returned to the connected wrapper rather than being discarded
  // before it can create a durable non-passing artifact.
  for (const summary of [
    { total: 0, passed: 0, failed: 0 },
    { total: 1.5, passed: 1.5, failed: 0 },
    { total: 1, passed: 1, failed: -1 },
  ]) {
    await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode" }, {
      execute: async (_command, args) => args.includes("editor status") ? { stdout: envelope({ status: "idle" }), stderr: "" }
        : args.includes("test status") ? { stdout: envelope({ status: "no_tests" }), stderr: "" }
          : { stdout: envelope({ status: "completed", summary }), stderr: "" },
      inspect: async () => capabilities(root), canonicalize: async value => value,
    }), (error: unknown) => error instanceof UnityPipelineTerminalTestEvidenceError
      && error.evidence.state === "completed"
      && (summary.total === 0 ? error.evidence.counts?.total === 0 : error.evidence.counts === undefined)
      && error.evidence.observations.some(value => value.includes("reported total=")));
  }

  const abort = new AbortController(); abort.abort();
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async () => ({ stdout: envelope({ status: "up_to_date" }), stderr: "" }), inspect: async () => capabilities(root), canonicalize: async value => value,
  }, { signal: abort.signal }), /aborted/);

  const abortDuringDelay = new AbortController(); clock = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor status") ? envelope({ status: "idle" }) : args.includes("script recompile") && !args.includes("script recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "compiling" }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock,
    sleep: async ms => { clock += ms; abortDuringDelay.abort(); },
  }, { signal: abortDuringDelay.signal }), /aborted.*may still be running/i);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("pi-unity Pipeline parser, polling, identity, and compact-output tests passed");
