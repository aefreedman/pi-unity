# Unity CLI and Pipeline Migration Policy

## Routing order

1. Resolve the exact project copy.
2. Inspect process, lockfile, and Pipeline state.
3. If that exact copy is open, reachable, and advertises the required command, prefer connected execution.
4. Choose an isolated Unity CLI or batchmode route only when the exact copy is verified closed and that route fits the request. An open or uncertain copy is not permission to launch another process.
5. Use the direct Editor executable only as an explicit fallback or when argument compatibility requires it.

## Compile

- Connected: invoke advertised `script recompile`, then poll `script recompile_status` through domain reload until `completed` or `up_to_date`; fail on compiler errors or unknown/incomplete state.
- Isolated: use `unity run <project> -- -quit ...` or the project package's compile tool when the Editor is closed.
- Never start batchmode against a project already open in the Editor merely to compile it.

## Tests

- Connected EditMode: advertised `test run --mode editor`; asynchronous execution plus `test status` is safest for uniform wrappers.
- Connected PlayMode: require advertised `--async-tests true`, then poll `test status` because domain reload can drop the initiating request.
- Isolated/report-producing: use `unity test` or the packaged `unity_run_tests` when NUnit XML/log artifacts are required.
- Preserve graphics requirements and reject zero-test, malformed, incomplete, or nested `success:false` results.

## Build and ExecuteMethod

- Connected Pipeline `build run` is confirmation-gated and must be followed by `build status`; verify the exact copy's schemas first.
- Cold `unity build` or raw batchmode must use a real project-owned static method; do not invent one.
- Keep `unity run <project> -- -executeMethod ...` for project-specific command-line tooling.

## Lifecycle

- Opening is a request until an exact-copy process or reachable Pipeline instance is observed.
- An explicitly authorized shutdown can disconnect before returning valid JSON; verify exact-copy process exit rather than trusting only the CLI exit code. The package's guarded closure workflow retains its own process and identity checks.
- Never close another project copy, delete lockfiles speculatively, or fall back destructively after uncertain dispatch.

## Profiles

### Pi-native

Refer to packaged tools first. Keep terminal commands only as bounded fallback examples.

### Portable

Use standalone `unity open`, `unity test`, `unity run`, `unity build`, and exact `unity command --project-path` examples. Discover full schemas with `unity command --project-path <path> --detail full --format json`; use `--result-only` for named commands and validate the CLI exit plus command-specific payload. Existing flat Pipeline commands retain their own advertised names/flags. Include direct Editor fallback only as an explicit route, never after uncertain dispatch.

### Mixed

State the routing policy once, then provide Pi-native tool names and portable equivalents without duplicating project-specific expectations.
