---
name: unity-interactive-playmode-authoring
description: Inspect and temporarily tune live Unity runtime objects through a reachable exact-copy Pipeline Editor while Play Mode remains active, then deliberately translate accepted runtime values into durable source or asset changes. Use only for explicit interactive Play Mode authoring or live visual experiments; not for ordinary compile, tests, planning, or batchmode.
---

# Unity Interactive Play Mode Authoring

Use this skill only when the user explicitly requests inspection or temporary mutation of live runtime state in an already-running exact Unity project copy. Typical examples include moving a runtime UI element while the user watches, tuning a value interactively, or exploring which connected Pipeline interaction mode can reach a live object.

Do not activate this skill for ordinary source edits, serialized-asset authoring, planning inspection, compilation, tests, screenshots alone, or opening Unity. Use the owning Unity workflow for those operations.

## Preconditions

1. Resolve the exact Unity project path; never route by display name or a similarly named workspace.
2. Call `unity_project_status` and require a verified matching Editor process, a reachable exact-copy Pipeline instance, and the advertised commands needed for the intended operation.
3. Inspect the advertised `editor_status` and require Play Mode to be active for a live-runtime experiment. If Play Mode is not active, do not enter it unless the user explicitly requested that lifecycle change.
4. Revalidate exact project path and Editor/Pipeline process identity before each mutation. Stop on unknown, stale, unreachable, or changed identity.
5. Establish the target object, requested temporary effect, and expected observation before mutation. Do not explore by changing unrelated live objects.

## Choose the Smallest Interaction Surface

Choose the smallest route that answers the question clearly:

1. **Advertised typed command.** Use a purpose-built command when its validation and result shape fit the task.
2. **One-shot connected command or `eval`.** Use advertised `eval` as the normal REPL escape hatch for project-specific properties, APIs, and operations that registered commands did not anticipate. Prefer one bounded invocation with an explicit return value over a long-lived interactive shell.

Typed commands are conveniences, not exclusive gateways. Do not force repository inference or add a new wrapper merely to avoid a direct connected property inspection.

GameObject transform and component commands do not operate on every runtime object. For example, UI Toolkit `VisualElement`s are not scene GameObjects, so `set_transform` is not an appropriate route for their layout styles.

`unity shell` is a human interactive convenience over the same connected Pipeline surface. It is not a stronger Editor capability and is not the preferred agent automation route.

## Command Discovery

- Prefer the command inventory returned by `unity_project_status`; do not fan out across CLI help, shell, and trial dispatch when availability is already known.
- If raw `unity list` is exceptionally needed, parse the outer JSON envelope and read command records from `data.tools`, not a guessed top-level `commands` field.
- Inspect one exact command schema before dispatch rather than repeatedly trialing argument forms against the live Editor.
- Treat outer CLI success as transport evidence only. Parse nested `success`, diagnostics, status, and result fields before claiming success.

## Bounded Eval Rules

Pipeline `eval` compiles C# with Roslyn and runs it on the connected Editor's main thread. It can inspect or call any reachable engine, Editor, or project API; it is not intrinsically read-only, and a static syntax/property allowlist is not a reliable side-effect boundary.

- Use one bounded, target-specific snippet with an explicit return value.
- Regular property and state inspection is allowed when it serves the active task.
- Resolve the exact target and check for a missing target before mutation.
- Mutations must match the user's request. Lifecycle, destructive, persistent-setting, asset, package, selection, scene-save, import, build, test, and source-file changes require the same authorization they would through a typed command.
- Research unfamiliar Unity/C# APIs when needed, but do not add a purpose-built wrapper solely to avoid `eval`.
- Avoid obsolete APIs; evaluator diagnostics may treat obsolete usage as a compilation failure.
- Fully qualify APIs when extension-method or namespace ambiguity is likely.
- Treat any compiler diagnostic, nested failure, null target, malformed result, or identity change as failure. Do not retry mutations speculatively.

Use `unity_pipeline_eval` for exact-copy connected C# queries and operations. Use `unity_pipeline_inspect` when one of its package-owned purpose-built inspection commands provides better evidence.

## Live Tuning Loop

For each requested adjustment:

1. Revalidate the exact-copy Pipeline identity and Play Mode state.
2. Read the current live value when needed to make the requested relative or absolute adjustment.
3. Apply one bounded temporary mutation.
4. Return the observed before/after values and ask for the next adjustment only when user observation is required.
5. State that the override is non-persistent and may be replaced by rendering, rebinding, a domain reload, or Play Mode exit.

Do not infer that a serialized asset or source edit updates an existing runtime instance. Confirm the relevant refresh, rebind, or reconstruction path before claiming a live result.

## Persisting an Accepted Runtime Result

A request to persist authorizes the durable source/asset edit, but lifecycle changes remain explicit unless already authorized.

1. Capture the final runtime values and the owning coordinate space, dimensions, scale, or other context needed to convert them into authored values.
2. Identify the authoritative source or serialized field and trace how it becomes the runtime value. Do not write a visual coordinate into a guessed representation.
3. Determine whether persistence triggers asset import, script compilation, domain reload, or runtime reconstruction, and whether the current instance can consume the change.
4. Inspect `editor_status`. If Play Mode must stop, dispatch the advertised `editor_stop` and verify Play Mode exited.
5. Apply the durable edit with the owning file/asset tool.
6. Use the `unity-pipeline-workflows` skill for any required connected compilation and terminal status validation.
7. Re-enter Play Mode only when requested. Report temporary live confirmation and durable verification as separate evidence.

## Stop Conditions

Stop and report uncertainty instead of changing routes when:

- the exact-copy identity changes or cannot be revalidated;
- Pipeline disconnects outside an expected, separately authorized compile/reload transition;
- the target is ambiguous or disappears;
- the required operation has no typed command and cannot be expressed as one bounded target-specific eval;
- eval returns diagnostics, malformed output, or an unknown side effect;
- persistence ownership or runtime conversion cannot be established;
- a required Play Mode stop, restart, compile, save, or other lifecycle mutation is not authorized.

Never launch batchmode or another Editor to continue an interactive live-authoring session.
