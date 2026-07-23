import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUnityCliBatchmodeReportArgs,
  createUnityCliEditorExitCommand,
  createUnityCliOpenCommand,
  createUnityCliRunCommand,
  haveSameKnownProcessIds,
  normalizeUnityCliForwardedArgs,
  parseUnityCliCommandListOutput,
  parseUnityCliPipelineListOutput,
  parseUnityCliStatusOutput,
  readDeclaredUnityPipelineVersion,
  resolveUnityCliCommand,
  summarizeUnityCliText,
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
assert.deepEqual(parseUnityCliCommandListOutput(JSON.stringify({
  success: true,
  data: { commands: ["eval\nforged", "x".repeat(121), ...Array.from({ length: 300 }, (_, index) => `command_${index}`)] },
})).length, 256);

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

console.log("free-unity-pi unity-cli tests passed");
