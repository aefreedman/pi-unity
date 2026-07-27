# Pi Unity

Pi skill and tool package for reusable Unity workflows.

## Contents

- skill: `unity-connected-workflows`
- skill: `unity-batchmode-tests`
- skill: `capturing-screenshots-unity`
- skill: `auditing-unity-agent-guidance`
- skill: `unity-docs` (solution-capture compatibility name preserved)
- tool: `unity_migrate_solution_docs`
- tool: `unity_guidance_audit`
- tool: `unity_project_status`
- tool: `unity_inspect_artifacts`
- tool: `unity_open_editor`
- tool: `unity_launch_batchmode`
- tool: `unity_run_test_batch`
- command: `/unity-open`

## Install

From GitHub:

```bash
pi install git:git@github.com:aefreedman/pi-unity.git
```

Local development install:

```bash
pi install <path-to-pi-unity>
```

Project-local install:

```bash
pi install -l <path-to-pi-unity>
```

## Notes

- Pi discovers packaged skills from `skills/` and extensions from `index.ts`.
- On every `session_start`, pi-unity registers a Unity generated-directory repository-search policy, a Unity solution-artifact v1/v2 profile, `UnityMigrationServiceV1`, and an `engine.unity` `WorkflowProviderV1`. The engine provider claims only the nearest `ProjectSettings/ProjectVersion.txt` marker, keeps status readiness separate from applicability, and supplies bounded plan/work/review/validation guidance. Canonical Unity guidance and resources remain packaged at their current paths. Registrations are isolated per session scope, safe under reverse load order, and a delayed old-session shutdown cannot remove another scope's current records.
- The repository policy excludes `Library`, `Temp`, `Logs`, `obj`, `Build`, `Builds`, `UserSettings`, and `.vs` only for detected Unity project roots. The canonical repository-search package remains Unity-neutral.
- The artifact profile defines legacy `problem_type` and v2 `schema_version`/`doc_type`/`category`/`failure_mode` as independent fields. Complete valid v2 is authoritative; partial v2 plus legacy fields is a conflict. Generic artifact search remains available when this profile is missing, while profile-specific filters return `missing_profile`.
- `unity_migrate_solution_docs` is dry-run for `operation=plan`. Apply requires the exact reviewed `approvalHash`, explicit authorization, and a backup/VCS recovery gate. It performs normalized destination collision checks; exact-range, lossless classification patches; rebases inbound and all moved-document outbound local Markdown links (inline, reference-definition, and bare paths); rejects final broken links; preserves POSIX modes; stages hashed outputs; creates byte backups; and journals every operation. Apply/resume/rollback share one root queue and nonce-owned lock with explicit journal transitions. Destination, run, lock, backup, and stage paths are physically revalidated immediately before mutation. `--include-manual-review` is intentionally unsupported.
- Package validation uses synthetic migration fixtures only. Publication/package install never authorizes migration against real project documents.
- `unity-docs` keeps all templates, schema, and guidance under its own skill directory and uses the canonical project artifact/migration tools rather than installation-specific package paths.
- `unity_guidance_audit` performs a bounded, read-only scan of AGENTS.md, CLAUDE.md, Copilot, and Cursor guidance for outdated Unity CLI/Pipeline, batchmode, test, lifecycle, and exact-project-copy instructions. The `auditing-unity-agent-guidance` skill owns contextual migration and user-authorized edits.
- `unity_open_editor` launches the full Unity Editor GUI.
- `unity_open_editor` prefers the installed `unity open` CLI when available, falling back to direct editor executable launch.
- `unity_project_status` reports native Unity lockfile state, Unity CLI status output, running Unity processes, the locally declared `com.unity.pipeline` version, exact-project-copy Pipeline instances, and live advertised commands without launching Unity.
- `unity_inspect_artifacts` summarizes existing Unity Test Framework XML results and Unity logs without launching Unity, reducing ad hoc shell parsing after failures.
- Test routing starts with `unity_project_status`: an exact project copy that is already open with reachable `run_tests`/`test_status` Pipeline commands should run connected tests without closing the Editor.
- `unity-connected-workflows` is the preferred guidance for that focused connected compile/test work; connected tests do not inherently produce NUnit XML and current execution uses constrained standalone CLI commands until typed tools land.
- `unity_run_test_batch` is the preferred isolated/report-producing Unity Test Framework entry point, not a reason to close a reachable Pipeline Editor. Choose it for a closed project, unavailable/unsupported connected testing, intentional CI isolation, unsupported filters, or required NUnit XML/log artifacts. It runs exactly one EditMode or PlayMode batch, combines filter/category arrays into one launch, creates collision-safe absolute XML/log paths under the project `Logs` directory, omits `-quit`, and uses the same guarded launcher as `unity_launch_batchmode`.
- `unity_launch_batchmode` prefers the installed `unity run` CLI when available, falling back to direct editor executable batchmode launch; use it when custom raw Editor arguments are required.
- `unity_launch_batchmode` adds `-nographics` by default to avoid unnecessary graphics initialization and reduce focus stealing; set `useGraphics: true` only for screenshots, visual capture, render checks, or graphics-dependent PlayMode tests.
- Unity GUI, generic batchmode, and test-batch tools expose `launcher` (`auto`, `unity-cli`, or `editor-executable`) so workflows can force direct Editor execution when Unity CLI argument handling differs from `Unity.exe`/`Unity`.
- In Unity CLI mode, `unity_launch_batchmode` forwards args after `unity run <project> --` and strips direct-Editor flags managed by the CLI (`-batchmode`, `-projectPath`, `-quit`).
- `unity_run_test_batch`, `unity_launch_batchmode`, and `unity_inspect_artifacts` require parsed Unity Test Framework results to report a known positive executed-test count and no failures before treating them as passing evidence. Zero-test, unknown-total, missing-result, malformed-result, and failing batches are non-passing; full artifacts remain on disk while session details retain bounded excerpts and byte counts.
- Validation guidance treats explicit user/project PlayMode skips as authoritative, distinguishes baseline compile/EditMode evidence from optional PlayMode evidence, and stops unchanged relaunch loops after hangs or infrastructure failures in favor of one inspection of the exact current-run artifact paths.
- `unity_launch_batchmode` uses Unity CLI status and direct process scans before launch. In Unity CLI mode, stale native `Temp/UnityLockfile` detection is delegated to `unity run`; direct Editor executable mode still blocks on the native lockfile for safety. A Pi-side project mutex prevents duplicate packaged batchmode calls from spawning Unity concurrently.
- `unity_launch_batchmode` can close a same-project blocking Unity process only when isolated execution was deliberately selected, the tool call sets `closeBlockingUnityProcess: true`, and Pi settings enable `piUnity.allowCloseRunningUnityProcess`. Do not use this to replace reachable connected Pipeline testing. The tool re-scans and selects matching Unity processes itself; it never accepts a model-supplied PID.
- After a guarded same-call close, `unity_launch_batchmode` may remove the exact resolved project's stale `Temp/UnityLockfile` only after verifying no matching Unity process remains. It still refuses general lockfile deletion outside that guarded continuation.
- When using `closeBlockingUnityProcess: true`, prefer `launcher: "auto"` or `launcher: "unity-cli"`; force `launcher: "editor-executable"` only when direct Editor execution is explicitly required.
- If a Unity launch is blocked by a lockfile, run `unity_project_status` before asking a user to remove anything.
- `/unity-open` is the user-facing GUI launcher helper.
- The package resolves Unity project copies from a direct project root, a coordination root containing multiple copies, or another nearby folder. Pipeline routing validates canonical project-path identity after CLI discovery so similarly named copies are not treated as interchangeable; connected commands always receive the exact resolved project path.
- Installing and starting `com.unity.pipeline@0.3.1-exp.1` is a broader project mutation than adding its manifest entry: its server startup assigns `Application.runInBackground = true`, which Unity persists as `PlayerSettings.runInBackground` in `ProjectSettings/ProjectSettings.asset`. Review that tracked change alongside `manifest.json` and `packages-lock.json`.
- Unity install probing is OS-aware and avoids machine-specific assumptions by using the project's `ProjectSettings/ProjectVersion.txt`, the optional `unity` CLI, standard per-OS install locations, and optional `UNITY_EDITOR_PATH` overrides.
- Unity allows only one process per project folder; GUI and batchmode both count.
- The `unity-batchmode-tests` skill is intended for Unity Test Framework CLI runs.
- The `capturing-screenshots-unity` skill is intended for Unity gameplay and UI screenshot workflows when the project supports capture.
- Keep skill-specific references and helper assets under the skill directory beside `SKILL.md`.

## Settings

`pi-unity` reads optional package-specific settings from global `~/.pi/agent/settings.json` and, for trusted projects, project `.pi/settings.json`:

```json
{
  "piUnity": {
    "allowCloseRunningUnityProcess": false,
    "closeRunningUnityProcessOnlyForTests": true,
    "closeRunningUnityProcessTimeoutMs": 30000
  }
}
```

- `allowCloseRunningUnityProcess` defaults to `false`. When enabled, `unity_launch_batchmode` may close only Unity processes that target the resolved project and only when the tool call explicitly sets `closeBlockingUnityProcess: true`.
- `closeRunningUnityProcessOnlyForTests` defaults to `true`, limiting process closure to Unity Test Framework launches (`-runTests`).
- `closeRunningUnityProcessTimeoutMs` defaults to `30000` and is clamped between 1000 and 120000 milliseconds.

## Skill evaluation

The `auditing-unity-agent-guidance` skill has an opt-in behavioral eval under `evals/auditing-unity-agent-guidance/`. It runs isolated fixtures through Pi, checks triggering, filesystem outcomes, instruction fidelity, and tool-call efficiency, and can compare skill-enabled runs with a no-skill baseline. Because it invokes an agent and may incur provider costs, it is not part of `npm test`.

```bash
npm run eval:guidance-skill -- --cases audit_legacy_instructions,migrate_mixed_harness_guidance,unrelated_typescript_review
npm run eval:guidance-skill -- --condition both --trials 3
```

See `evals/auditing-unity-agent-guidance/README.md` for the rubric.

## Package layout

```text
pi-unity/
  index.ts
  src/
    unity-core.ts
    unity-batchmode.ts
    unity-cli.ts
    unity-launch.ts
    unity-processes.ts
    unity-project-lock.ts
    unity-projects.ts
  contracts/
    v1.ts
  scripts/
    migrate-unity-docs-schema.ts
  skills/
    unity-docs/
      SKILL.md
      schema.yaml
      references/
      assets/
    auditing-unity-agent-guidance/
      SKILL.md
      references/
      assets/
    unity-connected-workflows/
      SKILL.md
    unity-batchmode-tests/
      SKILL.md
    capturing-screenshots-unity/
      SKILL.md
      assets/
      references/
  tests/
```

## Testing

```bash
npm test
npm pack --dry-run
```

The package declares semver dependencies on `@aefree/pi-capability-registry`, `@aefree/pi-project-artifacts`, `@aefree/pi-repo-search`, and `@aefree/pi-workflow`. Neutral consumers co-install their tarballs; the Unity archive contains no copied dependency tree, sibling `file:` path, or workspace link.

## License

MIT. See `LICENSE`.
