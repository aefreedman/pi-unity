---
name: unity-pipeline-workflows
description: Recompile code or run focused Unity tests through a reachable com.unity.pipeline Editor without launching, closing, or manually polling another Unity process.
---

# Unity Pipeline Workflows

Use this workflow only for an already-running exact project copy with `com.unity.pipeline` installed and reachable.

## Preferred typed tools

Use one typed tool call for each supported connected operation:

- `unity_pipeline_recompile` for connected script compilation.
- `unity_run_tests` for one compatible `EditMode` or `PlayMode` test-name or category selection.

These tools resolve the exact copy, require advertised commands, inspect lifecycle state, dispatch once, validate identity, and poll internally with a fixed deadline. Do not recreate their wait loops with `bash`, `unity command script recompile_status`, or `unity command test status` calls.

A timeout, malformed response, or busy response is uncertain: the Unity operation may still be running or blocked by a modal dialog. Do not cancel, retry, launch batchmode, close the Editor, or claim a result without a new user-authorized decision. Pipeline 0.6 uses busy for modal blocks and no source-verified discriminator is available through this transport, so pi-unity does not blindly retry it.

## Preconditions and boundaries

1. Pass an explicit `path` when multiple project copies may be found; paths identify copies, not display names.
2. The typed tools require a reachable exact-copy Pipeline and advertised `editor status` plus operation commands (or their existing flat Pipeline names). A different connected client is not itself a project lock.
3. `unity_pipeline_recompile` never sends `editor.playmode stop` or overrides Unity's Script Changes While Playing preference. Known recompile-and-continue, stop-and-recompile, and defer policies proceed according to Unity's configured behavior. If the Pipeline does not expose that preference, the tool reports the unavailable policy and respects the session's Play Mode exit authorization. `unity_run_tests` may dispatch advertised `editor.playmode stop` (or its flat name) when needed, then verifies Edit Mode before running tests. The tools never enter Play Mode, pause, save, launch, or close Unity; recompilation may perform Unity's normal asset refresh/import and script-change behavior.
4. Test success requires a well-formed terminal result, a known positive executed count, and zero failures. An asynchronous initiation with `Total: 0` and `running` is nonterminal.
5. Routine tool output remains compact. Complete bounded terminal test records are persisted immediately in the durable normalized JSON artifact before Pipeline status can be displaced.

## Compile

Call `unity_pipeline_recompile` with optional `path` and `timeoutSeconds` (default 180, maximum 3600). It reports either up-to-date scripts or a compact completion summary, including whether an explicit agent exit, Unity-policy-driven behavior, or unavailable policy applied. A defer policy can mean recompilation waits until Play Mode ends. Compiler failures, identity changes, cancellation, malformed evidence, and deadline expiry are tool errors.

## Focused tests

Call `unity_run_tests` with:

- required `testPlatform`: `EditMode` or `PlayMode`;
- optional `testFilters` or `testCategories`: at most one selector family and one selector for connected execution;
- optional `execution`, `path`, and `timeoutSeconds` (default 600, maximum 3600).
- for render-dependent PlayMode tests, verify the exact-version Game View prerequisites below; do not change focus/settings automatically.

### Render-dependent prerequisites

An active rendering Game View and **Play Unfocused** are different prerequisites. Unity's [`WaitForEndOfFrame` documentation](https://docs.unity3d.com/6000.6/Documentation/ScriptReference/WaitForEndOfFrame.html) explains that switching from Game View to Scene View can freeze that wait until Game View is selected again, and that it does not run in Editor batchmode. Verify the exact Unity version and the actual wait used by the project; do not assume every UniTask or Awaitable overload has identical requirements. A hidden Game View can explain an end-of-frame stall even when Play Unfocused is configured.

Check the documented rendering/focus prerequisites before increasing timeouts or changing product code. Report an unmet prerequisite and obtain user authorization before changing Editor layout, focus policy, persistent settings, or lifecycle. If a temporary change is authorized, record the prior state and restore it afterward. Ordinary logic tests do not require graphics or a focus change merely because they run in PlayMode; `useGraphics: true` also does not make a batchmode-incompatible wait compatible.

The tool treats `no_tests`, idle, and not-started statuses as safe inactivity, detects a pre-existing active connected test before dispatch, and stops rather than claiming or replacing active work. It captures returned mode/filter/run identity fields when available and stops as uncertain if status is clearly displaced by another run.

### Two independent fixtures in an open Editor

Keep the Editor open. For an authorized request for two known non-overlapping fixtures, use the same explicit exact-copy `path` and platform, one selector per call. For example, replace `./SyntheticGame` with the selected project path and issue this `unity_run_tests` call:

```json
{"path":"./SyntheticGame","testPlatform":"EditMode","execution":"connected","testFilters":["Synthetic.InventoryFixture"]}
```

Await the completed tool result and inspect its outcome and exact normalized artifact path. Only after a passing result, issue the second call (not in parallel or pre-queued in the same turn):

```json
{"path":"./SyntheticGame","testPlatform":"EditMode","execution":"connected","testFilters":["Synthetic.DialogueFixture"]}
```

Stop the remaining sequence on failure, timeout, cancellation, malformed evidence, displaced identity, or any uncertainty; report the first result and the remaining fixture as not run. Do not retry, close the Editor, switch to isolated execution, or broaden to a parent suite/category or empty selectors. Empty/omitted selectors select all tests. Keep each result's artifact separately; do not treat one fixture's evidence as covering the other.

For a single category use `testCategories: ["SyntheticCategory"]` and omit `testFilters`. Never combine the two families or join selectors with semicolons. Multiple-selector rejection means no test was dispatched: use the serial recipe only for independent, non-overlapping selections without other isolated-only requirements. If overlap or intended filter/category intersection semantics are unclear, stop for clarification rather than split, duplicate, or broaden tests. Required XML, retries, coverage, or other isolated-only options still need a deliberate isolation decision, not argument stripping.

## Bounded raw CLI troubleshooting only

Normally call the typed tools, not raw CLI commands. If a typed tool is unavailable in an older installed package and a user specifically authorizes troubleshooting, first use `unity_project_status` and require advertised `script recompile_status` or `test run` and `test status`. Discover full schemas with `unity command --project-path <path> --detail full --format json`; use the exact names and flags that copy advertises. Current grouped tests use `--async-tests true` and `--filter-type`; existing flat commands may advertise underscore spellings. Request `--result-only` for a named operation, use one fixed deadline and bounded backoff, and validate the operation payload as well as the CLI exit status. `Total: 0` with `result: running` is a valid nonterminal initiating response. Passing evidence reports successful completion, a known positive executed-test count, and zero failures; nested `success:false`, changed exact-copy identity, or polling timeout is non-passing uncertainty. Do not silently fall back to batchmode after uncertain connected dispatch. Connected work does not guarantee NUnit XML.

## When not to use connected tools

Use `unity_run_tests` with `execution: "isolated"` for a closed project, intentional isolation/CI, multiple selectors in one run, retries, sharding, coverage, or required NUnit/JUnit evidence. Multiple independent fixtures alone do not require closing a reachable Editor: use the serial recipe above. A single category is supported connected when Pipeline advertises the command; do not claim broader connected selector support. Do not use batchmode as an automatic fallback after an uncertain connected dispatch.

Use the typed compile/test tools when their polling and terminal evidence fit the task. For an explicitly requested existing C# builder file, `unity_pipeline_run_script` uses advertised ephemeral in-memory compilation with bounded JSON arguments or compile-only dry run; it never enables hotpatch and remains arbitrary code execution requiring explicit mutation authorization. Advertised Pipeline `eval` remains available through `unity_pipeline_eval` for bounded project-specific inspection or operations outside those typed workflows. Its `timeoutSeconds` range is 1–86,400 seconds and bounds the host wait plus, by default, the CLI wait. Optional `handlerTimeoutMilliseconds` (1–86,400,000) is forwarded only when the exact reachable Pipeline advertises raw argv and a verified eval signature. Grouped eval converts it to seconds with an empty positional file argument and omits the CLI request-timeout override; existing flat eval retains its verified millisecond signature. A shorter host wait can still win. Do not assume a larger host deadline alone changes every Pipeline's handler wait. For a newly authorized bounded operation, use the separately verified handler control when needed; never retry an uncertain prior mutation just to supply a longer timeout. A dispatcher expiry cannot cancel code already started on Unity's main thread, so the effect remains uncertain and no retry or fallback is allowed. It is an assistance surface, not a forbidden fallback or a substitute for the typed tools' completion protocol. Eval compiles arbitrary C# with Roslyn on the Editor main thread, so ordinary properties and local-variable snippets are valid; it is not expression-only or reliably statically read-only. Prefer typed tools for their stronger evidence, but let user intent and project guidance govern mutations. Lifecycle, persistent-setting, destructive, asset, scene-save, package, build, and test mutations require explicit authorization.
