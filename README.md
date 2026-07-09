# Pi Unity

Pi skill and tool package for reusable Unity workflows.

## Contents

- skill: `unity-batchmode-tests`
- skill: `capturing-screenshots-unity`
- tool: `unity_project_status`
- tool: `unity_inspect_artifacts`
- tool: `unity_open_editor`
- tool: `unity_launch_batchmode`
- command: `/unity-open`

## Install

From GitHub:

```bash
pi install git:git@github.com:aefreedman/pi-unity.git
```

Local development install:

```bash
pi install <path-to-pi-unity>
```

Project-local install:

```bash
pi install -l <path-to-pi-unity>
```

## Notes

- Pi discovers packaged skills from `skills/` and extensions from `index.ts`.
- `unity_open_editor` launches the full Unity Editor GUI.
- `unity_open_editor` prefers the installed `unity open` CLI when available, falling back to direct editor executable launch.
- `unity_project_status` reports native Unity lockfile state, Unity CLI status output, and running Unity processes for a project without launching Unity.
- `unity_inspect_artifacts` summarizes existing Unity Test Framework XML results and Unity logs without launching Unity, reducing ad hoc shell parsing after failures.
- `unity_launch_batchmode` prefers the installed `unity run` CLI when available, falling back to direct editor executable batchmode launch.
- `unity_launch_batchmode` adds `-nographics` by default to avoid unnecessary graphics initialization and reduce focus stealing; set `useGraphics: true` only for screenshots, visual capture, render checks, or graphics-dependent PlayMode tests.
- Both Unity launch tools expose `launcher` (`auto`, `unity-cli`, or `editor-executable`) so workflows can force direct Editor execution when Unity CLI argument handling differs from `Unity.exe`/`Unity`.
- In Unity CLI mode, `unity_launch_batchmode` forwards args after `unity run <project> --` and strips direct-Editor flags managed by the CLI (`-batchmode`, `-projectPath`, `-quit`).
- `unity_launch_batchmode` is test-aware: when Unity Test Framework runs write `-testResults` and `-logFile`, the tool prefers compact structured summaries over dumping full Unity logs into agent context.
- `unity_launch_batchmode` uses Unity CLI status and direct process scans before launch. In Unity CLI mode, stale native `Temp/UnityLockfile` detection is delegated to `unity run`; direct Editor executable mode still blocks on the native lockfile for safety. A Pi-side project mutex prevents duplicate packaged batchmode calls from spawning Unity concurrently.
- `unity_launch_batchmode` can close a same-project blocking Unity process only when the tool call sets `closeBlockingUnityProcess: true` and Pi settings enable `piUnity.allowCloseRunningUnityProcess`. The tool re-scans and selects matching Unity processes itself; it never accepts a model-supplied PID.
- After a guarded same-call close, `unity_launch_batchmode` may remove the exact resolved project's stale `Temp/UnityLockfile` only after verifying no matching Unity process remains. It still refuses general lockfile deletion outside that guarded continuation.
- When using `closeBlockingUnityProcess: true`, prefer `launcher: "auto"` or `launcher: "unity-cli"`; force `launcher: "editor-executable"` only when direct Editor execution is explicitly required.
- If a Unity launch is blocked by a lockfile, run `unity_project_status` before asking a user to remove anything.
- `/unity-open` is the user-facing GUI launcher helper.
- The package resolves Unity project copies from a direct project root, a coordination root containing multiple copies, or another nearby folder.
- Unity install probing is OS-aware and avoids machine-specific assumptions by using the project's `ProjectSettings/ProjectVersion.txt`, the optional `unity` CLI, standard per-OS install locations, and optional `UNITY_EDITOR_PATH` overrides.
- Unity allows only one process per project folder; GUI and batchmode both count.
- The `unity-batchmode-tests` skill is intended for Unity Test Framework CLI runs.
- The `capturing-screenshots-unity` skill is intended for Unity gameplay and UI screenshot workflows when the project supports capture.
- Keep skill-specific references and helper assets under the skill directory beside `SKILL.md`.

## Settings

`pi-unity` reads optional package-specific settings from global `~/.pi/agent/settings.json` and, for trusted projects, project `.pi/settings.json`:

```json
{
  "piUnity": {
    "allowCloseRunningUnityProcess": false,
    "closeRunningUnityProcessOnlyForTests": true,
    "closeRunningUnityProcessTimeoutMs": 30000
  }
}
```

- `allowCloseRunningUnityProcess` defaults to `false`. When enabled, `unity_launch_batchmode` may close only Unity processes that target the resolved project and only when the tool call explicitly sets `closeBlockingUnityProcess: true`.
- `closeRunningUnityProcessOnlyForTests` defaults to `true`, limiting process closure to Unity Test Framework launches (`-runTests`).
- `closeRunningUnityProcessTimeoutMs` defaults to `30000` and is clamped between 1000 and 120000 milliseconds.

## Package layout

```text
pi-unity/
  index.ts
  src/
    unity-core.ts
    unity-batchmode.ts
    unity-cli.ts
    unity-launch.ts
    unity-processes.ts
    unity-project-lock.ts
    unity-projects.ts
  skills/
    unity-batchmode-tests/
      SKILL.md
    capturing-screenshots-unity/
      SKILL.md
      assets/
      references/
  tests/
```

## Testing

```bash
npm test
```

## License

MIT. See `LICENSE`.
