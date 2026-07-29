# Unity Work Routing

Use this overlay only after `engine.unity` matches the exact Unity project copy. Keep project-specific compile, test, and validation requirements authoritative.

## Resolve Before Validation

Resolve and preserve the exact project-copy identity. Call `unity_project_status` before choosing a compile or test route. Do not select a similarly named copy or open or close another Editor for convenience. Do not delete lockfiles or terminate arbitrary PIDs. One process per project and the per-project launch mutex remain mandatory; lockfile handling is only available through the guarded, route-specific launch tools.

## Prefer a Reachable Connected Route

When that exact copy has a reachable Pipeline Editor advertising `recompile`, `recompile_status`, `run_tests`, and `test_status`, prefer its focused connected compile/test route. Poll the advertised status route after dispatch. A domain reload or disconnect requires rediscovering the same exact copy; it does not authorize changing targets or starting a second process.

Connected test evidence must meet the validation-evidence standard below. Connected tests do not inherently produce NUnit XML, so state that limitation when XML or logs are required.

## Isolated Batchmode Is an Explicit Fallback

Use `unity_run_test_batch` only when the project is closed, connected testing is unavailable or unsupported *before dispatch*, isolation/CI is intentional, filters are unsupported, or NUnit XML/log artifacts are required. Request graphics only for visual, rendering, screenshot, or graphics-dependent validation.

Do not silently switch to batchmode after an uncertain connected dispatch.

## Validation Evidence

Unity validation: require a known positive executed-test count and no failures before calling XML evidence passing. Honor explicit PlayMode skips. After a timeout or infrastructure failure, inspect the exact current-run artifacts once and do not relaunch unchanged work without a new hypothesis.
