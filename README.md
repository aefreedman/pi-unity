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

Pi discovers the extension from `index.ts` and packaged skills from `skills/`. In UI sessions, pi-unity warns once per Pi runtime when Unity CLI is unavailable or `UNITY_CLI_PATH` is invalid. The warning never displays configured paths; install Unity CLI, then restart or reload Pi.

## Development checks

Run `npm ci`, then `npm test` from the package repository. Tests first run the strict production-source type check (`index.ts` and `src/`) using the pinned TypeScript compiler and Node 22 types. Run `npm run typecheck` for that check alone. Tests and eval harnesses execute separately through `tsx`; they are outside this type-check scope.

## Tool presentation

In Pi's terminal UI, Unity tools use compact action headers and project names. Collapsed results show test counts, timing and route when available, plus failures and uncertainty. Expand using Pi's configured tool-details shortcut to see the full project path, highlighted eval code, formatted JSON results, bounded evidence, and artifact paths. Inspection success and test outcomes are displayed separately.

For a local, offline text preview, run `npm run preview:tools` from this package. The preview exercises the renderers without launching Unity; Pi supplies the surrounding tool box and configured keybinding hints in a live session.

## Included tools

### Connected Pipeline

Use these tools with an already-open exact Unity project copy that has a reachable `com.unity.pipeline` instance:

- `unity_project_status` — inspect lockfiles, matching Unity processes, Pipeline reachability, package version, and advertised commands without launching Unity.
- `unity_pipeline_recompile` — recompile through Pipeline with exact-copy preflight, bounded polling, and compact compiler evidence.
- `unity_run_tests` — one intent-oriented EditMode or PlayMode workflow. It reuses compatible connected Pipeline execution or selects isolated `unity test` when the exact project copy is closed.
- `unity_pipeline_eval` — execute bounded project-specific C# through Pipeline's Roslyn REPL. `timeoutSeconds` bounds pi-unity and Unity CLI waits (1–86,400 seconds). Optional `handlerTimeoutMilliseconds` is forwarded only when the exact reachable Pipeline advertises raw argv plus the verified eval timeout signature; it bounds that Pipeline dispatcher wait, not code already running on Unity's main thread. A timeout is uncertain and does not cancel or retry Editor work.
- `unity_pipeline_inspect` — dispatch supported package-owned inspection commands (including read-only `get_runtime_pipeline_settings`) and return structured evidence. Runtime settings are refused by Pipeline in Play Mode; pi-unity never exits Play Mode to read them.
- `unity_pipeline_run_script` — compile one existing project `.cs` file in Pipeline's ephemeral in-memory mode and invoke a named static entry point; supports bounded JSON arguments and compile-only `dryRun`. It deliberately does not expose hotpatch.

Connected recompilation follows Unity's Script Changes While Playing policy and never preemptively sends `editor_stop`. Connected tests may exit Play Mode through advertised `editor_stop` when necessary, then verify Edit Mode before dispatch. Play Mode exit is allowed by default; `/unity-playmode-exit allow|disallow|status` controls the current session.

A timeout is uncertain: work may still be running. The tools do not silently cancel, retry, launch another Editor, or switch to batchmode. Pipeline 0.6 can report busy for a modal dialog as well as startup settling, so ambiguous busy responses are surfaced and never blindly retried. Pipeline 0.7 improves recovery of standing compile errors and console output. For non-development Player builds, Pipeline also requires the `ENABLE_RUNTIME_PIPELINE` scripting define; enabling its runtime setting alone is insufficient.

### Editor and batchmode

- `unity_open_editor` — open the Unity Editor GUI. Pass `automated: true` to add the Unity Editor `-automated` flag; this is distinct from the Unity CLI's own `--non-interactive` option.
- `unity_launch_batchmode` — run a bounded batchmode command through Unity CLI or the direct Editor executable.
- `unity_inspect_artifacts` — validate existing normalized JSON test artifacts, Unity Test Framework XML and Unity logs without launching Unity. `details.status` describes inspection; `details.testOutcome` describes the tests, including failures and uncertainty. A valid failed-test artifact is a successful inspection, not a passing run.

Pass `normalizedResultPath` for standalone JSON evidence. Any explicit artifact path disables implicit latest-file selection and link expansion; missing requested files fail inspection. With all paths omitted, `latestFromLogs` selects one newest top-level JSON (mtime then filename) and only its contained declared NUnit/log links. Without JSON it selects XML alone, then log context. Historical selection cannot establish current-run identity. Mixed JSON/XML evidence must agree; without an explicit native artifact link, matching counts alone leave correlation uncertain.

Use `unity_run_tests` for all ordinary Unity Test Framework work. It writes a durable normalized JSON result under `Logs/`; isolated `unity test` runs retain requested native reports. Connected Pipeline is selected only for compatible requests. A reachable Editor is never closed automatically to obtain isolated-only features.

Isolated tests pin NUnit reports for normalized evidence; missing/malformed reports or nonzero CLI exits cannot pass. `retries` accepts 0–10; JSON-only retry evidence is reconciled to final outcomes. An omitted `coverage` setting may inherit from Unity CLI configuration (including enabled coverage); `coverage: false` does not override an inherited CLI setting. Where available the result reports read-only resolver provenance for effective `test.coverage` and `test.timeout`; no config is written. `timeoutSeconds` is a host deadline, not a CLI configuration override. Native batchmode `logFilePath` requires a project-contained absolute destination and conflicts with forwarded `-logFile`; `tailLog: false` disables native log tailing. Native log options require Unity CLI, not direct Editor execution. Connected Pipeline recompile remains the default; native CLI replacement is deferred pending exact identity, Play Mode, and JSON parity evidence.

Batchmode runs use `-nographics` by default. Set `useGraphics: true` only for screenshots, visual capture, render checks, or graphics-dependent tests. Unity permits only one process per project folder, so all launch routes verify the exact project and use a per-project mutex.

### Unity CLI information, Cloud inventory, and asset packages

- `unity_cli_info` reads the bounded global CLI command manifest or installed changelog. The manifest does **not** grant connected Pipeline commands; use exact-copy capability checks for those.
- `unity_docs_url` returns a validated official HTTPS URL without opening a browser. Supply an explicit Unity project root or Editor version for version-matched documentation; the sibling docs package owns content and caching.
- `unity_cloud_build_inventory` and `unity_pipeline_automation_inventory` perform one authenticated **remote read** (list/get) only when called. They never log in, write, or automatically page; filters and page/limit are explicit. Without organization/project IDs, Unity CLI environment or saved defaults choose the scope. Verify the returned selection and completeness before acting.
- `unity_inspect_unitypackage` reads an existing local archive's declared entries, not import completion. `unity_import_unitypackage` and `unity_export_unitypackage` mutate only on an explicit request and absolute exact project root; they fail closed on busy/unknown process state, native lockfile, or an existing mutex, never close an Editor, clear locks, overwrite an export, or retry. Success means the CLI reported success, **not** independently verified asset state. Import/export success JSON schemas have not been observed in a real mutation; inspect project/artifact effects separately. An external writer may race an export destination check.

Unity Accelerator settings may also be inherited from CLI environment or saved configuration. Check the effective settings before attributing download/cache behavior to a project; these tools do not reconfigure Accelerator.

Unity CLI telemetry is governed by its own controls: inspect `unity telemetry --help` and the CLI's current settings before choosing whether to enable or disable telemetry. Pi-unity does not change telemetry consent or persist CLI settings. Read-only Cloud calls still contact the service and may be subject to CLI telemetry; use them only when remote access is intended. Issue Tracker MCP is an external integration, **not** a pi-unity tool: consult the installed Unity CLI's Issue Tracker/MCP documentation and preview available commands explicitly before use; this package does not auto-enable MCP or infer connected permissions.

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
| Closed project or intentional CI isolation | `unity_run_tests` |
| Required NUnit XML or Unity log evidence | `unity_run_tests` |
| Existing failed-run artifacts | `unity_inspect_artifacts` |
| Project-specific C# query or operation | `unity_pipeline_eval` |
| Supported structured project inspection | `unity_pipeline_inspect` |
| Explicitly requested existing C# builder script | `unity_pipeline_run_script` |
| Open the GUI explicitly | `unity_open_editor` or `/unity-open` |

Pass an explicit project `path` when multiple copies may be discovered. Pipeline routing compares canonical paths so similarly named copies are not treated as interchangeable.

## Pipeline safety and evidence

The connected compile and test tools:

- require advertised commands before dispatch;
- verify the exact project copy and Pipeline identity;
- poll internally with fixed deadlines and bounded backoff;
- reject malformed or semantically failing nested results;
- require a known positive test count and zero failures before reporting a pass;
- keep routine tool output compact while preserving connected test records in durable normalized JSON evidence;
- detect pre-existing or clearly displaced test runs when available correlation fields permit it.

Another connected client is not a project lock. When Pipeline returns stable correlation fields, conflicting status is reported as displaced and uncertain. If Pipeline omits stable run identity, a competing same-mode, same-filter run may be indistinguishable from the requested run; the tool cannot prove exclusive ownership from shared Editor status alone.

### Pipeline eval

`unity_pipeline_eval` compiles C# with Roslyn and runs it on the connected Editor main thread. It is a live REPL, not an expression-only or statically read-only evaluator.

```text
{ code: "return UnityEditor.EditorSettings.scriptChangesDuringPlay;" }
{ code: "var s = UnityEngine.Application.dataPath; return s.Length;" }
```

`timeoutSeconds` remains the host/CLI wait. On exact copies that advertise raw argv and the verified eval `code`/integer-`timeout` signature, `handlerTimeoutMilliseconds` (1–86,400,000) also sets Pipeline's dispatcher wait through its positional command argument. A shorter host timeout may still win. This server wait can prevent queued work from starting, but cannot cancel eval code that already began on Unity's main thread; treat expiry as uncertain and never retry or fall back.

Use `unity_pipeline_inspect` when a purpose-built structured command fits. Use eval for bounded project-specific work that matches the user's intent. Prefer typed tools when they provide stronger lifecycle, polling, validation, or recovery semantics.

### Pipeline run_script

`unity_pipeline_run_script` is arbitrary code execution, not a sandbox or read-only inspection. Use it only when the user explicitly asks to run that existing file; obtain explicit authorization for lifecycle, settings, asset, build, test, or destructive mutations. It validates the exact project copy and advertised command twice, accepts a single existing `.cs` file inside the project, uses only `mode: ephemeral`, and never launches, saves, cancels, retries, falls back, hotpatches, or exits Play Mode. `dryRun: true` compiles without loading or executing the assembly.

Rejected eval and inspection results are native Pi tool failures (`isError: true`) via the documented `tool_result` middleware, with structured rejection codes and bounded diagnostics retained. Pre-dispatch rejection does not execute the command; a timeout or dispatch failure can leave effects uncertain and never triggers retry or fallback.

## Launch and process safeguards

`unity_open_editor` and batchmode tools treat Unity CLI as the authoritative launcher: `unity open`, `unity run`, and `unity test` receive only the selected project and let Unity CLI read `ProjectVersion.txt`. The direct Editor executable is an exceptional compatibility fallback used only when Unity CLI is unavailable. Set `launcher` to `auto`, `unity-cli`, or `editor-executable` when explicit routing is needed.

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

Legacy Pipeline releases (including `0.3.1-exp.1`) assigned `Application.runInBackground = true`, which Unity persisted as `PlayerSettings.runInBackground` in `ProjectSettings/ProjectSettings.asset`. Pipeline 0.6 restores the original value around server start/stop. Review tracked settings changes when installing older releases; Pipeline 0.6 reports non-automated Editor state as descriptor `info` rather than a console warning.

Pipeline 0.6 records local editor eval usage in `Library/Pipeline/eval-usage.jsonl`; raw source is not stored unless the Pipeline **Store Eval Source** setting is enabled. `UNITY_NO_CLI_INVOKED_TELEMETRY=1` opts out only of Unity CLI's per-invocation telemetry event; analytics and crash-reporting controls are separate and unchanged. Pipeline compact HTTP responses are accepted whether returned directly or inside the CLI's documented `data` wrapper; this does not assert that CLI wrapping has changed. For installed CLI/skill information, use read-only `unity skill show --list` or `unity skill show --path <path>`.

## License

MIT. See `LICENSE`.
