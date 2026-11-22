---
name: unity-pipeline-workflows
description: Use native Unity CLI and the live Pipeline catalog to find, open, inspect, close, compile, or test an exact Unity project copy. Use for Unity Editor automation, isolated tests, and coordination across workspaces or agents sharing an Editor.
---

# Unity CLI and Pipeline Workflows

Resolve the intended absolute project root first. If unknown, use `unity_find_projects` from the containing workspace. A result is a path, not proof of Editor readiness or permission to mutate. If targeting is ambiguous, resolve it rather than selecting the first match. Pass the root explicitly to every project-targeted call; a project name or inherited working directory can select the wrong copy.

Use the installed `unity` CLI, or invoke its configured absolute executable path if it is not on PATH. On a shared copy, assign one Editor-changing operator through terminal evidence capture. Give each child the exact root, role and authorized work. Read [targeting and fleet details](references/native-cli-fleet.md) when coordinating multiple agents or copies.

## Routine Editor lifecycle

```text
unity --non-interactive status --project-path "<root>" --format json
unity --non-interactive open "<root>" --until-ready
unity --non-interactive close "<root>"
```

Use `--until-ready` when command readiness matters; otherwise plain `open` is sufficient to launch. No connected instance is not proof no OS process owns the project. Use plain native `close` when requested: it exits without saving. The user owns the save decision; do not automatically save, check dirty assets, or add `--if-saved`. Do not close or force-kill an Editor to recover from unrelated work. Do not clear locks, auto-dismiss dialogs, or upgrade a project to get past a refusal.

## Work in a running Editor

Use `unity pipeline editors` to check installed and reachable instances; a manifest declaration is not a live connection. Narrow the exact copy's `unity command --project-path "<root>"` listing using the installed help and inspect the advertised command's `--help` before use. Prefer purpose-built reads to arbitrary C# when the native result fits. `script eval` is code execution on the Editor thread; its returned value is data, not a success envelope. `script run` hotpatches only when explicitly selected; do not substitute hotpatch for ephemeral execution. A timeout may stop waiting without stopping work.

Use native `unity recompile --project-path "<root>"` and read its terminal diagnostics. Unity owns Script Changes While Playing; don't stop Play Mode preemptively merely to compile. If the user is actively using Play Mode, account for the impact of compilation and domain reload.

## Choose and verify tests

Read the project's test scope and graphics requirements. Preserve the requested platform and selection; do not silently broaden a filter or run a skipped platform. Choose reachable connected testing for an open copy, or deliberately use `unity test` on a closed copy for isolation/CI or native XML reports. Do not automatically close or open a second Editor to switch routes.

- **Connected, Pipeline 1.0.1:** inspect native `test run` and `test status` help. EditMode supports synchronous execution; PlayMode and `all` need `--async-tests` because entering Play Mode can reload the domain. Check shared status before starting: a second run can cancel the first. An earlier terminal failure is not an active run. A successful async start can return no result (including JSON `null`); that is not a verdict. Poll formatted `test status` through terminal evidence and capture it before handing off or starting another run. For example, after checking that the target Editor advertises these flags:

  ```text
  unity --non-interactive --format json command --project-path "<root>" test run --mode playmode --filter "<test-name>" --filter-type TestName --async-tests true
  unity --non-interactive --format json command --project-path "<root>" test status --detail failures
  ```

  Do not add `--result-only` to this status call: CLI 1.0.1 can suppress the failed result in that mode. Formatted JSON retains the test status and requested result records. Read stdout and diagnostics even on nonzero exit; `--detail summary` is enough when only counts are needed. Synchronous EditMode can stream JSON test records. Shared status has no reliable per-run ID, and a detached start job completing does not mean tests completed.
- **Isolated:** inspect `unity test --help`. Pass the exact absolute project, explicit mode/selector, and a fresh absolute `--output` path. Keep reports/log paths tied to that run; check inherited test configuration if relevant. A native isolated `--timeout` can kill the Editor; a host wait expiring does not establish that it stopped. For existing CI that calls the Editor executable directly, do not combine `-runTests` and `-quit`; the Editor can exit before writing results.

Report executed, passed, failed and skipped counts separately. Zero executed, missing or unattributable evidence, and incomplete async startup are not a pass. On uncertainty, inspect current-run results and logs before conflicting work; do not blindly replay, broaden scope, cancel another run or switch routes.

### Graphics and focus

An actively rendering Game View and **Play Unfocused** solve different problems. Unity's [WaitForEndOfFrame documentation](https://docs.unity3d.com/6000.6/Documentation/ScriptReference/WaitForEndOfFrame.html) explains that switching from Game to Scene View can freeze the wait, and that it does not run in Editor batchmode. Check the exact Unity version and the wait the project uses before changing a timeout or product code. Graphics-enabled batchmode does not make a batchmode-incompatible wait work. Avoid forcing graphics for ordinary logic tests, but don't silently exclude requested graphics-dependent cases.
