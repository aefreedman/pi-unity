import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertArtifactProfileConformanceV1 } from "@aefree/pi-project-artifacts/contracts/v1/conformance";
import { createUnityArtifactProfileV1, validateUnitySolutionArtifact } from "../src/unity-artifact-profile";

const v1 = validateUnitySolutionArtifact({ path: "docs/solutions/legacy.md", kind: "solution", frontmatter: { problem_type: "runtime_error" } });
assert.equal(v1.outcome, "valid");
const v2 = validateUnitySolutionArtifact({ path: "docs/solutions/current.md", kind: "solution", frontmatter: { schema_version: 2, doc_type: "solution", category: "gameplay_code", failure_mode: "runtime_exception" } });
assert.equal(v2.outcome, "valid");
const completeHybrid = validateUnitySolutionArtifact({ path: "docs/solutions/hybrid.md", kind: "solution", frontmatter: { problem_type: "runtime_error", schema_version: 2, doc_type: "solution", category: "gameplay_code", failure_mode: "runtime_exception" } });
assert.equal(completeHybrid.outcome, "valid", "complete valid v2 remains authoritative during compatibility");
const partialHybrid = validateUnitySolutionArtifact({ path: "docs/solutions/partial.md", kind: "solution", frontmatter: { problem_type: "runtime_error", schema_version: 2, category: "gameplay_code" } });
assert.equal(partialHybrid.outcome, "conflict");
const invalidV2 = validateUnitySolutionArtifact({ path: "docs/solutions/invalid.md", kind: "solution", frontmatter: { schema_version: 2, doc_type: "solution", category: "unknown", failure_mode: "runtime_exception" } });
assert.equal(invalidV2.outcome, "invalid");

const report = await assertArtifactProfileConformanceV1({
  createProfile: createUnityArtifactProfileV1,
  validArtifact: { path: "/fixture/docs/solutions/current.md", kind: "solution", frontmatter: { schema_version: 2, doc_type: "solution", category: "gameplay_code", failure_mode: "runtime_exception" } },
  invalidArtifact: { path: "/fixture/docs/solutions/partial.md", kind: "solution", frontmatter: { problem_type: "runtime_error", category: "gameplay_code" } },
});
assert.equal(report.passed, true);
assert(report.checks.includes("invalid fixture"));

const root = await mkdtemp(join(tmpdir(), "pi-unity-artifact-profile-"));
try {
  const profile = createUnityArtifactProfileV1();
  const context = { cwd: root, signal: new AbortController().signal };
  const request = { workspaceRoot: root, artifactPath: join(root, "docs", "solutions", "entry.md"), signal: context.signal };
  assert.equal(await profile.appliesTo?.(context, request), false, "A generic solutions path must not select the Unity profile.");
  await mkdir(join(root, "ProjectSettings"));
  await writeFile(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.0f1\n");
  assert.equal(await profile.appliesTo?.(context, request), true, "Unity project evidence makes the profile a candidate.");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("pi-unity artifact profile tests passed");
