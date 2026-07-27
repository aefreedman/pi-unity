import { existsSync, readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  pi?: { extensions?: string[]; skills?: string[] };
  scripts?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  bundledDependencies?: string[];
  exports?: Record<string, string>;
};
const indexText = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const skillText = readFileSync(new URL("../skills/unity-batchmode-tests/SKILL.md", import.meta.url), "utf8");
const guidanceSkillText = readFileSync(new URL("../skills/auditing-unity-agent-guidance/SKILL.md", import.meta.url), "utf8");
const connectedSkillText = readFileSync(new URL("../skills/unity-connected-workflows/SKILL.md", import.meta.url), "utf8");
const unityDocsSkillText = readFileSync(new URL("../skills/unity-docs/SKILL.md", import.meta.url), "utf8");
const unityDocsSchemaText = readFileSync(new URL("../skills/unity-docs/schema.yaml", import.meta.url), "utf8");
const readmeText = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const testBatchText = readFileSync(new URL("../src/unity-test-batch.ts", import.meta.url), "utf8");
const batchmodeSourceText = readFileSync(new URL("../src/unity-batchmode.ts", import.meta.url), "utf8");
const changelogText = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const guidanceEvalReadmeText = readFileSync(new URL("../evals/auditing-unity-agent-guidance/README.md", import.meta.url), "utf8");
const guidanceEvalRunnerText = readFileSync(new URL("../evals/auditing-unity-agent-guidance/run-eval.ts", import.meta.url), "utf8");
const gitignoreText = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
const guidanceEvalCases = JSON.parse(readFileSync(new URL("../evals/auditing-unity-agent-guidance/cases.json", import.meta.url), "utf8")) as Array<{ id: string; should_trigger: boolean; expected_checks: string[] }>;
const guidanceAuditSourceText = readFileSync(new URL("../src/unity-guidance-audit.ts", import.meta.url), "utf8");
const workflowProviderSourceText = readFileSync(new URL("../src/unity-workflow-provider.ts", import.meta.url), "utf8");

assert(packageJson.pi?.extensions?.includes("./index.ts"), "Expected pi-unity to register its extension entrypoint.");
assert(packageJson.pi?.skills?.includes("./skills"), "Expected pi-unity to keep its skills registered.");
assert(packageJson.scripts?.test?.includes("unity-core.test.ts"), "Expected pi-unity test script to run unity-core tests.");
assert(packageJson.scripts?.test?.includes("unity-processes.test.ts"), "Expected pi-unity test script to run unity-process tests.");
assert(packageJson.scripts?.test?.includes("pi-unity-settings.test.ts"), "Expected pi-unity test script to run pi-unity settings tests.");
assert(packageJson.scripts?.test?.includes("unity-batchmode.test.ts"), "Expected pi-unity test script to run unity-batchmode tests.");
assert(packageJson.scripts?.test?.includes("unity-guidance-audit.test.ts"), "Expected pi-unity test script to run guidance audit tests.");
assert(packageJson.scripts?.test?.includes("unity-test-batch.test.ts"), "Expected pi-unity test script to run test-batch planner tests.");
assert(packageJson.scripts?.test?.includes("unity-cli.test.ts"), "Expected pi-unity test script to run unity-cli tests.");
assert(packageJson.scripts?.test?.includes("unity-project-lock.test.ts"), "Expected pi-unity test script to run unity project lock tests.");
assert(packageJson.scripts?.test?.includes("unity-workflow-provider.test.ts"), "Expected pi-unity test script to run workflow-provider tests.");
assert(packageJson.scripts?.test?.includes("unity-workflow-packed-copy.test.ts"), "Expected pi-unity test script to run packed workflow-provider dependency tests.");
assert(packageJson.scripts?.["eval:guidance-skill"]?.includes("auditing-unity-agent-guidance/run-eval.ts"), "Expected an opt-in guidance-skill behavioral eval script.");
assert(guidanceEvalCases.length >= 10, "Expected at least ten behavioral skill-eval prompts.");
assert(guidanceEvalCases.some((item) => item.should_trigger) && guidanceEvalCases.some((item) => !item.should_trigger), "Expected positive and negative skill-trigger controls.");
assert(guidanceEvalCases.every((item) => item.expected_checks.length > 0), "Expected per-case success criteria.");
assert(guidanceEvalCases.some((item) => item.id === "migrate_nested_workspace_with_inherited_guidance" && item.expected_checks.includes("audit_includes_ancestors") && item.expected_checks.includes("ancestor_guidance_unchanged")), "Expected inherited-guidance migration coverage.");
for (const snippet of ["no-skill baseline", "fresh OS-temporary fixture copy", "filesystem", "tool calls", "provider costs"]) {
  assert(guidanceEvalReadmeText.includes(snippet), `Expected behavioral eval guidance to contain: ${snippet}`);
}
assert(guidanceEvalRunnerText.includes('join(tmpdir(), "pi-unity-skill-evals"') && guidanceEvalRunnerText.includes("only writable workspace"), "Expected eval outputs and agent writes to stay outside the package checkout by default.");
assert(gitignoreText.includes("evals/**/results/") && gitignoreText.includes("evals/**/*.eval-results.json"), "Expected defense-in-depth ignores for explicitly persisted eval output.");
assert(packageJson.peerDependencies?.["@earendil-works/pi-ai"] === "*", "Expected pi-ai peer dependency for StringEnum schemas.");
assert(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"] === "*", "Expected pi-coding-agent peer dependency.");
assert(packageJson.peerDependencies?.["@earendil-works/pi-tui"] === "*", "Expected pi-tui peer dependency.");
assert(packageJson.peerDependencies?.["typebox"] === "*", "Expected typebox peer dependency.");
for (const dependency of ["@aefree/pi-capability-registry", "@aefree/pi-project-artifacts", "@aefree/pi-repo-search", "@aefree/pi-workflow"]) {
  assert(/^\^\d+\.\d+\.\d+$/.test(packageJson.dependencies?.[dependency] ?? ""), `Expected semver dependency for ${dependency}.`);
}
assert.equal(packageJson.bundledDependencies, undefined, "Decomposition packages are co-installed and must not copy sibling repositories into pi-unity tarballs.");
assert(packageJson.exports?.["./contracts/v1"] === "./contracts/v1.ts", "Expected side-effect-free Unity migration contract subpath.");
for (const snippet of ["createWorkflowProviderRegistryV1", "createUnityWorkflowProviderV1", "workflowProviderToken", "WeakMap<object, ScopeRegistrations>"]) {
  assert(indexText.includes(snippet), `Expected Unity workflow-provider registration lifecycle: ${snippet}`);
}
for (const snippet of ["engine.unity", "ProjectVersion.txt", "guidance/unity/plan", "guidance/unity/work", "guidance/unity/review", "guidance/unity/validation", "inspectUnityProjectBusyState", "listRunningUnityProcessesForProject", "raceAbortWithTimeout"]) {
  assert(workflowProviderSourceText.includes(snippet), `Expected Unity workflow provider capability: ${snippet}`);
}
assert(!JSON.stringify(packageJson).includes("file:../"), "Packed manifest must not contain sibling file dependencies.");

for (const snippet of ["pi.registerCommand(\"unity-open\"", "name: \"unity_migrate_solution_docs\"", "createUnityArtifactProfileV1", "createUnityRepositoryPolicyV1", "createUnityMigrationServiceV1", "name: \"unity_guidance_audit\"", "name: \"unity_project_status\"", "name: \"unity_inspect_artifacts\"", "name: \"unity_open_editor\"", "name: \"unity_run_test_batch\"", "name: \"unity_launch_batchmode\"", "closeBlockingUnityProcess", "piUnity.allowCloseRunningUnityProcess", "Unity allows only one process per project folder", "chooseProjectCandidateWithWrappingNavigation", "selectedIndex === 0 ? candidates.length - 1", "selectedIndex === candidates.length - 1 ? 0", "runGuardedUnityBatchmode", "withUnityProjectLaunchMutex", "assertUnityProjectNotBusy", "inspectUnityProjectBusyState", "getUnityNativeLockfilePath", "removeStaleLockfileAfterGuardedClose", "createUnityCliRunCommand", "createUnityCliEditorExitCommand", "launchUnityCliOpenDetached", "listRunningUnityCliEditorsForProject", "terminateRunningUnityProcesses", "renderCall(args, theme)", "renderResult(result, { expanded }, theme)"]) {
  assert(indexText.includes(snippet), `Expected index.ts to contain: ${snippet}`);
}

for (const snippet of ["unity_project_status", "unity_inspect_artifacts", "unity_open_editor", "unity_run_test_batch", "unity_launch_batchmode", "/unity-open", "one process per project folder", "piUnity.allowCloseRunningUnityProcess"]) {
  assert(skillText.includes(snippet), `Expected skill doc to contain: ${snippet}`);
  assert(readmeText.includes(snippet), `Expected README to contain: ${snippet}`);
}

for (const snippet of ["Temp/UnityLockfile", "Pi-side project mutex", "unity_project_status"]) {
  assert(skillText.includes(snippet), `Expected skill doc to contain: ${snippet}`);
  assert(readmeText.includes(snippet), `Expected README to contain: ${snippet}`);
}

for (const snippet of ["unity_guidance_audit", "exact project path", "Pipeline installation", "migration-policy.md", "untrusted evidence", "ancestorCandidates", "do not obscure or remove it to silence the heuristic"]) {
  assert(guidanceSkillText.includes(snippet), `Expected guidance audit skill to contain: ${snippet}`);
}
for (const snippet of ["name: unity-docs", "project_artifact_search", "unity_migrate_solution_docs", "approvalHash", "exact-path override", "synthetic fixtures only", "assets/resolution-template.md", "references/yaml-schema.md"]) {
  assert(unityDocsSkillText.includes(snippet), `Expected preserved thin unity-docs skill to contain: ${snippet}`);
}
assert(unityDocsSchemaText.includes("schema_version: 2") && unityDocsSchemaText.includes("failure_mode:"), "Expected packaged v2 Unity docs schema asset.");
assert(existsSync(new URL("../scripts/migrate-unity-docs-schema.ts", import.meta.url)), "Expected updated Unity docs migrator script.");
for (const resource of [
  "prompts/cg-migrate-unity-docs-schema.md",
  "references/_shared/unity-repo-research.md",
  "references/_shared/unity-review-guidance.md",
  "references/cg-review/unity-testing.md",
  "references/cg-work/unity-yaml-assets.md",
  "skills/unity-docs/SKILL.md",
  "skills/unity-docs/schema.yaml",
  "skills/unity-docs/assets/critical-pattern-template.md",
  "skills/unity-docs/assets/resolution-template.md",
  "skills/unity-docs/references/category-selection.md",
  "skills/unity-docs/references/error-handling.md",
  "skills/unity-docs/references/example.md",
  "skills/unity-docs/references/quality-guidelines.md",
  "skills/unity-docs/references/yaml-schema.md",
]) assert(existsSync(new URL(`../${resource}`, import.meta.url)), `Missing exact compatibility-map resource: ${resource}`);
assert(guidanceAuditSourceText.includes("ancestorCandidates") && indexText.includes("applicable ancestor instruction file(s) were not scanned"), "Expected local-only audits to disclose inherited instruction candidates.");

for (const skillSnippet of [
  "Use the `pi-unity` tools first instead of forming raw Unity CLI commands on the fly",
  "Only fall back to direct CLI commands if the packaged Unity tools are unavailable or fail",
  "Explicit user instructions and project guidance to skip PlayMode tests override generic validation defaults",
  "PlayMode is additional evidence only",
  "exact current-run `-testResults`/`-logFile` paths",
  "then stop relaunching",
  "new, stated hypothesis",
  "passed, failed, intentionally skipped, or blocked",
]) {
  assert(skillText.includes(skillSnippet), `Expected skill doc to contain: ${skillSnippet}`);
}

assert(readmeText.includes("explicit user/project PlayMode skips") && readmeText.includes("exact current-run artifact paths"), "Expected README validation stop-rule summary.");
assert(indexText.includes("For Unity Test Framework runs, always provide absolute -testResults and -logFile paths"), "Expected batchmode tool guidance for compact test summaries.");
assert(indexText.includes("skip PlayMode tests") && indexText.includes("exact current-run -testResults/-logFile paths") && indexText.includes("do not relaunch without a new stated hypothesis"), "Expected batchmode tool guidance to honor skips, inspect exact artifacts, and stop unchanged infrastructure retries.");
assert(indexText.includes("deriveUnityArtifactInspectionStatus") && indexText.includes("deriveUnityBatchmodeStatus"), "Expected batchmode and artifact inspection to share test-evidence status semantics.");
assert(batchmodeSourceText.includes("hasKnownPositiveExecutedTestCount") && batchmodeSourceText.includes("isPassingUnityTestEvidence"), "Expected shared passing-test evidence to require a known positive executed-test count.");
assert(indexText.includes("Summarize existing Unity log files and Unity Test Framework XML results without launching Unity"), "Expected artifact inspection guidance.");
assert(indexText.includes("if (result.killed || report.details.status !== \"passed\")") && indexText.includes("if (report.details.status === \"failed\") throw new Error(report.text)"), "Expected failed batches and artifact inspections to throw tool errors.");
assert(indexText.includes("compactUnityArtifacts") && indexText.includes("stdout: summarizeTextForAgent(result.stdout") && indexText.includes("stderr: summarizeTextForAgent(result.stderr"), "Expected bounded batchmode result details with full evidence retained by artifact path.");
assert(indexText.includes("Completed pre-launch side effects / evidence paths") && indexText.includes("Closed Unity process IDs") && indexText.includes("Completed Unity process closures before this error"), "Expected post-close errors to disclose shared-project side effects and evidence paths.");
assert(indexText.includes("signal?.aborted") && indexText.includes("error.name === \"AbortError\"") && indexText.includes("A graceful Unity Editor exit was requested for"), "Expected cancellation during graceful Editor close to stop before OS-level termination fallback and disclose the request.");
assert(testBatchText.includes("createUnityTestBatchPlan") && testBatchText.includes("randomUUID") && testBatchText.includes("-testCategory") && testBatchText.includes("-testResults"), "Expected collision-safe test-batch planning with categories and artifacts.");
assert(batchmodeSourceText.includes("parsedTestResults.total > 0") && batchmodeSourceText.includes("!isPassingUnityTestEvidence(parsedTestResults)"), "Expected zero-test and unknown-total batches to fail.");
assert(readmeText.includes("unknown-total") && readmeText.includes("known positive executed-test count"), "Expected package guidance to reject unknown executed-test totals.");
assert(readmeText.includes("collision-safe absolute XML/log paths") && skillText.includes("default for isolated or report-producing Unity Test Framework work"), "Expected isolated test-batch documentation and routing guidance.");
for (const snippet of [
  "unity_project_status",
  "recompile_status",
  "--async_tests true",
  "stringified nested JSON",
  "valid nonterminal initiating response",
  "known positive executed-test count",
  "reports successful completion",
  "bounded backoff",
  "nested `success:false`",
  "changed exact-copy identity",
  "polling timeout",
  "Do not silently fall back to batchmode",
  "NUnit XML",
]) {
  assert(connectedSkillText.includes(snippet), `Expected connected Unity workflow skill to contain: ${snippet}`);
}
assert(connectedSkillText.includes("`run_tests` and `test_status`") && connectedSkillText.includes("Total: 0") && connectedSkillText.includes("result: running"), "Expected connected routing to require both commands while preserving a nonterminal running Total: 0 response.");
assert(changelogText.includes("unity_run_test_batch") && changelogText.includes("Windows CI"), "Expected test-batch changelog entries.");
assert(skillText.includes("Do not close a reachable Pipeline Editor merely to run tests") && skillText.includes("Route before planning a batch") && readmeText.includes("should run connected tests without closing the Editor"), "Expected open-Editor Pipeline tests to precede isolated batchmode routing.");
assert(existsSync(new URL("../.github/workflows/macos.yml", import.meta.url)) && existsSync(new URL("../.github/workflows/windows.yml", import.meta.url)), "Expected macOS and Windows package validation workflows.");

assert(!/C:\/Users\/[^/]+/.test(readmeText), "Expected README install instructions to avoid machine-specific absolute paths.");

console.log("pi-unity package validation tests passed");
