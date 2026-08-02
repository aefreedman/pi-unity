import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { assertFileDiscoveryFilterConformanceV1 } from "@aefree/pi-file-discovery/contracts/v1/conformance";
import { createUnityFileDiscoveryFilterV1, evaluateUnityFileDiscoveryFilterV1, UNITY_BROAD_GENERATED_DIRECTORIES_APPLIED_CODE, UNITY_EXACT_GENERATED_ROOT_BYPASSED_CODE, UNITY_FILE_DISCOVERY_FILTER_ID_V1 } from "../src/unity-file-discovery-filter";

const root = await mkdtemp(path.join(tmpdir(), "pi-unity-file-discovery-filter-"));
const unity = path.join(root, "Game");
const plain = path.join(root, "Plain");
try {
  await mkdir(path.join(unity, "ProjectSettings"), { recursive: true });
  await mkdir(path.join(unity, "Assets"), { recursive: true });
  const packageCache = path.join(unity, "Library", "PackageCache", "com.example.fixture@1.0.0");
  await mkdir(packageCache, { recursive: true });
  await writeFile(path.join(unity, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1\n");
  await mkdir(plain);
  const signal = new AbortController().signal;
  const applied = await evaluateUnityFileDiscoveryFilterV1({ cwd: root, signal }, { workspaceRoot: root, roots: [unity], includeHidden: false, signal });
  assert.equal(applied.outcome, "applied");
  if (applied.outcome === "applied") {
    assert.equal(applied.roots[0]?.filterDecision, "applied");
    assert.equal(applied.roots[0]?.decisionCode, UNITY_BROAD_GENERATED_DIRECTORIES_APPLIED_CODE);
    for (const directory of ["Library", "Temp", "Logs", "obj", "Build", "Builds", "UserSettings", ".vs"]) {
      assert(applied.roots[0]?.excludeGlobs?.includes(`!${directory}/**`), `Expected broad Unity root to exclude ${directory}.`);
    }
    assert(!applied.roots[0]?.excludeGlobs?.some((glob) => glob === "!**" || glob === "!*"), "Unity must declare its bypass structurally, not through compatibility sentinel globs.");
    assert.match(applied.roots[0]?.disclosures[0] ?? "", /broad-root generated-directory filter applied/i);
  }
  for (const generatedSearchRoot of [path.join(unity, "Library"), packageCache]) {
    const generatedRoot = await evaluateUnityFileDiscoveryFilterV1({ cwd: root, signal }, { workspaceRoot: root, roots: [generatedSearchRoot], includeHidden: false, signal });
    assert.equal(generatedRoot.outcome, "applied");
    if (generatedRoot.outcome === "applied") {
      assert.equal(generatedRoot.roots[0]?.filterDecision, "bypassed");
      assert.equal(generatedRoot.roots[0]?.decisionCode, UNITY_EXACT_GENERATED_ROOT_BYPASSED_CODE);
      assert.equal(generatedRoot.roots[0]?.excludeGlobs, undefined);
      assert.match(generatedRoot.roots[0]?.disclosures[0] ?? "", /filter bypassed.*explicit root.*searched/i);
    }
  }
  const absent = await evaluateUnityFileDiscoveryFilterV1({ cwd: root, signal }, { workspaceRoot: root, roots: [plain], includeHidden: false, signal });
  assert.equal(absent.outcome, "not_applicable");

  await assertFileDiscoveryFilterConformanceV1(
    createUnityFileDiscoveryFilterV1(),
    { workspaceRoot: root, roots: [unity], includeHidden: false },
  );
  assert.equal(createUnityFileDiscoveryFilterV1().id, UNITY_FILE_DISCOVERY_FILTER_ID_V1);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("pi-unity file-discovery filter tests passed");
