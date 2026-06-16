import { readFileSync } from "node:fs";
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

assert(packageJson.pi?.extensions?.includes("./index.ts"), "Expected pi-unity to register its extension entrypoint.");
assert(packageJson.pi?.skills?.includes("./skills"), "Expected pi-unity to keep its skills registered.");
assert(packageJson.scripts?.test?.includes("unity-core.test.ts"), "Expected pi-unity test script to run unity-core tests.");
assert(packageJson.scripts?.test?.includes("unity-processes.test.ts"), "Expected pi-unity test script to run unity-process tests.");
assert(packageJson.scripts?.test?.includes("unity-batchmode.test.ts"), "Expected pi-unity test script to run unity-batchmode tests.");
assert(packageJson.scripts?.test?.includes("unity-cli.test.ts"), "Expected pi-unity test script to run unity-cli tests.");
assert(packageJson.scripts?.test?.includes("unity-project-lock.test.ts"), "Expected pi-unity test script to run unity project lock tests.");
assert(packageJson.peerDependencies?.["@mariozechner/pi-coding-agent"] === "*", "Expected pi-coding-agent peer dependency.");
assert(packageJson.peerDependencies?.["@mariozechner/pi-tui"] === "*", "Expected pi-tui peer dependency.");
assert(packageJson.peerDependencies?.["typebox"] === "*", "Expected typebox peer dependency.");

for (const snippet of ["pi.registerCommand(\"unity-open\"", "name: \"unity_open_editor\"", "name: \"unity_launch_batchmode\"", "Unity allows only one process per project folder", "withUnityProjectLaunchMutex", "assertUnityProjectNotBusy", "createUnityCliRunCommand", "launchUnityCliOpenDetached", "listRunningUnityCliEditorsForProject", "renderCall(args, theme)", "renderResult(result, { expanded }, theme)"]) {
  assert(indexText.includes(snippet), `Expected index.ts to contain: ${snippet}`);
}

for (const snippet of ["unity_open_editor", "unity_launch_batchmode", "/unity-open", "one process per project folder"]) {
  assert(skillText.includes(snippet), `Expected skill doc to contain: ${snippet}`);
  assert(readmeText.includes(snippet), `Expected README to contain: ${snippet}`);
}

for (const snippet of ["Temp/UnityLockfile", "Pi-side project mutex"]) {
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
]) {
  assert(skillText.includes(skillSnippet), `Expected skill doc to contain: ${skillSnippet}`);
}

assert(indexText.includes("For Unity Test Framework runs, always provide absolute -testResults and -logFile paths"), "Expected batchmode tool guidance for compact test summaries.");
assert(indexText.includes('isError: report.details.status === "failed"'), "Expected failed Unity batchmode runs to be marked as tool errors.");

assert(!/C:\/Users\/[^/]+/.test(readmeText), "Expected README install instructions to avoid machine-specific absolute paths.");

console.log("pi-unity package validation tests passed");
