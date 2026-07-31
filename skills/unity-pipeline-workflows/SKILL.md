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
3. The tools reject clearly incompatible Play Mode/paused lifecycle state without changing it. They never stop, pause, save, import, launch, or close Unity.
4. Test success requires a well-formed terminal result, a known positive executed count, and zero failures. An asynchronous initiation with `Total: 0` and `running` is nonterminal.
5. Passing test records are intentionally discarded. Failures retain only a bounded set of failed/inconclusive names, messages, and stack excerpts.

## Compile

Call `unity_pipeline_recompile` with optional `path` and `timeoutSeconds` (default 180, maximum 3600). It reports either up-to-date scripts or a compact completion summary. Compiler failures, identity changes, cancellation, malformed evidence, and deadline expiry are tool errors.

## Focused tests

Call `unity_pipeline_run_tests` with:

- required `testPlatform`: `EditMode` or `PlayMode`;
- optional `testFilter`: one test-name filter only;
- optional `path` and `timeoutSeconds` (default 600, maximum 3600).

The tool detects a pre-existing active connected test before dispatch and stops rather than claiming or replacing it. It captures returned mode/filter/run identity fields when available and stops as uncertain if status is clearly displaced by another run.

## Bounded raw CLI troubleshooting only

Normally call the typed tools, not raw CLI commands. If a typed tool is unavailable in an older installed package and a user specifically authorizes troubleshooting, first use `unity_project_status` and require advertised `recompile_status` or `run_tests` and `test_status`. Use the documented asynchronous form with `--async_tests true`, one fixed deadline, and bounded backoff; parse object and stringified nested JSON. `Total: 0` with `result: running` is a valid nonterminal initiating response. Passing evidence reports successful completion, a known positive executed-test count, and zero failures; nested `success:false`, changed exact-copy identity, or polling timeout is non-passing uncertainty. Do not silently fall back to batchmode after uncertain connected dispatch. Connected work does not guarantee NUnit XML.

## When not to use connected tools

Use `unity_run_test_batch` for a closed project, intentional isolation/CI, category or multiple filters, or required NUnit XML/log evidence. State the reason for that route. Do not use batchmode as an automatic fallback after an uncertain connected dispatch.

Use `unity_plan_inspect` only for package-owned read-only planning commands. Do not expose generic `eval` for ordinary compile/test work.
