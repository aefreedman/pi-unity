# Pi Unity

Pi skill and tool package for reusable Unity workflows.

## Contents

- skill: `unity-pipeline-workflows`
- skill: `unity-batchmode-tests`
- skill: `auditing-unity-agent-guidance`
- skill: `unity-docs` (solution-capture compatibility name preserved)
- tool: `unity_migrate_solution_docs`
- tool: `unity_guidance_audit`
- tool: `unity_project_status`
- tool: `unity_pipeline_recompile`
- tool: `unity_pipeline_run_tests`
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
- On every `session_start`, pi-unity registers a Unity generated-directory repository-search policy, a Unity solution-artifact v1/v2 profile, and `UnityMigrationServiceV1`. When the optional `@aefree/pi-workflow` contract is installed and valid, it also registers the `engine.unity` `WorkflowGuidanceContributorV1`; when that package is absent, all Unity tools, migration, repository policy, and references remain available without workflow composition. A broken installed workflow contract fails visibly. The contributor resolves an exact or enclosing Unity root from validated `ProjectSettings/ProjectVersion.txt` evidence and performs bounded nested discovery only when one copy is unambiguous; multiple copies are an explicit selection gap. Composition performs no Editor lock, process, or readiness inspection. Its plan, work, and review guidance is loaded from package-owned resources with bounded, sanitized results and stable package/resource provenance. The work overlay preserves exact-copy identity, includes Unity validation evidence rules, prefers reachable connected Pipeline compile/test routes, and limits isolated batchmode to explicit supported reasons; it never switches after uncertain connected dispatch. For external Unity/package API behavior, plan guidance inspects the project/version manifests and routes evidence from project docs, exact-version local docs, active Pi docs tools, then reachable official vendor docs; unavailable docs are a verification gap, never a reason to install or upgrade. Registrations are isolated per session scope, safe under reverse load order, and a delayed old-session shutdown cannot remove another scope's current records.
- The repository policy excludes `Library`, `Temp`, `Logs`, `obj`, `Build`, `Builds`, `UserSettings`, and `.vs` only for detected Unity project roots. The canonical repository-search package remains Unity-neutral.
- The artifact profile defines legacy `problem_type` and v2 `schema_version`/`doc_type`/`category`/`failure_mode` as independent fields. Complete valid v2 is authoritative; partial v2 plus legacy fields is a conflict. Generic artifact search remains available when this profile is missing, while profile-specific filters return `missing_profile`.
- `unity_migrate_solution_docs` is dry-run for `operation=plan`. Apply requires the exact reviewed `approvalHash`, explicit authorization, and a backup/VCS recovery gate. It performs normalized destination collision checks; exact-range, lossless classification patches; rebases inbound and all moved-document outbound local Markdown links (inline, reference-definition, and bare paths); rejects final broken links; preserves POSIX modes; stages hashed outputs; creates byte backups; and journals every operation. Apply/resume/rollback share one root queue and nonce-owned lock with explicit journal transitions. Destination, run, lock, backup, and stage paths are physically revalidated immediately before mutation. `--include-manual-review` is intentionally unsupported.
- Package validation uses synthetic migration fixtures only. Publication/package install never authorizes migration against real project documents.
- `unity-docs` keeps all templates, schema, and guidance under its own skill directory and uses the canonical project artifact/migration tools rather than installation-specific package paths.
- `unity_guidance_audit` performs a bounded, read-only scan of AGENTS.md, CLAUDE.md, Copilot, and Cursor guidance for outdated Unity CLI/Pipeline, batchmode, test, lifecycle, and exact-project-copy instructions. The `auditing-unity-agent-guidance` skill owns contextual migration and user-authorized edits.
- `unity_open_editor` launches the full Unity Editor GUI.
- `unity_open_editor` prefers the installed `unity open` CLI when available, falling back to direct editor executable launch.
- `unity_project_status` reports native Unity lockfile state, Unity CLI status output, running Unity processes, the locally declared `com.unity.pipeline` version, exact-project-copy Pipeline instances, and bounded live advertised commands without launching Unity. Pipeline discovery has distinct `absent`, `timeout`, and `unavailable` states; a timeout is startup uncertainty rather than proof of absence. Rendered process command lines redact access tokens and credential-like values.
- `unity_inspect_artifacts` summarizes existing Unity Test Framework XML results and Unity logs without launching Unity, reducing ad hoc shell parsing after failures.
- Planning and test routing preserve the exact project copy: a reachable Pipeline Editor is a positive connected inspection surface for bounded advertised read-only commands; the project should run connected tests without closing the Editor or replacing it with a second Editor. `unity_plan_inspect` is the registered planning inspection tool and only planning CLI dispatch route: it rechecks canonical identity and advertised commands immediately before dispatch, permits only package-owned purpose-built reads, and permits `eval` only for its conservative expression-only subset. It never launches or closes Unity; use repository research when it rejects a read rather than raw bash dispatch.
- `unity-pipeline-workflows` routes focused connected work through `unity_pipeline_recompile` and `unity_pipeline_run_tests`. Each performs exact-copy preflight, advertised-command checks, lifecycle inspection, identity-aware bounded internal polling, and compact output in one model-visible call. Timeouts are uncertain and do not cancel, retry, close Unity, or switch to batchmode. Connected tests do not inherently produce NUnit XML.
- `unity_run_test_batch` is the preferred isolated/report-producing Unity Test Framework entry point, not a reason to close a reachable Pipeline Editor. Choose it for a closed project, intentional CI isolation, category/multiple filters unsupported by the single connected test-name filter, or required NUnit XML/log artifacts. It runs exactly one EditMode or PlayMode batch, combines filter/category arrays into one launch, creates collision-safe absolute XML/log paths under the project `Logs` directory, omits `-quit`, and uses the same guarded launcher as `unity_launch_batchmode`.
- `unity_launch_batchmode` prefers the installed `unity run` CLI when available, falling back to direct editor executable batchmode launch; use it when custom raw Editor arguments are required.
- `unity_launch_batchmode` adds `-nographics` by default to avoid unnecessary graphics initialization and reduce focus stealing; set `useGraphics: true` only for screenshots, visual capture, render checks, or graphics-dependent PlayMode tests.
- Unity GUI, generic batchmode, and test-batch tools expose `launcher` (`auto`, `unity-cli`, or `editor-executable`) so workflows can force direct Editor execution when Unity CLI argument handling differs from `Unity.exe`/`Unity`. Every launch route keeps same-project process verification and a per-project mutex; unknown process state blocks launch. Direct Editor execution blocks native lockfiles, while Unity CLI may handle a stale lockfile only after pi-unity verifies no matching project process.
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
  references/
    _shared/unity-repo-research.md
    workflow/plan.md
    workflow/work.md
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
    unity-pipeline-workflows/
      SKILL.md
    unity-batchmode-tests/
      SKILL.md
  tests/
```

## Testing

```bash
npm test
npm pack --dry-run
```

The package declares semver dependencies on `@aefree/pi-capability-registry`, `@aefree/pi-project-artifacts`, and `@aefree/pi-repo-search`. `@aefree/pi-workflow` is an optional peer integration: install it to compose `engine.unity`, or omit it to use the standalone Unity package. Neutral consumers co-install tarballs; the Unity archive contains no copied dependency tree, sibling `file:` path, or workspace link.

## License

MIT. See `LICENSE`.
