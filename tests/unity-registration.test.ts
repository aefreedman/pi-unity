import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import registerProjectArtifacts from "@aefree/pi-project-artifacts/pi";
import { resolveArtifactProfilesV1, resolveArtifactSearchServiceV1, resolveTodoLifecycleServiceV1 } from "@aefree/pi-project-artifacts/contracts/v1";
import { resolveFileDiscoveryFiltersV1 } from "@aefree/pi-file-discovery/contracts/v1";
import { ExtensionRunner, initTheme } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import registerUnity from "../index";
import { writeNormalizedUnityTestArtifact, type NormalizedUnityTestResult } from "../src/unity-tests";
import { validateNormalizedUnityTestArtifact } from "../src/unity-artifact-inspection";

initTheme("dark");

function fakePi(exec: (command: string, args: string[]) => Promise<any> = async () => ({ code: 0, stdout: "", stderr: "" })) {
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  const tools: any[] = [];
  const commands: any[] = [];
  const entries: Array<{ customType: string; data: unknown }> = [];
  let activeTools: string[] = [];
  return {
    handlers, tools, commands, entries,
    on(name: string, handler: (event: any, ctx: any) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    registerTool(tool: any) { tools.push(tool); activeTools.push(tool.name); },
    registerCommand(name: string, command: any) { commands.push({ name, ...command }); },
    getActiveTools() { return [...activeTools]; },
    setActiveTools(names: string[]) { activeTools = [...names]; },
    appendEntry(customType: string, data: unknown) { entries.push({ customType, data }); },
    exec: (command: string, args: string[]) => exec(command, args),
    events: { emit() {}, on() {} },
  };
}
async function emit(pi: ReturnType<typeof fakePi>, name: string, ctx: any) { for (const handler of pi.handlers.get(name) ?? []) await handler({ reason: name === "session_start" ? "startup" : "quit" }, ctx); }

// Exercise Pi's actual native finalizer and extension middleware, not an imitation
// that treats execute().details.status (or a returned isError field) as failure.
// Resolve agent-core through the installed host so this works with nested npm deps.
const hostRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const coreManifestPath = hostRequire.resolve("@earendil-works/pi-agent-core/package.json");
const coreManifest = JSON.parse(await readFile(coreManifestPath, "utf8"));
const { runAgentLoop } = await import(new URL(coreManifest.exports["."].import, pathToFileURL(coreManifestPath)).href);
async function nativeToolResult(pi: ReturnType<typeof fakePi>, tool: any, params: any, ctx: any) {
  const runner = new ExtensionRunner([{ path: "synthetic-unity-extension", handlers: pi.handlers } as any], {} as any, ctx.cwd, ctx.sessionManager, {} as any);
  const errors: unknown[] = [];
  runner.onError(error => errors.push(error));
  const events: any[] = [];
  let executed: any;
  const messages = await runAgentLoop([], { systemPrompt: "Offline deterministic tool-result test", messages: [], tools: [{ ...tool, execute: async (...args: any[]) => { executed = await tool.execute(...args, ctx); return executed; } }] }, {
    model: { id: "synthetic", provider: "synthetic", api: "openai-completions" },
    convertToLlm: (messages: any[]) => messages,
    finishTurn: () => ({ action: "end" }),
    afterToolCall: ({ toolCall, args, result, isError }: any) => runner.emitToolResult({ type: "tool_result", toolName: toolCall.name, toolCallId: toolCall.id, input: args, content: result.content, details: result.details, isError }),
  }, (event: any) => { events.push(event); }, undefined, () => {
    const stream = createAssistantMessageEventStream();
    const response = { role: "assistant", content: [{ type: "toolCall", id: "synthetic-call", name: tool.name, arguments: params }], api: "openai-completions", provider: "synthetic", model: "synthetic", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 0 };
    stream.push({ type: "done", reason: "toolUse", message: response });
    stream.end(response);
    return stream;
  });
  assert.deepEqual(errors, [], "Native extension hooks must not fail silently.");
  const result = messages.find((message: any) => message.role === "toolResult");
  assert(result, "Native finalizer emitted a tool result.");
  assert.equal(events.find(event => event.type === "tool_execution_end")?.isError, result.isError, "Native execution event and stored result agree.");
  if (executed) {
    assert.deepEqual(result.details, executed.details, "Native failure must retain structured details unchanged.");
    assert.deepEqual(result.content, executed.content, "Native failure must retain bounded diagnostics unchanged.");
  }
  return result;
}

for (const order of ["artifacts-first", "unity-first"] as const) {
  const scope = {};
  const ctx = { cwd: process.cwd(), sessionManager: scope, mode: "print", hasUI: false, ui: {} };
  const artifacts = fakePi();
  const unity = fakePi();
  registerProjectArtifacts(artifacts as any);
  registerUnity(unity as any);
  // The shared Pi host advertises separately loaded optional packages globally.
  unity.setActiveTools(["project_artifact_search", "discover_candidate_files"]);
  if (order === "artifacts-first") { await emit(artifacts, "session_start", ctx); await emit(unity, "session_start", ctx); }
  else { await emit(unity, "session_start", ctx); await emit(artifacts, "session_start", ctx); }
  assert.equal(resolveArtifactSearchServiceV1(scope).outcome, "available", order);
  assert.equal(resolveTodoLifecycleServiceV1(scope).outcome, "available", order);
  assert.equal(resolveArtifactProfilesV1(scope).outcome, "available", order);
  assert.equal(resolveFileDiscoveryFiltersV1(scope).outcome, "available", order);
  assert.equal(unity.tools.filter((tool) => tool.name === "unity_migrate_solution_docs").length, 0);
  const openEditorTool = unity.tools.find((tool) => tool.name === "unity_open_editor");
  assert(openEditorTool, "pi-unity must register the Unity Editor launcher tool");
  assert.equal(openEditorTool.parameters.additionalProperties, false, "Open Editor schema must be strict.");
  assert.equal(openEditorTool.parameters.properties.unityEditorPath, undefined, "Open Editor must not expose a version-unverified Editor-path override.");
  assert.equal(openEditorTool.parameters.properties.automated.default, false);
  assert.match(openEditorTool.parameters.properties.automated.description, /Unity Editor's -automated flag/);
  const batchmodeTool = unity.tools.find((tool) => tool.name === "unity_launch_batchmode");
  assert(batchmodeTool, "pi-unity must register the batchmode launcher tool");
  assert.equal(batchmodeTool.parameters.additionalProperties, false, "Batchmode schema must be strict.");
  assert.equal(batchmodeTool.parameters.properties.unityEditorPath, undefined, "Legacy Editor-path arguments must be schema-invalid rather than ignored.");
  const recompileTool = unity.tools.find((tool) => tool.name === "unity_pipeline_recompile");
  const pipelineTestTool = unity.tools.find((tool) => tool.name === "unity_run_tests");
  assert(recompileTool && pipelineTestTool, "pi-unity must register recompile and the unified test tool");
  assert.equal(recompileTool.parameters.additionalProperties, false, "Pipeline recompile schema must be strict.");
  assert.equal(pipelineTestTool.parameters.additionalProperties, false, "Pipeline test schema must be strict.");
  assert.deepEqual(pipelineTestTool.parameters.properties.testPlatform.enum, ["EditMode", "PlayMode"]);
  assert.deepEqual(pipelineTestTool.parameters.properties.execution.enum, ["auto", "connected", "isolated"]);
  assert.equal(unity.tools.some((tool) => tool.name === "unity_pipeline_run_tests" || tool.name === "unity_run_test_batch"), false, "Legacy test tools must not be registered.");
  const evalTool = unity.tools.find((tool) => tool.name === "unity_pipeline_eval");
  assert(evalTool, "pi-unity must register Pipeline eval as the primary C# REPL tool");
  assert.equal(evalTool.parameters.additionalProperties, false);
  assert.equal(evalTool.parameters.properties.code.maxLength, 4000);
  assert.equal(evalTool.parameters.properties.handlerTimeoutMilliseconds.minimum, 1);
  assert.equal(evalTool.parameters.properties.handlerTimeoutMilliseconds.maximum, 86400000);
  assert.match(evalTool.parameters.properties.handlerTimeoutMilliseconds.description, /raw argv/i);
  assert.match(evalTool.promptGuidelines.join(" "), /shorter host deadline may still win/i);
  const inspectionTool = unity.tools.find((tool) => tool.name === "unity_pipeline_inspect");
  assert(inspectionTool, "pi-unity must register the purpose-built Pipeline inspection tool");
  assert.equal(inspectionTool.parameters.additionalProperties, false);
  assert.deepEqual(inspectionTool.parameters.properties.command.enum, [
    "get_authoring_root", "get_build_settings", "get_player_settings", "get_runtime_pipeline_settings", "get_scene_hierarchy",
    "editor_status", "list_open_scenes", "list_build_targets",
  ], "The inspection schema must advertise only package-owned purpose-built commands.");
  const runScriptTool = unity.tools.find((tool) => tool.name === "unity_pipeline_run_script");
  assert(runScriptTool, "pi-unity must register the bounded Pipeline run_script tool");
  assert.equal(runScriptTool.parameters.additionalProperties, false);
  assert.equal(runScriptTool.parameters.properties.file.type, "string");
  assert.equal(runScriptTool.parameters.properties.dryRun.type, "boolean");
  assert.match(runScriptTool.promptGuidelines.join(" "), /arbitrary code execution/i);
  assert.match(runScriptTool.promptGuidelines.join(" "), /hotpatch/i);
  assert.match(inspectionTool.promptGuidelines.join(" "), /never launches or closes Unity/i);
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const rendererContext = { lastComponent: undefined };
  const testCall = pipelineTestTool.renderCall({ path: "C:/Game", testPlatform: "EditMode", testFilter: "Game.Fast" }, theme, rendererContext);
  assert.match(testCall.render(300).join("\n"), /EditMode tests[\s\S]*Game.Fast/, "Test call headers retain platform and bounded filter.");
  const reusedTestCall = pipelineTestTool.renderCall({ path: "C:/Game", testPlatform: "PlayMode", testFilter: "secret=visible" }, theme, { lastComponent: testCall });
  assert.equal(reusedTestCall, testCall, "Pipeline call renderer reuses the prior Text component.");
  assert.match(reusedTestCall.render(300).join("\n"), /secret=\[redacted\]/i, "Sensitive-looking filter values are redacted.");
  const evalCall = evalTool.renderCall({ code: "return api_key=super-secret-value;" }, theme, rendererContext);
  assert.match(evalCall.render(300).join("\n"), /api_key=\[redacted\]/i, "Eval previews redact sensitive-looking values.");
  for (const code of [
    'password = "correct horse battery staple"; return password;',
    "token: 'multi word value'",
    'PASSWORD = "correct \\"horse\\" battery staple";',
  ]) {
    const rendered = evalTool.renderCall({ code }, theme, rendererContext).render(300).join("\n");
    assert.match(rendered, /(password|token)\s*[:=]\[redacted\]/i, "Quoted sensitive values are fully redacted.");
    for (const fragment of ["horse", "battery", "staple", "multi word value"]) {
      assert(!rendered.includes(fragment), `Sensitive fragment must not survive renderer redaction: ${fragment}`);
    }
  }
  const inspectCall = inspectionTool.renderCall({ command: "get_scene_hierarchy" }, theme, rendererContext);
  assert.match(inspectCall.render(300).join("\n"), /get scene hierarchy/);
  const partial = pipelineTestTool.renderResult({ content: [{ type: "text", text: "Unity EditMode tests running; 1.0s elapsed." }], details: {} }, { expanded: false, isPartial: true }, theme, rendererContext);
  assert.match(partial.render(300).join("\n"), /Unity/);
  const completedResult = {
    content: [{ type: "text", text: "Unity EditMode tests passed for C:/Game: 21 executed, 21 passed, 0 failed." }],
    details: { mode: "pipeline", status: "passed", pipeline: { operation: "tests", terminalState: "completed", elapsedSeconds: 2.4, testPlatform: "EditMode", counts: { total: 21, passed: 21, failed: 0 }, playModeHandling: "not_playing" } },
  };
  const completed = pipelineTestTool.renderResult(completedResult, { expanded: false, isPartial: false }, theme, { lastComponent: partial });
  assert(completed, "Unified test renderer returns a result component.");
  assert.match(completed.render(300).join("\n"), /21 passed · 0 failed/, "Collapsed test results show counts.");
  const expanded = pipelineTestTool.renderResult(completedResult, { expanded: true, isPartial: false }, theme, { lastComponent: completed });
  assert(expanded, "Unified test renderer expands results.");
  assert.match(expanded.render(300).join("\n"), /Unity EditMode tests passed for C:\/Game/, "Expanded Pipeline results show the bounded model-visible evidence.");
  const recompileWithoutPlayModeDetails = recompileTool.renderResult({
    content: [{ type: "text", text: "Unity recompile completed." }],
    details: { mode: "pipeline", status: "passed", pipeline: { operation: "recompile", terminalState: "completed", elapsedSeconds: 1.2 } },
  }, { expanded: false, isPartial: false }, theme, rendererContext);
  assert.match(recompileWithoutPlayModeDetails.render(300).join("\n"), /Recompile completed · 1.2s/, "Optional Play Mode details may be absent without breaking rendering.");
  const collapsedEval = evalTool.renderResult({ content: [{ type: "text", text: "Unity Pipeline eval completed.\n42" }], details: { mode: "pipeline_eval", status: "passed", pipelineEval: { outcome: "dispatched", command: "eval", output: "42", truncated: false } } }, { expanded: false, isPartial: false }, theme, rendererContext);
  assert.match(collapsedEval.render(300).join("\n"), /42/, "Collapsed eval output remains useful.");
  const rejectedEval = evalTool.renderResult({ content: [{ type: "text", text: "Unity Pipeline eval rejected: eval_failed\nRoslyn compilation failed." }], details: { mode: "pipeline_eval", status: "failed", pipelineEval: { outcome: "rejected", code: "eval_failed", message: "Roslyn compilation failed." } } }, { expanded: false, isPartial: false }, theme, { lastComponent: collapsedEval });
  assert.equal(rejectedEval, collapsedEval, "Rejected eval results reuse the prior Text component.");
  assert.match(rejectedEval.render(300).join("\n"), /Roslyn compilation failed/, "Rejected eval summaries remain visible while collapsed.");
  assert.equal(artifacts.tools.filter((tool) => tool.name === "project_artifact_search").length, 1);
  await emit(unity, "session_shutdown", ctx);
  await emit(artifacts, "session_shutdown", ctx);
  assert.equal(resolveArtifactProfilesV1(scope).outcome, "missing");
  assert.equal(resolveFileDiscoveryFiltersV1(scope).outcome, "missing");
  assert.equal(resolveArtifactSearchServiceV1(scope).outcome, "missing");
  assert.equal(resolveTodoLifecycleServiceV1(scope).outcome, "missing");
}

{
  const scopeA = {};
  const scopeB = {};
  const unity = fakePi();
  registerUnity(unity as any);
  unity.setActiveTools(["project_artifact_search", "discover_candidate_files"]);
  const ctxA = { cwd: process.cwd(), sessionManager: scopeA, mode: "print", hasUI: false, ui: {} };
  const ctxB = { ...ctxA, sessionManager: scopeB };
  await emit(unity, "session_start", ctxA);
  await emit(unity, "session_start", ctxB);
  assert.equal(resolveArtifactProfilesV1(scopeA).outcome, "available");
  assert.equal(resolveArtifactProfilesV1(scopeB).outcome, "available");
  assert.equal(resolveFileDiscoveryFiltersV1(scopeA).outcome, "available");
  assert.equal(resolveFileDiscoveryFiltersV1(scopeB).outcome, "available");
  await emit(unity, "session_shutdown", ctxA);
  assert.equal(resolveArtifactProfilesV1(scopeA).outcome, "missing");
  assert.equal(resolveFileDiscoveryFiltersV1(scopeA).outcome, "missing");
  assert.equal(resolveArtifactProfilesV1(scopeB).outcome, "available", "delayed old-session shutdown must preserve newer active scope");
  assert.equal(resolveFileDiscoveryFiltersV1(scopeB).outcome, "available", "delayed old-session shutdown must preserve newer active scope");
  await emit(unity, "session_shutdown", ctxB);
  assert.equal(resolveArtifactProfilesV1(scopeB).outcome, "missing");
  assert.equal(resolveFileDiscoveryFiltersV1(scopeB).outcome, "missing");
}
{
  const root = await mkdtemp(join(tmpdir(), "pi-unity-plan-tool-"));
  const project = join(root, "Game");
  const calls: string[][] = [];
  try {
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.1.0f1\n");
    await writeFile(join(project, "Packages", "manifest.json"), "{\"dependencies\":{}}\n");
    await mkdir(join(project, "Library", "Pipeline"), { recursive: true });
    await writeFile(join(project, "Library", "Pipeline", ".unity-pipeline-port"), JSON.stringify({ capabilities: ["exec.argv"] }));
    const canonicalProject = await realpath(project);
    let malformedEvalDescriptor = false;
    const pi = fakePi(async (_command, args) => {
      calls.push(args);
      if (args.includes("--version")) return { code: 0, stdout: "1.0.0", stderr: "" };
      if (args.includes("pipeline") && args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: canonicalProject, pid: 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
      if (args.includes("command") && !args.includes("get_authoring_root") && !args.includes("eval")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: [
        { name: "get_authoring_root", parameters: [] },
        { name: "eval", parameters: malformedEvalDescriptor ? [{ name: "code", type: "String", required: true }, null] : [{ name: "code", type: "String", required: true }, { name: "timeout", type: "Int32", required: false, defaultValue: 5000 }] },
      ] } }), stderr: "" };
      const connectedCommand = args[args.indexOf("--timeout") + 2];
      return connectedCommand === "eval"
        ? { code: 0, stdout: JSON.stringify({ success: true, data: { result: { success: true, result: 42, diagnostics: [] } } }), stderr: "" }
        : { code: 0, stdout: JSON.stringify({ success: true, data: { result: { root: "token=definitely-not-a-real-secret" } } }), stderr: "" };
    });
    registerUnity(pi as any);
    const ctx = { cwd: root, sessionManager: {}, mode: "print", hasUI: false, ui: {} };
    await emit(pi, "session_start", ctx);
    const pipelineInspection = pi.tools.find((item) => item.name === "unity_pipeline_inspect");
    const pipelineEval = pi.tools.find((item) => item.name === "unity_pipeline_eval");
    const result = await pipelineInspection.execute("test", { path: project, command: "get_authoring_root" }, undefined, undefined, ctx);
    assert.equal(result.details.pipelineInspection.outcome, "dispatched", JSON.stringify(result.details.pipelineInspection));
    assert.match(result.content[0].text, /token= \[redacted\]/);
    const evalResult = await pipelineEval.execute("eval", { path: project, code: "var s = UnityEngine.Application.dataPath; return s.Length;", timeoutSeconds: 86400 }, undefined, undefined, ctx);
    assert.equal(evalResult.details.pipelineEval.outcome, "dispatched", "The primary Pipeline eval tool must expose advertised arbitrary C# eval.");
    const handlerEvalCode = "return \"--not-a-flag\";";
    const handlerEvalResult = await pipelineEval.execute("handler-eval", { path: project, code: handlerEvalCode, timeoutSeconds: 12, handlerTimeoutMilliseconds: 321 }, undefined, undefined, ctx);
    assert.equal(handlerEvalResult.details.pipelineEval.outcome, "dispatched", "The registered native eval tool forwards a legitimately advertised handler timeout.");
    const handlerEvalCall = calls.find((args) => args.includes(handlerEvalCode));
    const handlerEvalIndex = handlerEvalCall!.indexOf("eval");
    assert.deepEqual(handlerEvalCall!.slice(handlerEvalIndex), ["eval", handlerEvalCode, "321"], "Registered eval preserves code as one argv token and appends milliseconds only after it.");
    assert.equal(handlerEvalCall!.filter(arg => arg === "--timeout").length, 1, "Registered eval keeps exactly one host timeout flag.");
    malformedEvalDescriptor = true;
    const evalDispatchCount = calls.filter(args => args.includes("eval") && args.includes("--timeout")).length;
    const malformedEvalResult = await pipelineEval.execute("malformed-handler-eval", { path: project, code: "return false;", handlerTimeoutMilliseconds: 321 }, undefined, undefined, ctx);
    assert.equal(malformedEvalResult.details.pipelineEval.outcome, "rejected", "The registered tool rejects malformed live descriptors before eval dispatch.");
    assert.equal(malformedEvalResult.details.pipelineEval.code, "planning_eval_timeout_unavailable");
    assert.equal(calls.filter(args => args.includes("eval") && args.includes("--timeout")).length, evalDispatchCount, "Malformed descriptor rejection has zero native eval dispatches.");
    const evalCall = calls.find((args) => args.includes("var s = UnityEngine.Application.dataPath; return s.Length;"));
    assert.equal(evalCall?.[evalCall.indexOf("--timeout") + 1], "86400", "Eval forwards its selected deadline to Unity CLI.");
    assert(calls.some((args) => args.includes("get_authoring_root")), "The guarded handler must dispatch only after discovery.");
    assert(calls.some((args) => args.includes("var s = UnityEngine.Application.dataPath; return s.Length;")), "The primary eval tool must preserve a local-variable C# snippet.");
    assert(calls.every((args) => !args.includes("open") && !args.includes("run") && !args.includes("Exit")), "Connected inspection must not launch or close Unity.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
{
  const root = await mkdtemp(join(tmpdir(), "pi-unity-pipeline-tools-"));
  const project = join(root, "Game");
  const dispatched: string[] = [];
  try {
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.1.0f1\n");
    await writeFile(join(project, "Packages", "manifest.json"), "{\"dependencies\":{\"com.unity.pipeline\":\"0.3.0-exp.1\"}}\n");
    const canonicalProject = await realpath(project);
    let playMode = true;
    const pi = fakePi(async (_command, args) => {
      if (args.includes("--version")) return { code: 0, stdout: "1.0.0", stderr: "" };
      if (args.includes("pipeline") && args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: canonicalProject, pid: 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
      if (args.includes("command") && !args.includes("--timeout")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: ["editor_status", "editor_stop", "recompile", "recompile_status", "run_tests", "test_status"] } }), stderr: "" };
      const command = args[args.indexOf("--timeout") + 2];
      dispatched.push(command);
      if (command === "editor_status") return { code: 0, stdout: JSON.stringify({ success: true, data: { result: { status: "ready", playMode: playMode ? "playing" : "stopped" } } }), stderr: "" };
      if (command === "editor_stop") { playMode = false; return { code: 0, stdout: JSON.stringify({ success: true, data: { result: "Exited play mode", success: true } }), stderr: "" }; }
      if (command === "recompile") return { code: 0, stdout: JSON.stringify({ success: true, data: { result: { status: "up_to_date" } } }), stderr: "" };
      if (command === "test_status") return { code: 0, stdout: JSON.stringify({ success: true, data: { result: JSON.stringify({ status: "no_tests", message: "No test run in progress" }) } }), stderr: "" };
      if (command === "run_tests") return { code: 0, stdout: JSON.stringify({ success: true, data: { result: { status: "completed", mode: "editor", summary: { total: 21, passed: 21, failed: 0 }, tests: [{ name: "Passing.Record", result: "Passed" }] } } }), stderr: "" };
      throw new Error(`Unexpected Pipeline command: ${String(command)}`);
    });
    registerUnity(pi as any);
    const notifications: string[] = [];
    const branch = () => pi.entries.map((entry, index) => ({ type: "custom", id: String(index), ...entry }));
    const ctxA = { cwd: root, sessionManager: { getBranch: () => [] }, mode: "print", hasUI: false, ui: { setStatus() {}, notify(message: string) { notifications.push(message); } } };
    const ctxB = { cwd: root, sessionManager: { getBranch: branch }, mode: "print", hasUI: false, ui: { setStatus() {}, notify(message: string) { notifications.push(message); } } };
    await emit(pi, "session_start", ctxA);
    await emit(pi, "session_start", ctxB);
    const recompile = pi.tools.find((item) => item.name === "unity_pipeline_recompile");
    const tests = pi.tools.find((item) => item.name === "unity_run_tests");
    const projectStatus = pi.tools.find((item) => item.name === "unity_project_status");
    const statusResult = await projectStatus.execute("status-call", { path: project }, undefined, undefined, ctxA);
    assert.match(statusResult.content[0].text, /declared Unity 6000\.1\.0f1/, "Project status lazily loads the declared version required for Pipeline capability checks.");
    const defaultTestResult = await tests.execute("default-test-call", { path: project, testPlatform: "EditMode" }, undefined, undefined, ctxA);
    assert.match(defaultTestResult.content[0].text, /21 executed/);
    assert.equal(dispatched.includes("editor_stop"), true, "Play Mode exit is allowed by default.");
    const playModeCommand = pi.commands.find((item) => item.name === "unity-playmode-exit");
    await playModeCommand.handler("disallow", ctxA);
    assert.deepEqual(pi.entries.at(-1), { customType: "pi-unity-session-settings-v1", data: { allowAutonomousPlayModeExit: false } });
    assert.match(notifications.at(-1) ?? "", /disabled/);
    playMode = true;
    await playModeCommand.handler("allow", ctxB);
    assert.deepEqual(pi.entries.at(-1), { customType: "pi-unity-session-settings-v1", data: { allowAutonomousPlayModeExit: true } });
    await assert.rejects(() => tests.execute("isolated-session-test-call", { path: project, testPlatform: "EditMode" }, undefined, undefined, ctxA), /Play Mode exit is disabled/, "An explicit session restriction must not be changed by another session.");
    await emit(pi, "session_shutdown", ctxA);
    await emit(pi, "session_start", ctxB); // Session reload/resume reconstructs B's explicit toggle from its branch entries.
    const compileResult = await recompile.execute("compile-call", { path: project }, undefined, undefined, ctxB);
    const testResult = await tests.execute("test-call", { path: project, testPlatform: "EditMode" }, undefined, undefined, ctxB);
    assert.match(compileResult.content[0].text, /up to date/);
    assert.equal(compileResult.details.pipeline.exitedPlayMode, false, "Recompile leaves lifecycle to Unity when editor_status lacks script-change policy.");
    assert.equal(compileResult.details.pipeline.playModeHandling, "policy_unknown");
    assert.match(compileResult.content[0].text, /did not send editor_stop/);
    assert.match(testResult.content[0].text, /21 executed/);
    assert.equal(testResult.details.pipeline.exitedPlayMode, true, "Connected tests retain their verified Play Mode exit path.");
    assert.equal(testResult.details.pipeline.playModeHandling, "agent_exited");
    assert.equal(JSON.stringify(testResult).includes("Passing.Record"), false, "Registered tool results must not retain passing test records.");
    assert.equal(dispatched.filter((command) => command === "editor_stop").length, 2);
    assert.equal(dispatched.filter((command) => command === "recompile").length, 1);
    assert.equal(dispatched.filter((command) => command === "run_tests").length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
// Execute the published serial recipe through registered tools and Pi's native
// finalizer. The continuation decision below is scripted, not model behavior.
{
  const skill = await readFile(new URL("../skills/unity-pipeline-workflows/SKILL.md", import.meta.url), "utf8");
  const recipe = [...skill.matchAll(/```json\r?\n([^`]+)\r?\n```/g)].map(match => JSON.parse(match[1]!));
  assert.equal(recipe.length, 2);
  assert.deepEqual(recipe.map(params => params.testFilters), [["Synthetic.InventoryFixture"], ["Synthetic.DialogueFixture"]], "The recipe must not duplicate or broaden fixtures.");
  assert(recipe.every(params => params.path === "./SyntheticGame" && params.testPlatform === "EditMode" && params.execution === "connected" && !params.testCategories));
  const root = await mkdtemp(join(tmpdir(), "pi-unity-selector-recipe-"));
  try {
    const project = join(root, "SyntheticGame");
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"));
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.1.0f1\n");
    await writeFile(join(project, "Packages", "manifest.json"), '{"dependencies":{"com.unity.pipeline":"0.3.0-exp.1"}}');
    const canonical = await realpath(project);
    for (const scenario of ["passed", "malformed", "timeout", "displaced", "zero", "active"] as const) {
      const commands: string[][] = [];
      const pi = fakePi(async (_command, args) => {
        if (args.includes("--version")) return { code: 0, stdout: "1.0.0", stderr: "" };
        const response = (result: unknown) => ({ code: 0, stdout: JSON.stringify({ success: true, data: { result } }), stderr: "" });
        if (args.includes("pipeline") && args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: canonical, pid: 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
        if (args.includes("command") && !args.includes("--timeout")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: ["editor_status", "run_tests", "test_status"] } }), stderr: "" };
        commands.push(args);
        const command = args[args.indexOf("--timeout") + 2];
        if (command === "editor_status") return response({ status: "ready", playMode: "stopped" });
        if (command === "test_status") return response({ status: scenario === "active" ? "running" : "no_tests" });
        assert.equal(command, "run_tests", "No Editor closure, launch, fallback or lifecycle dispatch is permitted.");
        if (scenario === "malformed") return { code: 0, stdout: "not JSON", stderr: "" };
        if (scenario === "timeout") return { code: null, killed: true, stdout: "", stderr: "" };
        const filter = args[args.indexOf("--filter") + 1];
        const total = scenario === "zero" ? 0 : 1;
        return response({ status: "completed", mode: "editor", filter: scenario === "displaced" ? "Synthetic.Unrelated" : filter, summary: { total, passed: total, failed: 0 }, tests: total ? [{ name: `${filter}.One`, result: "Passed" }] : [] });
      });
      registerUnity(pi as any);
      const tool = pi.tools.find(item => item.name === "unity_run_tests");
      const ctx = { cwd: root, sessionManager: {}, mode: "print", hasUI: false, ui: {} };
      assert.match(tool.parameters.properties.testFilters.description, /one test-name selector/);
      assert.match(tool.parameters.properties.testCategories.description, /one category/);
      assert.match(tool.promptGuidelines.join(" "), /Stop the remaining sequence/);
      const results: any[] = [];
      for (const params of recipe) {
        const result = await nativeToolResult(pi, tool, params, ctx);
        results.push(result);
        if (result.isError || result.details?.testResult?.outcome !== "passed") break;
        assert.equal(result.details.route, "connected");
        const artifact = JSON.parse(await readFile(join(project, result.details.artifactPath), "utf8"));
        assert.deepEqual(artifact.selection, { testFilters: params.testFilters, testCategories: [] });
        assert.equal(artifact.summary.total, 1);
        assert.deepEqual(artifact.tests.map((test: any) => test.name), [`${params.testFilters[0]}.One`]);
      }
      const runs = commands.filter(args => args.includes("run_tests"));
      assert.equal(results.length, scenario === "passed" ? 2 : 1, `${scenario}: scripted recipe stops remaining calls`);
      assert.equal(runs.length, scenario === "passed" ? 2 : scenario === "active" ? 0 : 1, `${scenario}: no automatic second dispatch or retry`);
      assert.deepEqual(runs.map(args => args[args.indexOf("--filter") + 1]), recipe.slice(0, runs.length).map(params => params.testFilters[0]));
      assert(runs.every(args => args[args.indexOf("--filter_type") + 1] === "testName"));
      if (scenario !== "passed") assert.equal(results[0].isError, true, `${scenario}: native failure`);
      else {
        assert.notEqual(results[0].details.artifactPath, results[1].details.artifactPath);
        for (const execution of ["auto", "connected"]) {
          for (const selection of [
            { testFilters: ["Synthetic.InventoryFixture", "Synthetic.DialogueFixture"] },
            { testCategories: ["SyntheticA", "SyntheticB"] },
            { testFilters: ["Synthetic.InventoryFixture"], testCategories: ["SyntheticA"] },
          ]) {
            const before = commands.length;
            const rejection = await nativeToolResult(pi, tool, { path: project, testPlatform: "EditMode", execution, ...selection }, ctx);
            assert.equal(rejection.isError, true);
            assert.match(rejection.content[0].text, /No tests were dispatched/);
            assert.match(rejection.content[0].text, /separate execution: "connected" calls/);
            assert.match(rejection.content[0].text, /Do not split a mixed/);
            assert.equal(commands.length, before, "Rejected selectors never reach operation or lifecycle commands.");
          }
        }
        const before = commands.length;
        const semicolon = await nativeToolResult(pi, tool, { ...recipe[0], testFilters: ["Synthetic.A;Synthetic.B"] }, ctx);
        assert.equal(semicolon.isError, true);
        assert.match(semicolon.content[0].text, /semicolons/);
        assert.equal(commands.length, before);
        const category = await nativeToolResult(pi, tool, { path: project, testPlatform: "EditMode", execution: "connected", testCategories: ["SyntheticCategory"] }, ctx);
        assert.equal(category.isError, false);
        const categoryRun = commands.filter(args => args.includes("run_tests")).at(-1)!;
        assert.equal(categoryRun[categoryRun.indexOf("--filter_type") + 1], "category");
        assert.equal(categoryRun[categoryRun.indexOf("--filter") + 1], "SyntheticCategory");
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
{
  const root = await mkdtemp(join(tmpdir(), "pi-unity-native-failure-"));
  try {
    await mkdir(join(root, "ProjectSettings"));
    await mkdir(join(root, "Packages"));
    await writeFile(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.1.0f1\n");
    await writeFile(join(root, "Packages", "manifest.json"), '{"dependencies":{"com.unity.pipeline":"0.3.0-exp.1"}}');
    const project = await realpath(root);
    const ctx = { cwd: project, sessionManager: {}, mode: "print", hasUI: false, ui: {} };
    for (const name of ["unity_pipeline_eval", "unity_pipeline_inspect"]) {
      for (const scenario of ["success", "identity", "unadvertised", "dispatch-failed", "timeout", "thrown-timeout", "malformed", "reported-failure"]) {
        const calls: string[][] = [];
        let discoveries = 0;
        const command = name === "unity_pipeline_eval" ? "eval" : "get_authoring_root";
        const pi = fakePi(async (_command, args) => {
          calls.push(args);
          if (args.includes("--version")) return { code: 0, stdout: "1.0.0", stderr: "" };
          if (args.includes("pipeline") && args.includes("list")) {
            discoveries++;
            return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: project, pid: scenario === "identity" && discoveries > 1 ? 43 : 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
          }
          if (args.includes("command") && !args.includes("--timeout")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: scenario === "unadvertised" ? ["editor_status"] : [command] } }), stderr: "" };
          assert.equal(args[args.indexOf("--timeout") + 2], command, "Only the selected command may dispatch.");
          if (scenario === "dispatch-failed") return { code: 1, stdout: "", stderr: "Synthetic dispatch error" };
          if (scenario === "timeout") return { code: null, killed: true, stdout: "", stderr: "" };
          if (scenario === "thrown-timeout") throw Object.assign(new Error("Synthetic timeout"), { code: "ETIMEDOUT" });
          if (scenario === "malformed") return { code: 0, stdout: "not JSON", stderr: "" };
          if (scenario === "reported-failure") return { code: 0, stdout: JSON.stringify({ success: true, data: { success: false, result: { success: false, diagnostics: [{ severity: "Error", message: "Synthetic diagnostic" }] } } }), stderr: "" };
          return { code: 0, stdout: JSON.stringify({ success: true, data: { result: { success: true, result: 42, diagnostics: [] } } }), stderr: "" };
        });
        registerUnity(pi as any);
        const tool = pi.tools.find(item => item.name === name);
        const result = await nativeToolResult(pi, tool, { path: project, ...(command === "eval" ? { code: "return 42;", timeoutSeconds: 12 } : { command }) }, ctx);
        assert.equal(result.isError, scenario !== "success", `${name}/${scenario} native failure`);
        const detail = command === "eval" ? result.details.pipelineEval : result.details.pipelineInspection;
        assert.equal(detail.outcome, scenario === "success" ? "dispatched" : "rejected");
        const expectedCode = { identity: "unity_project_identity_changed", unadvertised: "planning_command_unadvertised", "dispatch-failed": "planning_command_failed", timeout: "planning_command_timeout", "thrown-timeout": "planning_command_timeout", malformed: "planning_command_malformed", "reported-failure": "planning_command_reported_failure" }[scenario];
        if (expectedCode) assert.equal(detail.code, expectedCode, `${name}/${scenario} structured reason`);
        if (["timeout", "thrown-timeout", "dispatch-failed"].includes(scenario)) assert.match(detail.message, /effect may be uncertain/, "Failure after dispatch never implies no mutation occurred.");
        if (scenario === "reported-failure") assert.match(detail.message, /Synthetic diagnostic/);
        const dispatches = calls.filter(args => args.includes("command") && args.includes("--timeout"));
        assert.equal(dispatches.length, ["identity", "unadvertised"].includes(scenario) ? 0 : 1, `${name}/${scenario}: zero retry or fallback`);
        assert(calls.every(args => !args.some(arg => ["open", "run", "test", "Exit", "editor_stop"].includes(arg))), "No lifecycle, launch, test or fallback commands.");
      }
    }
    const pi = fakePi();
    registerUnity(pi as any);
    const hook = pi.handlers.get("tool_result")![0];
    const rejection = { mode: "pipeline_eval", pipelineEval: { outcome: "rejected", code: "synthetic", message: "synthetic" } };
    assert.equal(await hook({ toolName: "unrelated_tool", details: rejection, isError: false }, ctx), undefined, "Other tools are not classified by Unity-shaped content.");
    assert.equal(await hook({ toolName: "unity_pipeline_eval", details: { ...rejection, mode: "unrelated" }, isError: false }, ctx), undefined);
    assert.equal(await hook({ toolName: "unity_pipeline_eval", details: undefined, isError: true }, ctx), undefined, "Existing thrown failures are never cleared.");
  } finally { await rm(root, { recursive: true, force: true }); }
}
{
  const root = await mkdtemp(join(tmpdir(), "pi-unity-artifact-contract-"));
  try {
    await mkdir(join(root, "ProjectSettings"));
    await mkdir(join(root, "Packages"));
    await mkdir(join(root, "Logs"));
    await writeFile(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.1.0f1\n");
    await writeFile(join(root, "Packages", "manifest.json"), '{"dependencies":{}}');
    let dispatches = 0;
    const pi = fakePi(async () => { dispatches++; throw new Error("Artifact inspection must not execute Unity"); });
    registerUnity(pi as any);
    const tool = pi.tools.find(item => item.name === "unity_inspect_artifacts");
    const ctx = { cwd: root, sessionManager: {}, mode: "print", hasUI: false, ui: {} };
    const inspect = (params: any) => tool.execute("artifacts", { path: root, ...params }, undefined, undefined, ctx);
    const base: NormalizedUnityTestResult = {
      schemaVersion: 1, source: "pipeline", platform: "EditMode", selection: { testFilters: ["Synthetic.Suite"], testCategories: [] },
      outcome: "passed", summary: { total: 2, passed: 2, failed: 0 }, tests: [{ name: "Synthetic.One", status: "Passed" }],
    };
    const artifact = async (result: NormalizedUnityTestResult) => writeNormalizedUnityTestArtifact(root, result);
    const passing = await artifact(base);
    const latest = await inspect({});
    assert.equal(latest.details.testOutcome, "passed", "JSON-only discovery is first-class inspection input.");
    assert.match(latest.content[0].text, /does not establish current-run identity/);
    const flaky = await artifact({ ...base, outcome: "passed_with_flakes", flakyTests: [{ name: "Synthetic.One", attempts: 2 }] });
    assert.equal((await inspect({ normalizedResultPath: flaky })).details.testOutcome, "passed_with_flakes");
    // Existing unrelated latest XML/logs must not be selected for an exact JSON request.
    await writeFile(join(root, "Logs", "unrelated.xml"), '<test-run total="1" passed="0" failed="1"></test-run>');
    await writeFile(join(root, "Logs", "unrelated.log"), "Synthetic previous run log");
    const success = await inspect({ normalizedResultPath: passing });
    assert.equal(success.details.status, "passed");
    assert.equal(success.details.testOutcome, "passed");
    assert.equal(success.details.normalizedResult.testRecordCount, 1, "Bounded records need not equal total.");
    assert.equal(success.details.normalizedResult.tests, undefined, "Routine output must not retain all records.");
    assert.equal(success.details.artifacts.testResultsPath, undefined, "Explicit request disables unrelated latest XML.");
    assert.equal(success.details.artifacts.logFilePath, undefined);
    const failed = await artifact({ ...base, outcome: "tests_failed", summary: { total: 1, passed: 0, failed: 1 }, tests: [{ name: "Synthetic.Failing", status: "Failed", message: "Synthetic assertion mismatch" }] });
    const failure = await inspect({ normalizedResultPath: failed, latestFromLogs: false });
    assert.equal(failure.details.status, "passed", "Successful inspection is not a passing test run.");
    assert.equal(failure.details.testOutcome, "tests_failed");
    assert.match(failure.content[0].text, /Synthetic assertion mismatch/);
    for (const outcome of ["uncertain", "timed_out", "cancelled", "run_error", "empty_selection"] as const) {
      const zero = await artifact({ ...base, outcome, summary: { total: 0, passed: 0, failed: 0 }, tests: [] });
      const result = await inspect({ normalizedResultPath: zero });
      assert.equal(result.details.status, "passed", outcome);
      assert.equal(result.details.testOutcome, outcome, "Valid uncertainty/empty evidence never becomes passing tests.");
    }
    const unknown = await artifact({ ...base, outcome: "uncertain", summary: {}, tests: [] });
    assert.equal((await inspect({ normalizedResultPath: unknown })).details.testOutcome, "uncertain", "Schema-v1 counts are optional, not invented.");
    for (const [label, value] of [
      ["malformed", "{"], ["null", "null"], ["partial", { schemaVersion: 1, outcome: "passed" }],
      ["schema", { ...base, schemaVersion: 2 }], ["source", { ...base, source: "unknown" }],
      ["platform", { ...base, platform: "Unknown" }], ["outcome", { ...base, outcome: "ok" }],
      ["selection", { ...base, selection: {} }], ["records", { ...base, tests: [null] }],
      ["zero-pass", { ...base, summary: { total: 0, passed: 0, failed: 0 }, tests: [] }],
      ["unknown-pass", { ...base, summary: {}, tests: [] }],
      ["inconsistent", { ...base, summary: { total: 1, passed: 2, failed: 0 } }],
      ["fractional", { ...base, summary: { total: 1.5, passed: 1.5, failed: 0 } }],
      ["negative", { ...base, summary: { total: 2, passed: 2, failed: -1 } }],
      ["record-conflict", { ...base, tests: [{ name: "Synthetic.Failing", status: "Failed" }] }],
      ["identity", { ...base, backendArtifacts: { nunit: "../other/results.xml" } }],
      ["timestamp", { ...base, completedAt: "not-a-date" }],
    ] as const) {
      const file = join(root, "Logs", `${label}.json`);
      await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
      await assert.rejects(() => inspect({ normalizedResultPath: file }), /could not be loaded\/validated/, label);
    }
    for (const key of ["normalizedResultPath", "testResultsPath", "logFilePath"]) {
      await assert.rejects(() => inspect({ [key]: "Logs/missing-evidence", ...(key === "normalizedResultPath" ? {} : { normalizedResultPath: passing }) }), /missing-evidence/, `Missing explicit ${key} must not be masked by valid other evidence.`);
    }
    await assert.rejects(() => inspect({ latestFromLogs: false }), /No valid Unity artifacts/);
    const xmlPath = join(root, "Logs", "exact.xml");
    await writeFile(xmlPath, '<test-run total="2" passed="2" failed="0"></test-run>');
    const linked = await artifact({ ...base, source: "unity-cli", backendArtifacts: { nunit: "Logs/exact.xml" } });
    const mixed = await inspect({ normalizedResultPath: linked, testResultsPath: xmlPath });
    assert.equal(mixed.details.testOutcome, "passed", "Matching linked native evidence is supported.");
    const selectedLinked = await inspect({});
    assert.equal(selectedLinked.details.normalizedResultPath?.endsWith(linked.split(/[\\/]/).pop()!), true, "Latest JSON is the sole primary selection.");
    assert.equal(selectedLinked.details.artifacts.testResultsPath?.endsWith("exact.xml"), true, "Only the primary JSON's validated NUnit link is followed.");
    assert.equal(selectedLinked.details.artifacts.logFilePath, undefined, "Unrelated newer logs are not automatically recruited.");
    const uncorrelated = await inspect({ normalizedResultPath: passing, testResultsPath: xmlPath });
    assert.equal(uncorrelated.details.testOutcome, "uncertain", "Matching counts alone do not establish shared run identity.");
    assert.match(uncorrelated.content[0].text, /no shared run identity/);
    await assert.rejects(() => inspect({ normalizedResultPath: linked, testResultsPath: "Logs/unrelated.xml" }), /Conflicting/);
    await writeFile(join(root, "Logs", "different-run.xml"), '<test-run total="2" passed="2" failed="0"></test-run>');
    await assert.rejects(() => inspect({ normalizedResultPath: linked, testResultsPath: "Logs/different-run.xml" }), /Conflicting artifact identity/, "Identical counts must not mask an explicit run path mismatch.");
    await writeFile(xmlPath, '<test-run total="1" passed="2" failed="0"></test-run>');
    await assert.rejects(() => inspect({ testResultsPath: xmlPath }), /inconsistent counts/);
    await writeFile(xmlPath, '<test-run total="2" passed="1" failed="1"></test-run>');
    await assert.rejects(() => inspect({ normalizedResultPath: linked, testResultsPath: xmlPath }), /Conflicting normalized\/XML/);
    const xmlFailure = await inspect({ testResultsPath: xmlPath });
    assert.equal(xmlFailure.details.status, "passed");
    assert.equal(xmlFailure.details.testOutcome, "tests_failed");
    // Gate1: contradictions must fail in both XML-only and linked JSON/XML inspection.
    const gateLinked = await artifact({ ...base, source: "unity-cli", summary: { total: 1, passed: 1, failed: 0 }, tests: [], backendArtifacts: { nunit: "Logs/exact.xml" } });
    const gateOutcomes: string[] = [];
    for (const contradictoryXml of [
      '<test-run total="1" passed="1" failed="0" skipped="1"></test-run>',
      '<test-run total="1" passed="1" failed="0"><test-case name="Synthetic.Failed" result="Failed" /></test-run>',
    ]) {
      await writeFile(xmlPath, contradictoryXml);
      for (const mixed of [false, true]) {
        try {
          const result = await inspect({ testResultsPath: xmlPath, ...(mixed ? { normalizedResultPath: gateLinked } : {}) });
          gateOutcomes.push(`${result.details.status}/${result.details.testOutcome}`);
        } catch (error) {
          assert.match(String(error), /Conflicting .*evidence/);
          gateOutcomes.push("rejected");
        }
      }
    }
    assert.deepEqual(gateOutcomes, ["rejected", "rejected", "rejected", "rejected"], "Both Gate1 counterexamples must reject XML-only and linked mixed inspection.");

    for (const contradictoryXml of [
      '<test-run total="1" passed="1" failed="0" inconclusive="1"></test-run>',
      '<test-run total="1" passed="1" failed="0" skipped="not-a-count"></test-run>',
      '<test-run total="1" passed="1" failed="0" skipped=""></test-run>',
      `<test-run total="1" passed="1" failed="0"><test-case name='Synthetic.SingleQuotedFailure' result='Failed' /></test-run>`,
      '<test-run total="2" passed="1" failed="0" skipped="1" inconclusive="1"></test-run>',
      '<test-run total="1" passed="1" failed="0"><test-case name="Synthetic.Skipped" result="Skipped" /></test-run>',
      '<test-run total="1" passed="1" failed="0"><test-case name="Synthetic.Inconclusive" result="Inconclusive" /></test-run>',
      '<test-run total="1" passed="1" failed="0"><test-case name="Synthetic.Failed" success="False" /></test-run>',
      '<test-run total="1" passed="1" failed="0"><test-case name="Synthetic.One" result="Passed" /><test-case name="Synthetic.Two" result="Passed"></test-case></test-run>',
    ]) {
      await writeFile(xmlPath, contradictoryXml);
      await assert.rejects(() => inspect({ testResultsPath: xmlPath }), /Conflicting XML evidence/);
    }
    // Count evidence beyond the retained-record limit without requiring complete records.
    const boundedRecords = Array.from({ length: 2001 }, (_, index) => `<test-case name="Synthetic.Passing${index}" result="Passed" />`).join("");
    await writeFile(xmlPath, `<test-run total="2002" passed="2002" failed="0">${boundedRecords}<test-case name="Synthetic.LateSkipped" result="Skipped" /></test-run>`);
    await assert.rejects(() => inspect({ testResultsPath: xmlPath }), /Conflicting XML evidence/, "Truncation cannot hide a late conflicting record.");
    await writeFile(xmlPath, '<test-run passed="1" failed="0" skipped="1"></test-run>');
    assert.equal((await inspect({ testResultsPath: xmlPath })).details.testOutcome, "uncertain", "A missing total alone is not a contradiction.");
    await assert.rejects(() => inspect({ testResultsPath: xmlPath, normalizedResultPath: gateLinked }), /Conflicting normalized\/XML evidence/, "A linked total must still agree with XML-only counters.");
    await writeFile(xmlPath, '<test-run total="1" passed="1" failed="0"><test-case name="Synthetic.Unknown" /></test-run>');
    for (const mixed of [false, true]) assert.equal((await inspect({ testResultsPath: xmlPath, ...(mixed ? { normalizedResultPath: gateLinked } : {}) })).details.testOutcome, "uncertain", "Unknown record outcomes are not passing records.");
    for (const { xml, summary, outcome, records } of [
      { xml: '<test-run total="1" passed="1" failed="0"></test-run>', summary: { total: 1, passed: 1, failed: 0 }, outcome: "passed", records: 0 },
      { xml: '<test-run total="2" passed="2" failed="0"><test-case name="Synthetic.Partial" result="Passed" /></test-run>', summary: { total: 2, passed: 2, failed: 0 }, outcome: "passed", records: 1 },
      { xml: '<test-run total="1" passed="0" failed="1"><test-case name="Synthetic.Failed" result="Failed" /></test-run>', summary: { total: 1, passed: 0, failed: 1 }, outcome: "tests_failed", records: 1 },
      { xml: '<test-run total="2" passed="1" failed="0" skipped="1"><test-case name="Synthetic.Skipped" result="Skipped" /></test-run>', summary: { total: 2, passed: 1, failed: 0, skipped: 1 }, outcome: "uncertain", records: 1 },
      { xml: '<test-run total="2" passed="1" failed="0" inconclusive="1"><test-case name="Synthetic.Inconclusive" result="Inconclusive" /></test-run>', summary: { total: 2, passed: 1, failed: 0, inconclusive: 1 }, outcome: "uncertain", records: 1 },
      { xml: '<test-run total="3" passed="1" failed="0" skipped="1" inconclusive="1"></test-run>', summary: { total: 3, passed: 1, failed: 0, skipped: 1, inconclusive: 1 }, outcome: "uncertain", records: 0 },
      { xml: '<test-run passed="1" failed="0"><test-case name="Synthetic.Partial" result="Passed" /></test-run>', summary: { passed: 1, failed: 0 }, outcome: "uncertain", records: 1 },
    ] as const) {
      await writeFile(xmlPath, xml);
      const control = await artifact({ ...base, source: "unity-cli", summary, outcome, tests: [], backendArtifacts: { nunit: "Logs/exact.xml" } });
      for (const mixed of [false, true]) {
        const result = await inspect({ testResultsPath: xmlPath, ...(mixed ? { normalizedResultPath: control } : {}) });
        assert.equal(result.details.status, "passed", "Consistent partial/optional evidence remains inspectable.");
        assert.equal(result.details.testOutcome, outcome);
        assert.equal(result.details.parsedTestResults.tests.length, records);
        assert.equal(result.details.parsedTestResults.skipped, "skipped" in summary ? summary.skipped : undefined, "Omitted skipped is not synthesized from inconclusive.");
        if (outcome === "tests_failed") assert.equal(result.details.parsedTestResults.failedTests[0].name, "Synthetic.Failed");
      }
    }
    const logOnly = await inspect({ logFilePath: "Logs/unrelated.log" });
    assert.equal(logOnly.details.status, "passed");
    assert.equal(logOnly.details.testOutcome, undefined, "A loaded log alone is not test evidence.");
    assert.equal(dispatches, 0, "All artifact cases are read-only and offline.");
  } finally { await rm(root, { recursive: true, force: true }); }
}
// Registered-tool U1 acceptance: only correlated terminal Pipeline responses may create a durable
// non-passing artifact, and native tool_result must retain that evidence as an error.
{
  const root = await mkdtemp(join(tmpdir(), "pi-unity-terminal-evidence-"));
  try {
    const project = join(root, "Game");
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"));
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.1.0f1\n");
    await writeFile(join(project, "Packages", "manifest.json"), '{"dependencies":{"com.unity.pipeline":"0.3.0-exp.1"}}');
    const canonical = await realpath(project);
    const ctx = { cwd: root, sessionManager: {}, mode: "print", hasUI: false, ui: {} };
    const invoke = async (terminal: any, polled = false, partialPoll?: any, preflight?: any) => {
      const calls: string[][] = [];
      const pi = fakePi(async (_command, args) => {
        calls.push(args);
        if (args.includes("--version")) return { code: 0, stdout: "1.0.0", stderr: "" };
        if (args.includes("pipeline") && args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: canonical, pid: 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
        if (args.includes("command") && !args.includes("--timeout")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: ["editor_status", "run_tests", "test_status"] } }), stderr: "" };
        const command = args[args.indexOf("--timeout") + 2];
        const envelope = (result: any) => ({ code: 0, stdout: JSON.stringify({ success: true, data: { result } }), stderr: "" });
        if (command === "editor_status") return envelope({ status: "idle" });
        if (command === "test_status") {
          const statusCalls = calls.filter(call => call[call.indexOf("--timeout") + 2] === "test_status").length;
          if (preflight) return envelope(preflight);
          if (polled && statusCalls > 1) return envelope(partialPoll && statusCalls === 2 ? partialPoll : terminal);
          return envelope({ status: "no_tests" });
        }
        if (command === "run_tests") return envelope(polled ? { status: "running", mode: "editor", filter: "Synthetic.Target" } : terminal);
        throw new Error(`Unexpected Pipeline command ${command}`);
      });
      registerUnity(pi as any);
      const tool = pi.tools.find(item => item.name === "unity_run_tests");
      return { result: await nativeToolResult(pi, tool, { path: project, testPlatform: "EditMode", execution: "connected", testFilters: ["Synthetic.Target"] }, ctx), calls };
    };
    for (const [terminal, polled, outcome] of [
      [{ status: "completed", mode: "editor", filter: "Synthetic.Target", summary: {} }, false, "uncertain"],
      [{ status: "completed", mode: "editor", filter: "Synthetic.Target", summary: { total: 0, passed: 0, failed: 0 } }, false, "uncertain"],
      [{ status: "completed", mode: "editor", filter: "Synthetic.Target", summary: { total: 1.5, passed: 1.5, failed: 0 } }, false, "uncertain"],
      [{ status: "completed", mode: "editor", filter: "Synthetic.Target", summary: { total: 1, passed: 1, failed: -1 } }, true, "uncertain"],
      [{ status: "completed", mode: "editor", filter: "Synthetic.Target", summary: { total: 1, passed: 1, failed: 0 }, tests: [{ name: "Synthetic.Failed", result: "Failed" }] }, true, "tests_failed"],
      [{ status: "completed", mode: "editor", filter: "Synthetic.Target", summary: { total: 1, passed: 1, failed: 0 }, tests: [{ name: "Synthetic.One", result: "Passed" }, { name: "Synthetic.Two", result: "Passed" }] }, false, "uncertain"],
      [{ status: "failed", mode: "editor", filter: "Synthetic.Target", summary: { total: 1, passed: 0, failed: 1 }, tests: [{ name: "Synthetic.Failed", result: "Failed" }] }, false, "tests_failed"],
      [{ status: "error", mode: "editor", filter: "Synthetic.Target", error: "Synthetic runner initialization failed" }, true, "run_error"],
      [{ status: "cancelled", mode: "editor", filter: "Synthetic.Target", summary: { total: 2, passed: 0, failed: 1 }, tests: [{ name: "Synthetic.Failed", result: "Failed" }] }, true, "cancelled"],
    ] as const) {
      const { result, calls } = await invoke(terminal, polled);
      assert.equal(result.isError, true, `Terminal ${JSON.stringify(terminal)} polled=${polled} evidence is a native tool error: ${JSON.stringify(result.details)}`);
      assert.equal(result.details.testResult.outcome, outcome);
      assert.match(result.details.artifactPath, /^Logs\/pi-unity-tests-editmode-/);
      const stored = validateNormalizedUnityTestArtifact(JSON.parse(await readFile(join(project, result.details.artifactPath), "utf8")));
      assert.equal(stored.outcome, outcome);
      assert(stored.diagnostics?.length, "Terminal observations are retained in schema-valid diagnostics.");
      if (outcome === "uncertain") assert.deepEqual(stored.summary, {}, "Contradictory or invalid counts are never made authoritative.");
      assert.equal(calls.filter(args => args[args.indexOf("--timeout") + 2] === "run_tests").length, 1, "Terminal evidence never redispatches.");
      assert(!calls.some(args => args.includes("open") || args.includes("run") || args.includes("test") || args.includes("editor_stop")), "Terminal evidence never changes lifecycle or route.");
    }
    for (const [terminal, polled] of [
      [{ status: "failed", mode: "playmode", filter: "Other", summary: { total: 1, passed: 0, failed: 1 } }, false],
      [{ status: "cancelled", mode: "playmode", filter: "Other", summary: { total: 1, passed: 0, failed: 0 } }, true],
    ] as const) {
      const before = await readdir(join(project, "Logs")).catch(() => [] as string[]);
      const { result, calls } = await invoke(terminal, polled);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /different mode or filter|displaced/, "Mismatched terminal state is not attributed.");
      const after = await readdir(join(project, "Logs")).catch(() => [] as string[]);
      assert.deepEqual(after, before, "Mismatched direct/polled terminal state writes no artifact.");
      assert.equal(calls.filter(args => args[args.indexOf("--timeout") + 2] === "run_tests").length, 1);
    }
    for (const active of [
      { status: "running", mode: "editor", filter: "Synthetic.Target", summary: { total: 2, passed: 0, failed: 0, skipped: 1 }, tests: [{ name: "Synthetic.Skipped", result: "Skipped" }] },
      { status: "running", mode: "editor", filter: "Synthetic.Target", summary: { total: 2, passed: 0, failed: 0, inconclusive: 1 }, tests: [{ name: "Synthetic.Inconclusive", result: "Inconclusive" }] },
      { status: "running", mode: "editor", filter: "Synthetic.Target", summary: { total: 2, passed: 0, failed: 1 }, tests: [{ name: "Synthetic.Unknown", result: "Unknown" }, { name: "Synthetic.Failed", result: "Failed" }] },
    ]) {
      const before = await readdir(join(project, "Logs"));
      const { result, calls } = await invoke({ status: "completed", summary: {} }, false, undefined, active);
      assert.equal(result.isError, true, "Active preflight remains a native error regardless of partial records.");
      assert.match(result.content[0].text, /pre-existing connected Unity test run/);
      assert.equal(calls.filter(args => args[args.indexOf("--timeout") + 2] === "run_tests").length, 0, "Active preflight never dispatches a replacement run.");
      assert.deepEqual(await readdir(join(project, "Logs")), before, "Active preflight writes no artifact.");
    }
    const polledPartial = await invoke(
      { status: "completed", mode: "editor", filter: "Synthetic.Target", summary: { total: 1, passed: 1, failed: 0 }, tests: [{ name: "Synthetic.Terminal", result: "Passed" }] },
      true,
      { status: "running", mode: "editor", filter: "Synthetic.Target", summary: { total: 2, passed: 0, failed: 0, skipped: 1 }, tests: [{ name: "Synthetic.Skipped", result: "Skipped" }] },
    );
    assert.equal(polledPartial.result.isError, false, "Partial polling records wait for a correlated terminal response.");
    assert.equal(polledPartial.result.details.testResult.outcome, "passed");
    assert.equal(polledPartial.calls.filter(args => args[args.indexOf("--timeout") + 2] === "run_tests").length, 1, "Polling partial evidence never redispatches.");
    const preflightPi = fakePi(async (_command, args) => {
      if (args.includes("--version")) return { code: 0, stdout: "1.0.0", stderr: "" };
      if (args.includes("pipeline")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: canonical, pid: 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
      if (args.includes("command") && !args.includes("--timeout")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: ["editor_status", "run_tests", "test_status"] } }), stderr: "" };
      const command = args[args.indexOf("--timeout") + 2];
      return { code: 0, stdout: JSON.stringify({ success: true, data: { result: command === "editor_status" ? { status: "idle" } : { status: "running" } } }), stderr: "" };
    });
    registerUnity(preflightPi as any);
    const preflightTool = preflightPi.tools.find(item => item.name === "unity_run_tests");
    const beforePreflight = await readdir(join(project, "Logs"));
    await assert.rejects(() => preflightTool.execute("preflight", { path: project, testPlatform: "EditMode", execution: "connected" }, undefined, undefined, ctx), /pre-existing/);
    assert.deepEqual(await readdir(join(project, "Logs")), beforePreflight, "Pre-dispatch rejection writes no current-run artifact.");
    await rm(join(project, "Logs"), { recursive: true, force: true }); await writeFile(join(project, "Logs"), "blocked");
    const persistence = await invoke({ status: "completed", mode: "editor", filter: "Synthetic.Target", summary: {} });
    assert.equal(persistence.result.isError, true, "Artifact persistence failure is a native error.");
    assert.match(persistence.result.content[0].text, /Durable terminal evidence could not be persisted/);
    assert.doesNotMatch(persistence.result.content[0].text, /Normalized artifact:/, "A failed persistence never claims an artifact path.");
    assert.equal(persistence.calls.filter(args => args[args.indexOf("--timeout") + 2] === "run_tests").length, 1, "Persistence failure never replays dispatch.");
  } finally { await rm(root, { recursive: true, force: true }); }
}
// U2 acceptance uses the public inspection tool so selection and link failures cannot be
// hidden by a helper-only test. Windows ACL permission denial is intentionally not asserted:
// chmod does not reliably remove the current user's directory access on that platform.
{
  const root = await mkdtemp(join(tmpdir(), "pi-unity-primary-artifact-"));
  try {
    await mkdir(join(root, "ProjectSettings")); await mkdir(join(root, "Packages")); await mkdir(join(root, "Logs"));
    await writeFile(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.1.0f1\n");
    await writeFile(join(root, "Packages", "manifest.json"), "{\"dependencies\":{}}");
    const pi = fakePi(async () => { throw new Error("Inspection must not dispatch Unity"); }); registerUnity(pi as any);
    const tool = pi.tools.find(item => item.name === "unity_inspect_artifacts");
    assert.match(tool.parameters.properties.latestFromLogs.description, /one newest top-level Logs JSON.*NUnit\/log links.*Without JSON.*XML alone.*log context/, "Registered schema describes the primary/link/fallback policy.");
    const ctx = { cwd: root, sessionManager: {}, mode: "print", hasUI: false, ui: {} };
    const inspect = (params: any = {}) => tool.execute("inspect", { path: root, ...params }, undefined, undefined, ctx);
    const valid = (outcome: NormalizedUnityTestResult["outcome"] = "passed", backendArtifacts?: Record<string, string>) => JSON.stringify({ schemaVersion: 1, source: "pipeline", platform: "EditMode", selection: { testFilters: [], testCategories: [] }, outcome, summary: outcome === "passed" ? { total: 1, passed: 1, failed: 0 } : {}, tests: [], ...(backendArtifacts ? { backendArtifacts } : {}) });
    const logs = join(root, "Logs");
    const reset = async () => { await rm(logs, { recursive: true, force: true }); await mkdir(logs); };
    const stamp = new Date("2026-09-14T12:00:00.000Z");

    await writeFile(join(logs, "older.json"), valid()); await utimes(join(logs, "older.json"), stamp, stamp);
    await writeFile(join(logs, "newer.json"), "{"); await utimes(join(logs, "newer.json"), new Date(+stamp + 1_000), new Date(+stamp + 1_000));
    await assert.rejects(() => inspect(), /newer\.json/, "Corrupt newest JSON must not fall back to older evidence.");
    await writeFile(join(logs, "newer.json"), "x".repeat(2_000_001));
    await assert.rejects(() => inspect(), /newer\.json.*size limit/, "Oversized newest JSON remains the visible primary failure.");

    await reset(); await writeFile(join(logs, "primary.json"), valid("passed", { nunit: "Logs/missing.xml", log: "Logs/missing.log" }));
    await assert.rejects(() => inspect(), /primary\.json.*missing/, "Missing declared links fail without recruiting unrelated files.");
    await writeFile(join(logs, "unrelated.xml"), '<test-run total="1" passed="1" failed="0"></test-run>');
    await writeFile(join(logs, "unrelated.log"), "unrelated");
    await assert.rejects(() => inspect(), /missing/, "Unrelated XML/log files do not repair a missing declared link.");

    await reset(); await writeFile(join(logs, "b.json"), valid("uncertain")); await writeFile(join(logs, "a.json"), valid());
    await utimes(join(logs, "a.json"), stamp, stamp); await utimes(join(logs, "b.json"), stamp, stamp);
    const tied = await inspect();
    assert.match(tied.content[0].text, /a\.json/, "Equal mtimes use deterministic filename ordering.");
    await writeFile(join(logs, "unrelated.xml"), '<test-run total="1" passed="0" failed="1"></test-run>'); await writeFile(join(logs, "unrelated.log"), "unrelated");
    const explicit = await inspect({ normalizedResultPath: "Logs/a.json" });
    assert.equal(explicit.details.artifacts.testResultsPath, undefined, "Explicit paths disable automatic XML selection.");
    assert.equal(explicit.details.artifacts.logFilePath, undefined, "Explicit paths disable automatic log selection.");
    await assert.rejects(() => inspect({ normalizedResultPath: "Logs/a.json", testResultsPath: "Logs/unrelated.xml" }), /no shared run identity|Conflicting/, "Explicit multi-path evidence remains strictly validated.");

    await reset(); await writeFile(join(logs, "only.xml"), '<test-run total="1" passed="1" failed="0"></test-run>'); await writeFile(join(logs, "unrelated.log"), "context");
    const xmlOnly = await inspect(); assert.equal(xmlOnly.details.testOutcome, "passed"); assert.equal(xmlOnly.details.artifacts.logFilePath, undefined, "XML-only fallback does not mix a log.");
    await reset(); await writeFile(join(logs, "only.log"), "context");
    const logOnly = await inspect(); assert.equal(logOnly.details.testOutcome, undefined, "Log-only context establishes no test outcome.");
    await reset(); await assert.rejects(() => inspect(), /No valid Unity artifacts/); await assert.rejects(() => inspect({ latestFromLogs: false }), /No valid Unity artifacts/);

    await reset(); await writeFile(join(logs, "actual.xml"), '<test-run total="1" passed="1" failed="0"></test-run>'); await writeFile(join(logs, "primary.json"), valid("passed", { nunit: "Logs/alias.xml" }));
    try {
      await symlink(join(logs, "actual.xml"), join(logs, "alias.xml"), "file");
      const containedAlias = await inspect();
      assert.equal(containedAlias.details.status, "passed", "Canonical contained aliases match their declared NUnit link.");
      assert.match(containedAlias.content[0].text, /primary\.json/, "Primary JSON provenance remains visible.");
    } catch (error: any) { assert(["EPERM", "EACCES"].includes(error?.code), `Only unavailable symlink privileges may skip contained-alias coverage: ${String(error)}`); }
    const outside = `${root}-outside.xml`;
    await reset(); await writeFile(outside, '<test-run total="1" passed="1" failed="0"></test-run>'); await writeFile(join(logs, "primary.json"), valid("passed", { nunit: "Logs/escape.xml" }));
    try {
      await symlink(outside, join(logs, "escape.xml"), "file");
      await assert.rejects(() => inspect(), /escapes the project root/, "Canonical symlink containment rejects escaping links.");
    } catch (error: any) { assert(["EPERM", "EACCES"].includes(error?.code) || /escapes the project root/.test(String(error)), `Only unavailable symlink privileges may skip canonical containment: ${String(error)}`); }
  } finally { await rm(root, { recursive: true, force: true }); await rm(`${root}-outside.xml`, { force: true }); }
}
console.log("pi-unity reverse load-order, result-contract and delayed-shutdown registration tests passed");

{
  const warningSymbol = Symbol.for("@aefree/pi-unity/unity-cli-warning/v1");
  const resetWarning = () => { delete (globalThis as Record<PropertyKey, unknown>)[warningSymbol]; };
  const createUiContext = (hasUI = true) => {
    const notifications: string[] = [];
    return {
      notifications,
      ctx: { cwd: process.cwd(), sessionManager: {}, mode: hasUI ? "tui" : "print", hasUI, ui: { setStatus() {}, notify(message: string) { notifications.push(message); } } },
    };
  };

  try {
    resetWarning();
    const unavailable = createUiContext();
    const unity = fakePi(async () => ({ code: 1, stdout: "", stderr: "invalid configured CLI" }));
    registerUnity(unity as any);
    await emit(unity, "session_start", unavailable.ctx);
    await emit(unity, "session_start", { ...unavailable.ctx, sessionManager: {} });
    assert.equal(unavailable.notifications.length, 1, "Unavailable Unity CLI warns once per runtime across session scopes.");
    assert.match(unavailable.notifications[0] ?? "", /Unity CLI/i);
    assert.match(unavailable.notifications[0] ?? "", /restart or reload Pi/i);
    assert.equal(unavailable.notifications[0]?.includes(process.cwd()), false, "Capability warning must not expose a configured local path.");

    resetWarning();
    const successful = createUiContext();
    const successfulPi = fakePi(async () => ({ code: 0, stdout: "1.0.0", stderr: "" }));
    registerUnity(successfulPi as any);
    await emit(successfulPi, "session_start", successful.ctx);
    assert.equal(successful.notifications.length, 0, "A successful Unity CLI probe must not warn.");

    resetWarning();
    const timedOut = createUiContext();
    const timedOutPi = fakePi(async () => ({ code: null, killed: true, stdout: "", stderr: "" }));
    registerUnity(timedOutPi as any);
    await emit(timedOutPi, "session_start", timedOut.ctx);
    assert.equal(timedOut.notifications.length, 0, "A timed-out Unity CLI probe must not warn.");

    resetWarning();
    const timedOutError = createUiContext();
    const timedOutErrorPi = fakePi(async () => { throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }); });
    registerUnity(timedOutErrorPi as any);
    await emit(timedOutErrorPi, "session_start", timedOutError.ctx);
    assert.equal(timedOutError.notifications.length, 0, "A rejected timed-out Unity CLI probe must not warn.");

    resetWarning();
    const cancelled = createUiContext();
    const cancelledPi = fakePi(async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); });
    registerUnity(cancelledPi as any);
    await emit(cancelledPi, "session_start", cancelled.ctx);
    assert.equal(cancelled.notifications.length, 0, "A cancelled Unity CLI probe must not warn.");

    resetWarning();
    const noUi = createUiContext(false);
    let noUiProbeCount = 0;
    const noUiPi = fakePi(async () => { noUiProbeCount += 1; return { code: 1, stdout: "", stderr: "" }; });
    registerUnity(noUiPi as any);
    await emit(noUiPi, "session_start", noUi.ctx);
    assert.equal(noUiProbeCount, 0, "Headless sessions must not run the startup warning probe.");

    resetWarning();
    const configured = createUiContext();
    const configuredPath = "C:/private/unity-cli";
    const originalCliPath = process.env.UNITY_CLI_PATH;
    process.env.UNITY_CLI_PATH = configuredPath;
    try {
      const configuredPi = fakePi(async () => ({ code: 1, stdout: "", stderr: "invalid configured CLI" }));
      registerUnity(configuredPi as any);
      await emit(configuredPi, "session_start", configured.ctx);
      assert.equal(configured.notifications[0]?.includes(configuredPath), false, "Capability warning must not expose UNITY_CLI_PATH.");
    } finally {
      if (originalCliPath === undefined) delete process.env.UNITY_CLI_PATH;
      else process.env.UNITY_CLI_PATH = originalCliPath;
    }
  } finally {
    resetWarning();
  }
}
