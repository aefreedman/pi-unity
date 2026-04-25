import { strict as assert } from "node:assert";
import { parsePosixUnityProcessList, parseWindowsUnityProcessList } from "../src/unity-processes.ts";

const windowsJson = JSON.stringify([
  {
    ProcessId: 101,
    CommandLine: '"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -projectPath "C:/Repo/Game"',
  },
  {
    ProcessId: 202,
    CommandLine: '"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -projectPath "C:/Repo/Other"',
  },
]);
const windowsMatches = parseWindowsUnityProcessList(windowsJson, "C:/Repo/Game");
assert.equal(windowsMatches.length, 1);
assert.equal(windowsMatches[0].pid, 101);

const posixOutput = [
  '301 /Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity -projectPath /Users/test/Game',
  '302 /usr/bin/python worker.py /Users/test/Game',
  '303 /Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity -projectPath /Users/test/Other',
].join("\n");
const posixMatches = parsePosixUnityProcessList(posixOutput, "/Users/test/Game", "darwin");
assert.equal(posixMatches.length, 1);
assert.equal(posixMatches[0].pid, 301);

console.log("free-unity-pi unity-process tests passed");
