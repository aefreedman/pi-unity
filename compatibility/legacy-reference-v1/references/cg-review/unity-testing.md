# Unity Testing (Optional)

## Detect Applicability

Unity indicators include `Assets/`, `ProjectSettings/`, `Packages/manifest.json`, Unity scene/asset files, or Unity-generated C# project files.

Offer only test modes relevant to the changed scope:

1. EditMode
2. PlayMode
3. Both, run serially for the same project folder
4. Skip

## Execution

Run accepted Unity validation before final synthesis and summary so observed evidence can be classified correctly.

Prefer the root session loading the `unity-batchmode-tests` skill and using Pi Unity status/test tools. Do not spawn an unspecified worker merely to run tests. If a separate bounded worker is genuinely useful, only the root may delegate it, with the exact project copy, test mode/filter, absolute result/log paths, no edit/VCS/nested-delegation authority, and serialized access to that project folder.

Never run multiple Unity processes against one project folder. Inspect project status before launch and do not delete lockfiles automatically.

## Interpreting Results

A failed test command is evidence, not automatically a P1 defect. Distinguish:

- product regression caused by the reviewed change
- pre-existing test failure
- test-harness/infrastructure failure
- compile/import failure
- blocked launch or unavailable project copy

Assign severity from demonstrated impact and confidence. For missing Unity acceptance proof:

- use P1 only when required proof for a critical path is absent and the gap blocks safe merge or release;
- use P2 when required confidence is absent for material behavior without being an immediate critical release blocker;
- use P3 only for supplementary or bounded evidence that does not materially undermine acceptance or release confidence.

Missing proof is not automatically P1, but do not downgrade a material or critical evidence gap to P3 merely because the implementation exists or compilation passed. Create a review finding/todo only when evidence supports a concrete actionable issue; otherwise record the validation limitation or blocker in the summary. Preserve test result and concise log evidence, distinguish direct observations from inference, and keep any "fixed," "resolved," or "root cause" claim within the exercised Unity scenario.
