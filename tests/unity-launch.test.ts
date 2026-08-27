import { strict as assert } from "node:assert";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { buildUnityEditorCandidates } from "../src/unity-core";
import { resolveUnityEditorPath } from "../src/unity-launch";

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
