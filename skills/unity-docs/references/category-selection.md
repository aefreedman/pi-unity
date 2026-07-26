# Unity Docs Category Selection

Use schema v2 classification fields independently:

- `doc_type`: what kind of knowledge this is.
- `category`: where it should be filed and which area owns it.
- `failure_mode`: what observable shape the failure took.

## Choose `doc_type`

- `solution` - a concrete problem was solved. This is the default for troubleshooting docs.
- `pattern` - a reusable preventive practice or project convention, not tied to one incident.
- `workflow` - a repeatable editor/team/process workflow worth documenting as steps.
- `documentation_gap` - the main learning is that docs were missing, stale, misleading, or insufficient.

Do not use `pattern` just because a solution has prevention advice. Most solved incidents remain `doc_type: solution`.

## Choose `category`

Select the owning area and filing bucket, not the symptom wording.

Precedence rules:

1. If compilation/player build/batchmode is blocked, usually use `category: build_ci`.
2. If Unity Editor usage, editor tooling, inspectors, windows, menus, or editor-only workflows are the owner, use `category: editor_workflow`.
3. If assets fail to import or imported data is wrong, use `category: asset_pipeline`.
4. If packages, plugins, SDKs, middleware, or external services own the issue, use `category: packages_integrations`.
5. If Project Settings, Player Settings, package configuration, or environment configuration owns the issue, use `category: project_configuration`.
6. If serialization, ScriptableObjects, save data, property bags, or serialized references own the issue, use `category: serialization_data`.
7. If prefab/scene structure, prefab overrides, scene loading, or scene contents own the issue, use `category: prefabs_scenes`.
8. If a gameplay/domain C# bug is not better owned by another subsystem, use `category: gameplay_code`.
9. Otherwise use the subsystem owner: `physics_navigation`, `rendering_shaders`, `ui`, `animation_timeline`, `audio`, `input`, or `performance`.
10. Use `category: platform` only when platform behavior is the primary owner. If platform only describes where the issue occurred, put it in `platform` metadata instead.
11. Use `category: testing_validation` for test harnesses, screenshot validation, QA/playtest validation, or verification tooling.
12. Use `category: tooling_vcs` for project-local tooling, scripts, Plastic/Git/VCS workflow support, or repository operations.
13. Use `category: critical_patterns` only for the promoted required-reading pattern index, normally `docs/solutions/patterns/critical-patterns.md`. Individual solution docs that recommend promotion should keep their owning category.

## Choose `failure_mode`

Pick the observable failure shape, independent of category:

- `compile_error` - C# compiler/assembly errors.
- `build_failure` - player build, CI, or batchmode build failed.
- `test_failure` - automated tests or validation failed.
- `editor_crash` / `editor_hang` - Unity Editor crashed or froze.
- `runtime_exception` / `runtime_crash` - play mode/player exception or process crash.
- `incorrect_behavior` - behavior was wrong but no narrower mode fits.
- `visual_artifact` - visual output was wrong, pink, missing, clipping, flickering, etc.
- `asset_import_failure` - import/reimport failed or produced invalid imported data.
- `performance_regression` - FPS, memory, GC, load time, or responsiveness regression.
- `missing_reference` - missing object/component/asset reference was the observed failure.
- `data_loss_or_corruption` - data, asset, scene, prefab, or save corruption/loss.
- `version_incompatibility` - Unity/package/platform version mismatch.
- `workflow_friction` - human/editor workflow was blocked, confusing, or error-prone.
- `documentation_gap` - missing/stale/misleading docs were the failure being captured.

## Examples

```yaml
# UI Toolkit null reference in play mode
schema_version: 2
doc_type: solution
category: ui
failure_mode: runtime_exception
```

```yaml
# WebGL build fails because a package version is incompatible
schema_version: 2
doc_type: solution
category: build_ci
failure_mode: build_failure
platform: WebGL
```

```yaml
# Reusable project convention for ScriptableObject validation
schema_version: 2
doc_type: pattern
category: serialization_data
failure_mode: workflow_friction
```

```yaml
# Plastic workspace setup problem caused by local tooling path
schema_version: 2
doc_type: solution
category: tooling_vcs
failure_mode: workflow_friction
component: version_control
root_cause: tooling_error
```

```yaml
# Critical patterns aggregate file
schema_version: 2
doc_type: pattern
category: critical_patterns
failure_mode: workflow_friction
module: Cross-Cutting Unity Patterns
component: tooling
root_cause: missing_validation
resolution_type: documentation_update
```
