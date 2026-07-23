---
name: unity-batchmode-tests
description: Run isolated/report-producing Unity Test Framework EditMode/PlayMode tests through Unity CLI or direct Editor batchmode. Use for CI, NUnit XML evidence, closed projects, or when connected Pipeline testing is unavailable; not the default for an already-open reachable Pipeline Editor.
---

# Unity Batchmode Tests

Run Unity Test Framework tests from the command line without opening the Editor GUI.

## Critical Warnings

- **Inspect the exact project copy first** - call `unity_project_status`; if that copy is already open with reachable Pipeline test commands, prefer the connected workflow instead of closing it for batchmode.
- **Never pass `-quit` with `-runTests`** - Unity exits immediately before tests complete, producing no results file.
- **Use absolute paths** for `-testResults` and `-logFile` to ensure logs are easy to find.
- **Unity allows only one process per project folder** - GUI Editor and batchmode/headless both count as that one process.
- **Do not open the GUI editor for the same project before or during batchmode runs** - `/unity-open` and `unity_open_editor` launch the full Unity Editor GUI and are not equivalent to headless batchmode.
- **Do not close a reachable Pipeline Editor merely to run tests** - an already-open exact copy can run supported tests through `run_tests` plus `test_status`; use the `unity-connected-workflows` skill.
- **Only close a blocking Unity Editor through `unity_launch_batchmode` safeguards after deliberately choosing isolated execution** - this is limited to cases such as required NUnit XML, unsupported connected filters/commands, or explicit isolation. Use `closeBlockingUnityProcess: true` only when `unity_project_status` shows `piUnity.allowCloseRunningUnityProcess` is enabled or the user explicitly says it is enabled; pi-unity re-scans the resolved project and never accepts arbitrary PIDs.
- **Use `unity_launch_batchmode` when you want to run headless Unity directly** - keep test-specific flags deliberate, especially around `-runTests` and `-quit`.
- **Bundle tests into one Unity batchmode turn whenever practical** - starting/stopping Unity, importing assets, and domain reloads dominate runtime. A broader single run is usually faster than many sequential one-test Unity launches, and same-project runs cannot use useful parallelism.
- **Default to headless/no-graphics validation** - `unity_launch_batchmode` adds `-nographics` by default to reduce focus stealing and unnecessary graphics initialization.
- **Distinguish graphics-agnostic test runs from graphics-required visual runs** - screenshot, render-texture, and other visual-capture tests require an active graphics device and must not use `-nographics`.
- **Only request graphics when required by the user's work** - set `useGraphics: true` only for screenshots, visual capture, render checks, or graphics-dependent PlayMode tests.
- **Do not treat a graphics-disabled run as valid evidence for screenshot workflows** - graphics-required tests should fail clearly or be excluded from that run.

## Validation Scope and Stop Rules

- Explicit user instructions and project guidance to skip PlayMode tests override generic validation defaults. Record PlayMode as intentionally skipped; do not launch it anyway to seek extra evidence.
- Treat project-required compile validation and relevant EditMode tests as the baseline when they apply. PlayMode is additional evidence only when the user requests it, project/review guidance requires it, or the behavior cannot be validated honestly outside PlayMode.
- Plan and bundle the applicable evidence before launching Unity. Do not turn validation into an open-ended sequence of one-test processes.
- After a timeout, hang, missing-results infrastructure failure, or killed Unity process, call `unity_inspect_artifacts` once with the exact current-run `-testResults`/`-logFile` paths and `latestFromLogs: false`, then stop relaunching. Do not use an older "latest" artifact as evidence for the failed run. Retry only when there is a new, stated hypothesis that changes the command/environment, or the user explicitly requests another attempt.
- A failing product assertion may justify a targeted rerun after an implementation change. An unchanged infrastructure failure does not.
- Report required evidence as passed, failed, intentionally skipped, or blocked. Never imply an unrun PlayMode check passed.

## Workflow

### 1. Prefer the packaged Unity tools

Use the `pi-unity` tools first instead of forming raw Unity CLI commands on the fly:
- `unity_project_status` to inspect lockfile/process state without launching Unity
- `unity_inspect_artifacts` to summarize existing Unity logs/test XML without launching Unity
- `unity_run_test_batch` for isolated/report-producing Unity Test Framework runs with one platform and bundled filters/categories
- `unity_launch_batchmode` for custom headless Unity execution that needs raw Editor arguments
- `unity_open_editor` only when the user explicitly wants the GUI Editor
- `/unity-open` as the user-facing GUI launcher helper

`unity_run_test_batch` should be the default for isolated or report-producing Unity Test Framework work. It generates unique absolute XML/log paths under the project `Logs` directory, normalizes filter/category arrays into one launch, omits `-quit`, and uses the same guarded executor as `unity_launch_batchmode`. For an already-open reachable exact-copy Pipeline Editor, use the `unity-connected-workflows` skill instead.

`unity_launch_batchmode` remains the default for custom agent-run headless Unity work because it already:
- resolves the Unity project from a direct project root, a coordination root, or another nearby folder
- reads `ProjectSettings/ProjectVersion.txt`
- prefers the installed `unity run` CLI when available, falling back to OS-aware direct editor launch
- uses OS-aware standard install probing
- supports explicit `UNITY_EDITOR_PATH` / `unityEditorPath` overrides
- strips direct-Editor flags managed by `unity run` (`-batchmode`, `-projectPath`, `-quit`) before forwarding args in Unity CLI mode
- supports `launcher: "editor-executable"` when Unity CLI argument forwarding differs from direct Editor executable behavior
- checks Unity CLI status and running Unity processes before launch
- can close same-project blocking Unity processes only when `closeBlockingUnityProcess: true` is set and `piUnity.allowCloseRunningUnityProcess` is enabled in Pi settings; by default this is limited to Unity Test Framework runs
- may remove the exact resolved project's stale `Temp/UnityLockfile` after a guarded same-call process close, but only after verifying no matching Unity process remains
- delegates stale native `Temp/UnityLockfile` handling to `unity run` when the Unity CLI launcher is selected; direct Editor executable mode still blocks on native lockfiles for safety unless pi-unity just created the stale-lockfile condition through a guarded close
- uses a Pi-side project mutex so duplicate packaged batchmode calls fail before spawning Unity
- can summarize Unity Test Framework results compactly when `-testResults` and `-logFile` are provided

After a failed run, prefer `unity_inspect_artifacts` for follow-up inspection of existing result XML/log files instead of ad hoc `bash`/`sed`/Python parsing. This avoids shell quoting mistakes and does not start another Unity process.

If a launch is blocked by a native Unity lockfile, call `unity_project_status` before asking the user to remove anything. Only fall back to direct CLI commands if the packaged Unity tools are unavailable or fail to resolve the environment correctly.

### 2. Get the Project's Unity Version

If you are in direct CLI fallback mode, read `ProjectSettings/ProjectVersion.txt` in the Unity project root:

```
m_EditorVersion: ####.#.#f#
```

### 3. Find the Unity Executable

If you are in direct CLI fallback mode, check these locations based on platform and version:

**Windows:**
```
C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe
C:\Program Files\Unity\<version>\Editor\Unity.exe
C:\UnityInstalls\<version>\Editor\Unity.exe
```

**macOS:**
```
/Applications/Unity/Hub/Editor/<version>/Unity.app/Contents/MacOS/Unity
/Applications/Unity/<version>/Unity.app/Contents/MacOS/Unity
/Applications/Unity*
```

If not found, ask the user for their Unity install path.

### 4. Choose the execution route, then run tests

Route before planning a batch:
1. Call `unity_project_status` for the exact project copy.
2. If that copy is already open, Pipeline is reachable, and `run_tests` plus `test_status` are advertised, use `unity-connected-workflows`; do not close the Editor or invoke `unity_run_test_batch` merely because the test tool is more convenient.
3. Choose isolated `unity_run_test_batch` only when the Editor is closed, connected testing is unavailable, CI/isolation is intentional, required filters are unsupported, or NUnit XML/log artifacts are required. State the reason.
4. If project state is uncertain, stop rather than closing the Editor or starting batchmode.

After choosing the isolated route:
- plan the full validation batch before launching Unity
- bundle all tests that can share the same project, `-testPlatform`, and graphics mode into one `unity_launch_batchmode` call
- when several specific tests are relevant, prefer a broader class/namespace/suite/category filter, or no `-testFilter` for the affected platform, over separate Unity launches
- use a single-test launch only for a quick smoke check or to isolate/rerun a known failure; do not use one-test launches as the default validation strategy
- do not queue multiple `unity_launch_batchmode` calls back-to-back in one agent turn; wait for the structured summary, inspect failures, and only then decide whether another Unity launch is necessary
- call `unity_run_test_batch` for isolated/report-producing tests; use `unity_launch_batchmode` only when custom raw Unity arguments are required
- pass one `testPlatform` (`EditMode` or `PlayMode`) and bundle applicable `testFilters`/`testCategories`; empty arrays mean all tests on that platform
- use the generated exact result/log paths from the tool report for any follow-up artifact inspection
- pass `closeBlockingUnityProcess: true` only after connected testing was ruled out or isolated evidence was explicitly required, a same-project Unity process is blocking the chosen run, and Pi settings enable `piUnity.allowCloseRunningUnityProcess`
- prefer `launcher: "auto"` or `launcher: "unity-cli"` when using `closeBlockingUnityProcess: true`; force `launcher: "editor-executable"` only when direct Editor execution is explicitly required
- pass the explicit test arguments needed for the bundled run
- rely on the tool to remove direct-Editor lifecycle flags (`-batchmode`, `-projectPath`, `-quit`) before forwarding args through `unity run`
- use `launcher: "editor-executable"` if the installed `unity run` wrapper rejects or changes another argument that works with direct Editor batchmode
- always provide absolute `-testResults` and `-logFile` paths when practical so the tool can summarize results compactly for the agent
- keep test-specific flags deliberate, especially around `-runTests` and `-quit`
- decide up front whether the run is graphics-agnostic or graphics-required
- rely on the default `useGraphics: false` / `-nographics` mode for ordinary EditMode, non-visual PlayMode, asset import, build, and CI-style checks
- set `useGraphics: true` only when the requested work requires an active graphics device
- exclude graphics-required screenshot/visual-capture tests from no-graphics runs
- prefer project test categories such as `RequiresGraphics` / `VisualCapture` when the project exposes them

Direct CLI fallback templates:
```
unity test "<ProjectPath>" --mode <EditMode|PlayMode> --filter "<Full.Test.Name>" --output "<ResultsPath>" -- -logFile "<LogPath>"
"<UnityEditorPath>" -batchmode -nographics -projectPath "<ProjectPath>" -runTests -testPlatform <EditMode|PlayMode> -testFilter "<Full.Test.Name>" -testResults "<ResultsPath>" -logFile "<LogPath>"
```

Fallback parameters:
- `-testPlatform`: `EditMode` or `PlayMode`
- `-testFilter`: Full test name (e.g., `MyNamespace.MyTests.TestMethodName`)
- `-testCategory`: Optional category filter when the project uses NUnit categories for routing runs such as `RequiresGraphics`
- `-testResults`: Absolute path for XML results (e.g., `<ProjectPath>/Logs/test-results.xml`)
- `-logFile`: Absolute path for log output (e.g., `<ProjectPath>/Logs/test-run.log`)

## Project-Specific Configuration

Check the project's `AGENTS.md` for:
- Recommended log output locations
- Common test namespaces/filters
- Any project-specific testing notes
