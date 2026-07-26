import { strict as assert } from "node:assert";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
for (const required of ["src/unity-workflow-provider.ts", "contracts/v1.ts", "index.ts", "package.json"]) {
  assert(files.has(required), `Packed pi-unity copy is missing ${required}.`);
}
assert.equal((archive.bundled ?? []).length, 0, "Packed pi-unity must co-install contract owners instead of bundling sibling repositories.");
assert.equal([...files].some((entry) => entry.startsWith("../") || path.isAbsolute(entry)), false, "Packed pi-unity contains a sibling or absolute path.");
assert.equal([...files].some((entry) => entry.startsWith("node_modules/@aefree/")), false, "Packed pi-unity contains copied decomposition packages.");
console.log("pi-unity workflow provider packed-copy dependency test passed");
