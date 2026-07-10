import { existsSync, readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  pi?: { extensions?: string[]; skills?: string[] };
  scripts?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const indexText = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const skillText = readFileSync(new URL("../skills/unity-batchmode-tests/SKILL.md", import.meta.url), "utf8");
const screenshotSkillText = readFileSync(new URL("../skills/capturing-screenshots-unity/SKILL.md", import.meta.url), "utf8");
const screenshotUtilityText = readFileSync(new URL("../skills/capturing-screenshots-unity/assets/ScreenshotUtility.cs", import.meta.url), "utf8");
const readmeText = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const testBatchText = readFileSync(new URL("../src/unity-test-batch.ts", import.meta.url), "utf8");
const changelogText = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

assert(packageJson.pi?.extensions?.includes("./index.ts"), "Expected pi-unity to register its extension entrypoint.");
assert(packageJson.pi?.skills?.includes("./skills"), "Expected pi-unity to keep its skills registered.");
assert(packageJson.scripts?.test?.includes("unity-core.test.ts"), "Expected pi-unity test script to run unity-core tests.");
assert(packageJson.scripts?.test?.includes("unity-processes.test.ts"), "Expected pi-unity test script to run unity-process tests.");
assert(packageJson.scripts?.test?.includes("pi-unity-settings.test.ts"), "Expected pi-unity test script to run pi-unity settings tests.");
assert(packageJson.scripts?.test?.includes("unity-batchmode.test.ts"), "Expected pi-unity test script to run unity-batchmode tests.");
assert(packageJson.scripts?.test?.includes("unity-test-batch.test.ts"), "Expected pi-unity test script to run test-batch planner tests.");
assert(packageJson.scripts?.test?.includes("unity-cli.test.ts"), "Expected pi-unity test script to run unity-cli tests.");
assert(packageJson.scripts?.test?.includes("unity-project-lock.test.ts"), "Expected pi-unity test script to run unity project lock tests.");
assert(packageJson.peerDependencies?.["@mariozechner/pi-ai"] === "*", "Expected pi-ai peer dependency for StringEnum schemas.");
assert(packageJson.peerDependencies?.["@mariozechner/pi-coding-agent"] === "*", "Expected pi-coding-agent peer dependency.");
assert(packageJson.peerDependencies?.["@mariozechner/pi-tui"] === "*", "Expected pi-tui peer dependency.");
assert(packageJson.peerDependencies?.["typebox"] === "*", "Expected typebox peer dependency.");

for (const snippet of ["pi.registerCommand(\"unity-open\"", "name: \"unity_project_status\"", "name: \"unity_inspect_artifacts\"", "name: \"unity_open_editor\"", "name: \"unity_run_test_batch\"", "name: \"unity_launch_batchmode\"", "closeBlockingUnityProcess", "piUnity.allowCloseRunningUnityProcess", "Unity allows only one process per project folder", "chooseProjectCandidateWithWrappingNavigation", "selectedIndex === 0 ? candidates.length - 1", "selectedIndex === candidates.length - 1 ? 0", "runGuardedUnityBatchmode", "withUnityProjectLaunchMutex", "assertUnityProjectNotBusy", "inspectUnityProjectBusyState", "getUnityNativeLockfilePath", "removeStaleLockfileAfterGuardedClose", "createUnityCliRunCommand", "createUnityCliEditorExitCommand", "launchUnityCliOpenDetached", "listRunningUnityCliEditorsForProject", "terminateRunningUnityProcesses", "renderCall(args, theme)", "renderResult(result, { expanded }, theme)"]) {
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

for (const snippet of ["capturing-screenshots-unity", "ScreenshotUtility.cs", "screenshots"]) {
  assert(screenshotSkillText.includes(snippet) || readmeText.includes(snippet), `Expected screenshot skill or README to contain: ${snippet}`);
}
assert(screenshotUtilityText.includes("class ScreenshotUtility"), "Expected screenshot utility C# helper to be packaged.");
assert(!screenshotSkillText.includes("@AGENTS.md"), "Expected screenshot skill to use Pi-friendly project guidance references.");

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
assert(indexText.includes("selectedTestEvidenceUnavailable") && indexText.includes("!hasLoadedArtifacts") && indexText.includes("deriveUnityBatchmodeStatus"), "Expected missing batchmode and artifact evidence to avoid passed status.");
assert(indexText.includes("Summarize existing Unity log files and Unity Test Framework XML results without launching Unity"), "Expected artifact inspection guidance.");
assert(indexText.includes("if (result.killed || report.details.status !== \"passed\")") && indexText.includes("if (report.details.status === \"failed\") throw new Error(report.text)"), "Expected failed batches and artifact inspections to throw tool errors.");
assert(indexText.includes("compactUnityArtifacts") && indexText.includes("stdout: summarizeTextForAgent(result.stdout") && indexText.includes("stderr: summarizeTextForAgent(result.stderr"), "Expected bounded batchmode result details with full evidence retained by artifact path.");
assert(indexText.includes("Completed pre-launch side effects / evidence paths") && indexText.includes("Closed Unity process IDs") && indexText.includes("Completed Unity process closures before this error"), "Expected post-close errors to disclose shared-project side effects and evidence paths.");
assert(indexText.includes("signal?.aborted") && indexText.includes("error.name === \"AbortError\"") && indexText.includes("A graceful Unity Editor exit was requested for"), "Expected cancellation during graceful Editor close to stop before OS-level termination fallback and disclose the request.");
assert(testBatchText.includes("createUnityTestBatchPlan") && testBatchText.includes("randomUUID") && testBatchText.includes("-testCategory") && testBatchText.includes("-testResults"), "Expected collision-safe test-batch planning with categories and artifacts.");
assert(indexText.includes("parsedTestResults?.total === 0") || readFileSync(new URL("../src/unity-batchmode.ts", import.meta.url), "utf8").includes("parsedTestResults?.total === 0"), "Expected zero-test filtered batches to fail.");
assert(readmeText.includes("collision-safe absolute XML/log paths") && skillText.includes("default for ordinary Unity Test Framework work"), "Expected test-batch documentation and preferred workflow guidance.");
assert(changelogText.includes("unity_run_test_batch") && changelogText.includes("Windows CI"), "Expected unreleased cross-platform test-batch changelog entries.");
assert(existsSync(new URL("../.github/workflows/macos.yml", import.meta.url)) && existsSync(new URL("../.github/workflows/windows.yml", import.meta.url)), "Expected macOS and Windows package validation workflows.");

assert(!/C:\/Users\/[^/]+/.test(readmeText), "Expected README install instructions to avoid machine-specific absolute paths.");

console.log("pi-unity package validation tests passed");
