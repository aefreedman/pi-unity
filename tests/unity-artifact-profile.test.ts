import { strict as assert } from "node:assert";
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
console.log("pi-unity artifact profile tests passed");
