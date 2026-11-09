# Native Unity CLI and same-project fleets

Use native Unity CLI and the exact project's advertised `com.unity.pipeline` commands as the normal execution surface. Pi tools remain optional adapters when their documented evidence or lifecycle handling fits the task; they do not define the full native command surface.

## Target and discover

- Resolve the exact absolute project-copy path. Pass the appropriate explicit project selector on every project-targeted native call, including status/job follow-up. A display name, cwd, inherited shell variable or another agent's context is not sufficient targeting evidence.
- Include that absolute path, allowed work, mutation authorization and the designated Editor operator in every child brief, including nested delegation and resumed work. Revalidate the target before use; do not silently substitute another copy. Pi Unity does not automatically propagate a selected target to children or enforce their shell commands.
- Use installed CLI help and bounded discovery, then read the exact command's advertised signature. A manifest dependency is not proof of a reachable Editor or command support. For example, substitute the resolved absolute path and narrow the tag/limit to the task:

```text
unity --no-banner --non-interactive status --project-path "<absolute-project-root>" --format json
unity --no-banner --non-interactive command --project-path "<absolute-project-root>" --tag tests --detail full --limit 20 --format json
unity --no-banner --non-interactive command --project-path "<absolute-project-root>" --result-only editor status
```

Grouped names and flags belong to that Pipeline version; do not guess them from a neighboring command. Use `--result-only` for a named command when a single result payload is needed; it is not combined with `--detach`. Validate the CLI outcome and command-specific payload, not JSON syntax alone. Global `unity commands` and `unity changelog` need no project selector. Cloud inventory is an intended authenticated remote read, not routine local diagnosis; remote Pipeline Automation is not the local Editor Pipeline package.

## Fleet protocol

1. Different project copies can proceed independently. For a shared copy, the supervisor designates one Editor-changing operator: supervisor or child, not a new execution gateway.
2. Other agents may perform suitable source analysis and read-only inspections. Reads need not be immediate or parallel, and several reads do not form one consistent snapshot. Eval is arbitrary code, not intrinsically read-only.
3. The operator coordinates compilation, tests, eval/script mutations, imports, assets, Play Mode and other lifecycle changes according to user intent. Do not silently launch/close another Editor, install/upgrade Pipeline, dismiss dialogs, clear locks, save, persist settings or broaden test selection.
4. Keep the role assigned until the underlying operation really completes and its results are captured. Native command serialization is not workflow ownership: a start command can return while work continues.
5. Coordinate a stable validation phase after edits. File writes can cause auto-refresh/import/reload even without a CLI call. Keep one writer per shared checkout or use isolated worktrees; an Editor-operator role does not protect files from concurrent writers.
6. Report the exact project, operation/selection, native job ID where applicable, terminal evidence/artifact paths and any uncertainty. Handoff explicitly; do not infer availability from child exit or local timeout.

This is cooperative guidance, not exclusion against users or other clients. Pi launch mutexes apply only to participating adapter calls and end with their callback; `/unity-playmode-exit` governs package-controlled behavior in that Pi session, not native CLI calls or a project-wide veto.

## Completion and recovery

- In Pipeline 0.10, ordinary non-immediate commands are serialized, but async tests return `running` before completion. Starting another test run can invalidate the previous collector and replace shared test status. Keep the operator through terminal result capture; do not claim another run's shared status as yours.
- Native detached jobs identify command executions. A detached async-start job completing does not mean the tests completed or passed. Jobs are in Editor memory and do not survive domain reloads; a missing job is not proof of success or cancellation.
- Require command-specific terminal evidence. Test passing evidence needs a known positive executed count and zero failures; zero, missing, malformed or conflicting results are non-passing. Keep exact current-run evidence rather than a historical "latest" file.
- Timeouts, disconnects and cancellation leave effects uncertain. The newer protocol can request cancellation on disconnect/signals, but running work is only cooperatively cancellable; stopping a wait does not prove it stopped.
- On uncertain work, stop conflicting new actions and inspect the native completion surface or existing artifacts. Do not blindly retry, resubmit after a missing job, cancel someone else's work, switch to batchmode or remove locks. Obtain a new explicit decision before recovery that changes lifecycle or repeats an uncertain mutation.
