import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type {
  ArtifactCandidateV1,
  ArtifactProfileV1,
  ArtifactValidationResultV1,
} from "@aefree/pi-project-artifacts/contracts/v1";

export const UNITY_ARTIFACT_PROFILE_ID_V1 = "unity.artifacts.v1" as const;
export const UNITY_RENDER_PIPELINES = ["builtin", "urp", "hdrp", "custom", "agnostic"] as const;

const OWNER = Object.freeze({
  packageName: "@aefree/pi-unity",
  packageVersion: "0.8.3",
  packageRoot: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  registeredBy: "index.ts",
});

/**
 * Optional project-artifacts enrichment. These fields describe and validate
 * metadata but never authorize raw discovery/filtering. Artifact paths already
 * distinguish solutions from memories, while generic tags/module/component
 * metadata remains project-owned and schema-open.
 */
export function createUnityArtifactProfileV1(): ArtifactProfileV1 {
  return Object.freeze({
    contractVersion: 1,
    id: UNITY_ARTIFACT_PROFILE_ID_V1,
    kind: "artifact-profile",
    owner: OWNER,
    artifactKinds: Object.freeze(["solution", "memory"]),
    fields: Object.freeze([
      { name: "engine", type: "string", indexed: true, filterable: true, enumValues: Object.freeze(["unity"]) },
      { name: "unity_version", type: "string", indexed: true, filterable: true },
      { name: "unity_packages", type: "string_list", indexed: true, filterable: true },
      { name: "render_pipeline", type: "string", indexed: true, filterable: true, enumValues: UNITY_RENDER_PIPELINES },
      { name: "platforms", type: "string_list", indexed: true, filterable: true },
    ]),
    validators: Object.freeze([{
      id: "unity.artifact-metadata.v1",
      async validate(_context, request) {
        if (request.signal.aborted) return { outcome: "unavailable", code: "aborted", retryable: true };
        return validateUnityArtifactMetadata(request.artifact);
      },
    }]),
    async appliesTo(_context, request) {
      if (request.signal.aborted) return false;
      // A conventional docs path is not Unity authority. Require direct project
      // evidence before contributing definitions or validation confidence.
      try {
        await access(path.join(request.workspaceRoot, "ProjectSettings", "ProjectVersion.txt"));
        return true;
      } catch {
        return false;
      }
    },
  });
}

/** Validate only declared Unity fields that are present; all fields are optional. */
export function validateUnityArtifactMetadata(artifact: ArtifactCandidateV1): ArtifactValidationResultV1 {
  const frontmatter = artifact.frontmatter;
  const issues: { code: string; field: string; summary: string }[] = [];

  validateEnumString(frontmatter, "engine", ["unity"], issues);
  validateNonEmptyString(frontmatter, "unity_version", issues);
  validateStringList(frontmatter, "unity_packages", issues);
  validateEnumString(frontmatter, "render_pipeline", UNITY_RENDER_PIPELINES, issues);
  validateStringList(frontmatter, "platforms", issues);

  return issues.length === 0 ? { outcome: "valid" } : { outcome: "invalid", issues };
}

function validateNonEmptyString(
  frontmatter: Readonly<Record<string, unknown>>,
  field: string,
  issues: { code: string; field: string; summary: string }[],
): void {
  const value = frontmatter[field];
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ code: `unity_${field}_invalid`, field, summary: `Unity ${field} must be a non-empty string when present.` });
  }
}

function validateEnumString(
  frontmatter: Readonly<Record<string, unknown>>,
  field: string,
  values: readonly string[],
  issues: { code: string; field: string; summary: string }[],
): void {
  const value = frontmatter[field];
  if (value === undefined) return;
  if (typeof value !== "string" || !values.includes(value)) {
    issues.push({ code: `unity_${field}_invalid`, field, summary: `Unity ${field} must be one of: ${values.join(", ")}.` });
  }
}

function validateStringList(
  frontmatter: Readonly<Record<string, unknown>>,
  field: string,
  issues: { code: string; field: string; summary: string }[],
): void {
  const value = frontmatter[field];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    issues.push({ code: `unity_${field}_invalid`, field, summary: `Unity ${field} must be a non-empty list of non-empty strings when present.` });
  }
}
