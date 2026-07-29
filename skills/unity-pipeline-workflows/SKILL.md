---
name: unity-pipeline-workflows
description: Compile code or run focused Unity tests through a reachable com.unity.pipeline Editor without launching or closing another Unity process. Use for exact-copy connected recompile, EditMode tests, PlayMode tests, and bounded status polling.
---

# Unity Pipeline Workflows

Use this workflow only for an already-running exact project copy with `com.unity.pipeline` installed and reachable.

## Preconditions

1. Resolve the exact project path; never route by display name.
2. Call `unity_project_status` and require:
   - a verified matching Editor process
   - a reachable exact-copy Pipeline instance
   - live advertised commands needed by the operation (`run_tests` and `test_status` for tests)
3. Revalidate the exact project path and Editor/Pipeline process identity before dispatch and during polling. If status is unknown, unreachable, stale, or identity changes, stop. Do not silently start batchmode or close the Editor.
4. Inspect `editor_status` before lifecycle-sensitive work. Preserve whether the Editor is in Play Mode, paused, compiling, or reloading; reachability alone does not make every operation safe.
5. Do not expose generic `eval` for ordinary compile/test work.

Until typed connected compile/test tools are available, use the installed standalone Unity CLI only for the constrained commands below. Put global options before `command` and `--project-path` before the dynamic command name.

## Command Discovery and Raw CLI Fallback

- Prefer the advertised command inventory returned by `unity_project_status`; do not probe several CLI help or interaction modes when that inventory already answers availability.
- If raw `unity list` is exceptionally needed, parse the outer JSON envelope and read command records from `data.tools`, not a guessed top-level `commands` field. Inspect one exact command schema rather than repeatedly trialing argument forms against the live Editor.
- `unity shell` is a human interactive convenience over the same connected Pipeline surface. It is not a better automation route than explicit one-shot commands with exact-copy revalidation.
- Treat a successful outer CLI process as transport evidence only. Parse nested `success`, status, diagnostics, and result fields before claiming the operation succeeded.

## Compile

```text
unity --format json --no-banner --non-interactive command --project-path <exact-project> recompile
unity --format json --no-banner --non-interactive command --project-path <exact-project> recompile_status
```

- `recompile` may return `up_to_date` immediately or trigger a domain reload.
- Before dispatch, define a timeout and bounded-backoff polling schedule. Poll `recompile_status` with bounded backoff until `completed` or `up_to_date`; do not improvise an open-ended sequence of sleeps.
- If `editor_status` reports Play Mode and the persistent edit requires import or compilation, do not assume `recompile` will safely stop or preserve Play Mode. Obtain lifecycle authorization unless already explicit, dispatch the advertised `editor_stop`, verify Play Mode exited, and only then compile.
- A nonterminal state such as `triggered` or `compiling` is not completion even when `failed:false`.
- Temporary disconnects are expected during domain reload; rediscover the exact copy rather than changing targets.
- Pipeline may return the status payload as a JSON string nested inside the outer JSON envelope. Parse both layers.
- Fail on compiler errors, malformed payloads, unknown/nonterminal status after timeout, or changed project/PID identity.

## Tests

Prefer asynchronous execution for one uniform lifecycle:

```text
unity --format json --no-banner --non-interactive command --project-path <exact-project> run_tests --mode editor --filter <filter> --filter_type testName --async_tests true
unity --format json --no-banner --non-interactive command --project-path <exact-project> test_status
```

For PlayMode use `--mode playmode --async_tests true`; synchronous PlayMode requests are not reliable across domain reload.

- Use one filter and filter type per connected run. If the required selection needs combined name/category arrays, use isolated `unity_run_test_batch` instead.
- The initial asynchronous `run_tests` response can legitimately report `Total: 0` with `result: running`; this is a valid nonterminal initiating response, not terminal zero-test evidence.
- Establish the timeout and bounded-backoff polling schedule before dispatch. Poll `test_status` with bounded backoff until a terminal result while leaving the Editor open; do not extend the deadline merely because repeated polls continue to report `running`.
- Parse both outer CLI envelopes and stringified nested JSON results. Inspect nested status/result objects for failures; nested `success:false` is non-passing even when the CLI process exits zero.
- A terminal result is passing evidence only when it is well formed, reports successful completion, reports a known positive executed-test count (`Total > 0`), and reports no failures.
- Fail on a terminal zero or unknown executed-test count, reported failures, malformed/incomplete data, changed exact-copy identity, or polling timeout.
- If dispatch may have succeeded but its response or later polling is uncertain, stop and report the uncertainty. A result-collector exception combined with a continuing `running` status is uncertain state, not permission to launch another test. Do not silently fall back to batchmode because the connected test run may still be running.
- Connected tests do not inherently produce NUnit XML. Use `unity_run_test_batch` or `unity test` when report artifacts are required.
- Bound `list_tests` output; broad projects can return thousands of test records.

### Test Cancellation

Do not treat Pipeline `cancel_tests` or `test_status: cancelled` as proof that Unity Test Framework stopped the underlying job. In Pipeline 0.4.0-exp.1, `cancel_tests` can detach the result collector while the Unity test job continues running.

When the exact copy advertises the package- or project-owned `cancel_unity_test_runs` command, prefer its guarded contract:

```text
unity command --project-path <exact-project> cancel_unity_test_runs --confirm true
```

Then inspect its state without mutation:

```text
unity command --project-path <exact-project> cancel_unity_test_runs --dry_run true
```

Attempt one documented cancellation path. Do not start another connected test run until activeRunCount is known to be 0. If cancellation times out or cannot establish that state, stop rather than retrying cancellation or changing execution routes.

If cancel_unity_test_runs is unavailable, use the Unity Test Runner window’s Stop button. If no reliable terminal state can be established, restart the Editor before running more tests. Never rely on cancel_tests alone to clean up a hung run.

Interactive runtime authoring and temporary Play Mode tuning are outside this compile/test workflow. Use the `unity-interactive-playmode-authoring` skill when that intent is explicit.

## Fallback policy

Use the `unity-batchmode-tests` skill only when the Editor is closed, connected execution is unavailable before dispatch, CI/isolation is intentional, complex filters are required, or NUnit XML/log evidence is required. State the reason for switching routes. Never switch routes silently after an uncertain connected dispatch.
