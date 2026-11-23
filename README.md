# Pi Unity

Use Unity's own CLI and Pipeline from Pi. Agents get a read-only project finder; users get `/unity-open` to open the right workspace copy without typing its full path.

## Install

```sh
pi install npm:@aefree/pi-unity
```

Install [Unity CLI](https://docs.unity.com/en-us/unity-cli/use-unity-cli) separately. `/unity-open` requires `unity` on PATH. Otherwise, invoke the CLI by its absolute executable path in the shell. The native guidance targets Unity CLI and `com.unity.pipeline` 1.0.1. Use installed help and the exact Editor's advertised commands rather than assuming every project runs the same Pipeline version.

## Open the Editor from Pi

Type `/unity-open` inside a Unity project or from its workspace directory. It opens the nearest containing project, or the only nearby project if the search was complete. From a directory with several workspace copies, it shows their relative paths (for example, `ws1/Game` and `ws2/Game`), so projects with the same name are easy to tell apart. If the search was cut short, it won't open any copy without a selection. Press Escape to cancel.

To narrow the search or reach another workspace, supply a directory: `/unity-open ../ws2/Game` or `/unity-open "C:\Unity Workspaces\ws2\Game"`. Pi passes the chosen absolute project path to native `unity open`. It doesn't remember your selection, change Pi's working directory, wait for Editor readiness, or close other Editors. Use Unity CLI directly for launch flags or scripting.

## Find a project copy

`unity_find_projects` searches from the current directory or a supplied existing directory. It returns the nearest containing Unity project if found; otherwise it searches nearby descendants, excluding common generated directories and directory links and stopping at project roots. A candidate has a `ProjectVersion.txt` file plus an `Assets` directory or package manifest. Results contain canonical absolute roots, not a persistent selection or running Editor status. Descendant discovery is bounded to depth 4, 400 directories, 4,096 entries, and 20 candidates. A truncated or incomplete search cannot establish uniqueness. If a closer ancestor cannot be checked, the finder does not infer that an outer copy is the intended project. Skip discovery if the exact root is already known.

Use native `unity open <root>`, `unity status --project-path <root>`, and `unity close <root>` for Editor lifecycle. Requested close exits without saving; the user owns the save decision. When multiple agents share a copy, designate one operator through actual operation completion and evidence capture.

## Upgrade from the wrapper-based package

Update project agent instructions or scripts that refer to removed Pi tools or slash commands. The new `/unity-open` is a user-facing shortcut, not a replacement for the former execution tools or launch settings. Use native CLI and Pipeline commands for execution, `unity_find_projects` for copy discovery, and native test results or reports instead of `pi-unity-tests-*.json`. The old launch and close settings no longer apply. See [0.17.0 changes](CHANGELOG.md#0170---2026-11-22) for the removal list and the [workflow skill](skills/unity-pipeline-workflows/SKILL.md) for replacements.

## Included skills

- [Unity CLI and Pipeline Workflows](skills/unity-pipeline-workflows/SKILL.md): targeting, lifecycle, compilation, testing, and shared-copy coordination.
- [Unity Debugging](skills/unity-debugging/SKILL.md): diagnose activation, prerequisites and observable behavior before diving into internals.
- [Interactive Play Mode Authoring](skills/unity-interactive-playmode-authoring/SKILL.md): distinguish temporary live tuning from durable source or asset changes.
- [Consulting Unity Documentation](skills/consulting-unity-documentation/SKILL.md): use Unity's official versioned docs and agent indexes first. `pi-unity-docs` is optional for supplemental docsets or explicit offline lookup.

## Optional Pi integrations

With `pi-file-discovery`, broad searches exclude Unity-generated directories; explicitly targeted generated directories remain searchable. With `pi-project-artifacts`, Unity fields such as Editor version, package list and render pipeline are available for indexing and validation of solution and memory artifacts. These integrations register per session; neither is required for project discovery.

## Development

From this package root, run `npm ci`, `npm test`, and `npm pack --dry-run`. The manifest and lockfile pin Pi validation dependencies. Package tests do not start Unity.
