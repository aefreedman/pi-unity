---
name: unity-connected-workflows
description: Compile code or run focused Unity tests through a reachable com.unity.pipeline Editor without launching or closing another Unity process. Use for exact-copy connected recompile, EditMode tests, PlayMode tests, and bounded status polling.
---

# Unity Connected Workflows

Use this workflow only for an already-running exact project copy with `com.unity.pipeline` installed and reachable.

## Preconditions

1. Resolve the exact project path; never route by display name.
2. Call `unity_project_status` and require:
   - a verified matching Editor process
   - a reachable exact-copy Pipeline instance
   - live advertised commands needed by the operation
3. If status is unknown, unreachable, stale, or identity changes, stop. Do not silently start batchmode or close the Editor.
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
- The initial asynchronous `run_tests` response can legitimately report `Total: 0` with `result: running`; do not treat that initiating response as terminal zero-test evidence.
- Poll `test_status` to a terminal result while leaving the Editor open.
- Parse stringified nested JSON results.
- Fail when the terminal status reports zero tests, failures, malformed/incomplete data, or nested `success:false` even when the CLI process exits zero.
- Connected tests do not inherently produce NUnit XML. Use `unity_run_test_batch` or `unity test` when report artifacts are required.
- Bound `list_tests` output; broad projects can return thousands of test records.

## Fallback policy

Use the `unity-batchmode-tests` skill only when the Editor is closed, connected execution is unavailable, CI/isolation is intentional, complex filters are required, or NUnit XML/log evidence is required. State the reason for switching routes.
