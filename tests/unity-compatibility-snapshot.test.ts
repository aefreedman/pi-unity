import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const snapshot = path.resolve(fileURLToPath(new URL("..", import.meta.url)), "compatibility", "legacy-reference-v1", "prompts", "cg-migrate-unity-docs-schema.md");
const bytes = await readFile(snapshot);

assert.equal(bytes.includes(0x0d), false, "compatibility snapshot must materialize with LF line endings");
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  "d1c063c83c7fb4b828b05a32d963cacdaa20c51e8612d99070f3a733608fea6f",
  "compatibility snapshot must match the frozen v1 byte contract",
);

console.log("pi-unity compatibility snapshot byte contract test passed");
