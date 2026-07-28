# Reference Inventory

This directory contains only package-shipped references. Every Markdown reference here is listed below and checked by `tests/unity-package-validation.test.ts`.

| Reference | Consumer | Status |
| --- | --- | --- |
| `references/unity-repo-research.md` | `guidance/unity/plan` | Runtime-loaded with the planning overlay. |
| `references/workflow/plan.md` | `guidance/unity/plan` | Runtime-loaded planning overlay. |
| `references/workflow/work.md` | `guidance/unity/work` | Runtime-loaded work overlay. |

## Archived references

The following historical references have no current runtime or skill consumer. They are retained in the repository under `archive/references/` for comparison, excluded from npm packages, and should be restored to `references/` only with a documented consumer and an inventory update.

| Archived reference | Previous role | Status |
| --- | --- | --- |
| `archive/references/unity-review-guidance.md` | Legacy review guidance | Archived; not packaged. |
| `archive/references/unity-testing.md` | Legacy `cg-review` testing guidance | Archived; not packaged. |
| `archive/references/unity-yaml-assets.md` | Legacy `cg-work` YAML guidance | Archived; not packaged. |
