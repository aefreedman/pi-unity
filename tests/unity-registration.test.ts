import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerProjectArtifacts from "@aefree/pi-project-artifacts/pi";
import registerWorkflow from "../../pi-workflow/extensions/index.ts";
import { resolveArtifactProfilesV1, resolveArtifactSearchServiceV1, resolveTodoLifecycleServiceV1 } from "@aefree/pi-project-artifacts/contracts/v1";
import { resolveRepositoryPoliciesV1 } from "@aefree/pi-repo-search/contracts/v1";
import { resolveWorkflowProvidersV1, resolveWorkflowServiceV1 } from "@aefree/pi-workflow/contracts/v1";
import registerUnity from "../index";
import { resolveUnityMigrationServiceV1 } from "../contracts/v1";

function fakePi(exec: (command: string, args: string[]) => Promise<any> = async () => ({ code: 0, stdout: "", stderr: "" })) {
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  const tools: any[] = [];
  const commands: any[] = [];
  let activeTools: string[] = [];
  return {
    handlers, tools, commands,
    on(name: string, handler: (event: any, ctx: any) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    registerTool(tool: any) { tools.push(tool); activeTools.push(tool.name); },
    registerCommand(name: string, command: any) { commands.push({ name, ...command }); },
    getActiveTools() { return [...activeTools]; },
    setActiveTools(names: string[]) { activeTools = [...names]; },
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
  if (order === "artifacts-first") { await emit(artifacts, "session_start", ctx); await emit(unity, "session_start", ctx); }
  else { await emit(unity, "session_start", ctx); await emit(artifacts, "session_start", ctx); }
  assert.equal(resolveArtifactSearchServiceV1(scope).outcome, "available", order);
  assert.equal(resolveTodoLifecycleServiceV1(scope).outcome, "available", order);
  assert.equal(resolveArtifactProfilesV1(scope).outcome, "available", order);
  assert.equal(resolveRepositoryPoliciesV1(scope).outcome, "available", order);
  assert.equal(resolveUnityMigrationServiceV1(scope).outcome, "available", order);
  const workflowProviders = resolveWorkflowProvidersV1(scope);
  assert.equal(workflowProviders.outcome, "available", order);
  assert.deepEqual(workflowProviders.records.map((provider) => provider.id), ["engine.unity"], order);
  assert.equal(unity.tools.filter((tool) => tool.name === "unity_migrate_solution_docs").length, 1);
  const planningTool = unity.tools.find((tool) => tool.name === "unity_plan_inspect");
  assert(planningTool, "pi-unity must register the guarded planning inspection tool");
  assert.deepEqual(planningTool.parameters.properties.command.enum, [
    "get_authoring_root", "get_build_settings", "get_player_settings", "get_scene_hierarchy",
    "editor_status", "list_open_scenes", "list_build_targets", "eval",
  ], "The tool schema must advertise only package-owned inspections plus exceptional eval.");
  assert.match(planningTool.promptGuidelines.join(" "), /never launches or closes Unity/i);
  assert.equal(artifacts.tools.filter((tool) => tool.name === "project_artifact_search").length, 1);
  await emit(unity, "session_shutdown", ctx);
  await emit(artifacts, "session_shutdown", ctx);
  assert.equal(resolveArtifactProfilesV1(scope).outcome, "missing");
  assert.equal(resolveRepositoryPoliciesV1(scope).outcome, "missing");
  assert.equal(resolveUnityMigrationServiceV1(scope).outcome, "missing");
  assert.equal(resolveWorkflowProvidersV1(scope).outcome, "missing");
  assert.equal(resolveArtifactSearchServiceV1(scope).outcome, "missing");
  assert.equal(resolveTodoLifecycleServiceV1(scope).outcome, "missing");
}

for (const order of ["workflow-first", "unity-first"] as const) {
  const scope = {};
  const ctx = { cwd: process.cwd(), sessionManager: scope, mode: "print", hasUI: false, ui: {} };
  const workflow = fakePi();
  const unity = fakePi();
  registerWorkflow(workflow as any);
  registerUnity(unity as any);
  if (order === "workflow-first") { await emit(workflow, "session_start", ctx); await emit(unity, "session_start", ctx); }
  else { await emit(unity, "session_start", ctx); await emit(workflow, "session_start", ctx); }
  assert.equal(resolveWorkflowProvidersV1(scope).outcome, "available", order);
  assert.equal(resolveWorkflowServiceV1(scope).outcome, "available", order);
  await emit(workflow, "session_shutdown", ctx);
  await emit(unity, "session_shutdown", ctx);
  assert.equal(resolveWorkflowProvidersV1(scope).outcome, "missing", order);
}

{
  const scopeA = {};
  const scopeB = {};
  const unity = fakePi();
  registerUnity(unity as any);
  const ctxA = { cwd: process.cwd(), sessionManager: scopeA, mode: "print", hasUI: false, ui: {} };
  const ctxB = { ...ctxA, sessionManager: scopeB };
  await emit(unity, "session_start", ctxA);
  await emit(unity, "session_start", ctxB);
  assert.equal(resolveUnityMigrationServiceV1(scopeA).outcome, "available");
  assert.equal(resolveUnityMigrationServiceV1(scopeB).outcome, "available");
  assert.equal(resolveArtifactProfilesV1(scopeA).outcome, "available");
  assert.equal(resolveArtifactProfilesV1(scopeB).outcome, "available");
  assert.equal(resolveRepositoryPoliciesV1(scopeA).outcome, "available");
  assert.equal(resolveRepositoryPoliciesV1(scopeB).outcome, "available");
  assert.equal(resolveWorkflowProvidersV1(scopeA).outcome, "available");
  assert.equal(resolveWorkflowProvidersV1(scopeB).outcome, "available");
  await emit(unity, "session_shutdown", ctxA);
  assert.equal(resolveUnityMigrationServiceV1(scopeA).outcome, "missing");
  assert.equal(resolveArtifactProfilesV1(scopeA).outcome, "missing");
  assert.equal(resolveRepositoryPoliciesV1(scopeA).outcome, "missing");
  assert.equal(resolveWorkflowProvidersV1(scopeA).outcome, "missing");
  assert.equal(resolveUnityMigrationServiceV1(scopeB).outcome, "available", "delayed old-session shutdown must preserve newer active scope");
  assert.equal(resolveArtifactProfilesV1(scopeB).outcome, "available", "delayed old-session shutdown must preserve newer active scope");
  assert.equal(resolveRepositoryPoliciesV1(scopeB).outcome, "available", "delayed old-session shutdown must preserve newer active scope");
  assert.equal(resolveWorkflowProvidersV1(scopeB).outcome, "available", "delayed old-session shutdown must preserve newer active scope");
  await emit(unity, "session_shutdown", ctxB);
  assert.equal(resolveUnityMigrationServiceV1(scopeB).outcome, "missing");
  assert.equal(resolveWorkflowProvidersV1(scopeB).outcome, "missing");
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
    const pi = fakePi(async (_command, args) => {
      calls.push(args);
      if (args[0] === "--version") return { code: 0, stdout: "1.0.0", stderr: "" };
      if (args.includes("pipeline") && args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { instances: [{ projectPath: project, pid: 42, pipelineServer: { isReachable: true } }] } }), stderr: "" };
      if (args.includes("list")) return { code: 0, stdout: JSON.stringify({ success: true, data: { commands: ["get_authoring_root"] } }), stderr: "" };
      return { code: 0, stdout: "token=definitely-not-a-real-secret", stderr: "" };
    });
    registerUnity(pi as any);
    const ctx = { cwd: root, sessionManager: {}, mode: "print", hasUI: false, ui: {} };
    await emit(pi, "session_start", ctx);
    const tool = pi.tools.find((item) => item.name === "unity_plan_inspect");
    const result = await tool.execute("test", { path: project, command: "get_authoring_root" }, undefined, undefined, ctx);
    assert.equal(result.details.planningInspection.outcome, "dispatched");
    assert.match(result.content[0].text, /token= \[redacted\]/);
    assert(calls.some((args) => args.includes("get_authoring_root")), "The guarded handler must dispatch only after discovery.");
    assert(calls.every((args) => !args.includes("open") && !args.includes("run") && !args.includes("Exit")), "Planning inspection must not launch or close Unity.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
console.log("pi-unity reverse load-order and delayed-shutdown registration tests passed");
