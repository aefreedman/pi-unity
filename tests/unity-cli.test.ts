import { strict as assert } from "node:assert";
import {
  createUnityCliBatchmodeReportArgs,
  createUnityCliOpenCommand,
  createUnityCliRunCommand,
  parseUnityCliStatusOutput,
  resolveUnityCliCommand,
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

const run = createUnityCliRunCommand("/workspace/My Game", ["-nographics", "-runTests", "-testPlatform", "EditMode"], {
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

assert.deepEqual(createUnityCliBatchmodeReportArgs("/workspace/My Game", ["-quit"]), ["-batchmode", "-projectPath", "/workspace/My Game", "-quit"]);

const statusOutput = JSON.stringify({
  success: true,
  command: "status",
  data: {
    count: 2,
    instances: [
      { pid: 123, port: 64000, projectPath: "/workspace/My Game", version: "6000.1.13f1" },
      { pid: 456, port: 64001, projectPath: "/workspace/Other", version: "6000.1.13f1" },
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

assert.deepEqual(parseUnityCliStatusOutput("not json", "/workspace/My Game"), []);

console.log("free-unity-pi unity-cli tests passed");
