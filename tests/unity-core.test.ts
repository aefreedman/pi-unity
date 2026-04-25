import { strict as assert } from "node:assert";
import {
  buildUnityBatchmodeArgs,
  buildUnityEditorCandidates,
  buildUnityOpenEditorArgs,
  commandTargetsProject,
  normalizeUnityEditorOverride,
  parseUnityVersionText,
} from "../src/unity-core.ts";

assert.equal(parseUnityVersionText("m_EditorVersion: 2022.3.18f1\n"), "2022.3.18f1");
assert.equal(parseUnityVersionText("foo\nbar\n"), null);

assert.deepEqual(buildUnityOpenEditorArgs("/repo/game"), ["-projectPath", "/repo/game"]);
assert.deepEqual(buildUnityBatchmodeArgs("/repo/game", ["-quit", "-logFile", "-"]), ["-batchmode", "-projectPath", "/repo/game", "-quit", "-logFile", "-"]);

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

assert(commandTargetsProject('"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -projectPath "C:/Repo/Game"', "c:/repo/game", "win32"));
assert(commandTargetsProject('/Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity -projectPath /Users/test/Game', "/Users/test/Game", "darwin"));
assert(!commandTargetsProject('/Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity -projectPath /Users/test/Other', "/Users/test/Game", "darwin"));

console.log("free-unity-pi unity-core tests passed");
