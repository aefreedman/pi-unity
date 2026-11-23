import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import registerUnity from "../index";

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
assert.deepEqual([...extension.commands.keys()], ["unity-open"]);
const registered = extension.tools.get("unity_find_projects");
const root = await realpath(await mkdtemp(join(tmpdir(), "pi-unity-host-")));
try {
  for (const copy of ["alpha", "beta workspace"]) {
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
  assert.deepEqual(valid.result.details.candidates.map(({ projectRoot }) => projectRoot), [join(root, "alpha", "Game"), join(root, "beta workspace", "Game")]);
  assert.equal(valid.result.details.truncated, false);
  assert.equal(valid.result.details.incomplete, false);

  const invalid = await call("malformed", { path: { unexpected: true } });
  assert.equal(invalid.isError, true);
  assert.equal(executions, 1, "The host must reject malformed arguments without executing discovery.");

  // Use the real command handler and filesystem, but never launch Unity in tests.
  let open!: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"];
  const launches: { command: string; args: string[]; cwd: string | undefined }[] = [];
  let cliResult = { code: 0, stdout: "", stderr: "", killed: false, truncated: false };
  registerUnity({
    registerTool() {},
    registerCommand(name, options) {
      assert.equal(name, "unity-open");
      open = options.handler;
    },
    on() {},
    async exec(command, args, options) {
      launches.push({ command, args, cwd: options?.cwd });
      return cliResult;
    },
  } satisfies Pick<ExtensionAPI, "registerTool" | "registerCommand" | "on" | "exec"> as ExtensionAPI);

  const dialogs: { title: string; options: string[] }[] = [];
  const notifications: { message: string; level?: string }[] = [];
  let selection: string | undefined;
  const ui: Pick<ExtensionCommandContext["ui"], "select" | "notify"> = {
    async select(title, options) {
      dialogs.push({ title, options });
      return selection;
    },
    notify(message, level) { notifications.push({ message, level }); },
  };
  const invoke = (cwd: string, args = "", hasUI = true) => open(args, { cwd, hasUI, ui } as ExtensionCommandContext);
  const alpha = join(root, "alpha", "Game");
  const beta = join(root, "beta workspace", "Game");

  await invoke(join(alpha, "Assets"));
  await invoke(join(root, "alpha"));
  assert.equal(dialogs.length, 0);
  assert.deepEqual(launches.splice(0), [join(alpha, "Assets"), join(root, "alpha")].map(cwd => ({
    command: "unity", args: ["--no-banner", "--no-color", "--non-interactive", "open", alpha], cwd,
  })));

  await invoke(root);
  assert.deepEqual(dialogs.pop()?.options, [join("alpha", "Game"), join("beta workspace", "Game")]);
  assert.equal(launches.length, 0, "Cancelling the picker must not launch Unity.");
  selection = join("beta workspace", "Game");
  await invoke(root);
  await invoke(join(root, "alpha"), `"${join("..", "beta workspace", "Game")}"`);
  assert.deepEqual(launches.splice(0).map(({ args }) => args.slice(3)), [["open", beta], ["open", beta]]);

  await mkdir(join(root, "alpha", "nested", "a", "b", "c", "d"), { recursive: true });
  selection = undefined;
  await invoke(join(root, "alpha"));
  assert.deepEqual(dialogs.pop(), { title: "Open a found Unity project (search was incomplete)", options: ["Game"] });
  assert.equal(launches.length, 0, "A limited search with one match must not auto-open it.");

  const empty = join(root, "empty");
  await mkdir(empty);
  await invoke(empty);
  assert.equal(notifications.at(-1)?.level, "warning");
  await assert.rejects(invoke(root, beta, false), /needs a Pi UI/);
  assert.equal(launches.length, 0);

  cliResult = { ...cliResult, code: 1, stderr: "Native launch diagnostic" };
  await invoke(beta);
  assert.equal(notifications.at(-1)?.level, "error");
  assert.match(notifications.at(-1)!.message, /Native launch diagnostic/);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Pi host loads the read-only Unity project finder and the /unity-open command");
