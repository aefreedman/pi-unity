# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows semantic versioning for public package releases.

## Unreleased

### Added

- Added a session-scoped Unity repository-search policy for detected generated/cache/output directories and reusable provider conformance coverage.
- Added the preserved `unity-docs` solution-capture skill with skill-relative schema, templates, and references.
- Added explicit Unity solution artifact v1/v2 fields and validators over the canonical project-artifact profile contract, including complete-v2 authority and partial-hybrid conflict semantics.
- Added `UnityMigrationServiceV1`, `unity_migrate_solution_docs`, and an updated CLI migrator with normalized collision detection, complete mapping/override authority, content-hashed staging and backups, journaled apply/resume/rollback, inbound-link reconciliation, exclusive run/report paths, and backup/VCS restore gates.
- Added synthetic profile, repository-policy, migration collision/interruption/link/backup/recovery, physical symlink/junction containment, concurrent recovery, lossless frontmatter, POSIX mode, reverse load-order, and Pi registration fixtures.
- Added the `engine.unity` `WorkflowGuidanceContributorV1`, with validated exact/enclosing `ProjectVersion.txt` applicability, deterministic nested-project ambiguity handling, bounded plan/work/review guidance, conformance coverage, and packed-copy checks.
- Added deterministic Unity planning coverage for nested-project ambiguity, bounded command discovery, safe read-only eval classification, credential redaction, timeout uncertainty, and route-specific launch safety.

### Changed

- Updated the Pi development baseline to 0.83.0.

- Made `@aefree/pi-workflow` an optional guidance-composition peer integration. `engine.unity` now registers dynamically as a guidance contributor at session startup only when its exact workflow contract resolves; workflow-absent installs retain Unity tools, migration, repository policy, and references, while broken installed contracts fail visibly.
- Moved `guidance/unity/work` from an inline summary into bounded runtime-loaded package Markdown. The Unity work overlay preserves exact-copy identity, includes the work-specific validation evidence rules formerly declared separately, prefers reachable connected Pipeline routes, constrains isolated batchmode fallback, and retains sanitized missing/unavailable/abort results with stable package/resource provenance.
- Moved detailed `guidance/unity/plan` content into runtime-loaded packaged Markdown: the canonical Unity repository-research reference now supplies exact-version documentation priority, while a small workflow overlay supplies connected CLI/Pipeline boundaries. Missing packaged guidance is sanitized, and the contributor retains bounded output and stable package provenance.
- Declared semver dependencies on the capability registry and canonical repository/artifact contracts; neutral installs co-install their tarballs and never copy sibling repositories into the Unity archive.
- Reworked solution migration to exact-range frontmatter patches, complete moved-document outbound-link rebasing, final broken-link blocking, POSIX mode journaling/restoration, physical nearest-ancestor revalidation, and one queue/lock domain for apply/resume/rollback.
- Made Unity capability shutdown scope-owned so a delayed old-session shutdown cannot unregister a newer active session.
- Made Unity repository policy, artifact, migration, and workflow-guidance-contributor registrations independently scoped rather than replacing another live session.

### Removed

- Removed the `capturing-screenshots-unity` skill, its screenshot utility, and its unreferenced capture guidance.
- Removed the frozen pi-game-dev legacy-reference payload copies, `LegacyReferenceServiceV1` provider registration, and compatibility snapshot test. Canonical Unity resources and their direct package validation remain.

### Safety

- Unity document migration remains dry-run by default, requires approval of the exact current manifest hash before apply, rejects manual-review bypasses, and is never run against real project docs during package validation.

### Fixed

- Kept guidance composition limited to validated Unity project-copy applicability: it does not inspect Editor locks, processes, or readiness; nested discovery never guesses among copies, and owning Unity tools retain lifecycle checks.
- Raised bounded Pipeline discovery waits beyond the old five-second edge while exposing timeout/startup uncertainty separately from confirmed absence; process fallback rendering now redacts access-token and credential-like argument values.
- Required connected, batchmode, and artifact-inspected Unity test evidence to report a known positive executed-test count while preserving bounded connected polling and nonterminal running responses.
- Made inherited-guidance audit tests compare canonical paths so macOS `/var` aliases do not cause false CI failures.

## [0.8.2] - 2026-07-24

### Changed

- Marked Pi-bundled core dependencies as optional peers so Pi git installs do not create redundant per-package `node_modules` directories.

## [0.8.1] - 2026-07-23

### Changed

- Clarified test routing across tool prompts, README guidance, and the batchmode skill: an already-open exact project copy with reachable `run_tests`/`test_status` Pipeline commands should run connected tests without closing the Editor; batchmode is reserved for deliberately isolated/report-producing cases.
- Documented that an asynchronous connected `run_tests` initiation may report zero tests while still running and that zero-test validation belongs to terminal `test_status` results.
- Strengthened Unity guidance migration scope handling so nested-workspace audits include inherited instructions by default or explicitly disclose excluded ancestor candidates, while keeping ancestor edits authorization-gated.
- Added a behavioral regression case for auditing inherited coordination-root guidance without editing it.

### Fixed

- Instruct migration agents to preserve clear known-safe prohibitions and report likely heuristic defects instead of weakening wording merely to obtain a zero-finding audit.
- Recognize prohibitions placed between `-runTests` and `-quit`, such as “`-runTests` commands must not include `-quit`,” instead of reporting them as unsafe commands.

## [0.8.0] - 2026-07-23

### Added

- Added Unity CLI and Pipeline capability reporting to `unity_project_status`, including exact-project-copy instance matching, locally declared package versions, and live advertised command discovery.
- Added the read-only `unity_guidance_audit` tool plus an `auditing-unity-agent-guidance` skill, migration policy, detection catalog, and mixed-harness template for modernizing AGENTS.md, CLAUDE.md, Copilot, and Cursor Unity workflows.
- Added `unity-connected-workflows` guidance for exact-copy Pipeline recompilation and focused asynchronous tests, including nested JSON, domain reload, zero-test, and artifact limitations.
- Added an isolated behavioral eval for `auditing-unity-agent-guidance` with 12 real-problem-derived positive/negative prompts, deterministic outcome checks, skill-versus-baseline runs, repeat trials, and efficiency evidence. Eval fixtures and reports stay in OS-temporary directories by default, with defense-in-depth ignores for explicitly persisted reports.
- Documented the observed Pipeline startup side effect that persists `Application.runInBackground = true` into `ProjectSettings/ProjectSettings.asset`.

### Changed

- Reframed `unity-batchmode-tests` as the isolated/report-producing route instead of the default for an already-open reachable Pipeline Editor, and prefer the standalone `unity test` command over forwarding `-runTests` through `unity run`.
- Expanded guidance auditing to detect unconditional lockfile deletion, arbitrary PID termination, manifest-only Pipeline reachability assumptions, and unbounded command/test discovery.

### Fixed

- Parse the current Unity CLI's nested `pipelineServer.isReachable` and `pipelineServer.apiUrl` fields so unreachable instances do not trigger command discovery.
- Updated guarded graceful Editor exit to use the current `unity command eval` surface and attempt it only when the exact running project advertises `eval` and the discovered Editor/Pipeline process identity remains unchanged immediately before dispatch. Shutdown now waits for the configured graceful timeout and accepts a nonzero CLI response only when process verification confirms the Editor exited, since the Pipeline server can disconnect before returning a valid response.
- Propagated cancellation through capability probes and multi-process termination so cancellation prevents later lifecycle actions.

## [0.7.1] - 2026-07-10

### Changed

- Migrated Pi extension imports and peer dependencies to the `@earendil-works` package scope.

### Fixed

- Recognize Windows-style absolute Unity project paths with Windows path semantics when status output is validated on another operating system.

## [0.7.0] - 2026-07-09

### Added

- Added `unity_run_test_batch` for one-platform Unity Test Framework batches with normalized filter/category arrays, collision-safe absolute XML/log paths under project `Logs`, and the existing guarded Unity launcher on Windows and macOS.
- Added Windows CI alongside the existing macOS package validation workflow.

### Changed

- Added Unity validation scope and stop guidance so explicit PlayMode skips are honored, compile/EditMode and optional PlayMode evidence are distinguished, and unchanged infrastructure failures are inspected once using exact current-run artifact paths rather than retried in launch loops.
- Refactored generic batchmode and test-batch execution through one project-mutex, process-authorization, lockfile, launcher, and artifact-reporting path; cancellation now stops before forced-close fallback, while any completed closure is journaled into subsequent errors.

### Fixed

- Prevent Unity Test Framework runs with zero executed tests or requested but missing/unparseable result XML from being labeled passed, and make artifact inspection fail clearly when no requested evidence is available.
- Keep raw Unity XML/log/stdout/stderr evidence on disk instead of duplicating unbounded content into session details; retain paths, byte counts, parsed results, and bounded excerpts.
- Signal failed Unity batches and failed artifact inspections through thrown tool errors instead of unsupported `isError` return fields.

## [0.6.0] - 2026-07-09

### Changed

- Hardened same-project Unity process matching to parse only exact `-projectPath` arguments, use platform-correct path identity, and avoid treating unrelated Unity CLI status fields as project paths.
- Revalidate the Unity executable, project argument, PID, and command line immediately before guarded OS-level termination so recycled PIDs are skipped.
- Added macOS CI coverage for tests and package validation.
- Updated `unity_launch_batchmode` to add `-nographics` by default, with an explicit `useGraphics` opt-in for screenshots, visual capture, render checks, or graphics-dependent PlayMode tests.
- Updated Unity batchmode skill and README guidance to steer agents toward no-graphics validation unless the requested work requires graphics.

## [0.5.0] - 2026-06-28

### Added

- Added `piUnity.allowCloseRunningUnityProcess` settings support so `unity_launch_batchmode` can close same-project blocking Unity processes only when explicitly enabled and requested with `closeBlockingUnityProcess`.
- Added `piUnity.closeRunningUnityProcessOnlyForTests` and `piUnity.closeRunningUnityProcessTimeoutMs` safeguards for constrained Unity process closure.

### Changed

- Updated guarded process closing to request graceful Editor exit through `unity eval 'UnityEditor.EditorApplication.Exit(0);'` before falling back to OS-level process termination.
- Updated guarded process closing to clean up the exact resolved project's stale `Temp/UnityLockfile` only when pi-unity closed the matching Unity process in the same batchmode call and verifies no matching process remains.
- Updated Windows process termination to retry `taskkill` with `/F` only when Windows reports that force is required.
- Updated `unity_project_status`, README, and batchmode skill guidance to surface the new guarded process-closing settings.
- Updated the interactive Unity project picker so up/down navigation wraps between the first and last workspace options.

## [0.4.0] - 2026-06-27

### Added

- Added `unity_inspect_artifacts` to summarize existing Unity Test Framework XML results and Unity logs without launching Unity.

### Changed

- Updated Unity batchmode skill guidance to prefer `unity_inspect_artifacts` over ad hoc shell parsing after Unity failures.

## [0.3.0] - 2026-06-27

### Added

- Added `unity_project_status` to inspect Unity native lockfile state, Unity CLI status, and running project processes without launching Unity.

### Changed

- In Unity CLI launcher mode, `unity_launch_batchmode` now delegates stale native `Temp/UnityLockfile` handling to `unity run` after verifying no running project process is active, while keeping direct Editor executable launches blocked by native lockfiles.
- Tightened screenshot skill guidance so agents load it only when screenshot evidence is requested or required by project/review workflow.

## [0.2.0] - 2026-06-16

### Added

- Added Unity CLI integration so `unity_open_editor` prefers `unity open` and `unity_launch_batchmode` prefers `unity run` when the installed `unity` command is available.
- Added Unity CLI status parsing for safer same-project busy checks before launching GUI or batchmode Unity.
- Added `UNITY_CLI_PATH` support for overriding the Unity CLI executable.
- Added `launcher` selection (`auto`, `unity-cli`, `editor-executable`) so workflows can bypass Unity CLI when forwarded arguments differ from direct Editor executable behavior.
- Added Unity CLI argument normalization that strips direct-Editor flags managed by `unity run` (`-batchmode`, `-projectPath`, `-quit`) before forwarding user args.
- Added unit coverage for Unity CLI command construction, forwarded-argument normalization, and status parsing.

### Changed

- Kept direct Unity Editor executable launch as a fallback when Unity CLI is unavailable or cannot resolve the environment.
- Updated Unity batchmode skill and README guidance to document the Unity CLI preferred path and fallback behavior.

## [0.1.0] - 2026-04-27

### Added

- Initial Pi Unity package with Unity Editor GUI launch, batchmode execution, Unity Test Framework summary parsing, project discovery, single-project process safeguards, and screenshot workflow guidance.
