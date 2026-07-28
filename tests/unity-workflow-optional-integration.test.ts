import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveArtifactProfilesV1 } from "@aefree/pi-project-artifacts/contracts/v1";
import { resolveRepositoryPoliciesV1 } from "@aefree/pi-repo-search/contracts/v1";
import { resolveUnityMigrationServiceV1 } from "../contracts/v1";

const packagePath = fileURLToPath(new URL("../", import.meta.url));

type FakePi = ReturnType<typeof fakePi>;

function fakePi() {
  const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown>>();
  const tools: any[] = [];
  const commands: any[] = [];
  const emitted: Array<{ name: string; payload: any }> = [];
  return {
    handlers,
    tools,
    commands,
    emitted,
    on(name: string, handler: (event: unknown, ctx: any) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    registerTool(tool: any) { tools.push(tool); },
    registerCommand(name: string, command: any) { commands.push({ name, ...command }); },
    getActiveTools() { return tools.map((tool) => tool.name); },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    events: { emit(name: string, payload: any) { emitted.push({ name, payload }); }, on() {} },
  };
}

async function emitSessionStart(pi: FakePi, ctx: any): Promise<void> {
  for (const handler of pi.handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
}

async function createIsolatedCopy(name: string, workflow: "absent" | "broken"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pi-unity-workflow-${name}-`));
  for (const entry of ["index.ts", "src", "contracts", "references", "package.json"]) {
    await cp(join(packagePath, entry), join(root, entry), { recursive: true });
  }
  const nodeModules = join(root, "node_modules");
  await mkdir(join(nodeModules, "@aefree"), { recursive: true });
  for (const dependency of ["pi-capability-registry", "pi-project-artifacts", "pi-repo-search"]) {
    await symlink(join(packagePath, "node_modules", "@aefree", dependency), join(nodeModules, "@aefree", dependency), process.platform === "win32" ? "junction" : "dir");
  }
  for (const dependency of ["@earendil-works", "typebox"]) {
    await symlink(join(packagePath, "node_modules", dependency), join(nodeModules, dependency), process.platform === "win32" ? "junction" : "dir");
  }
  if (workflow === "broken") {
    const workflowRoot = join(nodeModules, "@aefree", "pi-workflow");
    await mkdir(workflowRoot, { recursive: true });
    await writeFile(join(workflowRoot, "package.json"), JSON.stringify({ type: "module", exports: { "./contracts/v1": "./contracts-v1.js" } }));
    await writeFile(join(workflowRoot, "contracts-v1.js"), 'throw new Error("intentionally broken workflow contract");\n');
  }
  return root;
}

async function loadIsolatedUnity(root: string): Promise<(pi: any) => void> {
  const module = await import(`${pathToFileURL(join(root, "index.ts")).href}?${encodeURIComponent(root)}`);
  return module.default;
}

{
  const root = await createIsolatedCopy("absent", "absent");
  try {
    const registerUnity = await loadIsolatedUnity(root);
    const pi = fakePi();
    registerUnity(pi as any);
    assert(pi.tools.some((tool) => tool.name === "unity_project_status"), "Workflow absence must not suppress Unity tools.");
    assert(pi.tools.some((tool) => tool.name === "unity_migrate_solution_docs"), "Workflow absence must not suppress Unity migration tools.");
    assert(pi.commands.some((command) => command.name === "unity-open"), "Workflow absence must not suppress Unity commands.");
    const scope = {};
    await emitSessionStart(pi, { cwd: root, sessionManager: scope, mode: "print", hasUI: false, ui: {} });
    assert.equal(resolveArtifactProfilesV1(scope).outcome, "available", "Workflow absence must retain the Unity artifact profile.");
    assert.equal(resolveRepositoryPoliciesV1(scope).outcome, "available", "Workflow absence must retain the Unity repository policy.");
    assert.equal(resolveUnityMigrationServiceV1(scope).outcome, "available", "Workflow absence must retain the Unity migration service.");
    assert.equal(pi.emitted.filter((event) => event.name === "pi-unity:capabilities-changed" && event.payload.action === "registered").length, 1, "Workflow absence must retain core session registration.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  const root = await createIsolatedCopy("broken", "broken");
  try {
    const registerUnity = await loadIsolatedUnity(root);
    const pi = fakePi();
    registerUnity(pi as any);
    await assert.rejects(
      () => emitSessionStart(pi, { cwd: root, sessionManager: {}, mode: "print", hasUI: false, ui: {} }),
      /intentionally broken workflow contract/,
      "A present but broken workflow contract must fail visibly rather than being treated as absent.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

console.log("pi-unity isolated optional workflow integration tests passed");
