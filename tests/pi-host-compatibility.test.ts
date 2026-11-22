import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hostManifest = fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(JSON.parse(await readFile(hostManifest, "utf8")).version, manifest.devDependencies["@earendil-works/pi-coding-agent"]);
const { loadExtensions } = await import(pathToFileURL(join(dirname(hostManifest), "dist/core/extensions/loader.js")).href);
const loaded = await loadExtensions([resolve("index.ts")], process.cwd());
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const extension = loaded.extensions[0];
assert.deepEqual([...extension.tools.keys()], ["unity_find_projects"]);
assert.equal(extension.commands.size, 0);
const tool = extension.tools.get("unity_find_projects").definition;
const root = await realpath(await mkdtemp(join(tmpdir(), "pi-unity-host-")));
try {
  for (const copy of ["alpha", "beta"]) {
    const project = join(root, copy, "Game");
    await mkdir(join(project, "Assets"), { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.6.8f1\n");
  }
  const result = await tool.execute("discovery", {}, undefined, undefined, { cwd: root });
  assert.deepEqual(result.details.candidates.map(({ projectRoot }) => projectRoot), [join(root, "alpha", "Game"), join(root, "beta", "Game")]);
  assert.equal(result.details.truncated, false);
  assert.equal(result.details.incomplete, false);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Pi host loads the single read-only Unity project finder");
