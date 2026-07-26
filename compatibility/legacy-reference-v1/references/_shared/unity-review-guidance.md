# Unity Review Guidance

Use this reference only when the changed files or project structure indicate a Unity project. Keep review agents engine-agnostic; pass these checks as conditional stack context instead of baking them into every review.

---

## Unity Pattern and Performance Checks

Look for these only in relevant Unity runtime/editor code paths:

- Heavy work or allocations in hot lifecycle methods such as `Update`, `FixedUpdate`, frequently fired events, or editor GUI loops.
- `GameObject.Find`, `FindObjectOfType`, broad scene searches, or string-based calls such as `SendMessage`/`Invoke` in frequently called paths.
- Missing null/reference handling for Unity object references, especially serialized fields, scene references, prefab references, and destroyed-object semantics.
- LINQ, closure allocations, per-frame allocations, or avoidable garbage in hot paths.
- Physics queries without appropriate layer masks or trigger handling.
- Frequent instantiate/destroy patterns where local conventions or profiling justify pooling.

---

## Unity Architecture Checks

Apply when architecture or system boundaries are in scope:

- Component responsibilities are clear and consistent with local MonoBehaviour/component patterns.
- ScriptableObject, prefab, scene, addressable, and package/module boundaries match project conventions.
- Singleton/manager usage is intentional and consistent with local architecture.
- Runtime/editor code is separated correctly, including assembly definitions and editor-only APIs.
- Serialization constraints are respected: field visibility, renames/migrations, cyclic references, prefab variants, and scene ownership.

---

## Unity Data and Asset Integrity Checks

Apply when changes touch persisted data, serialized assets, scenes, prefabs, addressables, asset bundles, or import/build settings:

- Serialized field changes preserve existing scene/prefab/asset data or include a migration plan.
- Asset GUIDs, moved/renamed assets, and references remain stable or have documented repair steps.
- ScriptableObject schemas, save data, and addressable keys/labels remain compatible with existing content.
- Editor scripts that modify assets call the appropriate refresh/save APIs and can be rerun safely.
- Build settings, platform settings, and package versions are validated for affected targets.

---

## Unity Agent-Native Checks

Apply when reviewing agent/tool parity for Unity runtime/editor features:

- Runtime vs editor context is explicit (`Application.isPlaying`, editor-only assemblies, command-line/batchmode support).
- Agent tools can observe and affect the same scene, asset, prefab, material, or project data users can.
- Asset modifications are visible to users and Unity after save/refresh operations.
- File paths and generated assets live in shared project locations rather than an agent-only sandbox.

---

## Evidence Expectations

Cite concrete file/line evidence from changed files or nearby local patterns. Do not require every Unity check for every change; mark checks as not applicable when the changed files do not touch the relevant subsystem.
