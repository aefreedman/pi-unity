---
name: unity-pipeline-workflows
description: Recompile code or run focused Unity tests through a reachable com.unity.pipeline Editor without launching, closing, or manually polling another Unity process.
---

# Unity Pipeline Workflows

Use this workflow only for an already-running exact project copy with `com.unity.pipeline` installed and reachable.

## Preferred typed tools

Use one typed tool call for each supported connected operation:

- `unity_pipeline_recompile` for connected script compilation.
- `unity_pipeline_run_tests` for one focused `EditMode` or `PlayMode` test-name selection.

These tools resolve the exact copy, require advertised commands, inspect lifecycle state, dispatch once, validate identity, and poll internally with a fixed deadline. Do not recreate their wait loops with `bash`, `unity recompile_status`, or `unity test_status` calls.

A timeout or malformed response is uncertain: the Unity operation may still be running. Do not cancel, retry, launch batchmode, close the Editor, or claim a result without a new user-authorized decision.

## Preconditions and boundaries

1. Pass an explicit `path` when multiple project copies may be found; paths identify copies, not display names.
2. The typed tools require a reachable exact-copy Pipeline and advertised `editor_status` plus operation commands. A different connected client is not itself a project lock.
3. Autonomous Play Mode exit is disallowed by default. `unity_pipeline_recompile` never sends `editor_stop` or overrides Unity's Script Changes While Playing preference: known recompile-and-continue and defer policies may proceed without exit authorization; known stop-and-recompile and unavailable policy require `/unity-playmode-exit allow` because the recompile may exit Play Mode. Pipeline 0.4 does not currently expose that preference, so absence is reported as uncertainty rather than a claim that Unity cannot compile in Play Mode. `unity_pipeline_run_tests` has separate lifecycle semantics and may dispatch advertised `editor_stop` only after that same authorization, then verifies Edit Mode. `/unity-playmode-exit disallow` restores the default. The tools never enter Play Mode, pause, save, launch, or close Unity autonomously; recompilation may perform Unity's normal asset refresh/import and script-change behavior.
4. Test success requires a well-formed terminal result, a known positive executed count, and zero failures. An asynchronous initiation with `Total: 0` and `running` is nonterminal.
5. Passing test records are intentionally discarded. Failures retain only a bounded set of failed/inconclusive names, messages, and stack excerpts.

## Compile

Call `unity_pipeline_recompile` with optional `path` and `timeoutSeconds` (default 180, maximum 3600). It reports either up-to-date scripts or a compact completion summary, including whether an explicit agent exit, Unity-policy-driven behavior, or unavailable policy applied. A defer policy can mean recompilation waits until Play Mode ends. Compiler failures, identity changes, cancellation, malformed evidence, and deadline expiry are tool errors.

## Focused tests

Call `unity_pipeline_run_tests` with:

- required `testPlatform`: `EditMode` or `PlayMode`;
- optional `testFilter`: one test-name filter only;
- optional `path` and `timeoutSeconds` (default 600, maximum 3600).

The tool treats `no_tests`, idle, and not-started statuses as safe inactivity, detects a pre-existing active connected test before dispatch, and stops rather than claiming or replacing active work. It captures returned mode/filter/run identity fields when available and stops as uncertain if status is clearly displaced by another run.

## Bounded raw CLI troubleshooting only

Normally call the typed tools, not raw CLI commands. If a typed tool is unavailable in an older installed package and a user specifically authorizes troubleshooting, first use `unity_project_status` and require advertised `recompile_status` or `run_tests` and `test_status`. Use the documented asynchronous form with `--async_tests true`, one fixed deadline, and bounded backoff; parse object and stringified nested JSON. `Total: 0` with `result: running` is a valid nonterminal initiating response. Passing evidence reports successful completion, a known positive executed-test count, and zero failures; nested `success:false`, changed exact-copy identity, or polling timeout is non-passing uncertainty. Do not silently fall back to batchmode after uncertain connected dispatch. Connected work does not guarantee NUnit XML.

## When not to use connected tools

Use `unity_run_test_batch` for a closed project, intentional isolation/CI, category or multiple filters, or required NUnit XML/log evidence. State the reason for that route. Do not use batchmode as an automatic fallback after an uncertain connected dispatch.

Use the typed compile/test tools when their polling and terminal evidence fit the task. Advertised Pipeline `eval` remains available through `unity_pipeline_eval` for bounded project-specific inspection or operations outside those typed workflows; it is an assistance surface, not a forbidden fallback or a substitute for the typed tools' completion protocol. Eval compiles arbitrary C# with Roslyn on the Editor main thread, so ordinary properties and local-variable snippets are valid; it is not expression-only or reliably statically read-only. Prefer typed tools for their stronger evidence, but let user intent and project guidance govern mutations. Lifecycle, persistent-setting, destructive, asset, scene-save, package, build, and test mutations require explicit authorization.
