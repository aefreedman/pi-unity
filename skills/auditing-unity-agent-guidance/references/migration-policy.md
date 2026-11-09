# Unity CLI and Pipeline Migration Policy

## Native-first routing

1. Resolve the exact absolute project-copy path and use its explicit native selector on every project-targeted call. Give every delegated child that path, allowed role and authorization; do not imply automatic inheritance.
2. Inspect native status and bounded live command schemas. `com.unity.pipeline` in the manifest is not reachability or capability evidence. Pi status tools are optional snapshots, not prerequisites to CLI use.
3. Prefer connected native execution when the exact open Editor is reachable and advertises the intended operation. Use installed help/schemas rather than guessing grouped/flat names or copying another command's flags.
4. Choose an isolated CLI/batchmode route only when the exact copy is verified closed and the route fits the request. Report requirements do not authorize closing an open Editor. Stop on uncertainty rather than silently switching routes.
5. Keep direct Editor execution as an explicit compatibility/unavailable-CLI or project-required CI route, never a destructive fallback after uncertain dispatch.

## Fleets and completion

Use [native CLI and fleet guidance](../../unity-pipeline-workflows/references/native-cli-fleet.md) when migrating multi-agent instructions. Designate one same-copy Editor-changing operator through real completion and result capture; allow suitable reads without promising parallel execution or consistent snapshots. Coordinate file edits before validation, since auto-refresh/import/reload can interfere. Selection is neither mutation permission nor operation ownership.

Native command serialization does not protect a multi-command workflow. In Pipeline 0.10, async test startup returns before completion, another run can invalidate the prior collector/shared status, and detached jobs disappear across domain reloads. A detached-start job finishing is not a test pass. Timeout, missing job or child exit is not proof that Editor work ended. Stop conflicting work and inspect native evidence before explicit handoff; do not blindly retry, cancel another client's work or clear locks.

## Compile, tests and project methods

- Use native `unity recompile --project-path "<absolute-project-root>"` when it supplies the needed completion evidence. Raw advertised `script recompile` and `script recompile_status` remain available under a fixed deadline through reload; do not require a custom polling loop when the native command already handles it.
- Discover exact test schemas. Connected EditMode may complete synchronously; connected PlayMode needs the advertised async route and terminal `test status` evidence across reload. Do not start another run before capturing the first result.
- Use native `unity test` for deliberately isolated/report-producing tests. Preserve intended filters/categories, graphics requirements and PlayMode skips. Reject zero-test, malformed, incomplete, contradictory and nested failing evidence.
- Native `unity run <absolute-project-root> -- -executeMethod ...` supports real project-owned static methods; do not invent one. Inspect native `unity build` and advertised connected build schemas before dispatch; honor their confirmation/status requirements rather than imposing a universal ExecuteMethod requirement.
- Optional Pi adapters can supply normalized artifacts and bounded orchestration. Describe their limits as adapter contracts, not native command restrictions.

## Lifecycle and profiles

Opening is not readiness. Native `open --until-ready` can observe readiness when opening is authorized; status/readiness diagnosis does not authorize opening. Shutdown needs explicit intent and exact-copy process verification. Do not install/upgrade packages, upgrade projects, dismiss dialogs or change telemetry merely to complete migration.

- **Pi-native:** native CLI/Pipeline commands are normal. Add optional Pi adapters and Pi-specific search/artifact integration where useful, not a mandatory tool-first gateway. Session settings and mutexes govern participating package calls only.
- **Portable:** supply native commands with explicit absolute selectors and discovered signatures, successful CLI outcomes and command-specific payload validation. Keep appropriate direct Editor/CI fallbacks.
- **Mixed:** state one native-first routing/fleet policy, then identify optional adapters without duplicating project-specific expectations.

Remote Cloud Build/Pipeline Automation inventory is intentional authenticated remote access, separate from local Editor `com.unity.pipeline`. Do not add it to routine local diagnosis or imply remote reads are offline.
