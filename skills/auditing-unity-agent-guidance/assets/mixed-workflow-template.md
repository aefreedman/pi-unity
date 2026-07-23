## Unity automation routing

Always resolve and pass the exact Unity project-copy path. Do not route by project name when multiple workspace copies may exist.

1. Inspect whether that exact copy is closed, open with reachable Pipeline, or uncertain.
2. Prefer connected Pipeline compilation/tests only when the exact running copy advertises the required command.
3. Use an isolated Unity CLI/batchmode run when the Editor is closed, connected execution is unsupported, CI isolation is intended, or NUnit XML/log artifacts are required.
4. Never close a running Editor or install/upgrade Pipeline implicitly.

### Pi tools

- Inspect: `unity_project_status`
- Connected compile/test: use the package's typed connected tools when available
- Isolated tests: `unity_run_test_batch`
- Custom isolated Editor arguments: `unity_launch_batchmode`
- Existing evidence: `unity_inspect_artifacts`

### Portable CLI

```powershell
$ProjectPath = (Resolve-Path "<workspace>/nor-unity").Path
unity open "$ProjectPath"
unity command --project-path "$ProjectPath" editor_status
unity command --project-path "$ProjectPath" recompile
unity command --project-path "$ProjectPath" recompile_status
```

Connected PlayMode tests must be asynchronous and followed by `test_status`. Use `unity test "$ProjectPath" --mode <EditMode|PlayMode> --output <absolute-results-path>` when report artifacts or an isolated run are required.

Keep direct Editor `-batchmode` commands only as explicit fallbacks. Raw `-runTests` commands require absolute result/log paths and must not include `-quit`.
