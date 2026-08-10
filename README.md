# Pi Unity

Pi tools and skills for reliable Unity Editor, Pipeline, batchmode, testing, and project-guidance workflows.

## Install

From npm:

```bash
pi install npm:@aefree/pi-unity
```

From GitHub:

```bash
pi install git:git@github.com:aefreedman/pi-unity.git
```

For local development:

```bash
pi install <path-to-pi-unity>
pi install -l <path-to-pi-unity> # project-local
```

Pi discovers the extension from `index.ts` and packaged skills from `skills/`.

## Included tools

### Connected Pipeline

Use these tools with an already-open exact Unity project copy that has a reachable `com.unity.pipeline` instance:

- `unity_project_status` — inspect lockfiles, matching Unity processes, Pipeline reachability, package version, and advertised commands without launching Unity.
- `unity_pipeline_recompile` — recompile through Pipeline with exact-copy preflight, bounded polling, and compact compiler evidence.
- `unity_pipeline_run_tests` — run one focused EditMode or PlayMode selection with bounded polling and aggregate results.
- `unity_pipeline_eval` — execute bounded project-specific C# through Pipeline's Roslyn REPL.
- `unity_pipeline_inspect` — dispatch supported package-owned inspection commands and return structured evidence.

Connected recompilation follows Unity's Script Changes While Playing policy and never preemptively sends `editor_stop`. Connected tests may exit Play Mode through advertised `editor_stop` when necessary, then verify Edit Mode before dispatch. Play Mode exit is allowed by default; `/unity-playmode-exit allow|disallow|status` controls the current session.

A timeout is uncertain: work may still be running. The tools do not silently cancel, retry, launch another Editor, or switch to batchmode.

### Editor and batchmode

- `unity_open_editor` — open the Unity Editor GUI. Pass `automated: true` to add the Unity Editor `-automated` flag; this is distinct from the Unity CLI's own `--non-interactive` option.
- `unity_launch_batchmode` — run a bounded batchmode command through Unity CLI or the direct Editor executable.
- `unity_run_test_batch` — run one isolated or report-producing Unity Test Framework platform with generated XML and log paths.
- `unity_inspect_artifacts` — summarize existing Unity Test Framework XML and Unity logs without launching Unity.

Use connected tests when the exact project is already open and Pipeline testing is reachable. Use `unity_run_test_batch` for closed projects, CI-style isolation, categories or multiple filters, graphics-dependent PlayMode tests, or required NUnit XML/log evidence.

Batchmode runs use `-nographics` by default. Set `useGraphics: true` only for screenshots, visual capture, render checks, or graphics-dependent tests. Unity permits only one process per project folder, so all launch routes verify the exact project and use a per-project mutex.

### Guidance audit

- `unity_guidance_audit` — inspect AGENTS.md, CLAUDE.md, Copilot, and Cursor instructions for outdated or unsafe Unity automation guidance without editing them.

### Commands

- `/unity-open` — open the current Unity project copy or choose a nearby copy.
- `/unity-playmode-exit` — allow, disallow, or inspect Play Mode exit behavior for the current session.

## Included skills

Each skill owns a distinct workflow:

- `unity-debugging` — evidence-first diagnosis of Editor, runtime, package, asset, lifecycle, callback, and feature-activation problems.
- `unity-pipeline-workflows` — connected compilation and focused tests through an already-running exact-copy Pipeline Editor.
- `unity-batchmode-tests` — isolated or report-producing Unity Test Framework execution.
- `unity-interactive-playmode-authoring` — temporary live runtime inspection and tuning followed by deliberate persistence when requested.
- `auditing-unity-agent-guidance` — review and migration of project-local Unity automation instructions.

Operation-specific recovery belongs to the operational skill. `unity-debugging` supplies the reusable diagnostic strategy rather than duplicating every workflow's failure handling.

## Choosing a workflow

| Situation | Preferred route |
| --- | --- |
| Open exact-copy Editor with reachable Pipeline | Connected Pipeline tools |
| Closed project or intentional CI isolation | `unity_run_test_batch` or `unity_launch_batchmode` |
| Required NUnit XML or Unity log evidence | `unity_run_test_batch` |
| Existing failed-run artifacts | `unity_inspect_artifacts` |
| Project-specific C# query or operation | `unity_pipeline_eval` |
| Supported structured project inspection | `unity_pipeline_inspect` |
| Open the GUI explicitly | `unity_open_editor` or `/unity-open` |

Pass an explicit project `path` when multiple copies may be discovered. Pipeline routing compares canonical paths so similarly named copies are not treated as interchangeable.

## Pipeline safety and evidence

The connected compile and test tools:

- require advertised commands before dispatch;
- verify the exact project copy and Pipeline identity;
- poll internally with fixed deadlines and bounded backoff;
- reject malformed or semantically failing nested results;
- require a known positive test count and zero failures before reporting a pass;
- discard passing-test records while retaining bounded failure diagnostics;
- detect pre-existing or clearly displaced test runs when available correlation fields permit it.

Another connected client is not a project lock. When Pipeline returns stable correlation fields, conflicting status is reported as displaced and uncertain. If Pipeline omits stable run identity, a competing same-mode, same-filter run may be indistinguishable from the requested run; the tool cannot prove exclusive ownership from shared Editor status alone.

### Pipeline eval

`unity_pipeline_eval` compiles C# with Roslyn and runs it on the connected Editor main thread. It is a live REPL, not an expression-only or statically read-only evaluator.

```text
{ code: "return UnityEditor.EditorSettings.scriptChangesDuringPlay;" }
{ code: "var s = UnityEngine.Application.dataPath; return s.Length;" }
```

Use `unity_pipeline_inspect` when a purpose-built structured command fits. Use eval for bounded project-specific work that matches the user's intent. Prefer typed tools when they provide stronger lifecycle, polling, validation, or recovery semantics.

## Launch and process safeguards

`unity_open_editor` and batchmode tools prefer the installed Unity CLI and can fall back to the direct Editor executable. Set `launcher` to `auto`, `unity-cli`, or `editor-executable` when explicit routing is needed.

Before launching, pi-unity checks:

- running Unity processes targeting the exact project;
- Unity CLI status and Pipeline instances;
- native `Temp/UnityLockfile` state;
- the package-owned per-project launch mutex.

Unknown process state blocks launch. Direct Editor execution blocks native lockfiles. Unity CLI may handle a stale lockfile only after pi-unity verifies that no matching Unity process remains.

A batchmode call may close a matching Unity process only when all of the following are true:

1. isolated execution was deliberately selected;
2. the call sets `closeBlockingUnityProcess: true`;
3. `piUnity.allowCloseRunningUnityProcess` is enabled;
4. any configured test-only restriction permits the operation.

The package selects and revalidates the process itself; it never accepts a model-supplied PID. It may remove only the exact project's stale lockfile after a same-call guarded closure and verification that no matching process remains.

## Settings

Pi-unity reads optional settings from global `~/.pi/agent/settings.json` and, for trusted projects, project `.pi/settings.json`:

```json
{
  "piUnity": {
    "allowCloseRunningUnityProcess": false,
    "closeRunningUnityProcessOnlyForTests": true,
    "closeRunningUnityProcessTimeoutMs": 30000
  }
}
```

- `allowCloseRunningUnityProcess` defaults to `false`.
- `closeRunningUnityProcessOnlyForTests` defaults to `true`.
- `closeRunningUnityProcessTimeoutMs` defaults to `30000` and is clamped from 1000 to 120000 milliseconds.

## Optional integrations

`@aefree/pi-project-artifacts` and `@aefree/pi-file-discovery` are optional peer integrations. Core Unity tools work without them.

Pi-unity uses a global registry rendezvous so independently installed Git, local, or npm packages can compose without sibling source paths:

- The project-artifacts integration contributes an optional Unity profile for solution and memory metadata.
- The file-discovery integration recommends excluding generated Unity directories from broad searches while preserving exact searches inside those directories.

The optional peer integrations are session-scoped, reverse-load-order safe, and transactional. A malformed advertised integration contract fails visibly; an unavailable optional package does not prevent the Unity extension from loading.

### Optional artifact metadata

When project artifacts are active, solution and memory Markdown may use:

```yaml
---
engine: unity
unity_version: "6000.0"
unity_packages:
  - com.unity.inputsystem
render_pipeline: urp
platforms:
  - windows
  - android
---
```

Supported `render_pipeline` values are `builtin`, `urp`, `hdrp`, `custom`, and `agnostic`. All fields are optional, and undeclared project metadata remains open and raw-filterable.

### File-discovery filtering

Broad Unity project searches may exclude `Library`, `Temp`, `Logs`, `obj`, `Build`, `Builds`, `UserSettings`, and `.vs`. An exact generated root—including `Library/PackageCache/...`—remains searchable. Filter failures degrade filtering rather than blocking inspection.

## Package layout

```text
pi-unity/
  index.ts
  src/
    unity-artifact-profile.ts
    unity-batchmode.ts
    unity-cli.ts
    unity-core.ts
    unity-file-discovery-filter.ts
    unity-guidance-audit.ts
    unity-launch.ts
    unity-pipeline.ts
    unity-processes.ts
    unity-project-lock.ts
    unity-projects.ts
    unity-test-batch.ts
  skills/
    auditing-unity-agent-guidance/
    unity-batchmode-tests/
    unity-debugging/
    unity-interactive-playmode-authoring/
    unity-pipeline-workflows/
  tests/
```

## Development and validation

```bash
npm ci
npm test
npm pack --dry-run --json
```

The auditing skill also has an opt-in provider-backed behavioral eval under `evals/auditing-unity-agent-guidance/`; it is intentionally not part of `npm test`.

The registry-clean `package-lock.json` is committed. Optional development packages resolve from the public registry, and the npm archive contains no copied dependency tree, sibling `file:` dependency, or workspace link.

## Unity Pipeline project side effect

Starting `com.unity.pipeline@0.3.1-exp.1` assigns `Application.runInBackground = true`, which Unity persists as `PlayerSettings.runInBackground` in `ProjectSettings/ProjectSettings.asset`. Review that tracked change alongside `manifest.json` and `packages-lock.json` when installing Pipeline in a Unity project.

## License

MIT. See `LICENSE`.
