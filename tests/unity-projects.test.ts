import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveUnityProjectCandidates } from "../src/unity-projects";

const root = await realpath(await mkdtemp(join(tmpdir(), "pi-unity-projects-")));
async function project(...segments: string[]): Promise<string> {
  const directory = join(root, ...segments);
  await mkdir(join(directory, "ProjectSettings"), { recursive: true });
  await mkdir(join(directory, "Assets"));
  await writeFile(join(directory, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.6.8f1\n");
  return directory;
}
try {
  const first = await project("workspace", "one", "Game");
  const second = await project("workspace", "two", "Game");
  await project("workspace", "one", "library", "Ignored");
  await project("workspace", "one", "Game", "Nested");
  await mkdir(join(root, "workspace", "Fake", "ProjectSettings", "ProjectVersion.txt"), { recursive: true });
  await mkdir(join(root, "workspace", "Fake", "Assets"));
  const alias = join(root, "workspace", "alias");
  await symlink(first, alias, process.platform === "win32" ? "junction" : "dir");
  const nearby = await resolveUnityProjectCandidates(root, "workspace");
  assert.equal(nearby.strategy, "descendants");
  assert.deepEqual(nearby.candidates.map(({ projectRoot }) => projectRoot), [first, second]);
  assert(!nearby.truncated && !nearby.incomplete);
  const containing = await resolveUnityProjectCandidates(root, join(alias, "Assets"));
  assert.equal(containing.strategy, "ancestor");
  assert.deepEqual(containing.candidates, [{ projectName: "Game", projectRoot: first }]);
  await assert.rejects(resolveUnityProjectCandidates(root, "missing"), { code: "ENOENT" });
  await assert.rejects(resolveUnityProjectCandidates(root, join(first, "ProjectSettings", "ProjectVersion.txt")), /start at a directory/);
  await assert.rejects(resolveUnityProjectCandidates(root, " "), /nonblank/);
  await assert.rejects(resolveUnityProjectCandidates(root, "workspace", AbortSignal.abort()), { name: "AbortError" });

  await project("depth", "a", "b", "c", "d", "Hidden");
  const deep = await resolveUnityProjectCandidates(root, "depth");
  assert.equal(deep.truncated, true);
  assert.deepEqual(deep.candidates, []);
  for (let i = 0; i < 21; i++) await project("count", `Game${String(i).padStart(2, "0")}`);
  const capped = await resolveUnityProjectCandidates(root, "count");
  assert.equal(capped.truncated, true);
  assert.equal(capped.candidates.length, 20);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Unity project discovery: filesystem markers, canonical aliases, exact copies and disclosed limits passed");
