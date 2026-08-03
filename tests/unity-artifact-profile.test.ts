import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertArtifactProfileConformanceV1 } from "@aefree/pi-project-artifacts/contracts/v1/conformance";
import {
  createUnityArtifactProfileV1,
  UNITY_ARTIFACT_PROFILE_ID_V1,
  UNITY_RENDER_PIPELINES,
  validateUnityArtifactMetadata,
} from "../src/unity-artifact-profile";

const profile = createUnityArtifactProfileV1();
assert.equal(profile.id, UNITY_ARTIFACT_PROFILE_ID_V1);
assert.deepEqual(profile.artifactKinds, ["solution", "memory"]);
assert.deepEqual(profile.fields.map((field) => field.name), ["engine", "unity_version", "unity_packages", "render_pipeline", "platforms"]);
assert.deepEqual(profile.fields.find((field) => field.name === "render_pipeline")?.enumValues, UNITY_RENDER_PIPELINES);

const absent = validateUnityArtifactMetadata({ path: "docs/solutions/unclassified.md", kind: "solution", frontmatter: {} });
assert.equal(absent.outcome, "valid", "Unity metadata remains optional");

const valid = validateUnityArtifactMetadata({
  path: "docs/solutions/current.md",
  kind: "solution",
  frontmatter: {
    engine: "unity",
    unity_version: "6000.0",
    unity_packages: ["com.unity.inputsystem", "com.unity.addressables"],
    render_pipeline: "urp",
    platforms: ["windows", "android"],
  },
});
assert.equal(valid.outcome, "valid");

const invalid = validateUnityArtifactMetadata({
  path: "docs/memories/invalid.md",
  kind: "memory",
  frontmatter: {
    engine: "Unity",
    unity_version: 6000,
    unity_packages: "com.unity.inputsystem",
    render_pipeline: "universal",
    platforms: [],
  },
});
assert.equal(invalid.outcome, "invalid");
if (invalid.outcome === "invalid") {
  assert.deepEqual(invalid.issues.map((issue) => issue.field), ["engine", "unity_version", "unity_packages", "render_pipeline", "platforms"]);
}

const openLegacyMetadata = validateUnityArtifactMetadata({
  path: "docs/solutions/legacy.md",
  kind: "solution",
  frontmatter: { problem_type: "project_specific_value", category: "custom_area" },
});
assert.equal(openLegacyMetadata.outcome, "valid", "undeclared metadata remains open and is not profile-gated");

const report = await assertArtifactProfileConformanceV1({
  createProfile: createUnityArtifactProfileV1,
  validArtifact: {
    path: "/fixture/docs/solutions/current.md",
    kind: "solution",
    frontmatter: { engine: "unity", unity_version: "6000.0", render_pipeline: "urp" },
  },
  invalidArtifact: {
    path: "/fixture/docs/solutions/invalid.md",
    kind: "solution",
    frontmatter: { engine: "unreal" },
  },
});
assert.equal(report.passed, true);
assert(report.checks.includes("invalid fixture"));

const root = await mkdtemp(join(tmpdir(), "pi-unity-artifact-profile-"));
try {
  const context = { cwd: root, signal: new AbortController().signal };
  const request = { workspaceRoot: root, artifactPath: join(root, "docs", "solutions", "entry.md"), signal: context.signal };
  assert.equal(await profile.appliesTo?.(context, request), false, "A conventional artifact path must not select the Unity profile.");
  await mkdir(join(root, "ProjectSettings"));
  await writeFile(join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.0f1\n");
  assert.equal(await profile.appliesTo?.(context, request), true, "Unity project evidence makes the profile applicable.");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("pi-unity artifact profile tests passed");
