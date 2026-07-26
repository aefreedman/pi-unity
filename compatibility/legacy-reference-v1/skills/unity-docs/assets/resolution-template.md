---
schema_version: 2
doc_type: [solution|pattern|workflow|documentation_gap]
category: [build_ci|editor_workflow|asset_pipeline|packages_integrations|project_configuration|serialization_data|prefabs_scenes|gameplay_code|physics_navigation|rendering_shaders|ui|animation_timeline|audio|input|performance|platform|testing_validation|tooling_vcs|critical_patterns]
failure_mode: [compile_error|build_failure|test_failure|editor_crash|editor_hang|runtime_exception|runtime_crash|incorrect_behavior|visual_artifact|asset_import_failure|performance_regression|missing_reference|data_loss_or_corruption|version_incompatibility|workflow_friction|documentation_gap]
module: [Unity subsystem name or specific module]
date: [YYYY-MM-DD]
component: [monobehaviour|scriptable_object|prefab|scene|material|shader|animation_controller|timeline|addressable|asset|editor_script|build_script|package|plugin|ui_toolkit|particle_system|terrain|navmesh|lighting|canvas|test|tooling|version_control]
symptoms: 
root_cause: [null_reference|lifecycle_timing|serialization_error|missing_reference|circular_dependency|memory_leak|resource_not_loaded|coroutine_stopped|wrong_thread|prefab_override_issue|asset_import_settings|physics_layer_collision|render_pipeline_config|scene_not_loaded|component_disabled|version_incompatibility|logic_error|config_error|missing_validation|tooling_error|documentation_gap]
unity_version: [e.g., 2022.3.21f1]
render_pipeline: [Built-in|URP X.X.X|HDRP X.X.X - optional]
platform: [Windows Editor|iOS|Android|WebGL|etc. - optional]
resolution_type: [code_fix|asset_reimport|prefab_revert|config_change|package_update|editor_restart|cache_clear|player_settings_change|build_settings_change|dependency_update|environment_setup|tooling_addition|documentation_update]
severity: [critical|high|medium|low]
tags: [keyword1, keyword2, keyword3]
---
# Troubleshooting: [Clear Problem Title]

## Problem
[1-2 sentence clear description of the issue and what you experienced]

## Environment
- Module: [Unity subsystem or specific module]
- Unity Version: [e.g., 2022.3.21f1]
- Render Pipeline: [Built-in, URP 14.0.8, HDRP 14.0.8]
- Platform: [Windows Editor, iOS, Android, WebGL]
- Affected Component: [e.g., "PlayerController MonoBehaviour", "Enemy Prefab", "MainScene"]
- Date: [YYYY-MM-DD when this was solved]

## Symptoms
- [Observable symptom 1 - what you saw/experienced]
- [Observable symptom 2 - error messages, visual issues, unexpected behavior]
- [Continue as needed - be specific]

## What Didn't Work

**Attempted Solution 1:** [Description of what was tried]
- **Why it failed:** [Technical reason this didn't solve the problem]

**Attempted Solution 2:** [Description of second attempt]
- **Why it failed:** [Technical reason]

[Continue for all significant attempts that DIDN'T work]

[If nothing else was attempted first, write:]
**Direct solution:** The problem was identified and the documented outcome was validated on the first attempt.

## Solution

[The actual fix that worked - provide specific details]

**Code changes** (if applicable):
```csharp
// Before (broken):
void Update()
{
    // Missing null check
    _rigidbody.velocity = Vector3.zero;
}

// After (fixed):
void Update()
{
    if (_rigidbody != null)
    {
        _rigidbody.velocity = Vector3.zero;
    }
}
```

**Asset changes** (if applicable):
```
Prefab: Assets/Prefabs/Player.prefab
- Added Rigidbody component
- Set Collision Detection to Continuous
- Set Interpolate to Interpolate
```

**Project Settings changes** (if applicable):
```
Edit > Project Settings > Physics
- Changed Fixed Timestep from 0.02 to 0.01
- Enabled Enhanced Determinism

Edit > Project Settings > Player
- Changed API Compatibility Level to .NET Standard 2.1
```

**Commands/Actions** (if applicable):
```bash
# Steps taken to fix in Unity:
- Assets > Reimport All
- Edit > Clear All PlayerPrefs
- Build Settings > Switch Platform to Android
- Library folder deleted and regenerated
```

## Validation / Confirmation Evidence

- **Proof target:** [The reported scenario or acceptance outcome this document claims was resolved]
- **Confirmation provenance:** [Explicit user confirmation tied to the outcome, direct scenario validation, reproduced failure then passing equivalent check, or another direct recorded source]
- **Observed evidence:** [What was actually run or observed, including relevant result, test/filter, environment, or user statement]
- **Scope and remaining gaps:** [What this evidence does not prove; write "None known for the stated proof target" only when justified]

[Do not use a generic completion phrase or implementation completion as the only evidence. Keep the solution claim within the observed proof target, and do not imply that unrun player-facing or acceptance paths passed.]

## Why This Works

[Technical explanation of:]
1. What is the demonstrated root cause, or the best-supported mechanism if root cause remains an inference?
2. Why does the solution address that cause or mechanism?
3. What was the underlying issue (Unity API misuse, configuration error, version issue, etc.)?

[Separate direct evidence from inference. Be detailed enough that future developers understand the "why", not just the "what", without overstating certainty.]

## Prevention

[How to avoid this problem in future development:]
- [Specific coding practice, check, or pattern to follow]
- [What to watch out for]
- [How to catch this early]

## Related Issues

[If any similar problems exist in docs/solutions/, link to them:]
- See also: [another-related-issue.md](../category/another-related-issue.md)
- Similar to: [related-problem.md](../category/related-problem.md)

[If no related issues, write:]
No related issues documented yet.
