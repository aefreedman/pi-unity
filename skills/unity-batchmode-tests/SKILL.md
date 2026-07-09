---
name: unity-batchmode-tests
description: Run Unity Test Framework EditMode/PlayMode tests in batch mode via CLI. Use when running Unity tests from command line, CI pipelines, or automated testing without the Unity Editor GUI.
---

# Unity Batchmode Tests

Run Unity Test Framework tests from the command line without opening the Editor GUI.

## Critical Warnings

- **Never pass `-quit` with `-runTests`** - Unity exits immediately before tests complete, producing no results file.
- **Use absolute paths** for `-testResults` and `-logFile` to ensure logs are easy to find.
- **Unity allows only one process per project folder** - GUI Editor and batchmode/headless both count as that one process.
- **Do not open the GUI editor for the same project before or during batchmode runs** - `/unity-open` and `unity_open_editor` launch the full Unity Editor GUI and are not equivalent to headless batchmode.
- **Only close a blocking Unity Editor through `unity_launch_batchmode` safeguards** - use `closeBlockingUnityProcess: true` only when `unity_project_status` shows `piUnity.allowCloseRunningUnityProcess` is enabled or the user explicitly says it is enabled; pi-unity re-scans the resolved project and never accepts arbitrary PIDs.
- **Use `unity_launch_batchmode` when you want to run headless Unity directly** - keep test-specific flags deliberate, especially around `-runTests` and `-quit`.
- **Bundle tests into one Unity batchmode turn whenever practical** - starting/stopping Unity, importing assets, and domain reloads dominate runtime. A broader single run is usually faster than many sequential one-test Unity launches, and same-project runs cannot use useful parallelism.
- **Default to headless/no-graphics validation** - `unity_launch_batchmode` adds `-nographics` by default to reduce focus stealing and unnecessary graphics initialization.
- **Distinguish graphics-agnostic test runs from graphics-required visual runs** - screenshot, render-texture, and other visual-capture tests require an active graphics device and must not use `-nographics`.
- **Only request graphics when required by the user's work** - set `useGraphics: true` only for screenshots, visual capture, render checks, or graphics-dependent PlayMode tests.
- **Do not treat a graphics-disabled run as valid evidence for screenshot workflows** - graphics-required tests should fail clearly or be excluded from that run.

## Workflow

### 1. Prefer the packaged Unity tools

Use the `pi-unity` tools first instead of forming raw Unity CLI commands on the fly:
- `unity_project_status` to inspect lockfile/process state without launching Unity
- `unity_inspect_artifacts` to summarize existing Unity logs/test XML without launching Unity
- `unity_launch_batchmode` for headless Unity execution
- `unity_open_editor` only when the user explicitly wants the GUI Editor
- `/unity-open` as the user-facing GUI launcher helper

`unity_launch_batchmode` should be the default path for agent-run headless Unity work because it already:
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

### 4. Run the Tests

Preferred path:
- plan the full validation batch before launching Unity
- bundle all tests that can share the same project, `-testPlatform`, and graphics mode into one `unity_launch_batchmode` call
- when several specific tests are relevant, prefer a broader class/namespace/suite/category filter, or no `-testFilter` for the affected platform, over separate Unity launches
- use a single-test launch only for a quick smoke check or to isolate/rerun a known failure; do not use one-test launches as the default validation strategy
- do not queue multiple `unity_launch_batchmode` calls back-to-back in one agent turn; wait for the structured summary, inspect failures, and only then decide whether another Unity launch is necessary
- call `unity_launch_batchmode`
- pass `closeBlockingUnityProcess: true` only when a same-project Unity process is blocking the run and Pi settings enable `piUnity.allowCloseRunningUnityProcess`
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
unity run "<ProjectPath>" -- -nographics -runTests -testPlatform <EditMode|PlayMode> -testFilter "<Full.Test.Name>" -testResults "<ResultsPath>" -logFile "<LogPath>"
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
