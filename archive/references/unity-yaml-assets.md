# Unity YAML Asset Editing

Use this reference when a work task creates or edits Unity serialized text assets such as scenes, prefabs, ScriptableObjects, materials, animation/controller assets, or `.meta` files.

## Editing Strategy

Unity YAML assets are durable authored data. Prefer controlled file edits over shell-generated blobs:

- Inspect with Pi `read`, `rg`, and focused scripts before changing files.
- Use Pi `edit` for small exact replacements where anchors are unique.
- For structural or multi-file changes, write a temporary/project-local script file and run it with explicit input/output paths.
- Keep large YAML payloads in files or data inputs; do not embed them in `python <<'PY'` heredocs or one-line shell commands.

## Fragility to Avoid

Avoid workflows that place large YAML-like content directly in shell commands. They are prone to failures or silent corruption from:

- heredoc termination mistakes,
- nested triple quotes,
- Windows path backslashes,
- braces in formatted strings,
- console encoding/code-page issues,
- accidental newline or indentation changes.

If a generated asset is large enough that quoting is hard to visually audit, move the generation logic into a script file or construct the file through structured small writes.

## Safe Transform Pattern

For scripted changes:

1. Resolve paths relative to the project/workspace root.
2. Read files as UTF-8 text unless the project documents another encoding.
3. Count expected anchors before editing and fail if the count differs from the intended scope.
4. Preserve existing line endings when practical.
5. Preserve Unity serialization identifiers and headers unless explicitly changing them:
   - `%YAML` / `%TAG` headers,
   - `fileID`, `guid`, `type`, `m_Script`,
   - `.meta` GUIDs,
   - stable asset names and local IDs.
6. Write to the target file only after validation passes.
7. Re-read or `rg` key anchors/references after writing.

## Validation

After Unity YAML edits, choose validation based on risk:

- run focused EditMode tests or editor validators for authored-data invariants,
- run Unity batchmode compile validation when code/schema references may be affected,
- inspect changed YAML sections for GUID/fileID/reference integrity,
- keep temporary scripts only if they are useful project tooling; otherwise remove them before closeout.
