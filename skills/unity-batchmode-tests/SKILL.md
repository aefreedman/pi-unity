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
- **Use `unity_launch_batchmode` when you want to run headless Unity directly** - keep test-specific flags deliberate, especially around `-runTests` and `-quit`.
- **Distinguish graphics-agnostic test runs from graphics-required visual runs** - screenshot, render-texture, and other visual-capture tests require an active graphics device and must not use `-nographics`.
- **Do not treat a graphics-disabled run as valid evidence for screenshot workflows** - graphics-required tests should fail clearly or be excluded from that run.

## Workflow

### 1. Prefer the packaged Unity tools

Use the `pi-unity` tools first instead of forming raw Unity CLI commands on the fly:
- `unity_launch_batchmode` for headless Unity execution
- `unity_open_editor` only when the user explicitly wants the GUI Editor
- `/unity-open` as the user-facing GUI launcher helper

`unity_launch_batchmode` should be the default path for agent-run headless Unity work because it already:
- resolves the Unity project from a direct project root, a coordination root, or another nearby folder
- reads `ProjectSettings/ProjectVersion.txt`
- uses OS-aware standard install probing
- supports explicit `UNITY_EDITOR_PATH` / `unityEditorPath` overrides
- checks Unity's native `Temp/UnityLockfile` and running Unity processes before launch
- uses a Pi-side project mutex so duplicate packaged batchmode calls fail before spawning Unity
- can summarize Unity Test Framework results compactly when `-testResults` and `-logFile` are provided

Only fall back to direct CLI commands if the packaged Unity tools are unavailable or fail to resolve the environment correctly.

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
- call `unity_launch_batchmode`
- pass the explicit test arguments needed for the run
- always provide absolute `-testResults` and `-logFile` paths when practical so the tool can summarize results compactly for the agent
- keep test-specific flags deliberate, especially around `-runTests` and `-quit`
- decide up front whether the run is graphics-agnostic or graphics-required
- exclude graphics-required screenshot/visual-capture tests from any `-nographics` run
- prefer project test categories such as `RequiresGraphics` / `VisualCapture` when the project exposes them

Direct CLI fallback template:
```
"<UnityEditorPath>" -batchmode -projectPath "<ProjectPath>" -runTests -testPlatform <EditMode|PlayMode> -testFilter "<Full.Test.Name>" -testResults "<ResultsPath>" -logFile "<LogPath>"
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
