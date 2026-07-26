# Unity Repository Research

Use this reference only when the project appears to be a Unity project. Keep the default planning workflow engine-agnostic; load Unity-specific search guidance conditionally after detecting Unity roots.

---

## Detecting Unity Roots

A directory is likely a Unity project root when it contains some of:

- `Assets/`
- `Packages/manifest.json`
- `ProjectSettings/ProjectVersion.txt`

Unity projects may be nested under the workspace root. Search from the workspace root when VCS ignore files live there, but scope content/code queries to the detected Unity root or project-specific roots inside `Assets/`.

---

## Default Exclusions

Avoid generated/cache/output folders unless the task explicitly concerns them:

- `Library/`
- `Temp/`
- `Logs/`
- `obj/`
- `Build/`
- `Builds/`
- `UserSettings/`
- `.vs/`
- transient IDE caches and generated solution/project files

In Plastic workspaces, prefer repo ignore files such as `ignore.conf` and `cloaked.conf` because they usually already encode these exclusions.

---

## High-Signal Unity Files

Prefer these sources before broad content scans:

- `AGENTS.md`, README, setup docs, and local project docs.
- `Packages/manifest.json` for installed packages and package versions.
- `ProjectSettings/ProjectVersion.txt` for Unity version.
- `.asmdef` files for assembly/module boundaries.
- `Assets/**/Scripts/**/*.cs`, `Assets/**/*.cs`, or project-specific code roots.
- Project-specific `Assets/` roots for gameplay/UI/tools/content.
- Relevant `.unity`, `.prefab`, `.asset`, `.uxml`, `.uss`, shader, timeline, animation, or addressables files only when the feature touches those systems.

Avoid reading `.meta` files unless the question depends on GUID references, importer settings, asset identity, or broken references.

---

## Useful Search Shapes

Use file-type filters and project roots to reduce noise:

```bash
rg --ignore-file ignore.conf --ignore-file cloaked.conf -n "ExactSymbolOrTerm" UnityRoot/Assets --glob "*.cs"
rg --ignore-file ignore.conf --ignore-file cloaked.conf --files UnityRoot/Assets --glob "*.asmdef" --glob "*.cs"
rg --ignore-file ignore.conf --ignore-file cloaked.conf -n "SerializedField|ComponentName" UnityRoot/Assets --glob "*.prefab" --glob "*.unity" --glob "*.asset"
```

If the project uses a game-specific root inside `Assets/`, search that root first before expanding to all `Assets/`.

---

## Unity-Specific Stop Conditions

For fast planning research, stop after finding:

- The Unity version and relevant package/module boundary.
- 2-4 existing implementation examples in project-owned code/content.
- The likely files or folders new work should modify.
- Any obvious mismatch between local patterns and authoritative Unity/package docs that needs follow-up.

Do not inventory all scenes, prefabs, packages, or plugins unless the feature requires that breadth.
