---
name: unity-docs
description: Capture solved Unity problems as validated v2 solution Markdown and safely plan or apply explicit v1-to-v2 migrations. Use only with direct confirmation provenance for the reported outcome.
---
# Unity Solution Documentation

Capture solved Unity problems under the resolved project docs root with validated schema-v2 classification. Preserve the compatibility skill name `unity-docs`.

All package assets are relative to this skill directory. Do not assume the package installation path or use sibling-repository paths.

## Capture Workflow

1. Resolve the exact workspace/docs root. Use `project_artifact_search` to inspect related project docs when available. If it is unavailable, report that deterministic artifact validation/search is missing rather than guessing a coordination-root path.
2. Establish direct confirmation provenance for the reported outcome: explicit user confirmation tied to the outcome, direct validation of the scenario, or reproduced failure followed by an equivalent passing check. Generic “done,” implementation completion, or unrelated tests are insufficient.
3. Gather module, symptoms/error, investigation, demonstrated versus inferred root cause, solution/prevention, Unity version/platform/render pipeline, proof target, observed evidence, and remaining gaps.
4. Search existing solutions before creating a duplicate.
5. Choose classification with [references/category-selection.md](references/category-selection.md).
6. Validate against [schema.yaml](schema.yaml) and [references/yaml-schema.md](references/yaml-schema.md). New docs require `schema_version: 2`, `doc_type`, `category`, and `failure_mode`; never add legacy `problem_type`.
7. Use [assets/resolution-template.md](assets/resolution-template.md) and write only to the resolved physical `${DOCS_ROOT}/solutions/<category-folder>/...` path after validation.
8. Search the new document through `project_artifact_search`. The installed Unity artifact profile validates/indexes explicit v1 and v2 fields without silently translating them.

Do not claim unrun player-facing, acceptance, or visual paths passed.

## Critical Pattern Recommendation

Recommend (do not auto-apply) promotion only for repeated high-impact Unity pitfalls, data/build/content-loss risks, non-obvious engine/package interactions, or project conventions likely to prevent future major failures. Use [assets/critical-pattern-template.md](assets/critical-pattern-template.md). The aggregate critical-pattern file must itself use v2 `doc_type: pattern` and `category: critical_patterns`.

## Schema Migration

Migration is a separate explicit content mutation, never part of package install or ordinary search.

1. Use `unity_migrate_solution_docs` with `operation: plan`. It performs normalized destination collision checks, complete hybrid-field authority, inbound-link planning across the authorized artifact root, and content hashing.
2. Review every conflict and exact-path override. Partial v2 plus `problem_type` always blocks unless a complete valid exact-path override is provided. No “include manual review” bypass exists.
3. Present the exact `approvalHash`. Apply only after explicit user authorization for that exact current plan.
4. Apply with `operation: apply`, the exact hash, and a recovery gate. The migrator creates byte backups even when a pinned VCS checkpoint is also recorded.
5. Keep the exclusive run journal. Use `operation: recover` with `resume` or `rollback` after interruption.
6. Verify hashes, uniqueness, links, v1/v2 counts, and the VCS diff before any separately authorized commit/check-in.

Never run migration against a real project merely to validate this package. Package tests use synthetic fixtures only.

## On-Demand Guidance

- [references/error-handling.md](references/error-handling.md)
- [references/quality-guidelines.md](references/quality-guidelines.md)
- [references/example.md](references/example.md)
