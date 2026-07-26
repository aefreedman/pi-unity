---
description: Plan or explicitly apply the recoverable Unity solution-doc schema migration
---
# Migrate Unity Docs Schema

Compatibility resource for the canonical `pi-unity` migration workflow. The `/cg-migrate-unity-docs-schema` command name remains owned by the separately installed game-development profile; this package does not register a duplicate prompt command.

1. Load the `unity-docs` skill and follow its migration section.
2. Resolve the exact physical workspace, artifact root, and `docs/solutions` root. Do not infer a coordination-root workspace.
3. Call `unity_migrate_solution_docs` with `operation: plan`.
4. Present scanned/migrated/moved/link-update/conflict counts and the exact `approvalHash`.
5. Resolve every collision, unknown mapping, or partial-v2/legacy hybrid with a complete valid exact-path override. There is no manual-review bypass.
6. Ask for explicit authorization of that exact current plan before apply.
7. Only after approval, call `operation: apply` with the exact hash and a backup or pinned-VCS recovery gate. Byte backups are always created.
8. On interruption, use the exclusive run directory with `operation: recover` and an explicit `resume` or `rollback` action.
9. Verify hashes, uniqueness, links, schema counts, and the VCS diff. Commit/check in only on separate explicit authorization.

Package validation must use synthetic fixtures only; it never applies migration to real project documentation.
