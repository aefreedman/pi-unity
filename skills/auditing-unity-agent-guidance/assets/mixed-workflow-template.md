## Unity automation routing

Resolve the exact absolute Unity project-copy path and pass it explicitly on every project-targeted native command. Use native CLI/Pipeline commands normally, discovering installed help and the exact copy's advertised signatures before dispatch. Do not route by display name, ambient cwd or inherited agent context alone.

1. Inspect whether the exact copy is closed, open with reachable Pipeline, or uncertain.
2. Prefer connected native compilation/tests when the running copy advertises the needed operation. Use isolated CLI/batchmode only when the copy is verified closed and requested isolation, supported selection or report requirements justify it.
3. Never close an Editor, launch another process, remove locks, install/upgrade Pipeline or upgrade a project implicitly. Stop on uncertainty rather than switching routes.
4. Give each child the absolute target, allowed work and mutation authorization. For a shared copy, designate one Editor-changing operator through actual completion and result capture; do not start competing tests, lifecycle changes or reloads. Suitable reads may proceed but need not be parallel or snapshot-consistent. Coordinate source edits before validation.
5. Async test startup and detached-start job completion are not passing test evidence. Shared test status can be replaced; jobs do not survive domain reloads. Require a known positive terminal test count and zero failures, preserving exact current-run evidence. Timeout or child exit is not proof that work stopped; resolve uncertainty before handoff or retry.

### Native CLI

Substitute the intended root below; `Resolve-Path` establishes an absolute path, not permission to mutate:

```powershell
$ProjectPath = (Resolve-Path "<workspace>/<project>").Path
unity status --project-path "$ProjectPath" --format json
# Bound discovery to the task and inspect exact advertised signatures.
unity command --project-path "$ProjectPath" --tag tests --detail full --limit 20 --format json
unity command --project-path "$ProjectPath" --result-only editor status
# Compile only when intended; use its completion diagnostics, not a duplicate poller.
unity recompile --project-path "$ProjectPath"
```

Grouped examples require those names/signatures to be advertised. `--result-only` payloads still require successful CLI completion and command-specific result validation. Discover the native test selector/async options; connected PlayMode needs advertised async testing plus terminal status, not merely a completed start job. For deliberately isolated reports, inspect `unity test --help` and use the explicit absolute project and result paths. Opening with `unity open "$ProjectPath" --until-ready` is only for an explicit GUI request and a verified closed copy.

### Optional Pi adapters

`unity_project_status`, `unity_run_tests`, `unity_pipeline_recompile`, `unity_launch_batchmode` and `unity_inspect_artifacts` remain available when their documented orchestration or evidence fits. They are not mandatory before native commands; adapter selection limits are not native limits. Pi session Play Mode policy and launch mutexes apply only to participating package calls, not arbitrary shell actions or fleet-wide ownership.

Keep direct Editor `-batchmode` commands only as explicit fallbacks or project-required CI routes. Raw Editor `-runTests` commands require absolute result/log paths and must not include `-quit`. Preserve project-specific test filters, PlayMode skips, graphics prerequisites and artifact locations.
