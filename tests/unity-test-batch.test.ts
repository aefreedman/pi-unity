import { strict as assert } from "node:assert";
import * as path from "node:path";
import { createUnityTestBatchPlan } from "../src/unity-test-batch";
import { parseUnityBatchmodeInvocation } from "../src/unity-batchmode";
import { createUnityCliRunCommand, normalizeUnityCliForwardedArgs } from "../src/unity-cli";
import { createUnityBatchmodeCommand } from "../src/unity-editor-fallback";

const now = new Date("2026-07-10T01:02:03.123Z");
const windowsPlan = createUnityTestBatchPlan({
  projectRoot: "C:\\Development\\My Game",
  testPlatform: "EditMode",
  testFilters: ["Game.Tests.Fast", "Game.Tests.Other", "Game.Tests.Fast"],
  testCategories: ["Fast", "!RequiresGraphics"],
  now,
  token: "abc-123",
  pathApi: path.win32,
});
assert.deepEqual(windowsPlan.testFilters, ["Game.Tests.Fast", "Game.Tests.Other"], "Expected stable selector deduplication.");
assert.deepEqual(windowsPlan.testCategories, ["Fast", "!RequiresGraphics"]);
assert(path.win32.isAbsolute(windowsPlan.testResultsPath) && path.win32.isAbsolute(windowsPlan.logFilePath), "Windows artifacts must be absolute.");
assert.equal(path.win32.dirname(windowsPlan.testResultsPath), "C:\\Development\\My Game\\Logs");
assert(windowsPlan.testResultsPath.endsWith("unity-tests-editmode-20260710T010203123Z-abc123.xml"), "Expected Windows-safe deterministic artifact name.");
assert(!windowsPlan.args.some((arg) => arg.toLowerCase().startsWith("-quit")), "Convenience args must never include -quit.");

const parsed = parseUnityBatchmodeInvocation(windowsPlan.args);
assert.equal(parsed.isTestRun, true);
assert.equal(parsed.testPlatform, "EditMode");
assert.equal(parsed.testFilter, "Game.Tests.Fast;Game.Tests.Other");
assert.equal(parsed.testCategory, "Fast;!RequiresGraphics");
assert.equal(parsed.testResultsPath, windowsPlan.testResultsPath);
assert.equal(parsed.logFilePath, windowsPlan.logFilePath);

const macPlan = createUnityTestBatchPlan({
  projectRoot: "/Users/dev/Projects/Gamé Project",
  testPlatform: "PlayMode",
  testFilters: [],
  testCategories: [],
  now,
  token: "xyz789",
  pathApi: path.posix,
});
assert(path.posix.isAbsolute(macPlan.testResultsPath) && macPlan.testResultsPath.startsWith("/Users/dev/Projects/Gamé Project/Logs/"), "macOS artifacts must stay under project Logs.");
assert.deepEqual(macPlan.args.slice(0, 3), ["-runTests", "-testPlatform", "PlayMode"]);
assert(!macPlan.args.includes("-testFilter") && !macPlan.args.includes("-testCategory"), "Empty selectors should run all tests for the platform.");

const secondMacPlan = createUnityTestBatchPlan({
  projectRoot: "/Users/dev/Projects/Gamé Project",
  testPlatform: "PlayMode",
  now,
  token: "different",
  pathApi: path.posix,
});
assert.notEqual(macPlan.testResultsPath, secondMacPlan.testResultsPath, "Distinct tokens must produce collision-safe artifact paths.");

for (const invalid of [" ", "bad;selector", "bad\nselector", "bad\0selector"]) {
  assert.throws(() => createUnityTestBatchPlan({
    projectRoot: "/project",
    testPlatform: "EditMode",
    testFilters: [invalid],
    now,
    token: "token",
    pathApi: path.posix,
  }), /must not/);
}

const directCommand = createUnityBatchmodeCommand("/Applications/Unity", "/Users/dev/Projects/Gamé Project", macPlan.args);
assert(directCommand.args.includes("-runTests") && directCommand.args.includes(macPlan.testResultsPath), "Direct Editor launch must preserve planned test args.");
const cliCommand = createUnityCliRunCommand("/Users/dev/Projects/Gamé Project", macPlan.args, { cliCommand: "unity" });
assert(cliCommand.args.includes("-runTests") && cliCommand.args.includes(macPlan.testResultsPath), "Unity CLI launch must preserve planned test args.");
assert(!normalizeUnityCliForwardedArgs(macPlan.args).some((arg) => arg.toLowerCase() === "-quit"));

console.log("pi-unity test batch planner tests passed");
