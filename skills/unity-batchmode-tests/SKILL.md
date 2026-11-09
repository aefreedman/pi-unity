---
name: unity-batchmode-tests
description: Run isolated/report-producing Unity Test Framework EditMode/PlayMode tests through native Unity CLI or explicit direct Editor fallback. Use for CI, NUnit XML evidence, closed projects or unavailable connected testing; not the default for an already-open reachable Pipeline Editor.
---

# Unity Batchmode Tests

Use native Unity CLI for isolated tests and custom headless execution. Read [native targeting and fleet guidance](../unity-pipeline-workflows/references/native-cli-fleet.md) first. Pass the exact absolute project path, give every child an explicit target/role/authorization, and keep one same-copy Editor-changing operator through completion and evidence capture. Project context is not automatically inherited or enforced.

## Choose the route before launch

1. Inspect the exact copy with native `unity status --project-path "<absolute-project-root>" --format json` and bounded Pipeline discovery; `unity_project_status` remains an optional combined snapshot.
2. If the copy is open, reachable and advertises the needed tests, use `unity-pipeline-workflows`. Do not close it merely for convenience or start a second Editor.
3. Choose isolated native `unity test` when the copy is verified closed and isolation/CI, connected limitations or requested NUnit/JUnit/log evidence justify that route. If state is uncertain, stop. An isolated-only option does not authorize closing the running Editor.
4. Use native `unity run` for project-owned custom headless methods/arguments, not as an automatic fallback from uncertain connected work. Direct Editor execution is an explicit compatibility/unavailable-CLI fallback, not the unconditional primary route.

Unity permits only one process per project folder. GUI and batchmode both count. Do not launch the GUI before or during an isolated run, remove locks speculatively, terminate an arbitrary PID or silently substitute another Editor version.

## Native test execution

Inspect installed `unity test --help` and the project's `ProjectSettings/ProjectVersion.txt`. Let Unity CLI resolve that declared Editor rather than adding a different version. Substitute absolute project/result/log paths and the intended filter in this project-authoritative template:

```text
unity test "<absolute-project-root>" --mode <EditMode|PlayMode> --filter "<Full.Test.Name>" --output "<absolute-results-path>" -- -logFile "<absolute-log-path>"
```

Keep report destinations distinct and current-run-specific. Confirm format, filter/category and report flags from installed help; do not infer native semantics from Pi parameter names. CLI configuration may supply coverage, timeout or Accelerator settings. Inspect effective configuration when it matters; do not rewrite it as a shortcut.

Plan the relevant validation batch before launch. Bundle intended filters/categories that share a platform and graphics mode into one run when native semantics support it, without broadening requested scope. Avoid repeated one-test launches or pre-queued runs; inspect the first result before deciding another is needed. A targeted rerun after a product change is different from blindly repeating an unchanged infrastructure failure.

### Graphics and scope

- Honor project/user instructions to skip PlayMode; report it intentionally skipped rather than running it for extra evidence.
- Use no-graphics execution for graphics-agnostic checks. Select graphics-enabled execution only when screenshots, rendering or graphics-dependent tests require it; confirm the native flags. The optional batchmode adapter adds `-nographics` by default and uses `useGraphics: true` to opt out.
- Do not treat no-graphics results as screenshot evidence. Use project categories such as `RequiresGraphics`/`VisualCapture` when available; do not silently exclude requested tests.
- An active graphics device does not make a batchmode-incompatible wait valid. Check exact-version Game View/`WaitForEndOfFrame` prerequisites in `unity-pipeline-workflows`.

## Completion and recovery

Require a parsed current-run terminal result with a known positive executed count and zero failures before reporting a pass. Exit zero, empty selection, unknown totals, missing/malformed reports and contradictory evidence are not passes. Preserve native reports and exact paths for follow-up; a historical "latest" file cannot establish current-run identity.

After timeout, hang, missing-results infrastructure failure or killed process, inspect the exact current-run reports/logs once, then stop relaunching. `unity_inspect_artifacts` is an optional reader: supply exact paths and `latestFromLogs: false`. Native evidence may also be read directly with bounded output. Report passed, failed, intentionally skipped or blocked evidence separately; never imply an unrun check passed. Cancellation/timeout does not prove underlying work stopped, so resolve uncertainty before handing the Editor-changing role to another child.

## Optional Pi adapters and direct Editor fallback

- `unity_run_tests` supplies automatic compatible connected/isolated routing and normalized JSON evidence under `Logs/`; it does not silently close an open Editor to obtain isolated-only features. Those routing/selection limits are not restrictions on native commands.
- `unity_launch_batchmode` supplies custom raw-Editor argument forwarding, exact-version direct fallback, process checks and a participating per-project launch mutex. The mutex is not an operation lock for arbitrary CLI callers.
- In these adapters, `timeoutSeconds` is a host deadline; native log controls are `logFilePath`/`tailLog`, not direct Editor flags. `coverage: false` does not override inherited enabled CLI coverage. Inspect the adapter result and effective-source provenance when available.
- Guarded closure is available only after deliberately choosing isolation, explicitly authorizing closure, setting `closeBlockingUnityProcess: true`, and enabling `piUnity.allowCloseRunningUnityProcess` (plus any test-only restriction). The adapter selects and revalidates the exact process; never pass a guessed PID or assume these settings constrain native calls.
- `unity_open_editor` and `/unity-open` remain optional GUI helpers, only when GUI opening is requested. They are not batchmode execution or proof of readiness.

For direct Editor fallback, resolve the exact declared version from standard installed locations or native Editor discovery; never guess a nearby version. If unavailable, report the missing prerequisite rather than upgrading. Raw Editor test arguments use absolute `-projectPath`, `-testResults`, `-logFile` and the intended `-testPlatform`/`-testFilter`/`-testCategory`. **Never combine `-runTests` with `-quit`: Unity can exit before tests finish and reports are written.** Do not duplicate lifecycle flags when forwarding through native CLI; follow its installed help.

Check project `AGENTS.md` for test scope, filters, graphics requirements and artifact locations. Preserve valid CI/direct-Editor requirements rather than replacing them merely to prefer a Pi tool.
