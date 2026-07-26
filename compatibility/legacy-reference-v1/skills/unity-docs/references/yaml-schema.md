# YAML Frontmatter Schema

**See skills/unity-docs/schema.yaml for the complete schema specification.**

This is schema version 2. It separates document kind, filing category, and observable failure mode so docs are easier to classify and search.

## Required Fields

- **schema_version** (number): Must be `2`.
- **doc_type** (enum): One of [solution, pattern, workflow, documentation_gap].
- **category** (enum): One of [build_ci, editor_workflow, asset_pipeline, packages_integrations, project_configuration, serialization_data, prefabs_scenes, gameplay_code, physics_navigation, rendering_shaders, ui, animation_timeline, audio, input, performance, platform, testing_validation, tooling_vcs, critical_patterns].
- **failure_mode** (enum): One of [compile_error, build_failure, test_failure, editor_crash, editor_hang, runtime_exception, runtime_crash, incorrect_behavior, visual_artifact, asset_import_failure, performance_regression, missing_reference, data_loss_or_corruption, version_incompatibility, workflow_friction, documentation_gap].
- **module** (string): Unity subsystem or module name (e.g., "Physics", "Rendering", "UI").
- **date** (string): ISO 8601 date (YYYY-MM-DD).
- **component** (enum): One of [monobehaviour, scriptable_object, prefab, scene, material, shader, animation_controller, timeline, addressable, asset, editor_script, build_script, package, plugin, ui_toolkit, particle_system, terrain, navmesh, lighting, canvas, test, tooling, version_control].
- **symptoms** (array): 1-5 specific observable symptoms.
- **root_cause** (enum): One of [null_reference, lifecycle_timing, serialization_error, missing_reference, circular_dependency, memory_leak, resource_not_loaded, coroutine_stopped, wrong_thread, prefab_override_issue, asset_import_settings, physics_layer_collision, render_pipeline_config, scene_not_loaded, component_disabled, version_incompatibility, logic_error, config_error, missing_validation, tooling_error, documentation_gap].
- **resolution_type** (enum): One of [code_fix, asset_reimport, prefab_revert, config_change, package_update, editor_restart, cache_clear, player_settings_change, build_settings_change, dependency_update, environment_setup, tooling_addition, documentation_update].
- **severity** (enum): One of [critical, high, medium, low].

## Optional Fields

- **unity_version** (string): Unity version (e.g., '2022.3.21f1').
- **render_pipeline** (string): Render pipeline (Built-in, URP, HDRP).
- **platform** (string): Platform where issue occurred (Editor, iOS, Android, WebGL, etc.). Use this as metadata unless platform ownership is the primary category.
- **related_components** (array): Other components that interact with this issue.
- **tags** (array): Searchable keywords (lowercase, hyphen-separated).

## Classification Model

Use the fields independently:

- `doc_type` answers: what kind of knowledge is this?
- `category` answers: where should this be filed and who owns it?
- `failure_mode` answers: what observable shape did the failure take?

Do not recreate the old `problem_type` buckets by overloading `category`. For example, a UI Toolkit null reference is usually:

```yaml
doc_type: solution
category: ui
failure_mode: runtime_exception
```

A WebGL-only build failure is usually:

```yaml
doc_type: solution
category: build_ci
failure_mode: build_failure
platform: WebGL
```

Only use `category: platform` when platform behavior is the primary owner of the solution rather than contextual metadata.

## Validation Rules

1. All required fields must be present.
2. Enum fields must match allowed values exactly (case-sensitive).
3. `symptoms` must be a YAML array with 1-5 items.
4. `date` must match YYYY-MM-DD format.
5. `unity_version` (if provided) must match Unity version format (e.g., 2022.3.21f1).
6. `tags` should be lowercase, hyphen-separated.
7. `problem_type` is legacy schema v1 and must not be used in new docs.

## Example

```yaml
---
schema_version: 2
doc_type: solution
category: physics_navigation
failure_mode: runtime_exception
module: Physics
date: 2026-06-26
component: monobehaviour
symptoms:
  - "NullReferenceException in PlayerController.Update()"
  - "Player character freezes when jumping"
root_cause: null_reference
unity_version: 2022.3.21f1
render_pipeline: URP 14.0.8
platform: Windows Editor
resolution_type: code_fix
severity: high
tags: [null-reference, update-loop, player-controller]
---
```

## Category Mapping

Documentation is filed in `${DOCS_ROOT}/solutions/<category-folder>/` based on `category`:

- **build_ci** → `docs/solutions/build-ci/`
- **editor_workflow** → `docs/solutions/editor-workflow/`
- **asset_pipeline** → `docs/solutions/asset-pipeline/`
- **packages_integrations** → `docs/solutions/packages-integrations/`
- **project_configuration** → `docs/solutions/project-configuration/`
- **serialization_data** → `docs/solutions/serialization-data/`
- **prefabs_scenes** → `docs/solutions/prefabs-scenes/`
- **gameplay_code** → `docs/solutions/gameplay-code/`
- **physics_navigation** → `docs/solutions/physics-navigation/`
- **rendering_shaders** → `docs/solutions/rendering-shaders/`
- **ui** → `docs/solutions/ui/`
- **animation_timeline** → `docs/solutions/animation-timeline/`
- **audio** → `docs/solutions/audio/`
- **input** → `docs/solutions/input/`
- **performance** → `docs/solutions/performance/`
- **platform** → `docs/solutions/platform/`
- **testing_validation** → `docs/solutions/testing-validation/`
- **tooling_vcs** → `docs/solutions/tooling-vcs/`
- **critical_patterns** → `docs/solutions/patterns/`

## Migration from Schema v1

Use `scripts/migrate-unity-docs-schema.ts` for existing docs that still use `problem_type`.

Default dry run:

```bash
npx tsx scripts/migrate-unity-docs-schema.ts --solutions-root <path-to-docs/solutions>
```

Apply after reviewing the dry-run report:

```bash
npx tsx scripts/migrate-unity-docs-schema.ts --solutions-root <path-to-docs/solutions> --apply
```
