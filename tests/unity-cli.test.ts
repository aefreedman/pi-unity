import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUnityCliBatchmodeReportArgs,
  createUnityCliEditorExitCommand,
  createUnityCliOpenCommand,
  createUnityCliRunCommand,
  dispatchUnityPlanningInspection,
  haveSameKnownProcessIds,
  inspectUnityCliProjectCapabilities,
  isSafeUnityPlanningEvalSnippet,
  isUnityCliTimeout,
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

const open = createUnityCliOpenCommand("/workspace/My Game", { editorVersion: "6000.1.13f1" });
assert.equal(resolveUnityCliCommand({ env: { UNITY_CLI_PATH: "unity-custom" } as NodeJS.ProcessEnv }), "unity-custom");
assert.equal(open.command, "unity");
assert.deepEqual(open.args, ["--no-banner", "--non-interactive", "open", "/workspace/My Game", "--editor-version", "6000.1.13f1"]);

const openWithPath = createUnityCliOpenCommand("C:/Projects/Game", { editorPath: "C:/Unity/Editor/Unity.exe", cliCommand: "unity-beta" });
assert.equal(openWithPath.command, "unity-beta");
assert.deepEqual(openWithPath.args, [
  "--no-banner",
  "--non-interactive",
  "open",
  "C:/Projects/Game",
  "--editor-path",
  "C:/Unity/Editor/Unity.exe",
]);

assert.deepEqual(
  normalizeUnityCliForwardedArgs(["-batchmode", "-projectPath", "/workspace/Other", "-quit", "-logFile", "run.log", "-projectPath=C:/Other"]),
  ["-logFile", "run.log"],
);

const run = createUnityCliRunCommand("/workspace/My Game", ["-quit", "-runTests", "-testPlatform", "EditMode"], {
  editorVersion: "6000.1.13f1",
  timeoutSeconds: 90,
});
assert.deepEqual(run.args, [
  "--no-banner",
  "--non-interactive",
  "run",
  "/workspace/My Game",
  "--editor-version",
  "6000.1.13f1",
  "--timeout",
  "90",
  "--",
  "-nographics",
  "-runTests",
  "-testPlatform",
  "EditMode",
]);

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

assert.equal(isSafeUnityPlanningEvalSnippet("return UnityEngine.Application.unityVersion;"), true);
assert.equal(isSafeUnityPlanningEvalSnippet("return UnityEditor.EditorUserBuildSettings.activeBuildTarget;"), true);
for (const unsafe of [
  "UnityEditor.AssetDatabase.SaveAssets(); return true;",
  "UnityEditor.EditorApplication.Exit(0); return true;",
  "return unknownMethod();",
  "return UnityEngine.Application.productName;\nreturn UnityEngine.Application.unityVersion;",
  "return UnityEngine.Application.productName; {",
]) assert.equal(isSafeUnityPlanningEvalSnippet(unsafe), false, `Planning eval must reject ${unsafe}`);
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

const absentCapabilities = await inspectUnityCliProjectCapabilities("/fixture/closed", "6000.1.0f1", {
  execute: async (_command, args) => args[0] === "--version"
    ? { stdout: "1.0.0", stderr: "" }
    : { stdout: JSON.stringify({ success: true, data: { instances: [] } }), stderr: "" },
});
assert.equal(absentCapabilities.pipelineDiscovery, "absent", "valid empty discovery is absence, not a timeout");
const timeoutCapabilities = await inspectUnityCliProjectCapabilities("/fixture/closed", "6000.1.0f1", {
  execute: async (_command, args) => args[0] === "--version"
    ? { stdout: "1.0.0", stderr: "" }
    : { stdout: "", stderr: "timeout", error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) },
});
assert.equal(timeoutCapabilities.pipelineDiscovery, "timeout");
const malformedCapabilities = await inspectUnityCliProjectCapabilities("/fixture/closed", "6000.1.0f1", {
  execute: async (_command, args) => args[0] === "--version" ? { stdout: "1.0.0", stderr: "" } : { stdout: "not-json", stderr: "" },
});
assert.equal(malformedCapabilities.pipelineDiscovery, "unavailable");

assert.deepEqual(UNITY_PLANNING_READ_COMMANDS, [
  "get_authoring_root",
  "get_build_settings",
  "get_player_settings",
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
    return { stdout: "safe response", stderr: "" };
  };
  const safe = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval",
    evalSnippet: "return UnityEngine.Application.unityVersion;",
  }, { execute, inspect: async () => planningCapabilities(42) });
  assert.equal(safe.outcome, "dispatched");
  assert.equal(dispatched.length, 1, "safe eval is dispatched only through the owning guarded path");
  assert(dispatched[0].includes("eval"));

  const mutating = await dispatchUnityPlanningInspection({
    projectRoot: planningProject, unityVersion: "6000.1.13f1", command: "eval",
    evalSnippet: "UnityEditor.AssetDatabase.SaveAssets(); return true;",
  }, { execute, inspect: async () => planningCapabilities(42) });
  assert.deepEqual(mutating, { outcome: "rejected", code: "planning_eval_not_read_only", message: "Planning eval must be a conservative expression-only read." });
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
  if (callerChosenCommand.outcome === "rejected") assert.equal(callerChosenCommand.code, "planning_command_not_read_only");
  assert.equal(redactUnityPlanningOutput("token=abc123def456ghijkl and sk_abcdefghijklmnop"), "token= [redacted] and [redacted]");
  assert.equal(disconnected.outcome, "rejected");
  if (disconnected.outcome === "rejected") assert.equal(disconnected.code, "pipeline_not_reachable");
} finally {
  await rm(planningProject, { recursive: true, force: true });
}

console.log("free-unity-pi unity-cli tests passed");
