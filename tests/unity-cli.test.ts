import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUnityCliBatchmodeReportArgs,
  createUnityCliEditorExitCommand,
  createUnityCliOpenCommand,
  createUnityCliRunCommand,
  createUnityCliTestCommand,
  dispatchUnityPlanningInspection,
  dispatchUnityPipelineRunScript,
  haveSameKnownProcessIds,
  inspectUnityCliProjectCapabilities,
  isUnityCliTimeout,
  listRunningUnityCliEditorsForProject,
  normalizeUnityCliForwardedArgs,
  parseUnityCliCommandListOutput,
  parseUnityCliPipelineListOutput,
  parseUnityCliStatusOutput,
  readDeclaredUnityPipelineVersion,
  redactUnityPlanningOutput,
  resolveUnityCliCommand,
  summarizeUnityCliText,
  UNITY_PLANNING_READ_COMMANDS,
  type UnityCliProjectCapabilities,
} from "../src/unity-cli";

const open = createUnityCliOpenCommand("/workspace/My Game");
assert.equal(resolveUnityCliCommand({ env: { UNITY_CLI_PATH: "unity-custom" } as NodeJS.ProcessEnv }), "unity-custom");
assert.equal(open.command, "unity");
assert.deepEqual(open.args, ["--no-banner", "--non-interactive", "open", "/workspace/My Game"], "Ordinary Unity CLI open relies on the project-declared version.");

const automatedOpen = createUnityCliOpenCommand("/workspace/My Game", { automated: true });
assert.deepEqual(automatedOpen.args, [
  "--no-banner",
  "--non-interactive",
  "open",
  "/workspace/My Game",


  "--args",
  "-automated",
], "Unity CLI forwards the Editor -automated flag with unity open --args.");

const versionedRun = createUnityCliRunCommand("C:/Projects/Game", [], { editorVersionOverride: "6000.1.13f1", cliCommand: "unity-beta" });
assert.equal(versionedRun.command, "unity-beta");
assert(versionedRun.args.includes("--editor-version"), "Only an explicit low-level override emits an Editor version.");
assert(!versionedRun.args.includes("--editor-path"), "Unity CLI project launch must not accept a fixed Editor path.");

assert.deepEqual(
  normalizeUnityCliForwardedArgs(["-batchmode", "-projectPath", "/workspace/Other", "-quit", "-logFile", "run.log", "-projectPath=C:/Other"]),
  ["-logFile", "run.log"],
);

const run = createUnityCliRunCommand("/workspace/My Game", ["-quit", "-runTests", "-testPlatform", "EditMode"], {
  timeoutSeconds: 90,
});
assert.deepEqual(run.args, [
  "--no-banner",
  "--non-interactive",
  "run",
  "/workspace/My Game",


  "--timeout",
  "90",
  "--",
  "-nographics",
  "-runTests",
  "-testPlatform",
  "EditMode",
]);

const nativeLog = createUnityCliRunCommand("/workspace/My Game", ["-runTests"], { logFilePath: "/workspace/My Game/Logs/run.log", tailLog: false });
assert.deepEqual(nativeLog.args.slice(4, 8), ["--log-file", "/workspace/My Game/Logs/run.log", "--no-tail", "--"]);
for (const flag of ["-logFile", "-logFile=elsewhere.log", "-LOGFILE:elsewhere.log"]) assert.throws(() => createUnityCliRunCommand("/game", [flag, "other"], { logFilePath: "/game/Logs/run.log" }), /conflicts/);
assert.throws(() => createUnityCliRunCommand("/game", [], { tailLog: false }), /requires/);
assert(createUnityCliRunCommand("/game", ["-logFile", "legacy.log"]).args.includes("legacy.log"));
assert.deepEqual(createUnityCliBatchmodeReportArgs("/workspace/My Game", ["-quit"]), ["-batchmode", "-projectPath", "/workspace/My Game", "-nographics", "-quit"]);
assert.deepEqual(createUnityCliBatchmodeReportArgs("/workspace/My Game", ["-quit"], { useGraphics: true }), ["-batchmode", "-projectPath", "/workspace/My Game", "-quit"]);

const graphicsRun = createUnityCliRunCommand("/workspace/My Game", ["-runTests"], { useGraphics: true });
assert.deepEqual(graphicsRun.args, [
  "--no-banner",
  "--non-interactive",
  "run",
  "/workspace/My Game",
  "--",
  "-runTests",
]);

const exit = createUnityCliEditorExitCommand("/workspace/My Game", { timeoutSeconds: 7 });
assert.deepEqual(exit.args, [
  "--no-banner",
  "--non-interactive",
  "command",
  "--project-path",
  "/workspace/My Game",
  "--timeout",
  "7",
  "eval",
  "UnityEditor.EditorApplication.Exit(0); return true;",
]);

const statusOutput = JSON.stringify({
  success: true,
  command: "status",
  data: {
    count: 2,
    instances: [
      { pid: 123, port: 64000, projectPath: "/workspace/My Game", version: "6000.1.13f1" },
      { pid: 456, port: 64001, projectPath: "/workspace/Other", version: "6000.1.13f1" },
      { pid: 999, port: 64002, projectPath: "/workspace/My Game Backup", version: "6000.1.13f1" },
    ],
  },
});
const matches = parseUnityCliStatusOutput(statusOutput, "/workspace/My Game");
assert.equal(matches.length, 1);
assert.equal(matches[0].pid, 123);
assert.match(matches[0].commandLine, /port=64000/);
assert.match(matches[0].commandLine, /My Game/);

const fallbackFieldOutput = JSON.stringify({
  data: {
    instances: [
      { processId: "789", project: "C:/Projects/Game", state: "Idle" },
    ],
  },
});
assert.equal(parseUnityCliStatusOutput(fallbackFieldOutput, "C:/Projects/Game")[0].pid, 789);
const starting = JSON.stringify({ success: true, data: { instances: [{ projectPath: "/workspace/My Game", pid: 111, state: "starting", reachable: false }] } });
assert.equal(parseUnityCliStatusOutput(starting, "/workspace/My Game")[0]?.pid, 111);
assert.deepEqual(parseUnityCliPipelineListOutput(starting, "/workspace/My Game").instances.map(instance => [instance.state, instance.reachable]), [["starting", false]]);

const nestedProjectOnlyOutput = JSON.stringify({
  data: {
    instances: [
      { pid: 901, metadata: { projectPath: "/workspace/My Game" }, message: "project /workspace/My Game" },
    ],
  },
});
assert.deepEqual(parseUnityCliStatusOutput(nestedProjectOnlyOutput, "/workspace/My Game"), [], "Only direct project fields may identify a Unity CLI instance.");

assert.deepEqual(parseUnityCliStatusOutput("not json", "/workspace/My Game"), []);
assert.equal(summarizeUnityCliText(`${"v".repeat(300)}\nignored`, 200, 1), `${"v".repeat(200)}…`);

const pipelineList = parseUnityCliPipelineListOutput(JSON.stringify({
  data: {
    latestVersion: "0.3.1-exp.1",
    instances: [
      { projectPath: "/workspace/My Game", pid: 321, editorVersion: "6000.3.7f1", pipelineVersion: "0.3.0-exp.1", isRunning: true, pipelineServer: { isReachable: true, apiUrl: "http://127.0.0.1:7801" } },
      { projectPath: "/workspace/My Game Copy", pid: 654, port: 7802, packageVersion: "0.3.1-exp.1" },
    ],
  },
}), "/workspace/My Game");
assert.equal(pipelineList.latestVersion, "0.3.1-exp.1");
assert.deepEqual(pipelineList.instances, [{
  projectPath: "/workspace/My Game",
  pid: 321,
  port: 7801,
  unityVersion: "6000.3.7f1",
  pipelineVersion: "0.3.0-exp.1",
  state: "running",
  reachable: true,
}]);

assert.deepEqual(parseUnityCliCommandListOutput(JSON.stringify({
  success: true,
  data: { commands: [{ name: "run_tests" }, { command: "eval" }, "recompile", { name: "eval" }] },
})), ["eval", "recompile", "run_tests"]);
assert.deepEqual(parseUnityCliCommandListOutput(JSON.stringify({ success: false, data: { commands: ["eval"] } })), []);
assert.deepEqual(parseUnityCliCommandListOutput("not json"), []);
assert.deepEqual(parseUnityCliCommandListOutput(JSON.stringify({ success: true, data: { commands: [] } })), []);
assert.equal(parseUnityCliCommandListOutput(JSON.stringify({
  success: true,
  data: { commands: ["eval\nforged", "x".repeat(121), ...Array.from({ length: 300 }, (_, index) => `command_${index}`)] },
})).length, 256, "Command discovery must remain bounded.");

assert.equal(isUnityCliTimeout({ error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) }), true);
assert.equal(isUnityCliTimeout({ error: Object.assign(new Error("not found"), { code: "ENOENT" }) }), false);

assert.equal(haveSameKnownProcessIds([{ pid: 10 }, { pid: 20 }], [{ pid: 20 }, { pid: 10 }]), true);
assert.equal(haveSameKnownProcessIds([{ pid: 10 }], [{ pid: 11 }]), false);
assert.equal(haveSameKnownProcessIds([{ pid: null }], [{ pid: null }]), false);
assert.equal(haveSameKnownProcessIds([], []), false);

const packageProject = await mkdtemp(join(tmpdir(), "pi-unity-cli-test-"));
try {
  await mkdir(join(packageProject, "Packages"));
  await writeFile(join(packageProject, "Packages", "manifest.json"), JSON.stringify({ dependencies: { "com.unity.pipeline": "0.3.0-exp.1" } }));
  assert.equal(await readDeclaredUnityPipelineVersion(packageProject), "0.3.0-exp.1");
  await writeFile(join(packageProject, "Packages", "packages-lock.json"), JSON.stringify({ dependencies: { "com.unity.pipeline": { version: "0.3.1-exp.1" } } }));
  assert.equal(await readDeclaredUnityPipelineVersion(packageProject), "0.3.1-exp.1");
} finally {
  await rm(packageProject, { recursive: true, force: true });
}

const warningStatus = await listRunningUnityCliEditorsForProject("/fixture/game", { execute: async () => ({ stdout: JSON.stringify({ success: true, warnings: [{ message: "partial status" }], data: { instances: [{ projectPath: "/fixture/game", pid: 4 }] } }), stderr: "" }) });
assert.equal(warningStatus.processes.length, 1, "Known positive status instances are retained.");
assert.match(warningStatus.warning ?? "", /absence is uncertain/, "Status warnings block launch-safe absence claims even with a positive instance.");

const absentCapabilities = await inspectUnityCliProjectCapabilities("/fixture/closed", "6000.1.0f1", {
  execute: async (_command, args) => args.includes("--version")
    ? { stdout: "1.0.0", stderr: "" }
    : { stdout: JSON.stringify({ success: true, data: { instances: [] } }), stderr: "" },
});
assert.equal(absentCapabilities.pipelineDiscovery, "absent", "valid empty discovery is absence, not a timeout");
const timeoutCapabilities = await inspectUnityCliProjectCapabilities("/fixture/closed", "6000.1.0f1", {
  execute: async (_command, args) => args.includes("--version")
    ? { stdout: "1.0.0", stderr: "" }
    : { stdout: "", stderr: "timeout", error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) },
});
assert.equal(timeoutCapabilities.pipelineDiscovery, "timeout");
const malformedCapabilities = await inspectUnityCliProjectCapabilities("/fixture/closed", "6000.1.0f1", {
  execute: async (_command, args) => args.includes("--version") ? { stdout: "1.0.0", stderr: "" } : { stdout: "not-json", stderr: "" },
});
assert.equal(malformedCapabilities.pipelineDiscovery, "unavailable");
let usageCalls = 0;
const usageFailure = await inspectUnityCliProjectCapabilities("/fixture/closed", "6000.1.0f1", { execute: async (_command, args) => {
  usageCalls++;
  return args.includes("--version") ? { stdout: "1.0.0-beta.11", stderr: "" } : { stdout: JSON.stringify({ success: false, errors: [{ code: "INVALID_COMMAND_ARGS", message: "Invalid argument token=secret123" }] }), stderr: "", error: Object.assign(new Error("exit 2"), { code: 2 }) };
} });
assert.equal(usageCalls, 2, "A structured usage failure never retries or discovers commands.");
assert.equal(usageFailure.pipelineDiscovery, "unavailable");
assert.doesNotMatch(usageFailure.warnings.join(" "), /secret123/);

const catalogProject = await mkdtemp(join(tmpdir(), "pi-unity-cli-catalog-"));
try {
  const catalogCapabilities = await inspectUnityCliProjectCapabilities(catalogProject, "6000.1.0f1", {
    execute: async (_command, args) => {
      if (args.includes("--version")) return { stdout: "1.0.0", stderr: "" };
      if (args.includes("pipeline")) return { stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: catalogProject, pid: 7, pipelineServer: { isReachable: true } }] } }), stderr: "" };
      assert(args.includes("command") && args.includes("--detail") && args.includes("full"), "Exact timeout gating must request the full command descriptor, not normalized unity list metadata.");
      return { stdout: JSON.stringify({ success: true, data: { commands: [{ name: "eval", parameters: [{ name: "code", type: "String", required: true, defaultValue: null }, { name: "timeout", type: "Int32", required: false, defaultValue: 5000 }] }] } }), stderr: "" };
    },
  });
  assert.deepEqual(catalogCapabilities.verifiedCommandParameters?.eval, [
    { name: "code", type: "String", required: true, defaultValue: null },
    { name: "timeout", type: "Int32", required: false, defaultValue: 5000 },
  ], "Only a complete full command descriptor is retained as capability evidence.");

  await mkdir(join(catalogProject, "Library", "Pipeline"), { recursive: true });
  await writeFile(join(catalogProject, "Library", "Pipeline", ".unity-pipeline-port"), JSON.stringify({ capabilities: ["exec.argv"] }));
  const validEvalDescriptor = { name: "eval", parameters: [{ name: "code", type: "String", required: true }, { name: "timeout", type: "Int32", required: false, defaultValue: 5000 }] };
  const malformedCatalogs: Array<[string, unknown[]]> = [
    ["null parameter", [{ ...validEvalDescriptor, parameters: [validEvalDescriptor.parameters[0], null] }]],
    ["nonboolean required", [{ ...validEvalDescriptor, parameters: [validEvalDescriptor.parameters[0], { name: "timeout", type: "Int32", required: "false", defaultValue: 5000 }] }]],
    ["missing required", [{ ...validEvalDescriptor, parameters: [{ name: "code", type: "String" }, validEvalDescriptor.parameters[1]] }]],
    ["excess parameters", [{ ...validEvalDescriptor, parameters: Array.from({ length: 33 }, () => ({ name: "code", type: "String", required: true })) }]],
    ["duplicate eval", [validEvalDescriptor, validEvalDescriptor]],
    ["conflicting eval", [validEvalDescriptor, { ...validEvalDescriptor, parameters: [validEvalDescriptor.parameters[0]] }]],
  ];
  for (const [label, commands] of malformedCatalogs) {
    const inspect = () => inspectUnityCliProjectCapabilities(catalogProject, "6000.1.0f1", {
      execute: async (_command, args) => {
        if (args.includes("--version")) return { stdout: "1.0.0", stderr: "" };
        if (args.includes("pipeline")) return { stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: catalogProject, pid: 7, pipelineServer: { isReachable: true } }] } }), stderr: "" };
        return { stdout: JSON.stringify({ success: true, data: { commands } }), stderr: "" };
      },
    });
    let evalDispatches = 0;
    const rejected = await dispatchUnityPlanningInspection({ projectRoot: catalogProject, unityVersion: "6000.1.0f1", command: "eval", evalSnippet: "return true;", handlerTimeoutMilliseconds: 321 }, {
      inspect,
      execute: async () => { evalDispatches++; return { stdout: "", stderr: "" }; },
    });
    assert.equal(rejected.outcome, "rejected", `${label} must not authorize handler-timeout forwarding.`);
    if (rejected.outcome === "rejected") assert.equal(rejected.code, "planning_eval_timeout_unavailable");
    assert.equal(evalDispatches, 0, `${label} must reject before eval dispatch.`);
  }
} finally {
  await rm(catalogProject, { recursive: true, force: true });
}

assert.deepEqual(UNITY_PLANNING_READ_COMMANDS, [
  "get_authoring_root",
  "get_build_settings",
  "get_player_settings",
  "get_runtime_pipeline_settings",
  "get_scene_hierarchy",
  "editor_status",
  "list_open_scenes",
  "list_build_targets",
], "Planning commands must be package-owned, advertised inspection commands only.");

const planningProject = await mkdtemp(join(tmpdir(), "pi-unity-planning-dispatch-"));
try {
  const planningCapabilities = (pid: number, commands = ["eval", "get_authoring_root"]): UnityCliProjectCapabilities => ({
    cliAvailable: true,
    projectSupportsPipeline: true,
    pipelinePackageDeclared: true,
    matchingInstances: [{ projectPath: planningProject, pid, reachable: true }],
    advertisedCommands: commands,
    advertisedCommandCount: commands.length,
    advertisedCommandsTruncated: false,
    commandDiscoveryAttempted: true,
    commandDiscoverySucceeded: true,
    pipelineDiscovery: "available",
    commandDiscovery: "available",
    warnings: [],
  });
  const dispatched: string[][] = [];
  const execute = async (_command: string, args: string[]) => {
    dispatched.push(args);
    return { stdout: JSON.stringify({ success: true, data: { result: { success: true, result: "safe response", diagnostics: [] } } }), stderr: "" };
  };
  for (const evalSnippet of [
    "return UnityEditor.EditorSettings.scriptChangesDuringPlay;",
    "var s = UnityEngine.Application.dataPath; return s.Length;",
  ]) {
    const inspected = await dispatchUnityPlanningInspection({
      projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval", evalSnippet,
    }, { execute, inspect: async () => planningCapabilities(42) });
    assert.equal(inspected.outcome, "dispatched", "Advertised eval must allow ordinary C# inspection, including local variables.");
    assert(dispatched.at(-1)?.includes(evalSnippet));
    assert(dispatched.at(-1)?.includes("--format") && dispatched.at(-1)?.includes("json"), "Connected inspection requests structured JSON evidence.");
  }
  assert.equal(dispatched.length, 2, "Eval is dispatched only through the exact-copy guarded path.");
  const defaultEvalArgs = dispatched.at(-1)!;
  assert.equal(defaultEvalArgs.at(-1), "var s = UnityEngine.Application.dataPath; return s.Length;", "Omitted handler timeout preserves the existing eval argv exactly.");

  const evalTimeoutCapabilities = (): UnityCliProjectCapabilities => ({
    ...planningCapabilities(42),
    pipelineSupportsExecArgv: true,
    verifiedCommandParameters: {
      eval: [
        { name: "code", type: "String", required: true },
        { name: "timeout", type: "Int32", required: false, defaultValue: 5000 },
      ],
    },
  });
  const handlerTimeoutCalls: string[][] = [];
  const handlerTimeout = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval",
    evalSnippet: "return \"--not-a-flag\";", handlerTimeoutMilliseconds: 321,
  }, {
    inspect: async () => evalTimeoutCapabilities(),
    execute: async (_command, args) => {
      handlerTimeoutCalls.push(args);
      return { stdout: JSON.stringify({ success: true, data: { result: { success: true, result: "safe", diagnostics: [] } } }), stderr: "" };
    },
  });
  assert.equal(handlerTimeout.outcome, "dispatched");
  assert.equal(handlerTimeoutCalls.length, 1, "Handler timeout forwarding must dispatch exactly once.");
  const handlerTimeoutArgs = handlerTimeoutCalls[0]!;
  const evalIndex = handlerTimeoutArgs.indexOf("eval");
  assert.deepEqual(handlerTimeoutArgs.slice(evalIndex), ["eval", "return \"--not-a-flag\";", "321"], "The handler timeout is an argv positional after code, preserving whitespace/flag-like C# exactly.");
  assert.equal(handlerTimeoutArgs.filter(arg => arg === "--timeout").length, 1, "Do not send a colliding duplicate --timeout flag.");
  assert.equal(handlerTimeoutArgs[handlerTimeoutArgs.indexOf("--timeout") + 1], "12", "Existing host/CLI timeout remains seconds and precedes eval.");

  for (const unavailableCapabilities of [
    { ...evalTimeoutCapabilities(), pipelineSupportsExecArgv: false },
    { ...evalTimeoutCapabilities(), verifiedCommandParameters: { eval: [{ name: "code", type: "String", required: true }] } },
  ]) {
    const unavailable = await dispatchUnityPlanningInspection({
      projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval", evalSnippet: "return true;", handlerTimeoutMilliseconds: 321,
    }, { inspect: async () => unavailableCapabilities, execute: async () => { throw new Error("missing timeout contract must not dispatch"); } });
    assert.equal(unavailable.outcome, "rejected");
    if (unavailable.outcome === "rejected") assert.equal(unavailable.code, "planning_eval_timeout_unavailable");
  }
  let handlerTimeoutAttempts = 0;
  const uncertainHandlerTimeout = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval", evalSnippet: "return true;", handlerTimeoutMilliseconds: 321,
  }, {
    inspect: async () => evalTimeoutCapabilities(),
    execute: async () => {
      handlerTimeoutAttempts++;
      return { stdout: "", stderr: "server wait expired", error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) };
    },
  });
  assert.equal(handlerTimeoutAttempts, 1, "A server wait expiry must not replay eval or route-fallback.");
  assert.equal(uncertainHandlerTimeout.outcome, "rejected");
  if (uncertainHandlerTimeout.outcome === "rejected") {
    assert.equal(uncertainHandlerTimeout.code, "planning_command_timeout");
    assert.match(uncertainHandlerTimeout.message, /effect may be uncertain/i);
  }
  let serverTimeoutAttempts = 0;
  const serverTimeout = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval", evalSnippet: "return true;", handlerTimeoutMilliseconds: 321,
  }, {
    inspect: async () => evalTimeoutCapabilities(),
    execute: async () => {
      serverTimeoutAttempts++;
      return { stdout: JSON.stringify({ success: false, error: { message: "eval timed out after 321ms" }, data: {} }), stderr: "" };
    },
  });
  assert.equal(serverTimeoutAttempts, 1, "A server timeout envelope must not replay eval or route-fallback.");
  assert.equal(serverTimeout.outcome, "rejected");
  if (serverTimeout.outcome === "rejected") assert.equal(serverTimeout.code, "planning_command_reported_failure");

  for (const [label, refreshed] of [
    ["signature loss", { ...evalTimeoutCapabilities(), verifiedCommandParameters: { eval: [{ name: "code", type: "String", required: true }] } }],
    ["exec.argv loss", { ...evalTimeoutCapabilities(), pipelineSupportsExecArgv: false }],
  ] as const) {
    let inspections = 0; let evalDispatches = 0;
    const refreshedRejected = await dispatchUnityPlanningInspection({
      projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval", evalSnippet: "return true;", handlerTimeoutMilliseconds: 321,
    }, {
      inspect: async () => ++inspections === 1 ? evalTimeoutCapabilities() : refreshed,
      execute: async () => { evalDispatches++; return { stdout: "", stderr: "" }; },
    });
    assert.equal(refreshedRejected.outcome, "rejected", `${label} must block dispatch after initial approval.`);
    if (refreshedRejected.outcome === "rejected") assert.equal(refreshedRejected.code, "planning_eval_timeout_unavailable");
    assert.equal(evalDispatches, 0, `${label} must have zero eval dispatches.`);
  }

  const intentGoverned = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval",
    evalSnippet: "UnityEditor.AssetDatabase.SaveAssets(); return true;",
  }, { execute, inspect: async () => planningCapabilities(42) });
  assert.equal(intentGoverned.outcome, "dispatched", "Syntax classification is not an authorization boundary; callers must honor user intent and guidance.");
  for (const [label, stdout, expectedCode] of [
    ["outer failure", JSON.stringify({ success: false, data: {} }), "planning_command_reported_failure"],
    ["nested failure", JSON.stringify({ success: true, data: { result: { success: false, error: "compile failed" } } }), "planning_command_reported_failure"],
    ["stringified nested failure", JSON.stringify({ success: true, data: { result: JSON.stringify({ success: false, error: "compile failed" }) } }), "planning_command_reported_failure"],
    ["Roslyn error diagnostic", JSON.stringify({ success: true, data: { result: { success: true, diagnostics: [{ severity: "error", message: "CS1002" }] } } }), "planning_command_reported_failure"],
    ["malformed evidence", "not-json", "planning_command_malformed"],
  ] as const) {
    const failed = await dispatchUnityPlanningInspection({
      projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval", evalSnippet: "return true;",
    }, { execute: async () => ({ stdout, stderr: "" }), inspect: async () => planningCapabilities(42) });
    assert.equal(failed.outcome, "rejected", `${label} must not be reported as a passed dispatch.`);
    if (failed.outcome === "rejected") assert.equal(failed.code, expectedCode);
  }
  for (const timedOut of [false, true]) {
    let attempts = 0;
    const failure = await dispatchUnityPlanningInspection({
      projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "get_authoring_root",
    }, {
      inspect: async () => planningCapabilities(42),
      execute: async () => {
        attempts++;
        return { stdout: "Update Pipeline to 0.6.0-exp.1 or newer.", stderr: "token=synthetic-private-token " + "x".repeat(5000), error: Object.assign(new Error("CLI failed"), { code: timedOut ? "ETIMEDOUT" : 1 }) };
      },
    });
    assert.equal(attempts, 1, "Diagnostics must not cause retry or fallback.");
    assert.equal(failure.outcome, "rejected");
    if (failure.outcome === "rejected") {
      assert.equal(failure.code, timedOut ? "planning_command_timeout" : "planning_command_failed");
      assert.match(failure.message, /Update Pipeline to 0\.6\.0-exp\.1/);
      assert.match(failure.message, /effect may be uncertain/);
      assert.match(failure.message, /\[redacted\]/);
      assert(!failure.message.includes("synthetic-private-token"));
      assert(failure.message.length < 4200, "Failure diagnostics remain bounded.");
    }
  }
  const invalidEval = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval", evalSnippet: "",
  }, { execute, inspect: async () => planningCapabilities(42) });
  assert.deepEqual(invalidEval, { outcome: "rejected", code: "planning_eval_invalid", message: "Eval requires one non-empty bounded C# snippet and no separate arguments." });
  const oversizedEval = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval", evalSnippet: "x".repeat(4001),
  }, { execute, inspect: async () => planningCapabilities(42) });
  assert.equal(oversizedEval.outcome, "rejected", "Eval source remains bounded even though ordinary C# syntax is unrestricted.");
  const unadvertised = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval",
    evalSnippet: "return UnityEngine.Application.unityVersion;",
  }, { execute, inspect: async () => planningCapabilities(42, ["get_authoring_root"]) });
  assert.equal(unadvertised.outcome, "rejected");
  if (unadvertised.outcome === "rejected") assert.equal(unadvertised.code, "planning_command_unadvertised");
  let inspection = 0;
  const changedIdentity = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "get_authoring_root",
  }, { execute, inspect: async () => planningCapabilities(++inspection === 1 ? 42 : 99) });
  assert.equal(changedIdentity.outcome, "rejected");
  if (changedIdentity.outcome === "rejected") assert.equal(changedIdentity.code, "unity_project_identity_changed");
  const disconnected = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "get_authoring_root",
  }, { execute, inspect: async () => ({ ...planningCapabilities(42), matchingInstances: [{ projectPath: planningProject, pid: 42, reachable: false }] }) });
  const callerChosenCommand = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "arbitrary_read",
  }, { execute, inspect: async () => planningCapabilities(42, ["arbitrary_read"]) });
  assert.equal(callerChosenCommand.outcome, "rejected", "Callers cannot self-declare arbitrary commands as planning reads.");
  if (callerChosenCommand.outcome === "rejected") assert.equal(callerChosenCommand.code, "planning_command_invalid");
  const scriptDir = join(planningProject, "AgentScripts");
  await mkdir(scriptDir); const scriptFile = join(scriptDir, "Build.cs"); await writeFile(scriptFile, "public static class Build { public static void Main() {} }");
  const scriptCalls: string[][] = [];
  const runScript = await dispatchUnityPipelineRunScript({ projectRoot: planningProject, unityVersion: "6000", file: scriptFile, entry: "Build.Main", args: ["ok", 2], dryRun: true }, {
    inspect: async () => planningCapabilities(42, ["run_script"]),
    execute: async (_command, args) => { scriptCalls.push(args); return { stdout: JSON.stringify({ success: true, result: { result: "ok", diagnostics: [], compileMs: 1, executeMs: 0 } }), stderr: "" }; },
  });
  assert.equal(runScript.outcome, "dispatched");
  assert(scriptCalls[0]?.includes("AgentScripts/Build.cs") || scriptCalls[0]?.includes("AgentScripts\\Build.cs"));
  assert(scriptCalls[0]?.includes("--dry_run") && scriptCalls[0]?.includes("--entry") && scriptCalls[0]?.includes('["ok",2]'));
  for (const [label, file, code] of [["sibling", join(`${planningProject}Sibling`, "Attack.cs"), "run_script_file_invalid"], ["directory", join(planningProject, "NotAFile.cs"), "run_script_file_invalid"], ["missing", join(planningProject, "Missing.cs"), "run_script_path_unavailable"]] as const) {
    if (label === "sibling") { await mkdir(`${planningProject}Sibling`, { recursive: true }); await writeFile(file, "class Attack {}"); }
    if (label === "directory") await mkdir(file);
    const rejected = await dispatchUnityPipelineRunScript({ projectRoot: planningProject, unityVersion: "6000", file }, { inspect: async () => planningCapabilities(42, ["run_script"]), execute: async () => { throw new Error("must not dispatch"); } });
    assert.equal(rejected.outcome, "rejected", `${label} must be rejected before dispatch`); if (rejected.outcome === "rejected") assert.equal(rejected.code, code);
  }
  const outsideFile = join(`${planningProject}Sibling`, "Escape.cs"); await writeFile(outsideFile, "class Escape {}");
  const linkedFile = join(scriptDir, "Escape.cs");
  try {
    await symlink(outsideFile, linkedFile, "file");
    const symlinkRejected = await dispatchUnityPipelineRunScript({ projectRoot: planningProject, unityVersion: "6000", file: linkedFile }, { inspect: async () => planningCapabilities(42, ["run_script"]), execute: async () => { throw new Error("symlink escape must not dispatch"); } });
    assert.equal(symlinkRejected.outcome, "rejected", "Canonical symlink targets outside the exact project are rejected.");
  } catch (error: any) {
    assert(["EPERM", "EACCES"].includes(error?.code), "Only unavailable symlink privileges may skip the symlink fixture.");
  }
  for (const [stdout, code] of [[JSON.stringify({ success: true, result: { success: false, diagnostics: [] } }), "run_script_reported_failure"], [JSON.stringify({ success: true }), "run_script_malformed"], [JSON.stringify({ success: true, result: { result: "x", diagnostics: [{ severity: "error", message: "CS1" }] } }), "run_script_reported_failure"]] as const) {
    const rejected = await dispatchUnityPipelineRunScript({ projectRoot: planningProject, unityVersion: "6000", file: scriptFile }, { inspect: async () => planningCapabilities(42, ["run_script"]), execute: async () => ({ stdout, stderr: "" }) });
    assert.equal(rejected.outcome, "rejected"); if (rejected.outcome === "rejected") assert.equal(rejected.code, code);
  }
  const unavailableInspect = async () => ({ ...planningCapabilities(42, ["run_script", "eval", "get_runtime_pipeline_settings"]), commandDiscoverySucceeded: false, commandDiscovery: "unavailable" as const, warnings: ["Requires Pipeline 0.6.0-exp.1; token=secret"] });
  const noDispatch = async () => { throw new Error("unavailable capability must not dispatch"); };
  for (const result of [
    await dispatchUnityPipelineRunScript({ projectRoot: planningProject, unityVersion: "6000", file: scriptFile }, { inspect: unavailableInspect, execute: noDispatch }),
    await dispatchUnityPlanningInspection({ projectRoot: planningProject, unityVersion: "6000", command: "eval", evalSnippet: "return 1;" }, { inspect: unavailableInspect, execute: noDispatch }),
    await dispatchUnityPlanningInspection({ projectRoot: planningProject, unityVersion: "6000", command: "get_runtime_pipeline_settings" }, { inspect: unavailableInspect, execute: noDispatch }),
  ]) {
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.match(result.message, /Requires Pipeline 0\.6\.0-exp\.1/);
      assert(!result.message.includes("secret"));
    }
  }
  const scriptResponse = { result: { success: false }, diagnostics: [], compileMs: 1, executeMs: 0, assemblyName: "Script" };
  for (const [label, envelope, expected] of [
    ["legacy transport failure", { success: true, data: { success: false, result: scriptResponse } }, "rejected"],
    ["legacy opaque user result", { success: true, data: { success: true, result: scriptResponse } }, "dispatched"],
    ["compact opaque user result", { success: true, result: scriptResponse }, "dispatched"],
    ["legacy JSON-string response", { success: true, data: { success: true, result: JSON.stringify(scriptResponse) } }, "dispatched"],
  ] as const) {
    const result = await dispatchUnityPipelineRunScript({ projectRoot: planningProject, unityVersion: "6000", file: scriptFile }, {
      inspect: async () => planningCapabilities(42, ["run_script"]),
      execute: async () => ({ stdout: JSON.stringify(envelope), stderr: "" }),
    });
    assert.equal(result.outcome, expected, label);
    if (result.outcome === "rejected") assert.equal(result.code, "run_script_reported_failure", label);
  }
  assert.equal(redactUnityPlanningOutput("token=abc123def456ghijkl and sk_abcdefghijklmnop"), "token= [redacted] and [redacted]");
  assert.equal(disconnected.outcome, "rejected");
  if (disconnected.outcome === "rejected") assert.equal(disconnected.code, "pipeline_not_reachable");
} finally {
  await rm(planningProject, { recursive: true, force: true });
  await rm(`${planningProject}Sibling`, { recursive: true, force: true });
}

const nunitOnly = createUnityCliTestCommand("/game", { testPlatform: "EditMode", retries: 10, reportPaths: { nunit: "/game/Logs/backend.xml" } });
assert.deepEqual(nunitOnly.args.slice(nunitOnly.args.indexOf("--output"), nunitOnly.args.indexOf("--output") + 4), ["--output", "/game/Logs/backend.xml", "--report-format", "nunit"]);
assert(nunitOnly.args.includes("10"));
const cliTest = createUnityCliTestCommand("/game", { testPlatform: "EditMode", testFilters: ["Game.Fast"], testCategories: ["Smoke"], retries: 2, shard: "1/4", coverage: true, reportPaths: { nunit: "/game/Logs/results.xml", junit: "/game/Logs/results.junit.xml", log: "/game/Logs/results.log" } });
assert.deepEqual(cliTest.args.slice(0, 6), ["--no-banner", "--non-interactive", "test", "/game", "--mode", "EditMode"]);
assert(!cliTest.args.includes("--editor-version"), "Ordinary Unity CLI test relies on ProjectVersion.txt.");
assert(cliTest.args.includes("--retries") && cliTest.args.includes("2") && cliTest.args.includes("--shard") && cliTest.args.includes("1/4"));
assert(cliTest.args.includes("--report-format") && cliTest.args.includes("nunit,junit") && cliTest.args.includes("--junit-output") && cliTest.args.includes("/game/Logs/results.junit.xml"), "CLI test command preserves separate native NUnit and JUnit paths.");
assert(cliTest.args.includes("--coverage") && cliTest.args.includes("--output"));
assert.deepEqual(cliTest.args.slice(cliTest.args.indexOf("--")), ["--", "-nographics", "-testCategory", "Smoke", "-logFile", "/game/Logs/results.log"], "Editor-only category, log, and headless arguments are forwarded after --.");
const graphicsJunitTest = createUnityCliTestCommand("/game", { testPlatform: "PlayMode", useGraphics: true, reportPaths: { junit: "/game/Logs/play.junit.xml" } });
assert(graphicsJunitTest.args.includes("--report-format") && graphicsJunitTest.args.includes("junit"));
assert(!graphicsJunitTest.args.includes("-nographics") && !graphicsJunitTest.args.includes("--"), "Graphics-enabled tests do not receive synthetic batchmode or nographics flags.");
console.log("pi-unity unity-cli tests passed");
