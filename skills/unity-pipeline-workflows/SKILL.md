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
4. Do not expose generic `eval` for ordinary compile/test work.

Until typed connected compile/test tools are available, use the installed standalone Unity CLI only for the constrained commands below. Put global options before `command` and `--project-path` before the dynamic command name.

## Compile

```text
unity --format json --no-banner --non-interactive command --project-path <exact-project> recompile
unity --format json --no-banner --non-interactive command --project-path <exact-project> recompile_status
```

- `recompile` may return `up_to_date` immediately or trigger a domain reload.
- Poll `recompile_status` with bounded backoff until `completed` or `up_to_date`.
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
- Poll `test_status` with bounded backoff and a stated timeout until a terminal result while leaving the Editor open.
- Parse both outer CLI envelopes and stringified nested JSON results. Inspect nested status/result objects for failures; nested `success:false` is non-passing even when the CLI process exits zero.
- A terminal result is passing evidence only when it is well formed, reports successful completion, reports a known positive executed-test count (`Total > 0`), and reports no failures.
- Fail on a terminal zero or unknown executed-test count, reported failures, malformed/incomplete data, changed exact-copy identity, or polling timeout.
- If dispatch may have succeeded but its response or later polling is uncertain, stop and report the uncertainty. Do not silently fall back to batchmode because the connected test run may still be running.
- Connected tests do not inherently produce NUnit XML. Use `unity_run_test_batch` or `unity test` when report artifacts are required.
- Bound `list_tests` output; broad projects can return thousands of test records.

### Test Cancellation

As of version 0.4.0-exp.1 there is a bug with `cancel_tests`

1. Do not start a replacement run after cancel_tests. Treat it as “detach reporting,” not actual cancellation.
2. Use focused fixture/assembly runs while the Editor stays open.
3. For a stuck run, use Unity’s Test Runner window Stop control (it should use the Test Framework’s native job cancellation
   rather than Pipeline’s collector-only cancellation).

If you detect that Unity still executes tests afterward, restart the Editor before another connected run. This is the only reliable cleanup without a package fix.

## Fallback policy

Use the `unity-batchmode-tests` skill only when the Editor is closed, connected execution is unavailable before dispatch, CI/isolation is intentional, complex filters are required, or NUnit XML/log evidence is required. State the reason for switching routes. Never switch routes silently after an uncertain connected dispatch.
