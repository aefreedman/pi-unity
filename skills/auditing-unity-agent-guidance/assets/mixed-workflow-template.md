## Unity automation routing

Always resolve and pass the exact Unity project-copy path. Do not route by project name when multiple workspace copies may exist.

1. Inspect whether that exact copy is closed, open with reachable Pipeline, or uncertain.
2. Prefer connected Pipeline compilation/tests only when the exact running copy advertises the required command.
3. Use an isolated Unity CLI/batchmode run when the Editor is closed, connected execution is unsupported, CI isolation is intended, or NUnit XML/log artifacts are required.
4. Never close a running Editor or install/upgrade Pipeline implicitly.

### Pi tools

- Inspect: `unity_project_status`
- Connected compile/test: use the package's typed connected tools when available
- Isolated tests: `unity_run_tests`
- Custom isolated Editor arguments: `unity_launch_batchmode`
- Existing evidence: `unity_inspect_artifacts`

### Portable CLI

```powershell
$ProjectPath = (Resolve-Path "<workspace>/<project>").Path
# Open only when explicitly requested and that exact project is verified closed.
unity open "$ProjectPath"
# Verify the exact running copy and its advertised schemas before dispatch.
unity command --project-path "$ProjectPath" --detail full --format json
unity command --project-path "$ProjectPath" --result-only editor status
unity command --project-path "$ProjectPath" --result-only script recompile
unity command --project-path "$ProjectPath" --result-only script recompile_status
```

These examples use current grouped commands; use only names and signatures advertised by the exact copy. Named `--result-only` responses still require successful CLI completion and command-specific result validation. Connected PlayMode tests must use advertised `test run --async-tests true` and be followed by `test status` until a verified terminal result, under a fixed deadline. Use `unity test "$ProjectPath" --mode <EditMode|PlayMode> --output <absolute-results-path>` when report artifacts or an isolated run are required.

Keep direct Editor `-batchmode` commands only as explicit fallbacks. Raw `-runTests` commands require absolute result/log paths and must not include `-quit`.
