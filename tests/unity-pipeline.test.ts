import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UNITY_PIPELINE_BACKOFF_SECONDS,
  createUnityPipelineCommand,
  normalizeUnityPipelineCompile,
  normalizeUnityPipelineTest,
  parseUnityPipelineEnvelope,
  runUnityPipelineRecompile,
  runUnityPipelineTests,
} from "../src/unity-pipeline";
import type { UnityCliProjectCapabilities } from "../src/unity-cli";

const envelope = (result: unknown, success = true) => JSON.stringify({ success, data: { result } });
const capabilities = (root: string, pid = 42): UnityCliProjectCapabilities => ({
  cliAvailable: true, projectSupportsPipeline: true, pipelinePackageDeclared: true,
  matchingInstances: [{ projectPath: root, pid, reachable: true }],
  advertisedCommands: ["editor_status", "recompile", "recompile_status", "run_tests", "test_status"],
  advertisedCommandCount: 5, advertisedCommandsTruncated: false, commandDiscoveryAttempted: true,
  commandDiscoverySucceeded: true, pipelineDiscovery: "available", commandDiscovery: "available", warnings: [],
});

assert.deepEqual(createUnityPipelineCommand("/Game", "run_tests", ["--mode", "editor"]).args, [
  "--format", "json", "--no-banner", "--non-interactive", "command", "--project-path", "/Game", "--timeout", "12", "run_tests", "--mode", "editor",
]);
assert.deepEqual(UNITY_PIPELINE_BACKOFF_SECONDS, [1, 2, 3, 5, 8]);
assert.equal(normalizeUnityPipelineCompile(envelope({ status: "up_to_date" })).state, "up_to_date");
const failedCompile = normalizeUnityPipelineCompile(envelope({ status: "completed", failed: true, compilerErrors: [{ message: "CS1001" }, { message: "CS1001" }] }));
assert.equal(failedCompile.state, "failed");
assert.deepEqual(failedCompile.diagnostics, ["CS1001"], "Compiler diagnostics must dedupe.");
assert.equal(normalizeUnityPipelineCompile(envelope({ status: "completed", compilerErrors: [{ message: "CS2001" }] })).state, "failed", "Compiler diagnostics contradict compile success even without a failure flag.");
assert.equal(normalizeUnityPipelineCompile(envelope("{not json")).state, "uncertain", "Malformed nested JSON is never success.");
assert.equal(parseUnityPipelineEnvelope(envelope(JSON.stringify({ status: "running" }))).result.status, "running");
assert.equal(normalizeUnityPipelineTest(envelope({ result: "running", Summary: { Total: 0 } })).state, "running", "Starting zero tests is nonterminal.");
const passing33 = normalizeUnityPipelineTest(envelope(JSON.stringify({ status: "completed", summary: { total: 33, passed: 33, failed: 0 }, tests: Array.from({ length: 33 }, (_, i) => ({ name: `Passing.${i}`, result: "Passed" })) })));
assert.equal(passing33.state, "completed");
assert.equal(passing33.total, 33);
assert.deepEqual(passing33.failures, [], "Passing test names must not be retained.");
const twoFailures = normalizeUnityPipelineTest(envelope({ status: "completed", summary: { total: 2, passed: 0, failed: 2 }, tests: [{ name: "A", result: "Failed", message: "nope", stackTrace: "stack" }, { name: "B", result: "Inconclusive", message: "maybe" }] }));
assert.equal(twoFailures.state, "failed");
assert.equal(twoFailures.failures.length, 2);
const boundedFailures = normalizeUnityPipelineTest(envelope({ status: "completed", summary: { total: 20, passed: 0, failed: 20 }, tests: Array.from({ length: 20 }, (_, i) => ({ name: `Failure.${i}`, result: "Failed", message: "x".repeat(1000), stackTrace: "s".repeat(1000) })) }));
assert.equal(boundedFailures.failures.length, 8, "Failed-test diagnostics must remain count-bounded.");
assert(boundedFailures.failures.every(value => value.length <= 600), "Failed-test diagnostics must remain character-bounded.");

const root = await mkdtemp(join(tmpdir(), "pi-unity-pipeline-"));
try {
  let clock = 0;
  const responses = new Map<string, string[]>([
    ["editor_status", [envelope({ status: "idle" })]],
    ["recompile", [envelope({ status: "triggered" })]],
    ["recompile_status", [envelope({ status: "compiling" }), envelope({ status: "completed" })]],
  ]);
  const execute = async (_command: string, args: string[]) => {
    const command = args[args.indexOf("--timeout") + 2]!;
    const queue = responses.get(command) ?? [];
    return { stdout: queue.shift() ?? envelope({ status: "completed" }), stderr: "" };
  };
  const result = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000.1.0f1" }, {
    execute, inspect: async () => capabilities(root), canonicalize: async value => value,
    now: () => clock, sleep: async ms => { clock += ms; },
  });
  assert.match(result.text, /completed/);
  assert.equal(result.details.compilationTriggered, true);

  // A temporary domain-reload disconnect is rediscovered only for the same canonical copy.
  clock = 0; let discovery = 0;
  const recovered = await runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000.1.0f1" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor_status") ? envelope({ status: "idle" }) : args.includes("recompile") && !args.includes("recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "completed" }), stderr: "" }),
    inspect: async () => ++discovery === 3 ? { ...capabilities(root), matchingInstances: [] } : capabilities(root),
    canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  });
  assert.match(recovered.text, /completed/);

  clock = 0;
  const testResponses = new Map<string, string[]>([
    ["editor_status", [envelope({ status: "idle" })]],
    ["test_status", [envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } }), envelope(JSON.stringify({ status: "completed", summary: { total: 21, passed: 21, failed: 0 } }))]],
    ["run_tests", [envelope({ result: "running", Summary: { Total: 0 }, mode: "editor" })]],
  ]);
  const testResult = await runUnityPipelineTests({ projectRoot: root, unityVersion: "6000.1.0f1", testPlatform: "EditMode", testFilter: "Game.Fast" }, {
    execute: async (_command, args) => { const command = args[args.indexOf("--timeout") + 2]!; return { stdout: testResponses.get(command)?.shift() ?? envelope({ status: "completed", summary: { total: 21, passed: 21, failed: 0 } }), stderr: "" }; },
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  });
  assert.match(testResult.text, /21 executed, 21 passed, 0 failed/);
  assert.equal(JSON.stringify(testResult.details).includes("Passing."), false);

  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor_status") ? envelope({ status: "idle" }) : envelope({ status: "running", Summary: { Total: 0 } }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, sleep: async () => {},
  }), /pre-existing connected Unity test run/);

  // Terminal zero or incomplete counts are never promoted to a pass, even when dispatch says completed.
  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor_status") ? envelope({ status: "idle" }) : args.includes("test_status") ? envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } }) : envelope({ status: "completed", summary: { total: 0, passed: 0, failed: 0 } }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, sleep: async () => {},
  }), /lacks passing evidence/);
  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor_status") ? envelope({ status: "idle" }) : args.includes("test_status") ? envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } }) : envelope({ status: "completed", summary: { total: 3 } }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, sleep: async () => {},
  }), /lacks passing evidence/, "Unknown passed/failed counts must not be invented.");

  // Requested mode/filter seed correlation even when dispatch returns no correlation fields.
  let correlationStatusCalls = 0; clock = 0;
  await assert.rejects(() => runUnityPipelineTests({ projectRoot: root, unityVersion: "6000", testPlatform: "EditMode", testFilter: "Game.Fast" }, {
    execute: async (_command, args) => {
      const command = args[args.indexOf("--timeout") + 2]!;
      if (command === "editor_status") return { stdout: envelope({ status: "idle" }), stderr: "" };
      if (command === "run_tests") return { stdout: envelope({ status: "running", Summary: { Total: 0 } }), stderr: "" };
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
      const command = args[args.indexOf("--timeout") + 2]!;
      if (command === "editor_status") return { stdout: envelope({ status: "idle" }), stderr: "" };
      if (command === "test_status") { clock = 1000; return { stdout: envelope({ status: "completed", summary: { total: 1, passed: 1, failed: 0 } }), stderr: "" }; }
      dispatchedTests = true; return { stdout: envelope({ status: "running" }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /timed out/);
  assert.equal(dispatchedTests, false, "Tests must not dispatch after the absolute deadline.");

  clock = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000", timeoutSeconds: 1 }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor_status") ? envelope({ status: "idle" }) : args.includes("recompile") && !args.includes("recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "compiling" }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /timed out/);

  let lifecycleDispatch = false;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => {
      if (args.includes("editor_status")) return { stdout: envelope({ status: "playing" }), stderr: "" };
      lifecycleDispatch = true; return { stdout: envelope({ status: "up_to_date" }), stderr: "" };
    },
    inspect: async () => capabilities(root), canonicalize: async value => value,
  }), /Play Mode or paused/);
  assert.equal(lifecycleDispatch, false, "Incompatible lifecycle state must reject before dispatch.");

  let inspections = 0; clock = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000", timeoutSeconds: 5 }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor_status") ? envelope({ status: "idle" }) : args.includes("recompile") && !args.includes("recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "compiling" }), stderr: "" }),
    inspect: async () => capabilities(root, ++inspections > 2 ? 99 : 42), canonicalize: async value => value, now: () => clock, sleep: async ms => { clock += ms; },
  }), /identity changed/);

  const abort = new AbortController(); abort.abort();
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async () => ({ stdout: envelope({ status: "up_to_date" }), stderr: "" }), inspect: async () => capabilities(root), canonicalize: async value => value,
  }, { signal: abort.signal }), /aborted/);

  const abortDuringDelay = new AbortController(); clock = 0;
  await assert.rejects(() => runUnityPipelineRecompile({ projectRoot: root, unityVersion: "6000" }, {
    execute: async (_command, args) => ({ stdout: args.includes("editor_status") ? envelope({ status: "idle" }) : args.includes("recompile") && !args.includes("recompile_status") ? envelope({ status: "triggered" }) : envelope({ status: "compiling" }), stderr: "" }),
    inspect: async () => capabilities(root), canonicalize: async value => value, now: () => clock,
    sleep: async ms => { clock += ms; abortDuringDelay.abort(); },
  }, { signal: abortDuringDelay.signal }), /aborted.*may still be running/i);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("pi-unity Pipeline parser, polling, identity, and compact-output tests passed");
