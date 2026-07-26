---
name: unity-docs
description: Capture solved Unity problems as categorized documentation with YAML frontmatter for fast lookup
---
# unity-docs Skill

Purpose: document solved Unity problems under `${DOCS_ROOT}/solutions/`
with validated YAML frontmatter.

## Package Reference Loading

CRITICAL: Use `cg_read_reference` for Compound Game Dev package reference files.

- Pass package-relative paths such as `skills/unity-docs/references/yaml-schema.md`.
- When an instruction says to load, use, or see a package reference path, call `cg_read_reference` for that path.
- Do NOT use `read` with package-reference paths; file tools resolve relative to the current project cwd, not this package.
- Do NOT preemptively load all reference files.
- Treat loaded references as mandatory instructions for the active task scope.
- For long files, use `cg_read_reference` with `offset`/`limit` to load only needed sections.

## Workflow

### Step 0: Resolve Artifact Roots

Load with `cg_read_reference`:

- `references/_shared/artifact-root-resolution.md`
- `references/_shared/artifact-path-contract.md`

### Step 1: Establish Confirmation Provenance (Blocking)

Treat confirmation phrases as candidate-discovery signals, not proof by themselves. Only proceed for a non-trivial solution when at least one provenance source directly supports resolution of the reported outcome:

- explicit user confirmation tied to that outcome;
- direct validation of the reported scenario;
- a reproduced failure followed by a passing equivalent check; or
- another recorded evidence source that directly supports the resolution claim.

Record the provenance source and observed evidence for the document. Generic language such as "done" or "completed," implementation completion, or an unrelated passing check is insufficient. If provenance is absent, do not create a `doc_type: solution`; ask for clarification when useful, otherwise report that the candidate was skipped.

### Step 2: Gather Context

Required:

- Module/subsystem
- Exact symptoms or error message
- Investigation attempts
- Root cause to the extent supported by evidence; distinguish a demonstrated cause from inference
- Solution and prevention
- Environment details (Unity version, platform, render pipeline)
- Confirmation provenance, observed validation evidence, proof target, and remaining validation gaps

Keep "fixed," "resolved," and root-cause language within the exercised scenario. If critical context is missing, ask and wait.

### Step 3: Check Existing Docs (Optional)

Search `${DOCS_ROOT}/solutions/` for similar issues. If found, ask whether to
create a new doc, update existing, or link.

### Step 4: Generate Filename

Format: `[sanitized-symptom]-[module]-[YYYYMMDD].md`

### Step 5: Classify and Validate YAML Schema (Blocking)

Load `skills/unity-docs/references/category-selection.md` when choosing schema v2 classification fields.

Validate against:

- `skills/unity-docs/schema.yaml`
- `skills/unity-docs/references/yaml-schema.md`

Required schema v2 classification:

- `doc_type`: what kind of knowledge this is
- `category`: filing/ownership bucket
- `failure_mode`: observable failure shape

Do not use legacy `problem_type` in new docs. Do not proceed if validation fails.

### Step 6: Create Documentation

Use `skills/unity-docs/assets/resolution-template.md` via `cg_read_reference` and write to the physical path:

- `${DOCS_ROOT}/solutions/<category-folder>/<filename>.md`

Complete the template's Validation / Confirmation Evidence section with the proof target, provenance source, observed result, and remaining gaps. Do not leave placeholders or imply that unrun player-facing or acceptance paths passed.

### Step 7: Critical Pattern Recommendation

After creating the documentation, assess whether the solution should be elevated to a critical pattern.

Recommend elevation only when the documented solution is likely to prevent repeated high-impact failures, such as:

- a recurring Unity-specific failure mode or team-wide pitfall
- a bug pattern that can cause data loss, broken builds, major content loss, or player-facing regressions
- a non-obvious engine/editor/package interaction that future work is likely to hit again
- a project convention that should become required reading before touching a subsystem

If the doc meets that bar, tell the user why and recommend creating a critical pattern entry using `skills/unity-docs/assets/critical-pattern-template.md` via `cg_read_reference`. Do not auto-promote without explicit confirmation. When creating or editing `docs/solutions/patterns/critical-patterns.md`, ensure the aggregate file has schema v2 frontmatter with `doc_type: pattern` and `category: critical_patterns`.

If it does not meet that bar, state that no critical-pattern elevation is recommended and why.

## Reference Files (Load On Demand)

1. YAML schema -> `skills/unity-docs/schema.yaml`
2. YAML guide -> `skills/unity-docs/references/yaml-schema.md`
3. Resolution template -> `skills/unity-docs/assets/resolution-template.md`
4. Category selection -> `skills/unity-docs/references/category-selection.md`
5. Artifact root resolution -> `references/_shared/artifact-root-resolution.md`
6. Artifact path contract -> `references/_shared/artifact-path-contract.md`

On-demand:

- Error handling -> `skills/unity-docs/references/error-handling.md`
- Quality guidelines -> `skills/unity-docs/references/quality-guidelines.md`
- Example -> `skills/unity-docs/references/example.md`
- Critical pattern template -> `skills/unity-docs/assets/critical-pattern-template.md`
