import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveArtifactProfilesV1 } from "@aefree/pi-project-artifacts/contracts/v1";
import { resolveRepositoryPoliciesV1 } from "@aefree/pi-repo-search/contracts/v1";
import { resolveWorkflowGuidanceContributorsV1 } from "@aefree/pi-workflow/contracts/v1";

const packagePath = fileURLToPath(new URL("../", import.meta.url));
const workspacePath = dirname(packagePath);
const artifactPackagePath = join(workspacePath, "pi-project-artifacts");
const repoSearchPackagePath = join(workspacePath, "pi-repo-search");

const keys = {
  artifacts: "@aefree/pi-project-artifacts/profiles/v1",
  repoSearch: "@aefree/pi-repo-search/policies/v1",
  workflow: "@aefree/pi-workflow/guidance-contributors/v1",
} as const;

type FakePi = ReturnType<typeof fakePi>;
function fakePi() {
  const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown>>();
  const tools: any[] = [];
  return {
    handlers, tools,
    on(name: string, handler: (event: unknown, ctx: any) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    registerTool(tool: any) { tools.push(tool); },
    registerCommand() {},
    getActiveTools() { return tools.map((tool) => tool.name); },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    events: { emit() {}, on() {} },
  };
}
async function emit(pi: FakePi, name: "session_start" | "session_shutdown", ctx: any): Promise<void> {
  for (const handler of pi.handlers.get(name) ?? []) await handler({ reason: name === "session_start" ? "startup" : "quit" }, ctx);
}
function clearRendezvous(): void {
  for (const key of Object.values(keys)) delete (globalThis as Record<symbol, unknown>)[Symbol.for(key)];
}

/** pi-unity gets only Pi core modules; optional package roots remain external. */
async function createIsolatedUnityCopy(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pi-unity-optional-${name}-`));
  for (const entry of ["index.ts", "src", "references", "package.json"]) {
    await cp(join(packagePath, entry), join(root, entry), { recursive: true });
  }
  const nodeModules = join(root, "node_modules");
  await mkdir(join(nodeModules, "@aefree"), { recursive: true });
  for (const dependency of ["@earendil-works", "typebox"]) {
    await symlink(join(packagePath, "node_modules", dependency), join(nodeModules, dependency), process.platform === "win32" ? "junction" : "dir");
  }
  return root;
}
async function loadIsolatedUnity(root: string): Promise<(pi: any) => void> {
  const module = await import(`${pathToFileURL(join(root, "index.ts")).href}?${encodeURIComponent(root)}`);
  return module.default;
}
async function externalRegister(relativeModule: string): Promise<(pi: any) => void> {
  // This is deliberately imported from the peer package's own root, never from
  // the isolated pi-unity copy's node_modules.
  return (await import(pathToFileURL(join(workspacePath, relativeModule)).href)).default;
}

{
  clearRendezvous();
  const root = await createIsolatedUnityCopy("none");
  try {
    const registerUnity = await loadIsolatedUnity(root);
    const pi = fakePi();
    registerUnity(pi as any);
    const scope = {};
    await emit(pi, "session_start", { cwd: root, sessionManager: scope, mode: "print", hasUI: false, ui: {} });
    assert(pi.tools.some((tool) => tool.name === "unity_project_status"), "Optional integration absence must not suppress Unity tools.");
    assert.equal(resolveArtifactProfilesV1(scope).outcome, "missing");
    assert.equal(resolveRepositoryPoliciesV1(scope).outcome, "missing");
    assert.equal(resolveWorkflowGuidanceContributorsV1(scope).outcome, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
    clearRendezvous();
  }
}

for (const fixture of [
  { name: "artifacts", module: "pi-project-artifacts/src/pi/index.ts", resolve: (scope: object) => resolveArtifactProfilesV1(scope).outcome },
  { name: "repo-search", module: "pi-repo-search/extensions/index.ts", resolve: (scope: object) => resolveRepositoryPoliciesV1(scope).outcome },
  { name: "workflow", module: "pi-workflow/extensions/index.ts", resolve: (scope: object) => resolveWorkflowGuidanceContributorsV1(scope).outcome },
] as const) {
  clearRendezvous();
  const root = await createIsolatedUnityCopy(fixture.name);
  try {
    const [registerUnity, registerPeer] = await Promise.all([loadIsolatedUnity(root), externalRegister(fixture.module)]);
    const pi = fakePi();
    registerPeer(pi as any);
    registerUnity(pi as any);
    const scope = {};
    const ctx = { cwd: root, sessionManager: scope, mode: "print", hasUI: false, ui: {} };
    await emit(pi, "session_start", ctx);
    assert.equal(fixture.resolve(scope), "available", `${fixture.name} composes from its separate package root.`);
    await emit(pi, "session_shutdown", ctx);
    assert.equal(fixture.resolve(scope), "missing", `${fixture.name} record is removed on shutdown.`);
  } finally {
    await rm(root, { recursive: true, force: true });
    clearRendezvous();
  }
}

for (const [name, key, resolver] of [
  ["artifacts", keys.artifacts, (scope: object) => resolveArtifactProfilesV1(scope).outcome],
  ["repo-search", keys.repoSearch, (scope: object) => resolveRepositoryPoliciesV1(scope).outcome],
  ["workflow", keys.workflow, (scope: object) => resolveWorkflowGuidanceContributorsV1(scope).outcome],
] as const) {
  clearRendezvous();
  const root = await createIsolatedUnityCopy(`broken-${name}`);
  try {
    const registerUnity = await loadIsolatedUnity(root);
    const pi = fakePi();
    pi.registerTool({ name: name === "artifacts" ? "project_artifact_search" : name === "repo-search" ? "repository_search" : "workflow_guidance" });
    registerUnity(pi as any);
    (globalThis as Record<symbol, unknown>)[Symbol.for(key)] = { broken: true };
    await assert.rejects(
      () => emit(pi, "session_start", { cwd: root, sessionManager: {}, mode: "print", hasUI: false, ui: {} }),
      /incompatible capability-registry contract/,
      "An advertised but broken integration contract must fail visibly.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    clearRendezvous();
  }
}

for (const [failureAt, firstResolver, secondResolver] of [
  ["repo-search", (scope: object) => resolveArtifactProfilesV1(scope).outcome, undefined],
  ["workflow", (scope: object) => resolveArtifactProfilesV1(scope).outcome, (scope: object) => resolveRepositoryPoliciesV1(scope).outcome],
] as const) {
  clearRendezvous();
  const root = await createIsolatedUnityCopy(`rollback-${failureAt}`);
  try {
    const registerUnity = await loadIsolatedUnity(root);
    const pi = fakePi();
    for (const tool of ["project_artifact_search", "repository_search", "workflow_guidance"]) pi.registerTool({ name: tool });
    registerUnity(pi as any);
    const key = failureAt === "repo-search" ? keys.repoSearch : keys.workflow;
    class ThrowingWeakMap extends WeakMap<object, unknown> { override get(): undefined { throw new Error(`intentional ${failureAt} registration failure`); } }
    (globalThis as Record<symbol, unknown>)[Symbol.for(key)] = {
      protocol: "@aefree/pi-capability-registry/root", protocolVersion: 1, registryKey: key,
      versions: new Map([[1, { version: 1, scopes: new ThrowingWeakMap() }]]),
    };
    const scope = {};
    await assert.rejects(() => emit(pi, "session_start", { cwd: root, sessionManager: scope, mode: "print", hasUI: false, ui: {} }), /intentional .* registration failure/);
    assert.equal(firstResolver(scope), "missing", "Failed multi-integration registration rolls back the first record.");
    if (secondResolver !== undefined) assert.equal(secondResolver(scope), "missing", "Third-registration failure also rolls back the second record.");
  } finally {
    await rm(root, { recursive: true, force: true });
    clearRendezvous();
  }
}

console.log("pi-unity optional integration rendezvous and transactional registration tests passed");
