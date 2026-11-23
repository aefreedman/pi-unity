import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
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

  const enter = "\r";
  const escape = "\x1b";
  const down = "\x1b[B";
  const tab = "\t";
  let input: string[] = [];
  let frames: string[][] = [];
  const rpcSelections: (string | undefined)[] = [];
  const notifications: { message: string; level?: string }[] = [];
  const ui: Pick<ExtensionCommandContext["ui"], "custom" | "select" | "notify"> = {
    async custom(factory, options) {
      const tui = { requestRender() {} } as Parameters<typeof factory>[0];
      const theme = { fg: (_color: string, text: string) => text } as Parameters<typeof factory>[1];
      let selection: { value: Parameters<Parameters<typeof factory>[3]>[0] } | undefined;
      const component = await factory(tui, theme, getKeybindings(), (value) => { selection = { value }; });
      assert.equal(options?.blocked?.kind, "question");
      frames = [component.render(120)];
      for (const key of input) {
        component.handleInput?.(key);
        frames.push(component.render(120));
      }
      assert(selection, "Picker did not finish after simulated input");
      return selection.value;
    },
    async select(_title, options) {
      const selection = rpcSelections.shift();
      if (selection !== undefined) assert(options.includes(selection));
      return selection;
    },
    notify(message, level) { notifications.push({ message, level }); },
  };
  const invoke = (cwd: string, keys: string[] = [], args = "", mode: ExtensionCommandContext["mode"] = "tui") => {
    input = keys;
    return open(args, { cwd, mode, hasUI: mode !== "print", ui } as ExtensionCommandContext);
  };
  const alpha = join(root, "alpha", "Game");
  const beta = join(root, "beta workspace", "Game");

  await invoke(join(alpha, "Assets"), [enter]);
  assert(frames[0].join("\n").includes(alpha));
  assert.deepEqual(launches.shift(), {
    command: "unity", args: ["--no-banner", "--no-color", "--non-interactive", "open", alpha], cwd: join(alpha, "Assets"),
  });

  await invoke(root, [down, tab, escape]);
  assert(frames[0].join("\n").includes(join("alpha", "Game")));
  assert(frames[0].join("\n").includes(join("beta workspace", "Game")));
  assert.equal(launches.length, 0, "Cancelling after changing modes must not launch Unity.");

  await invoke(root, [down, tab, enter]);
  assert(frames[2].includes("Mode: Automated (Tab to switch)"));
  assert(frames[2].includes(`→ ${join("beta workspace", "Game")}`), "Switching modes keeps the highlighted project.");
  await invoke(join(root, "alpha"), [tab, tab, enter], `"${join("..", "beta workspace", "Game")}"`);
  assert(frames[0].includes("Mode: Normal (Tab to switch)"), "A new picker resets to Normal.");
  assert.deepEqual(launches.splice(0).map(({ args }) => args.slice(3)), [["open", beta, "--args=-automated"], ["open", beta]]);

  await mkdir(join(root, "alpha", "nested", "a", "b", "c", "d"), { recursive: true });
  await invoke(join(root, "alpha"), [escape]);
  assert.equal(frames[0][0], "Open a found Unity project (search was incomplete)");
  assert.equal(launches.length, 0);

  rpcSelections.push(join("beta workspace", "Game"), "Automated");
  await invoke(root, [], "", "rpc");
  assert.deepEqual(launches.shift()?.args.slice(3), ["open", beta, "--args=-automated"]);
  rpcSelections.push(join("beta workspace", "Game"), undefined);
  await invoke(root, [], "", "rpc");
  assert.equal(launches.length, 0, "Cancelling the RPC mode prompt must not launch Unity.");

  const empty = join(root, "empty");
  await mkdir(empty);
  await invoke(empty);
  assert.equal(notifications.at(-1)?.level, "warning");
  await assert.rejects(invoke(root, [], beta, "print"), /needs a Pi UI/);
  assert.equal(launches.length, 0);

  cliResult = { ...cliResult, code: 1, stderr: "Native launch diagnostic" };
  await invoke(beta, [enter]);
  assert.equal(notifications.at(-1)?.level, "error");
  assert.match(notifications.at(-1)!.message, /Native launch diagnostic/);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Pi host loads the read-only Unity project finder and the /unity-open command");
