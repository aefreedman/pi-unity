# Auditing Unity Agent Guidance Skill Eval

This is a behavioral eval for `skills/auditing-unity-agent-guidance`. It follows the outcome-first approach in Philipp Schmid's “Practical Guide to Evaluating and Testing Agent Skills.” It is intentionally separate from `npm test`: agent runs are nondeterministic, slower, and may incur provider costs.

## Success criteria

The skill is primarily a **preference skill**: it should make migrations conform to this package's exact-copy, capability-driven Unity workflow. The eval measures:

1. **Triggering** — relevant audit/migration prompts load the skill; unrelated Unity implementation/test tasks and unrelated coding work do not.
2. **Outcomes** — audits call the deterministic tool without mutation; migrations produce usable guidance while preserving project constraints and project/package files.
3. **Instruction fidelity** — exact-copy routing, connected and isolated routes, explicit Pipeline installation, current project version, CI/report, PlayMode, and graphics requirements.
4. **Efficiency** — bounded tool calls, duration, input/output tokens, reported provider cost, changed paths, and no unnecessary Unity launch.

Checks grade observable output and filesystem state rather than requiring one exact sequence of agent actions.

## Prompt set

`cases.json` contains 13 prompts drawn from known failure modes:

- stale direct Editor/batchmode guidance
- `-runTests -quit`
- hard-coded Unity versions
- multiple project copies
- nested workspaces with inherited coordination-root guidance that must be audited but not edited
- explicit safe prohibitions that must not be weakened merely to silence the heuristic
- portable and mixed-harness instructions
- explicit CI, PlayMode-skip, and graphics constraints
- audit-only mutation safety
- negative controls for test diagnosis, test execution, package installation, code creation, and unrelated edits

Each case declares its own deterministic checks. Fixtures are synthetic and contain no private project content.

## Run

From `pi-unity`:

```bash
# One skill-enabled trial for every case
npm run eval:guidance-skill

# Compare skill-loaded behavior with a no-skill baseline
npm run eval:guidance-skill -- --condition both

# Recommended signal once the pilot is stable
npm run eval:guidance-skill -- --condition both --trials 3

# Fast pilot
npm run eval:guidance-skill -- --cases audit_legacy_instructions,migrate_mixed_harness_guidance,unrelated_typescript_review
```

Optional arguments:

- `--model <provider/model>` pins a model.
- `--keep` preserves isolated temporary workspaces for diagnosis.
- `--trials 1..5` captures nondeterministic pass distributions.
- `--output <path>` explicitly selects a report path.

Every run uses a fresh OS-temporary fixture copy, disables context-file loading, explicitly controls skill/extension loading, limits available tools, and tells the agent that only its temporary working directory is writable. By default, reports go to the OS temporary directory under `pi-unity-skill-evals/`; the eval does not generate files in the package checkout. Use `--output` only when a persistent report is intentional, and do not commit generated reports.

## Interpreting results

- Compare the same outcome checks under `skill` and `baseline`; this measures the skill's incremental value and can reveal eventual retirement. Baseline reports use `skill_absent_for_baseline`, while `metrics.skillLoaded` records the observed state directly.
- Treat a single failure as a hypothesis. Inspect the captured answer, failed check, tool/token/cost metrics, and optionally retained workspace.
- Convert confirmed failures into focused prompt cases or deterministic package tests.
- After stable near-100% behavior, keep the suite as a regression eval and periodically rerun it across supported harnesses/models.

The deterministic `tests/unity-guidance-audit.test.ts` suite remains the fast test for scanner behavior. This eval tests whether an agent actually selects and applies the skill correctly.
