import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerProjectArtifacts from "@aefree/pi-project-artifacts/pi";
import { resolveArtifactProfilesV1, resolveArtifactSearchServiceV1, resolveTodoLifecycleServiceV1 } from "@aefree/pi-project-artifacts/contracts/v1";
import { resolveFileDiscoveryFiltersV1 } from "@aefree/pi-file-discovery/contracts/v1";
import { initTheme } from "@earendil-works/pi-coding-agent";
import registerUnity from "../index";

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
  assert.equal(openEditorTool.parameters.properties.automated.default, false);
  assert.match(openEditorTool.parameters.properties.automated.description, /Unity Editor's -automated flag/);
  const recompileTool = unity.tools.find((tool) => tool.name === "unity_pipeline_recompile");
  const pipelineTestTool = unity.tools.find((tool) => tool.name === "unity_pipeline_run_tests");
  assert(recompileTool && pipelineTestTool, "pi-unity must register both bounded connected Pipeline execution tools");
  assert.equal(recompileTool.parameters.additionalProperties, false, "Pipeline recompile schema must be strict.");
  assert.equal(pipelineTestTool.parameters.additionalProperties, false, "Pipeline test schema must be strict.");
  assert.deepEqual(pipelineTestTool.parameters.properties.testPlatform.enum, ["EditMode", "PlayMode"]);
  assert.equal(pipelineTestTool.parameters.properties.testFilter.maxLength, 500);
  const evalTool = unity.tools.find((tool) => tool.name === "unity_pipeline_eval");
  assert(evalTool, "pi-unity must register Pipeline eval as the primary C# REPL tool");
  assert.equal(evalTool.parameters.additionalProperties, false);
  assert.equal(evalTool.parameters.properties.code.maxLength, 4000);
  const inspectionTool = unity.tools.find((tool) => tool.name === "unity_pipeline_inspect");
  assert(inspectionTool, "pi-unity must register the purpose-built Pipeline inspection tool");
  assert.equal(inspectionTool.parameters.additionalProperties, false);
  assert.deepEqual(inspectionTool.parameters.properties.command.enum, [
    "get_authoring_root", "get_build_settings", "get_player_settings", "get_scene_hierarchy",
    "editor_status", "list_open_scenes", "list_build_targets",
  ], "The inspection schema must advertise only package-owned purpose-built commands.");
  assert.match(inspectionTool.promptGuidelines.join(" "), /never launches or closes Unity/i);
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const rendererContext = { lastComponent: undefined };
  const testCall = pipelineTestTool.renderCall({ path: "C:/Game", testPlatform: "EditMode", testFilter: "Game.Fast" }, theme, rendererContext);
  assert.match(testCall.render(300).join("\n"), /EditMode • Game.Fast/, "Test call headers retain platform and bounded filter.");
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
  assert.match(inspectCall.render(300).join("\n"), /command=get_scene_hierarchy/);
  const partial = pipelineTestTool.renderResult({ content: [{ type: "text", text: "Unity EditMode tests running; 1.0s elapsed." }], details: {} }, { expanded: false, isPartial: true }, theme, rendererContext);
  assert.match(partial.render(300).join("\n"), /Unity Pipeline working/);
  const completedResult = {
    content: [{ type: "text", text: "Unity EditMode tests passed for C:/Game: 21 executed, 21 passed, 0 failed." }],
    details: { mode: "pipeline", status: "passed", pipeline: { operation: "tests", terminalState: "completed", elapsedSeconds: 2.4, testPlatform: "EditMode", counts: { total: 21, passed: 21, failed: 0 }, playModeHandling: "not_playing" } },
  };
  const completed = pipelineTestTool.renderResult(completedResult, { expanded: false, isPartial: false }, theme, { lastComponent: partial });
  assert.equal(completed, partial, "Pipeline result renderer reuses the partial Text component for the settled result.");
  assert.match(completed.render(300).join("\n"), /EditMode tests 21\/21 passed • 2.4s/);
  assert.match(completed.render(300).join("\n"), /details/, "Collapsed Pipeline results include the configured expansion hint.");
  const expanded = pipelineTestTool.renderResult(completedResult, { expanded: true, isPartial: false }, theme, { lastComponent: completed });
  assert.equal(expanded, completed, "Expanded Pipeline results reuse the settled Text component.");
  assert.match(expanded.render(300).join("\n"), /Unity EditMode tests passed for C:\/Game/, "Expanded Pipeline results show the bounded model-visible evidence.");
  const recompileWithoutPlayModeDetails = recompileTool.renderResult({
    content: [{ type: "text", text: "Unity recompile completed." }],
    details: { mode: "pipeline", status: "passed", pipeline: { operation: "recompile", terminalState: "completed", elapsedSeconds: 1.2 } },
  }, { expanded: false, isPartial: false }, theme, rendererContext);
  assert.match(recompileWithoutPlayModeDetails.render(300).join("\n"), /Unity recompile completed • 1.2s/, "Optional Play Mode details may be absent without breaking rendering.");
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
    const canonicalProject = await realpath(project);
    const pi = fakePi(async (_command, args) => {
      calls.push(args);
      if (args[0] === "--version") return { code: 0, stdout: "1.0.0", stderr: "" };
      if (args.includes("pipeline") && args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: canonicalProject, pid: 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
      if (args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: ["get_authoring_root", "eval"] } }), stderr: "" };
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
      if (args[0] === "--version") return { code: 0, stdout: "1.0.0", stderr: "" };
      if (args.includes("pipeline") && args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: canonicalProject, pid: 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
      if (args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: ["editor_status", "editor_stop", "recompile", "recompile_status", "run_tests", "test_status"] } }), stderr: "" };
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
    const tests = pi.tools.find((item) => item.name === "unity_pipeline_run_tests");
    const defaultTestResult = await tests.execute("default-test-call", { path: project, testPlatform: "EditMode" }, undefined, undefined, ctxA);
    assert.match(defaultTestResult.content[0].text, /21 executed, 21 passed, 0 failed/);
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
    assert.match(testResult.content[0].text, /21 executed, 21 passed, 0 failed/);
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
console.log("pi-unity reverse load-order and delayed-shutdown registration tests passed");
