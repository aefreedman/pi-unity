# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows semantic versioning for public package releases.

## [Unreleased]

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
