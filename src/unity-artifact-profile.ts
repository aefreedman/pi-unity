import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type {
  ArtifactCandidateV1,
  ArtifactProfileV1,
  ArtifactValidationResultV1,
} from "@aefree/pi-project-artifacts/contracts/v1";

export const UNITY_ARTIFACT_PROFILE_ID_V1 = "unity.solution-docs.v1" as const;
export const UNITY_DOC_TYPES = ["solution", "pattern", "workflow", "documentation_gap"] as const;
export const UNITY_CATEGORIES = [
  "build_ci", "editor_workflow", "asset_pipeline", "packages_integrations", "project_configuration",
  "serialization_data", "prefabs_scenes", "gameplay_code", "physics_navigation", "rendering_shaders",
  "ui", "animation_timeline", "audio", "input", "performance", "platform", "testing_validation",
  "tooling_vcs", "critical_patterns",
] as const;
export const UNITY_FAILURE_MODES = [
  "compile_error", "build_failure", "test_failure", "editor_crash", "editor_hang", "runtime_exception",
  "runtime_crash", "incorrect_behavior", "visual_artifact", "asset_import_failure", "performance_regression",
  "missing_reference", "data_loss_or_corruption", "version_incompatibility", "workflow_friction", "documentation_gap",
] as const;
export const UNITY_LEGACY_PROBLEM_TYPES = [
  "build_error", "editor_crash", "runtime_error", "performance_issue", "asset_import_issue", "physics_bug",
  "rendering_bug", "ui_bug", "audio_bug", "animation_bug", "input_bug", "integration_issue", "logic_error",
  "editor_workflow", "best_practice", "documentation_gap", "serialization_issue", "platform_specific",
] as const;

const OWNER = Object.freeze({
  packageName: "@aefree/pi-unity",
  packageVersion: "0.8.3",
  packageRoot: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  registeredBy: "index.ts",
});

export function createUnityArtifactProfileV1(): ArtifactProfileV1 {
  return Object.freeze({
    contractVersion: 1,
    id: UNITY_ARTIFACT_PROFILE_ID_V1,
    kind: "artifact-profile",
    owner: OWNER,
    artifactKinds: Object.freeze(["solution"]),
    fields: Object.freeze([
      { name: "schema_version", type: "integer", indexed: true, filterable: true },
      { name: "doc_type", type: "string", indexed: true, filterable: true, enumValues: UNITY_DOC_TYPES },
      { name: "category", type: "string", indexed: true, filterable: true, enumValues: UNITY_CATEGORIES },
      { name: "failure_mode", type: "string", indexed: true, filterable: true, enumValues: UNITY_FAILURE_MODES },
      { name: "problem_type", type: "string", indexed: true, filterable: true, enumValues: UNITY_LEGACY_PROBLEM_TYPES },
      { name: "unity_version", type: "string", indexed: true, filterable: true },
      { name: "render_pipeline", type: "string", indexed: true, filterable: true },
      { name: "platform", type: "string", indexed: true, filterable: true },
    ]),
    validators: Object.freeze([{
      id: "unity.solution-schema.v1-v2",
      async validate(_context, request) {
        if (request.signal.aborted) return { outcome: "unavailable", code: "aborted", retryable: true };
        return validateUnitySolutionArtifact(request.artifact);
      },
    }]),
    async appliesTo(_context, request) {
      if (request.signal.aborted) return false;
      // Profiles are composable candidates. A solution path alone is not Unity
      // authority: require Unity project evidence before contributing metadata.
      try {
        await access(path.join(request.workspaceRoot, "ProjectSettings", "ProjectVersion.txt"));
        return true;
      } catch {
        return false;
      }
    },
  });
}

/** Explicit compatibility-window validation: v1 and v2 are read, never translated. */
export function validateUnitySolutionArtifact(artifact: ArtifactCandidateV1): ArtifactValidationResultV1 {
  const frontmatter = artifact.frontmatter;
  const legacy = scalar(frontmatter.problem_type);
  const schemaVersion = numberValue(frontmatter.schema_version);
  const v2Values = {
    doc_type: scalar(frontmatter.doc_type),
    category: scalar(frontmatter.category),
    failure_mode: scalar(frontmatter.failure_mode),
  };
  const presentV2 = Object.values(v2Values).filter((value) => value !== undefined).length;
  const completeV2 = presentV2 === 3;
  if (completeV2) {
    const issues = validateUnityV2Classification(schemaVersion, v2Values);
    if (issues.length > 0) return { outcome: "invalid", issues };
    // Complete valid v2 fields are authoritative even while a legacy field remains.
    return { outcome: "valid" };
  }
  if (presentV2 > 0) {
    return {
      outcome: legacy === undefined ? "invalid" : "conflict",
      issues: [{ code: "unity_v2_partial", summary: legacy === undefined
        ? "Unity schema v2 classification is incomplete."
        : "Partial v2 classification plus problem_type has no automatic authority; an exact-path migration override is required." }],
    };
  }
  if (legacy !== undefined) {
    if (!(UNITY_LEGACY_PROBLEM_TYPES as readonly string[]).includes(legacy)) {
      return { outcome: "invalid", issues: [{ code: "unity_problem_type_unknown", field: "problem_type", summary: `Unknown Unity v1 problem_type '${legacy}'.` }] };
    }
    return { outcome: "valid" };
  }
  return {
    outcome: "invalid",
    issues: [{ code: "unity_classification_missing", summary: "Unity solution requires either v1 problem_type or complete v2 doc_type/category/failure_mode classification." }],
  };
}

export function validateUnityV2Classification(
  schemaVersion: number | undefined,
  classification: { doc_type?: string; category?: string; failure_mode?: string },
): { code: string; field?: string; summary: string }[] {
  const issues: { code: string; field?: string; summary: string }[] = [];
  if (schemaVersion !== 2) issues.push({ code: "unity_schema_version_invalid", field: "schema_version", summary: "Unity v2 classification requires schema_version: 2." });
  if (!(UNITY_DOC_TYPES as readonly string[]).includes(classification.doc_type ?? "")) issues.push({ code: "unity_doc_type_invalid", field: "doc_type", summary: "Unity doc_type is missing or invalid." });
  if (!(UNITY_CATEGORIES as readonly string[]).includes(classification.category ?? "")) issues.push({ code: "unity_category_invalid", field: "category", summary: "Unity category is missing or invalid." });
  if (!(UNITY_FAILURE_MODES as readonly string[]).includes(classification.failure_mode ?? "")) issues.push({ code: "unity_failure_mode_invalid", field: "failure_mode", summary: "Unity failure_mode is missing or invalid." });
  return issues;
}
function scalar(value: unknown): string | undefined { return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^\d+$/u.test(value.trim()) ? Number(value.trim()) : undefined; }
