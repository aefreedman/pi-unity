import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { declaredPiVersion, assertPiVersion } from "../evals/auditing-unity-agent-guidance/pi-version.ts";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(declaredPiVersion(), manifest.devDependencies["@earendil-works/pi-coding-agent"]);
const fixture = mkdtempSync(join(tmpdir(), "pi-version-selection-"));
const previousCwd = process.cwd();
try {
  process.chdir(fixture);
  assert.equal(declaredPiVersion(), manifest.devDependencies["@earendil-works/pi-coding-agent"], "selection must not depend on cwd");
  const url = pathToFileURL(join(fixture, "package.json"));
  const write = (version: unknown) => writeFileSync(url, JSON.stringify({ devDependencies: { "@earendil-works/pi-coding-agent": version } }));
  write("9.8.7");
  assert.equal(declaredPiVersion(url), "9.8.7");
  assert.doesNotThrow(() => assertPiVersion("9.8.7", declaredPiVersion(url)));
  assert.throws(() => assertPiVersion("9.8.6", declaredPiVersion(url)), /requires Pi 9\.8\.7 exactly/);
  for (const version of ["latest", "^9.8.7", "9.8", undefined]) {
    write(version);
    assert.throws(() => declaredPiVersion(url), /exact stable version/);
  }
} finally { process.chdir(previousCwd); rmSync(fixture, { recursive: true, force: true }); }
console.log("PASS: manifest selects exact Pi; floating declarations and installed mismatches fail");
