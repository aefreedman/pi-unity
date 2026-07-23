# Unity Guidance Detection Catalog

The audit tool reports evidence, not automatic rewrite instructions.

## High-confidence problems

- `-runTests` combined with `-quit` in a raw Editor command.
- `unity command` without an exact `--project-path`.
- Bare `unity -batchmode`, which confuses the standalone Unity CLI with the Editor executable.
- Unconditional lockfile deletion or arbitrary PID termination.
- Instructions that assume Pipeline commands merely because the package appears in the manifest.

## Migration warnings

- Direct `Unity.exe -batchmode` presented as the only or primary local workflow.
- Headless Editor launch presented as the only compile check.
- Hard-coded Unity versions or Hub paths without ProjectVersion/fallback language.
- Pipeline installation presented as harmless setup rather than an explicit project mutation.
- Broad test discovery or command listing that can flood agent context.

## Usually valid and worth preserving

- Direct Editor commands explicitly labeled as legacy, CI, isolated, or unavailable-CLI fallback.
- `unity run <project> -- ...` for project-owned `-executeMethod` tooling.
- `unity test` when NUnit XML or an isolated cold run is required.
- Graphics-enabled PlayMode or screenshot workflows.
- Project guidance that intentionally skips PlayMode tests.
- Absolute project-local artifact paths and bounded failure inspection.
