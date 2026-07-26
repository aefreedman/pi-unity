import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { assertRepositoryPolicyConformanceV1 } from "@aefree/pi-repo-search/contracts/v1/conformance";
import { createUnityRepositoryPolicyV1, evaluateUnityRepositoryPolicyV1, UNITY_REPOSITORY_POLICY_ID_V1 } from "../src/unity-repo-search-policy";

const root = await mkdtemp(path.join(tmpdir(), "pi-unity-policy-"));
const unity = path.join(root, "Game");
const plain = path.join(root, "Plain");
try {
  await mkdir(path.join(unity, "ProjectSettings"), { recursive: true });
  await mkdir(path.join(unity, "Assets"), { recursive: true });
  await mkdir(path.join(unity, "Library"), { recursive: true });
  await writeFile(path.join(unity, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1\n");
  await mkdir(plain);
  const signal = new AbortController().signal;
  const applied = await evaluateUnityRepositoryPolicyV1({ cwd: root, signal }, { workspaceRoot: root, roots: [unity], includeHidden: false, signal });
  assert.equal(applied.outcome, "applied");
  if (applied.outcome === "applied") {
    assert(applied.roots[0]?.excludeGlobs?.includes("!Library/**"));
    assert.match(applied.roots[0]?.disclosures[0] ?? "", /Unity generated/);
  }
  const included = await evaluateUnityRepositoryPolicyV1({ cwd: root, signal }, { workspaceRoot: root, roots: [unity], includeHidden: false, options: { includeGenerated: true }, signal });
  assert.equal(included.outcome, "applied");
  if (included.outcome === "applied") assert.equal(included.roots[0]?.excludeGlobs, undefined);
  const generatedRoot = await evaluateUnityRepositoryPolicyV1({ cwd: root, signal }, { workspaceRoot: root, roots: [path.join(unity, "Library")], includeHidden: false, signal });
  assert.equal(generatedRoot.outcome, "applied");
  if (generatedRoot.outcome === "applied") assert(generatedRoot.roots[0]?.excludeGlobs?.includes("!**"));
  const absent = await evaluateUnityRepositoryPolicyV1({ cwd: root, signal }, { workspaceRoot: root, roots: [plain], includeHidden: false, signal });
  assert.equal(absent.outcome, "not_applicable");

  const report = await assertRepositoryPolicyConformanceV1({
    createPolicy: createUnityRepositoryPolicyV1,
    applicableRequest: { workspaceRoot: root, roots: [unity] },
    nonApplicableRequest: { workspaceRoot: root, roots: [plain] },
  });
  assert.equal(report.passed, true);
  assert.equal(createUnityRepositoryPolicyV1().id, UNITY_REPOSITORY_POLICY_ID_V1);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("pi-unity repository policy tests passed");
