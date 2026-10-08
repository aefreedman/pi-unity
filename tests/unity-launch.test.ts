import { strict as assert } from "node:assert";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { buildUnityEditorCandidates } from "../src/unity-core";
import { resolveUnityEditorPath } from "../src/unity-editor-fallback";

const root = await mkdtemp(`${tmpdir()}/pi-unity-launch-`);
const version = "6000.1.13f1";
const stalePath = `${root}/stale-editor`;
const previousEditorPath = process.env.UNITY_EDITOR_PATH;
const previousUnityPath = process.env.UNITY_PATH;

try {
  const [exactCandidate] = buildUnityEditorCandidates(version, "linux", root);
  assert(exactCandidate, "Expected a Linux exact-version candidate.");
  await mkdir(dirname(exactCandidate), { recursive: true });
  await writeFile(exactCandidate, "editor");
  await writeFile(stalePath, "stale editor");
  await chmod(exactCandidate, 0o755);
  await chmod(stalePath, 0o755);

  process.env.UNITY_EDITOR_PATH = stalePath;
  process.env.UNITY_PATH = stalePath;
  assert.equal(
    await resolveUnityEditorPath(version, { platform: "linux", homeDir: root }),
    exactCandidate,
    "Global Editor-path variables must not override the exact project-version candidate.",
  );

  await assert.rejects(
    resolveUnityEditorPath("6000.1.99f1", {
      platform: "linux",
      homeDir: root,
      access: async () => { throw new Error("missing"); },
    }),
    /Could not find a Unity Editor executable for Unity 6000\.1\.99f1.*Install that exact Editor version/s,
    "A missing exact version must fail without probing machine-wide installation paths.",
  );
} finally {
  if (previousEditorPath === undefined) delete process.env.UNITY_EDITOR_PATH;
  else process.env.UNITY_EDITOR_PATH = previousEditorPath;
  if (previousUnityPath === undefined) delete process.env.UNITY_PATH;
  else process.env.UNITY_PATH = previousUnityPath;
  await rm(root, { recursive: true, force: true });
}

console.log("pi-unity unity-launch tests passed");

// Synthetic process events only: never invoke Unity or an Editor.
const { launchUnityCliOpenDetached, summarizeUnityGuiLaunch } = await import("../src/unity-launch");
const { syntheticGuiSpawn } = await import("./unity-gui-fixture");
for (const code of [0, 1]) {
  const fake = syntheticGuiSpawn(child => {
    child.stdout.write("warning password=launch-secret");
    child.stderr.write(code ? "PROJECT_UPGRADE_REQUIRED: manual decision required" : "opened");
    child.emit("close", code, null);
  });
  const result = await launchUnityCliOpenDetached("synthetic-project", { spawn: fake.spawn, automated: true });
  assert.equal(result.outcome, code ? "failed" : "completed");
  assert.equal(result.cliPid, 987);
  assert.equal("pid" in result, false);
  assert.equal(result.diagnostics.includes("launch-secret"), false);
  assert.deepEqual(fake.calls[0].slice(-2), ["--args", "-automated"]);
  assert.equal(fake.calls.length, 1);
  assert.match(summarizeUnityGuiLaunch(result), code ? /No retry, direct fallback, or project upgrade/ : /readiness.*not verified/);
}
{
  const fake = syntheticGuiSpawn(child => child.emit("error", new Error("ENOENT password=spawn-secret")));
  const result = await launchUnityCliOpenDetached("synthetic", { spawn: fake.spawn });
  assert.equal(result.outcome, "failed");
  assert.match(result.diagnostics, /ENOENT/);
  assert.equal(result.diagnostics.includes("spawn-secret"), false);
}
for (const kind of ["timeout", "cancelled"] as const) {
  const controller = new AbortController();
  const fake = syntheticGuiSpawn(child => { if (kind === "cancelled") controller.abort(); });
  const result = await launchUnityCliOpenDetached("synthetic", { spawn: fake.spawn, signal: controller.signal, observationTimeoutMs: 10 });
  assert.equal(result.outcome, kind);
  assert.match(summarizeUnityGuiLaunch(result), /uncertain.*already be running/);
  fake.children[0].emit("close", 0, null); // late completion cannot reclassify uncertainty
  assert.equal(result.outcome, kind);
}
{
  const fake = syntheticGuiSpawn(child => {
    child.stdout.write("password=" + "s".repeat(70000));
    child.stderr.write("x".repeat(4500) + " password=tail-secret");
    child.emit("close", null, "SIGTERM");
  });
  const result = await launchUnityCliOpenDetached("synthetic", { spawn: fake.spawn });
  assert.equal(result.outcome, "failed");
  assert.match(result.diagnostics, /capture limit exceeded/);
  assert.match(result.diagnostics, /truncated/);
  assert.equal(result.diagnostics.includes("tail-secret"), false);
}
{
  const controller = new AbortController(); controller.abort();
  const result = await launchUnityCliOpenDetached("synthetic", { signal: controller.signal, spawn: () => { throw new Error("Must not dispatch"); } });
  assert.equal(result.outcome, "cancelled");
  const result2 = await launchUnityCliOpenDetached("synthetic", { spawn: () => { throw new Error("spawn failed"); } });
  assert.equal(result2.outcome, "failed");
}
console.log("bounded GUI CLI observation tests passed");
