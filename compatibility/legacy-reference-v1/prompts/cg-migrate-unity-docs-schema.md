---
description: Migrate Unity solution docs from legacy problem_type schema to schema v2 categories
---
# Migrate Unity Docs Schema

Purpose: safely migrate project-local Unity solution documentation from legacy `problem_type` frontmatter to schema v2 `doc_type`, `category`, and `failure_mode` fields using the package migrator.

Use this only for Unity solution docs under a resolved `${DOCS_ROOT}/solutions/` tree. Do not change implementation code.

## Package Reference Loading

CRITICAL: Use `cg_read_reference` for Compound Game Dev package reference files.

- Pass package-relative paths such as `skills/unity-docs/references/yaml-schema.md`.
- When an instruction says to load, use, or see a package reference path, call `cg_read_reference` for that path.
- Do NOT use `read` with `references/...` or `skills/...` package-reference paths; file tools resolve relative to the current project cwd, not this package.
- Do not call `cg_read_reference` again for the same unchanged section during the current uncompacted workflow phase. Reuse loaded instructions; reload after compaction only when they are no longer retained, or when a later stage explicitly needs a different section or updated content.
- Treat loaded references as mandatory instructions for the active task scope.

## Workflow

1. Resolve artifact roots by loading:
   - `references/_shared/artifact-root-resolution.md`
   - `references/_shared/artifact-path-contract.md`
2. Load schema/classification guidance:
   - `skills/unity-docs/references/yaml-schema.md`
   - `skills/unity-docs/references/category-selection.md`
3. Resolve the target solutions root. Default to `${DOCS_ROOT}/solutions/` unless the user provides a specific folder.
4. Detect VCS and working tree status before mutating files:
   - Use Plastic tools/status for Plastic workspaces.
   - Use Git commands for Git workspaces.
   - If the tree has unrelated changes, summarize them and ask before continuing.
5. Run the package migrator in dry-run mode first:

   ```bash
   cd <pi-compound-game-dev-package-root>
   npx tsx scripts/migrate-unity-docs-schema.ts --solutions-root <target-docs-solutions-root> --write-report <safe-report-path>
   ```

6. Present the dry-run summary:
   - scanned/changed/moved/skipped counts
   - category counts
   - manual-review items
   - report path, if written
7. Ask for explicit confirmation before applying the migration.
8. On confirmation, run:

   ```bash
   cd <pi-compound-game-dev-package-root>
   npx tsx scripts/migrate-unity-docs-schema.ts --solutions-root <target-docs-solutions-root> --apply --write-report <safe-report-path>
   ```

   The migrator leaves manual-review files untouched by default. If the user explicitly approves the reported manual-review classifications, add `--include-manual-review`; otherwise use a mapping override and rerun the dry run.

9. Validate the result:
   - no migrated solution docs still use `problem_type:` unless intentionally skipped/manual-review
   - docs use `schema_version: 2`, `doc_type`, `category`, and `failure_mode`
   - moved-doc relative links still resolve where practical
   - VCS diff contains only expected docs/schema migration changes
10. Commit/check in only when the user explicitly asks.

## Optional Mapping Overrides

If dry-run classification is ambiguous, create a project-local JSON mapping file outside the package and rerun with `--mapping <path>`.

Example:

```json
{
  "pathOverrides": {
    "best-practices/scriptable-object-validation.md": {
      "doc_type": "pattern",
      "category": "serialization_data",
      "failure_mode": "workflow_friction"
    }
  }
}
```

Never silently apply ambiguous classifications. Use the dry-run report and ask the user how to handle manual-review items.
