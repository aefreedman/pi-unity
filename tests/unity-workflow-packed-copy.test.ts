import { strict as assert } from "node:assert";
import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execOptions = { cwd: packageRoot, encoding: "utf8" as const, windowsHide: true, maxBuffer: 8 * 1024 * 1024 };
const output = process.platform === "win32"
  ? execSync("npm pack --dry-run --json --ignore-scripts", execOptions)
  : execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], execOptions);
const packed = JSON.parse(output) as Array<{ files?: Array<{ path: string }>; bundled?: string[] }>;
assert.equal(packed.length, 1, "Expected one packed pi-unity archive description.");
const archive = packed[0]!;
const files = new Set((archive.files ?? []).map((entry) => entry.path));
for (const required of ["src/unity-workflow-provider.ts", "contracts/v1.ts", "index.ts", "package.json", "references/unity-repo-research.md", "references/workflow/plan.md", "references/workflow/work.md"]) {
  assert(files.has(required), `Packed pi-unity copy is missing ${required}.`);
}
assert.equal((archive.bundled ?? []).length, 0, "Packed pi-unity must co-install contract owners instead of bundling sibling repositories.");
assert.equal([...files].some((entry) => entry.startsWith("../") || path.isAbsolute(entry)), false, "Packed pi-unity contains a sibling or absolute path.");
assert.equal([...files].some((entry) => entry.startsWith("node_modules/@aefree/")), false, "Packed pi-unity contains copied decomposition packages.");

// Simulate an installed package copy using only files asserted above to be packable.
// Its provider must resolve Markdown from its own package root, not this checkout.
const installedCopy = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unity-workflow-installed-copy-"));
try {
  fs.cpSync(path.join(packageRoot, "src"), path.join(installedCopy, "src"), { recursive: true });
  fs.cpSync(path.join(packageRoot, "references"), path.join(installedCopy, "references"), { recursive: true });
  fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(installedCopy, "package.json"));
  fs.symlinkSync(path.join(packageRoot, "node_modules"), path.join(installedCopy, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const copiedModule = await import(`${pathToFileURL(path.join(installedCopy, "src", "unity-workflow-provider.ts")).href}?installed-copy`);
  const provider = copiedModule.createUnityWorkflowProviderV1();
  const signal = new AbortController().signal;
  const planGuidance = await provider.loadGuidance({ cwd: installedCopy, signal }, { resourceId: "guidance/unity/plan", purpose: "work", maxChars: 100_000, signal });
  assert.equal(planGuidance.outcome, "available", "A copied installed provider must load its packaged planning Markdown.");
  if (planGuidance.outcome === "available") {
    assert(planGuidance.content.includes("# Unity Repository Research"));
    assert(planGuidance.content.includes("# Connected Planning and Documentation Routing"));
    assert(!/[A-Za-z]:[\\/]|\/(?:Users|home)\//.test(planGuidance.content), "Copied-provider guidance must not leak its installation path.");
  }
  const workGuidance = await provider.loadGuidance({ cwd: installedCopy, signal }, { resourceId: "guidance/unity/work", purpose: "work", maxChars: 100_000, signal });
  assert.equal(workGuidance.outcome, "available", "A copied installed provider must load its packaged work Markdown.");
  if (workGuidance.outcome === "available") {
    assert(workGuidance.content.includes("# Unity Work Routing"));
    assert(workGuidance.content.includes("Do not silently switch to batchmode after an uncertain connected dispatch."));
    assert.deepEqual(workGuidance.ref, { packageName: "@aefree/pi-unity", packageVersion: provider.owner.packageVersion, resourceId: "guidance/unity/work" });
    assert(!/[A-Za-z]:[\\/]|\/(?:Users|home)\//.test(workGuidance.content), "Copied work guidance must not leak its installation path.");
  }
  assert.equal(provider.owner.packageRoot, installedCopy, "Copied provider provenance must use its installed package root.");
  const workPath = path.join(installedCopy, "references", "workflow", "work.md");
  fs.rmSync(workPath);
  assert.deepEqual(await provider.loadGuidance({ cwd: installedCopy, signal }, { resourceId: "guidance/unity/work", purpose: "work", maxChars: 100, signal }), {
    outcome: "missing", code: "guidance_resource_missing", retryable: false,
  }, "A missing packaged optional work resource must produce a sanitized stable result.");
  fs.mkdirSync(workPath);
  assert.deepEqual(await provider.loadGuidance({ cwd: installedCopy, signal }, { resourceId: "guidance/unity/work", purpose: "work", maxChars: 100, signal }), {
    outcome: "unavailable", code: "guidance_resource_unavailable", retryable: false,
  }, "An unreadable packaged work resource must produce a sanitized stable result.");
} finally {
  fs.rmSync(installedCopy, { recursive: true, force: true });
}
console.log("pi-unity workflow provider packed-copy dependency test passed");
