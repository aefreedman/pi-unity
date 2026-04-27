# Pi Unity

Pi skill and tool package for reusable Unity workflows.

## Contents

- skill: `unity-batchmode-tests`
- skill: `capturing-screenshots-unity`
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
- `unity_launch_batchmode` launches Unity CLI batchmode.
- `unity_launch_batchmode` is test-aware: when Unity Test Framework runs write `-testResults` and `-logFile`, the tool prefers compact structured summaries over dumping full Unity logs into agent context.
- `unity_launch_batchmode` checks Unity's native `Temp/UnityLockfile` before launch and uses a Pi-side project mutex so duplicate packaged batchmode calls fail before spawning Unity.
- `/unity-open` is the user-facing GUI launcher helper.
- The package resolves Unity project copies from a direct project root, a coordination root containing multiple copies, or another nearby folder.
- Unity install probing is OS-aware and avoids machine-specific assumptions by using the project's `ProjectSettings/ProjectVersion.txt`, standard per-OS install locations, and optional `UNITY_EDITOR_PATH` overrides.
- Unity allows only one process per project folder; GUI and batchmode both count.
- The `unity-batchmode-tests` skill is intended for Unity Test Framework CLI runs.
- The `capturing-screenshots-unity` skill is intended for Unity gameplay and UI screenshot workflows when the project supports capture.
- Keep skill-specific references and helper assets under the skill directory beside `SKILL.md`.

## Package layout

```text
pi-unity/
  index.ts
  src/
    unity-core.ts
    unity-batchmode.ts
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
