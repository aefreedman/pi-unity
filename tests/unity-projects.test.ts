import assert from "node:assert/strict";
import fs, { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { mock } from "node:test";
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
  const lexical = await project("workspace", "Game");
  // POSIX resolves link/.. via the link target; some Windows volumes normalize
  // it lexically. The finder must always honor native path resolution.
  const viaParent = ["alias", "..", "Game"].join(sep);
  const nativeRoot = await realpath(`${join(root, "workspace")}${sep}${viaParent}`);
  if (process.platform !== "win32") assert.equal(nativeRoot, first);
  else assert([lexical, first].includes(nativeRoot));
  const linkedParent = await resolveUnityProjectCandidates(join(root, "workspace"), viaParent);
  assert.equal(linkedParent.candidates[0].projectRoot, nativeRoot);
  if (process.platform === "win32") {
    for (const ambiguous of ["C:relative", "\\drive-root-relative"]) {
      await assert.rejects(resolveUnityProjectCandidates(root, ambiguous), /fully qualified Windows path/);
    }
  }

  const nested = join(first, "Nested");
  const inaccessibleMarker = join(nested, "ProjectSettings", "ProjectVersion.txt");
  const realStat = fs.stat;
  const mockStat = mock.method(fs, "stat", (target: Parameters<typeof realStat>[0], ...opts: unknown[]) => {
    if (target === inaccessibleMarker) throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    return Reflect.apply(realStat, fs, [target, ...opts]);
  });
  syncBuiltinESMExports();
  try {
    const unreadable = await resolveUnityProjectCandidates(join(nested, "Assets"));
    assert.equal(unreadable.strategy, "ancestor");
    assert.equal(unreadable.incomplete, true);
    assert.deepEqual(unreadable.candidates, [], "Never infer the outer copy is nearest when a closer marker could not be read");
  } finally {
    mockStat.mock.restore();
    syncBuiltinESMExports();
  }

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

  const crowded = join(root, "crowded");
  await mkdir(crowded);
  for (let offset = 0; offset < 4_200; offset += 100) {
    await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(join(crowded, `file-${offset + index}`), "")));
  }
  const crowdedResult = await resolveUnityProjectCandidates(crowded);
  assert(crowdedResult.truncated, "Ordinary files must also count toward bounded discovery");
  assert(!crowdedResult.incomplete);
  assert.deepEqual(crowdedResult.candidates, []);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Unity project discovery: filesystem markers, canonical aliases, exact copies and disclosed limits passed");
