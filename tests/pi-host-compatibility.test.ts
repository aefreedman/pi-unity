import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { chooseProjectCandidateWithWrappingNavigation } from "../index";
import { executeUnityCommand } from "../src/unity-exec";
import { renderUnityToolResult } from "../src/unity-renderers";

const hostManifest = fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")));
const hostRoot = dirname(hostManifest);
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(JSON.parse(await readFile(hostManifest, "utf8")).version, manifest.devDependencies["@earendil-works/pi-coding-agent"]);
const hostRequire = createRequire(hostManifest);
const coreManifest = hostRequire.resolve("@earendil-works/pi-agent-core/package.json");
const core = JSON.parse(await readFile(coreManifest, "utf8"));
const { runAgentLoop } = await import(new URL(core.exports["."].import, pathToFileURL(coreManifest)).href);
const { loadExtensions } = await import(pathToFileURL(join(hostRoot, "dist/core/extensions/loader.js")).href);
const { execCommand } = await import(pathToFileURL(join(hostRoot, "dist/core/exec.js")).href);
initTheme("dark");

// Load the shipped composition through Pi's jiti mapper, not a direct execute stub.
const loaded = await loadExtensions([resolve("index.ts")], process.cwd());
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const tools = [...loaded.extensions[0].tools.values()].map((entry: any) => entry.definition);
assert(tools.length > 10);
assert(tools.some((tool: any) => tool.name === "unity_import_unitypackage"));
let dispatches = 0;
let received: any;
async function call(name: string, args: unknown) {
  const tool = tools.find((entry: any) => entry.name === name);
  assert(tool);
  const messages = await runAgentLoop([], { systemPrompt: "Offline schema boundary", messages: [], tools: [{ ...tool, execute: async (_id: string, params: unknown) => {
    dispatches++; received = params; return { content: [{ type: "text", text: "synthetic dispatch" }], details: {} };
  } }] }, {
    model: { id: "fixture", provider: "fixture", api: "openai-completions" },
    convertToLlm: (messages: unknown[]) => messages,
    finishTurn: () => ({ action: "end" }),
  }, () => {}, undefined, () => {
    const stream = createAssistantMessageEventStream();
    const response: any = { role: "assistant", content: [{ type: "toolCall", id: "call", name, arguments: args }], api: "openai-completions", provider: "fixture", model: "fixture", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 0 };
    stream.push({ type: "done", reason: "toolUse", message: response }); stream.end(response); return stream;
  });
  return messages.find((message: any) => message.role === "toolResult");
}
for (const [name, args] of [
  ["unity_run_tests", {}],
  ["unity_run_tests", { testPlatform: "Wrong" }],
  ["unity_run_tests", { testPlatform: "EditMode", retries: 11 }],
  ["unity_pipeline_eval", { code: "return 1;", handlerTimeoutMilliseconds: 0 }],
  ["unity_import_unitypackage", {}],
  ["unity_pipeline_run_script", { file: "Assets/Fixture.cs", dryRun: "not-a-boolean" }],
] as const) {
  const before = dispatches;
  const result = await call(name, args);
  assert.equal(result.isError, true, name);
  assert.equal(dispatches, before, "Invalid mutation arguments never reach execution");
}
const valid = await call("unity_run_tests", { testPlatform: "EditMode", retries: "2", coverage: "false", testFilters: "Fixture.Test", path: null });
assert.equal(valid.isError, false);
assert.equal(received.retries, 2);
assert.equal(received.coverage, false);
assert.deepEqual(received.testFilters, ["Fixture.Test"]);
assert.equal("path" in received, false);
assert.equal((await call("unity_pipeline_run_script", { file: "Assets/Fixture.cs", dryRun: "true" })).isError, false);
assert.equal(received.dryRun, true);

const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value };
const render = (ctx: any) => renderUnityToolResult({ content: [{ type: "text", text: "Invalid arguments" }] }, false, theme, ctx).render(120).join("\n");
assert.match(render({ isError: true, keyText: () => "alt+e", keyHint: (_action: string, label: string) => `alt+e ${label}` }), /alt\+e details/);
assert.doesNotMatch(render({ isError: true, keyText: () => "", keyHint: () => "incorrect hint" }), /incorrect hint|ctrl\+o|details/);
assert.doesNotThrow(() => render({ isError: true }));

// Use Pi's actual custom-dialog completion/disposal, with a synthetic UI surface.
const { InteractiveMode } = await import(pathToFileURL(join(hostRoot, "dist/modes/interactive/interactive-mode.js")).href);
const dialogs: any[] = [];
const blocked = new Map<any, unknown>();
const host: any = {
  editor: { getText: () => "", setText() {} },
  ui: { requestRender() {} },
  keybindings: { matches: (data: string, action: string) => data === action },
  pushExtensionDialog(component: any, state: unknown) { dialogs.push(component); blocked.set(component, state); },
  removeExtensionDialog(component: any) { const i = dialogs.indexOf(component); if (i >= 0) dialogs.splice(i, 1); blocked.delete(component); },
};
const candidates = [{ projectName: "A", projectRoot: "/synthetic/A" }, { projectName: "B", projectRoot: "/synthetic/B" }];
const ctx: any = { mode: "tui", cwd: process.cwd(), ui: { custom: (factory: any, options: any) => InteractiveMode.prototype.showExtensionCustom.call(host, factory, options) } };
const first = chooseProjectCandidateWithWrappingNavigation(ctx, candidates);
const second = chooseProjectCandidateWithWrappingNavigation(ctx, candidates);
await Promise.resolve(); await Promise.resolve();
assert.equal(dialogs.length, 2);
assert.deepEqual([...blocked.values()], [{ kind: "question", message: "Select Unity project" }, { kind: "question", message: "Select Unity project" }]);
const older = dialogs[0], newer = dialogs[1];
older.handleInput("tui.select.up"); older.handleInput("tui.select.confirm");
assert.equal((await first)?.projectName, "B");
assert.deepEqual(dialogs, [newer], "Closing an older dialog must not close a newer one");
older.handleInput("tui.select.cancel");
assert.equal(blocked.size, 1);
newer.handleInput("tui.select.cancel");
assert.equal(await second, null);
assert.equal(blocked.size, 0);
await assert.rejects(InteractiveMode.prototype.showExtensionCustom.call(host, () => { throw new Error("synthetic UI failure"); }, { blocked: { kind: "question", message: "fixture" } }), /synthetic UI failure/);
assert.equal(blocked.size, 0);

// Exercise real host process capture using Node fixtures only; never start Unity.
const pi: any = { exec: (command: string, args: string[], options: unknown) => execCommand(command, args, process.cwd(), options) };
const utf8 = await executeUnityCommand(pi, process.execPath, ["-e", "const b=Buffer.from('雪😀');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),30)"], { timeout: 5000 });
assert.equal(utf8.stdout, "雪😀"); assert.equal(utf8.code, 0);
const missing = await executeUnityCommand(pi, "pi-unity-synthetic-missing-executable", [], { timeout: 5000 });
assert.notEqual(missing.code, 0); assert(missing.stderr);
await assert.rejects(executeUnityCommand(pi, process.execPath, ["-e", "process.stdout.write(JSON.stringify({success:true})); process.stdout.write('x'.repeat(3*1024*1024))"], { timeout: 5000 }), (error: any) => error.code === "OUTPUT_TRUNCATED");
const timeout = await executeUnityCommand(pi, process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 30 });
assert.equal(timeout.killed, true);
const controller = new AbortController();
const aborted = executeUnityCommand(pi, process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: controller.signal, timeout: 5000 });
setTimeout(() => controller.abort(), 30);
await assert.rejects(aborted, (error: any) => error.name === "AbortError");
let preAbortDispatches = 0;
await assert.rejects(executeUnityCommand({ exec: async () => { preAbortDispatches++; throw new Error("must not dispatch"); } }, "synthetic", [], { signal: controller.signal }));
assert.equal(preAbortDispatches, 0);
console.log(`Pi ${manifest.devDependencies["@earendil-works/pi-coding-agent"]}: actual load, schema rejection/coercion, injected hints, dialog lifecycle and bounded host exec passed`);
