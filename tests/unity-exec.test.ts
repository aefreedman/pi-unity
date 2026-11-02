import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerUnity from "../index";
import { executeUnityCommand, executeUnityLongCommand } from "../src/unity-exec";

// Actual Node children, no Unity executable or real project is used.
const noisy = String.raw`
const fs = require('node:fs');
(async () => {
  const noise = 'x'.repeat(3 * 1024 * 1024);
  await new Promise(resolve => process.stdout.write(noise, resolve));
  await new Promise(resolve => process.stderr.write(noise, resolve));
  fs.writeFileSync(process.argv[1], '<test-run total="1" passed="1" failed="0"><test-case name="Synthetic.Noisy" result="Passed" /></test-run>');
  fs.writeFileSync(process.argv[2], 'token=synthetic-secret\n' + noise + '\nFINAL LOG EVIDENCE');
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
const root = await mkdtemp(join(tmpdir(), "unity-noisy-run-"));
const previousCli = process.env.UNITY_CLI_PATH;
// Any out-of-band native discovery can only probe this missing synthetic path.
process.env.UNITY_CLI_PATH = join(root, "missing-synthetic-cli");
try {
  const project = join(root, "Game");
  await mkdir(join(project, "Assets"), { recursive: true });
  await mkdir(join(project, "ProjectSettings"));
  await mkdir(join(project, "Packages"));
  await mkdir(join(project, "Logs"));
  await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.1.0f1\n");
  await writeFile(join(project, "Packages", "manifest.json"), '{"dependencies":{}}');
  const tools: any[] = [];
  let dispatches = 0;
  const pi: any = {
    on() {}, registerTool(tool: any) { tools.push(tool); }, registerCommand() {},
    getActiveTools: () => [], events: { emit() {}, on() {} },
    exec: async (_command: string, args: string[]) => {
      if (args.includes("--version")) return { code: 0, stdout: "synthetic", stderr: "" };
      if (args.includes("pipeline") || args.includes("status")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [] } }), stderr: "" };
      if (args.includes("config")) return { code: 0, stdout: "{}", stderr: "" };
      throw new Error("Long-running work must not use bounded pi.exec capture");
    },
  };
  registerUnity(pi, { executeLong: async (_command, args, options) => {
    dispatches++;
    const xml = args[args.indexOf(args.includes("test") ? "--output" : "-testResults") + 1];
    const log = args[args.indexOf("-logFile") + 1];
    assert(xml && log);
    return executeUnityLongCommand(process.execPath, ["-e", noisy, xml, log], options);
  } });
  const ctx: any = { cwd: root, mode: "print", hasUI: false, sessionManager: {}, ui: {} };
  const xml = join(project, "Logs", "batch.xml");
  const log = join(project, "Logs", "batch.log");
  const batch = await tools.find(tool => tool.name === "unity_launch_batchmode").execute("noisy", {
    path: project, launcher: "unity-cli", timeoutSeconds: 15,
    args: ["-runTests", "-testPlatform", "EditMode", "-testResults", xml, "-logFile", log],
  }, undefined, undefined, ctx);
  assert.equal(batch.details.status, "passed");
  assert.equal(batch.details.exitCode, 0);
  assert.equal(batch.details.killed, false);
  assert.equal(batch.details.parsedTestResults.passed, 1);
  assert.match(batch.details.warning, /diagnostics.*omitted/);
  assert.match(batch.details.stdout, /omitted/);
  assert.match(batch.details.stderr, /omitted/);
  assert.doesNotMatch(JSON.stringify(batch), /synthetic-secret/);
  assert((await stat(log)).size > 2 * 1024 * 1024);
  assert((await readFile(log, "utf8")).endsWith("FINAL LOG EVIDENCE"), "Native log remains complete");
  const tests = await tools.find(tool => tool.name === "unity_run_tests").execute("noisy-tests", {
    path: project, testPlatform: "EditMode", execution: "isolated", isolatedLauncher: "unity-cli", timeoutSeconds: 15,
  }, undefined, undefined, ctx);
  assert.equal(tests.details.status, "passed");
  assert.equal(tests.details.testResult.outcome, "passed");
  assert.match(tests.content[0].text, /diagnostics.*omitted/);
  const durable = JSON.parse(await readFile(join(project, tests.details.artifactPath), "utf8"));
  assert.equal(durable.outcome, "passed");
  assert.equal(durable.summary.passed, 1);
  assert.equal(dispatches, 2, "No replay or retry of either mutation");

  const utf8 = await executeUnityLongCommand(process.execPath, ["-e", "const b=Buffer.from('雪😀');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20)"], { timeout: 5000 });
  assert.equal(utf8.stdout, "雪😀"); assert.equal(utf8.outputOmitted, false);
  const timeout = await executeUnityLongCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 50 });
  assert.equal(timeout.killed, true);
  const controller = new AbortController();
  const aborted = executeUnityLongCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: controller.signal, timeout: 5000 });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(aborted, (error: any) => error.name === "AbortError");
  await assert.rejects(executeUnityLongCommand("must-not-spawn", [], { signal: controller.signal }), (error: any) => error.name === "AbortError");
  const failed = await executeUnityLongCommand(process.execPath, ["-e", "process.stderr.write('fixture failed');process.exitCode=8"], { timeout: 5000 });
  assert.equal(failed.code, 8); assert.equal(failed.killed, false); assert.equal(failed.stderr, "fixture failed");
  const missing = await executeUnityLongCommand(join(root, "not-installed"), [], { timeout: 5000 });
  assert.notEqual(missing.code, 0); assert(missing.stderr);
  // Structured/probe capture still rejects an incomplete success-shaped JSON result.
  let maxBuffer: number | undefined;
  await assert.rejects(executeUnityCommand({ exec: async (_command, _args, options) => {
    maxBuffer = options?.maxBuffer;
    return { code: 0, stdout: '{"success":true}', stderr: "", killed: false, truncated: true };
  } }, "synthetic", [], {}), (error: any) => error.code === "OUTPUT_TRUNCATED");
  assert.equal(maxBuffer, 2 * 1024 * 1024);
  console.log("Noisy batchmode and isolated tests retain final reports/logs; bounded structured capture, timeout, abort, UTF-8 and failures passed");
} finally {
  if (previousCli === undefined) delete process.env.UNITY_CLI_PATH; else process.env.UNITY_CLI_PATH = previousCli;
  await rm(root, { recursive: true, force: true });
}
