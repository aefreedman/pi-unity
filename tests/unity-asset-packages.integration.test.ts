// Explicit opt-in live CLI evidence capture; excluded from npm test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectUnitypackage } from "../src/unity-asset-packages";

function tarEntry(name: string, contents: string): Buffer {
  const data = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(32, 148, 156);
  header.write("0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}

test("opt-in real Unity CLI archive inspection", { skip: process.env.PI_UNITY_LIVE_INSPECT !== "1" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "unity-asset-inspect-live-"));
  try {
    const archive = join(root, "fixture.unitypackage");
    const guid = "abcdef0123456789abcdef0123456789";
    const tar = Buffer.concat([
      tarEntry(`${guid}/pathname`, "Assets/Sample.txt"),
      tarEntry(`${guid}/asset`, "sample"),
      Buffer.alloc(1024),
    ]);
    await writeFile(archive, gzipSync(tar));
    const actual = JSON.parse(execFileSync("unity", ["--format", "json", "--no-banner", "--non-interactive", "assets", "inspect", archive], { encoding: "utf8", timeout: 15000 }));
    const mocked = await inspectUnitypackage(archive, { execute: async () => ({ stdout: JSON.stringify(actual), stderr: "" }) });
    assert.equal(mocked.outcome, "inspected");
    assert.deepEqual(actual.data.entries, mocked.details?.entries);
  } finally { await rm(root, { recursive: true, force: true }); }
});
