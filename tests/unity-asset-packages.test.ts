import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportUnitypackage, importUnitypackage, inspectUnitypackage, type AssetDependencies } from "../src/unity-asset-packages";

const goodInspect = (path = "Assets/Example.txt") => JSON.stringify({ success: true, command: "assets inspect", data: { count: 1, totalSize: 6, entries: [{ path, guid: "abcdef0123456789abcdef0123456789", size: 6, hasPreview: false }] }, errors: [], warnings: [] });
const goodMutation = JSON.stringify({ success: true, command: "assets export", data: {}, errors: [], warnings: [] });

async function fixture(run: (values: { root: string; project: string; archive: string; output: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "unity-assets-test-"));
  const project = join(root, "project");
  const guid = "abcdef0123456789abcdef0123456789";
  const archive = join(root, "package.unitypackage");
  const output = join(root, "export.unitypackage");
  try {
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.0f1");
    await mkdir(join(project, "Assets"));
    await writeFile(join(project, "Assets", "Example.txt"), "example");
    await mkdir(join(root, guid));
    await writeFile(join(root, guid, "pathname"), "Assets/Example.txt");
    await writeFile(join(root, guid, "asset"), "sample");
    execFileSync("tar", ["-czf", archive, "-C", root, guid]);
    await run({ root, project, archive, output });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("inspect uses a bounded local archive and reports declared entries, not import effects", async () => fixture(async ({ archive }) => {
  const calls: string[][] = [];
  const result = await inspectUnitypackage(archive, { execute: async (_, args) => { calls.push(args); return { stdout: goodInspect(), stderr: "" }; } });
  assert.equal(result.outcome, "inspected");
  assert.equal(result.details?.declaredCount, 1);
  assert.match(result.message, /does not prove import/);
  assert.deepEqual(calls, [["--format", "json", "--no-banner", "--non-interactive", "assets", "inspect", archive]]);
  const actual = execFileSync("unity", ["--format", "json", "--no-banner", "--non-interactive", "assets", "inspect", archive], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(actual).data.entries, result.details?.entries);
}));

test("inspect fails closed on malformed, excessive, warning diagnostics are bounded and redacted", async () => fixture(async ({ archive }) => {
  const bad = await inspectUnitypackage(archive, { execute: async () => ({ stdout: goodInspect("token=secret123"), stderr: "" }) });
  assert.equal((bad.details?.entries as { path: string }[])[0].path, "token= [redacted]");
  const malformed = await inspectUnitypackage(archive, { execute: async () => ({ stdout: "{", stderr: "password=secret123" }) });
  assert.equal(malformed.outcome, "rejected");
  assert.doesNotMatch(malformed.message, /secret123/);
  const huge = await inspectUnitypackage(archive, { execute: async () => ({ stdout: "x".repeat(2_100_000), stderr: "" }) });
  assert.equal(huge.code, "asset_output_oversized");
}));

test("import/export require guard; busy or unknown refuses with no mutation dispatch", async () => fixture(async ({ project, archive, output }) => {
  let dispatches = 0;
  const deps: AssetDependencies = { resolveProject: async () => project, execute: async () => { dispatches++; return { stdout: goodMutation, stderr: "" }; } };
  assert.equal((await importUnitypackage({ path: project, file: archive }, deps)).code, "asset_guard_missing");
  assert.equal((await exportUnitypackage({ path: project, assetPaths: ["Assets/Example.txt"], output }, deps)).code, "asset_guard_missing");
  deps.withSafeProjectLaunch = async () => { throw new Error("busy or unknown: token=private"); };
  assert.equal((await importUnitypackage({ path: project, file: archive }, deps)).code, "asset_preflight_failed");
  assert.equal(dispatches, 0);
}));

test("export rejects traversal, aliases, collision including dangling symlink, and dispatches once after guarded validation", async () => fixture(async ({ project, root, output }) => {
  const calls: string[][] = [];
  let guarded = false;
  const deps: AssetDependencies = { resolveProject: async () => project, withSafeProjectLaunch: async (_, action) => { guarded = true; return action(); }, execute: async (_, args) => { assert.equal(guarded, true); calls.push(args); return { stdout: goodMutation, stderr: "" }; } };
  for (const assetPaths of [["Assets/../ProjectSettings"], ["Assets\\Example.txt"], ["/Assets/Example.txt"], ["Assets//Example.txt"]]) {
    assert.equal((await exportUnitypackage({ path: project, assetPaths, output }, deps)).code, "asset_path_invalid");
  }
  await symlink(join(root, "missing"), output);
  assert.equal((await exportUnitypackage({ path: project, assetPaths: ["Assets/Example.txt"], output }, deps)).code, "asset_output_collision");
  await rm(output);
  await symlink(join(project, "Assets", "Example.txt"), join(project, "Assets", "Alias.txt"));
  assert.equal((await exportUnitypackage({ path: project, assetPaths: ["Assets/Alias.txt"], output }, deps)).code, "asset_path_invalid");
  assert.equal((await exportUnitypackage({ path: project, assetPaths: ["Assets/Example.txt"], output, includeDependencies: false }, deps)).outcome, "dispatched");
  assert.deepEqual(calls, [["--format", "json", "--no-banner", "--non-interactive", "assets", "export", "Assets/Example.txt", "--output", output, "--project", project, "--no-dependencies"]]);
}));

test("import validates the archive using inspect before its one mutation dispatch; failure stops", async () => fixture(async ({ project, archive }) => {
  const calls: string[][] = [];
  const deps: AssetDependencies = { resolveProject: async () => project, withSafeProjectLaunch: async (_, action) => action(), execute: async (_, args) => { calls.push(args); return { stdout: args.includes("inspect") ? goodInspect() : goodMutation, stderr: "" }; } };
  assert.equal((await importUnitypackage({ path: project, file: archive }, deps)).outcome, "dispatched");
  assert.deepEqual(calls.map(c => c[5]), ["inspect", "import"]);
  calls.length = 0;
  deps.execute = async (_, args) => { calls.push(args); return { stdout: "bad", stderr: "" }; };
  assert.equal((await importUnitypackage({ path: project, file: archive }, deps)).outcome, "rejected");
  assert.equal(calls.length, 1);
}));

test("exact-copy identity changes and timeout/failure never retry", async () => fixture(async ({ project, output }) => {
  let resolves = 0; let dispatches = 0;
  const deps: AssetDependencies = { resolveProject: async () => ++resolves === 1 ? project : join(project, "Assets"), withSafeProjectLaunch: async (_, action) => action(), execute: async () => { dispatches++; return { stdout: goodMutation, stderr: "" }; } };
  assert.equal((await exportUnitypackage({ path: project, assetPaths: ["Assets/Example.txt"], output }, deps)).code, "asset_project_changed");
  assert.equal(dispatches, 0);
  deps.resolveProject = async () => project;
  deps.execute = async () => { dispatches++; return { stdout: "", stderr: "", error: Object.assign(new Error("token=secret"), { code: "ETIMEDOUT" }) }; };
  assert.equal((await exportUnitypackage({ path: project, assetPaths: ["Assets/Example.txt"], output }, deps)).code, "asset_timeout");
  assert.equal(dispatches, 1);
}));
