---
name: unity-pipeline-workflows
description: Recompile code or run focused Unity tests through a reachable exact-copy com.unity.pipeline Editor using native CLI commands, with optional Pi adapters for bounded polling and durable evidence.
---

# Unity Pipeline Workflows

Use this workflow for an already-running exact project copy with reachable `com.unity.pipeline`. Start with [native CLI targeting and fleet guidance](references/native-cli-fleet.md): explicit absolute project paths, exact advertised schemas, one same-copy Editor-changing operator through completion and result capture. Native commands are the normal route, not a troubleshooting-only fallback.

## Native connected workflow

1. Inspect the exact Editor with native `unity status --project-path "<absolute-project-root>" --format json` and bounded command discovery. Require live reachability and advertised operation signatures; package presence alone is insufficient.
2. Use native `unity recompile --project-path "<absolute-project-root>"` for compilation when it fits. Follow its completion/diagnostics rather than recreating a polling loop. Raw advertised `script recompile` plus `script recompile_status` is also available when needed; tolerate expected reload disconnects under a fixed deadline, without replaying the mutation.
3. For tests, inspect that copy's `test run` and `test status` schemas. Preserve the intended platform and selectors. Current grouped tests use `--mode editor|playmode`, `--filter`, `--filter-type` and `--async-tests true`; existing flat names may advertise underscore spellings. Async startup is nonterminal; observe status through verified completion and capture results before any other run starts. Connected PlayMode testing needs the advertised async route because entering Play Mode can reload the domain.
4. Passing evidence requires successful terminal execution, a known positive executed-test count, and zero failures. `Total: 0` with `result: running` is valid startup, not a pass. Nested `success:false`, displaced results, malformed evidence and timeout are non-passing uncertainty.
5. Inspect Play Mode and Unity's Script Changes While Playing policy before changing state. A defer policy can wait until Play Mode ends. Obtain authorization for lifecycle changes; do not preemptively stop Play Mode or close the Editor merely to compile/test.

Do not broaden, combine or split selectors into different semantics just to fit an adapter. Multiple independent fixtures can run serially in the same Editor when explicitly intended, capturing each result before the next; stop on failure or uncertainty. Required NUnit XML, coverage, retries or other isolated-only features need a deliberate isolation decision, not argument stripping or closing an open Editor automatically.

## Render-dependent prerequisites

An active rendering Game View and **Play Unfocused** are different prerequisites. Unity's [`WaitForEndOfFrame` documentation](https://docs.unity3d.com/6000.6/Documentation/ScriptReference/WaitForEndOfFrame.html) explains that switching from Game View to Scene View can freeze that wait until Game View is selected again, and that it does not run in Editor batchmode. Verify the exact Unity version and actual wait used by the project; do not assume every UniTask or Awaitable overload has identical requirements. A hidden Game View can explain an end-of-frame stall even when Play Unfocused is configured.

Check rendering/focus prerequisites before increasing timeouts or changing product code. Report unmet prerequisites and obtain user authorization before changing Editor layout, focus policy, persistent settings or lifecycle. Record prior state and restore any authorized temporary change afterward. Ordinary logic tests do not require graphics merely because they run in PlayMode; graphics-enabled batchmode does not make a batchmode-incompatible wait compatible.

## Optional Pi adapters

Use these when their documented orchestration fits the task, not as compulsory gateways to native commands:

- `unity_project_status`: combined exact-copy process/lock/capability snapshot.
- `unity_pipeline_recompile`: exact-copy preflight and bounded internal polling (default 180 seconds, maximum 3600). It follows Unity's script-change policy rather than preemptively sending an Editor stop.
- `unity_run_tests`: compatible connected or deliberate isolated execution with durable normalized evidence (default 600 seconds, maximum 3600). Connected selection accepts one test-name filter or category, not both. It checks for pre-existing tests and detects displaced status when correlation permits; this is not atomic fleet exclusion. It may exit Play Mode when needed under its session policy, then verify Edit Mode.
- `unity_pipeline_inspect`, `unity_pipeline_eval`, `unity_pipeline_run_script`: bounded adapters over advertised inspections, C# eval and an explicitly requested existing script. Native purpose-built commands and bounded eval remain available directly.

The adapters retain their own limits and failure semantics. `/unity-playmode-exit` controls package behavior only; it does not govern native commands. Their normalized JSON persistence is an adapter feature, not a native execution prerequisite.

### Optional adapter recipe: two independent fixtures

Replace `/absolute/path/SyntheticGame` below with the selected absolute project root. Use one designated operator and two known non-overlapping fixtures, awaiting and inspecting each complete result and exact artifact path before issuing the next call:

```json
{"path":"/absolute/path/SyntheticGame","testPlatform":"EditMode","execution":"connected","testFilters":["Synthetic.InventoryFixture"]}
```

Only after a passing first result:

```json
{"path":"/absolute/path/SyntheticGame","testPlatform":"EditMode","execution":"connected","testFilters":["Synthetic.DialogueFixture"]}
```

Stop the remaining sequence on failure, timeout, cancellation, malformed evidence, displaced identity or any uncertainty. Report the other fixture as not run; do not retry, broaden to a parent suite/category, omit selectors or switch routes. For one category use `testCategories` instead. Never join selectors with semicolons or split an unclear intersection/overlap into separate calls. This adapter recipe does not limit richer native selector capabilities.

### Eval and existing-file execution

Native eval compiles arbitrary C# with Roslyn on the Editor main thread; properties and local-variable snippets are valid, but not reliably statically read-only. Use bounded target-specific code and explicit mutation intent. Research unfamiliar APIs and prefer a purpose-built command when it supplies clearer evidence, not merely to avoid eval.

The optional `unity_pipeline_eval` adapter's `timeoutSeconds` bounds its host wait plus, by default, CLI wait. `handlerTimeoutMilliseconds` is forwarded only for verified advertised signatures. Grouped eval converts it to seconds with an empty positional file argument and omits the CLI request-timeout override; flat eval retains its millisecond signature. A shorter host wait can still win. These are adapter controls, not native flag names. Never retry an uncertain prior mutation just to extend a timeout; expiry cannot cancel arbitrary code already running on the main thread.

`unity_pipeline_run_script` uses only ephemeral in-memory mode for one existing project `.cs` file; `dryRun` compiles without loading/executing and it does not expose hotpatch. Native script modes and parameters must be discovered and authorized independently. Lifecycle, persistent-setting, destructive, asset, scene-save, package, build and test mutations require intent regardless of route.
