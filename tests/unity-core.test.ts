import { strict as assert } from "node:assert";
import {
  applyDefaultUnityBatchmodeArgs,
  buildUnityBatchmodeArgs,
  buildUnityEditorCandidates,
  buildUnityOpenEditorArgs,
  commandTargetsProject,
  extractUnityProjectPathArguments,
  hasUnityCommandLineFlag,
  normalizeUnityEditorOverride,
  parseCommandLineArguments,
  parseUnityVersionText,
  projectPathsMatch,
} from "../src/unity-core.ts";

assert.equal(parseUnityVersionText("m_EditorVersion: 2022.3.18f1\n"), "2022.3.18f1");
assert.equal(parseUnityVersionText("foo\nbar\n"), null);

assert.deepEqual(buildUnityOpenEditorArgs("/repo/game"), ["-projectPath", "/repo/game"], "Direct Editor launch omits -automated by default.");
assert.deepEqual(buildUnityOpenEditorArgs("/repo/game", { automated: true }), ["-projectPath", "/repo/game", "-automated"], "Direct Editor launch includes -automated when requested.");
assert.deepEqual(buildUnityBatchmodeArgs("/repo/game", ["-quit", "-logFile", "-"]), ["-batchmode", "-projectPath", "/repo/game", "-nographics", "-quit", "-logFile", "-"]);
assert.deepEqual(buildUnityBatchmodeArgs("/repo/game", ["-quit"], { useGraphics: true }), ["-batchmode", "-projectPath", "/repo/game", "-quit"]);
assert.deepEqual(applyDefaultUnityBatchmodeArgs(["-nographics", "-runTests"]), ["-nographics", "-runTests"]);
assert(hasUnityCommandLineFlag(["-NoGraphics"], "-nographics"), "Expected command-line flag detection to be case-insensitive.");

const normalizeSlashes = (value: string): string => value.replace(/\\/g, "/");

const winCandidates = buildUnityEditorCandidates("2022.3.18f1", "win32").map(normalizeSlashes);
assert(winCandidates.some((candidate) => candidate.includes("Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe")), "Expected Windows Hub candidate.");

const macCandidates = buildUnityEditorCandidates("2022.3.18f1", "darwin").map(normalizeSlashes);
assert(macCandidates.some((candidate) => candidate.includes("Unity.app/Contents/MacOS/Unity")), "Expected macOS app candidate.");

const linuxCandidates = buildUnityEditorCandidates("2022.3.18f1", "linux", "/home/tester").map(normalizeSlashes);
assert(linuxCandidates.some((candidate) => candidate.includes("/home/tester/Unity/Hub/Editor/2022.3.18f1/Editor/Unity")), "Expected Linux home-directory candidate.");
assert(linuxCandidates.some((candidate) => candidate.includes("/opt/Unity/Hub/Editor/2022.3.18f1/Editor/Unity")), "Expected Linux /opt candidate.");

assert.equal(
  normalizeSlashes(normalizeUnityEditorOverride("/Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app", "darwin")),
  "/Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity",
);
assert.equal(
  normalizeSlashes(normalizeUnityEditorOverride("C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe", "win32")),
  "C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe",
);

assert.deepEqual(
  parseCommandLineArguments('"C:/Program Files/Unity/Editor/Unity.exe" -projectPath "C:/Repo/My Game"'),
  ["C:/Program Files/Unity/Editor/Unity.exe", "-projectPath", "C:/Repo/My Game"],
);
assert(commandTargetsProject('"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -projectPath "C:/Repo/Game"', "c:\\repo\\game", "win32"));
assert(commandTargetsProject('Unity.exe -projectPath="C:/Repo/My Game"', "c:\\repo\\my game", "win32"));
assert.deepEqual(
  extractUnityProjectPathArguments("Unity -projectPath /Users/test/My Game -logFile -"),
  ["/Users/test/My Game"],
  "Unquoted process-list paths may contain spaces before the next Unity flag.",
);
assert(commandTargetsProject("Unity -projectPath /Users/test/My Game -logFile -", "/Users/test/My Game", "darwin"));
assert(!commandTargetsProject("Unity -projectPath relative/Game", "/workspace/relative/Game", "darwin"), "Relative process paths must not match without a process cwd.");
assert(!commandTargetsProject('Unity.exe -projectPath C:/Repo/GameBackup', "C:/Repo/Game", "win32"), "Project prefixes must not match.");
assert(!commandTargetsProject('Unity.exe -logFile "C:/Repo/Game" -projectPath C:/Repo/Other', "C:/Repo/Game", "win32"), "Unrelated arguments must not match.");
assert(commandTargetsProject('/Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity -projectPath /Users/test/Game', "/Users/test/Game", "darwin"));
assert(!commandTargetsProject('/Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity -projectPath /Users/test/Other', "/Users/test/Game", "darwin"));
assert(!projectPathsMatch("/tmp/__pi_unity_case_match__/game", "/tmp/__pi_unity_case_match__/Game", "darwin"), "Darwin project paths must remain case-sensitive.");

console.log("pi-unity unity-core tests passed");
