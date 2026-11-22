import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hostManifest = fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(JSON.parse(await readFile(hostManifest, "utf8")).version, manifest.devDependencies["@earendil-works/pi-coding-agent"]);
const extensionsRoot = join(dirname(hostManifest), "dist/core/extensions");
const { loadExtensions } = await import(pathToFileURL(join(extensionsRoot, "loader.js")).href);
const { wrapRegisteredTool } = await import(pathToFileURL(join(extensionsRoot, "wrapper.js")).href);
const coreManifest = createRequire(hostManifest).resolve("@earendil-works/pi-agent-core/package.json");
const coreEntry = JSON.parse(await readFile(coreManifest, "utf8")).exports["."].import;
const { runToolCall } = await import(pathToFileURL(join(dirname(coreManifest), coreEntry)).href);
const loaded = await loadExtensions([resolve("index.ts")], process.cwd());
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const extension = loaded.extensions[0];
assert.deepEqual([...extension.tools.keys()], ["unity_find_projects"]);
assert.equal(extension.commands.size, 0);
const registered = extension.tools.get("unity_find_projects");
const root = await realpath(await mkdtemp(join(tmpdir(), "pi-unity-host-")));
try {
  for (const copy of ["alpha", "beta"]) {
    const project = join(root, copy, "Game");
    await mkdir(join(project, "Assets"), { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.6.8f1\n");
  }
  let executions = 0;
  const tool = wrapRegisteredTool(registered, {
    createToolContext() { executions++; return { cwd: root }; },
  });
  const assistantMessage = { role: "assistant", content: [] };
  const context = { messages: [assistantMessage], tools: [tool] };
  const call = (id: string, args: Record<string, unknown>) => runToolCall(
    { type: "toolCall", id, name: tool.name, arguments: args },
    { tools: [tool], assistantMessage, context },
  );
  const valid = await call("discovery", { path: root });
  assert.equal(valid.isError, false);
  assert.deepEqual(valid.result.details.candidates.map(({ projectRoot }) => projectRoot), [join(root, "alpha", "Game"), join(root, "beta", "Game")]);
  assert.equal(valid.result.details.truncated, false);
  assert.equal(valid.result.details.incomplete, false);

  const invalid = await call("malformed", { path: { unexpected: true } });
  assert.equal(invalid.isError, true);
  assert.equal(executions, 1, "The host must reject malformed arguments without executing discovery.");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Pi host loads the single read-only Unity project finder");
