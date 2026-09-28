import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { unityCliInfo, unityDocsUrl, checkCliResult } from "../src/unity-cli-information";
import type { UnityCliExecutor } from "../src/unity-cli";
const envelope = (command: string, data: unknown, warnings: unknown[] = []) => ({ stdout: JSON.stringify({ success: true, command, data, errors: [], warnings }), stderr: "" });
test("global manifest filters exact paths and caps output without granting dispatch", async () => {
  const calls: string[][] = [];
  const execute: UnityCliExecutor = async (_cmd, args, opts) => { calls.push(args); assert.equal(opts.timeout, 10000); return envelope("commands", { commands: [{ name: "pipeline", description: "top", arguments: [], options: [], subcommands: [{ name: "cloud-build", description: "cloud", arguments: [], options: [], subcommands: [{ name: "targets", description: "target", arguments: [], options: [], subcommands: [] }] }] }] }); };
  const result = await unityCliInfo({ include: ["commands"], commandPrefixes: ["pipeline cloud-build"], maxCommands: 1 }, execute);
  assert.deepEqual(calls, [["--format", "json", "--no-banner", "--non-interactive", "commands"]]);
  assert.equal(result.matchingCount, 2); assert.equal(result.commandsTruncated, true);
  assert.equal((result.commands as {path: string}[])[0].path, "pipeline cloud-build");
});
test("changelog is bounded, redacted; warnings, malformed and timeout fail closed", async () => {
  const data = await unityCliInfo({ include: ["changelog"], maxChangelogChars: 100 }, async () => envelope("changelog", { version: "1.0.0-beta.11", changelog: "token=abc123 " + "z".repeat(200) }));
  assert.equal(data.changelogTruncated, true); assert.doesNotMatch(String(data.changelog), /abc123/);
  await assert.rejects(unityCliInfo({ include: ["commands"] }, async () => envelope("commands", { commands: [] }, [{ message: "secret=private" }])), /uncertain/);
  await assert.rejects(unityCliInfo({ include: ["commands"] }, async () => ({ stdout: "not json", stderr: "" })), /malformed/);
  await assert.rejects(unityCliInfo({ include: ["commands"] }, async () => ({ stdout: "", stderr: "secret=x", error: Object.assign(new Error("secret=x"), { code: "ETIMEDOUT" }) })), /timeout/);
  await assert.rejects(unityCliInfo({ include: ["commands"] }, async () => envelope("commands", { commands: [{ name: "bad\nname", subcommands: [] }] })), /invalid entries/);
  await assert.rejects(unityCliInfo({ include: ["commands"], commandPrefixes: ["--config"] }, async () => { throw Error("dispatched"); }), /Invalid command prefix/);
  assert.throws(() => checkCliResult(envelope("commands", {}, [{ message: "token=private" }]), "commands"), error => { assert.doesNotMatch(String(error), /private/); return true; });
});
test("docs always uses --url, explicit project or override, and rejects unsafe evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "unity-docs-url-"));
  try {
    await mkdir(join(root, "Assets")); await mkdir(join(root, "ProjectSettings"));
    await writeFile(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.26f1\n");
    const calls: string[][] = [];
    const execute: UnityCliExecutor = async (_cmd, args) => { calls.push(args); return envelope("docs", { url: "https://docs.unity3d.com/6000.0/Documentation/Manual/Coroutines.html", version: args[args.indexOf("--editor-version") + 1], opened: false }); };
    const result = await unityDocsUrl({ topic: "Coroutines", kind: "manual", path: root }, execute, root);
    assert.equal(result.versionSource, "project"); assert.equal(result.editorVersion, "6000.0.26f1");
    assert.deepEqual(calls[0], ["--format", "json", "--no-banner", "--non-interactive", "docs", "--url", "--manual", "--editor-version", "6000.0.26f1", "Coroutines"]);
    const override = await unityDocsUrl({ topic: "GameObject", kind: "search", path: root, editorVersion: "2022.3" }, async (_cmd, args) => { calls.push(args); return envelope("docs", { url: "https://docs.unity3d.com/", version: "2022.3", opened: false }); }, root);
    assert.equal(override.versionSource, "explicit"); assert.ok(calls[1].includes("--search"));
    await assert.rejects(unityDocsUrl({ topic: "X" }, async () => envelope("docs", { url: "http://example.com", opened: false }), root), /unsafe URL/);
    await assert.rejects(unityDocsUrl({ topic: "X", path: join(root, "Assets") }, execute, root), /not a Unity project root/);
    await assert.rejects(unityDocsUrl({ topic: "-bad" }, execute, root), /Invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
