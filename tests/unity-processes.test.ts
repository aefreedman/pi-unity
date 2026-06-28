import { strict as assert } from "node:assert";
import { dedupeRunningUnityProcesses, parsePosixUnityProcessList, parseWindowsUnityProcessList, shouldRetryWindowsTaskkillWithForce, terminateRunningUnityProcesses } from "../src/unity-processes.ts";

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

const deduped = dedupeRunningUnityProcesses([
  { pid: 10, commandLine: "Unity -projectPath Game" },
  { pid: 10, commandLine: "Unity duplicate" },
  { pid: null, commandLine: "Unity no pid" },
  { pid: null, commandLine: "Unity no pid" },
]);
assert.equal(deduped.length, 2);

const terminatedPids: number[] = [];
const termination = await terminateRunningUnityProcesses([
  { pid: 42, commandLine: "Unity -projectPath Game" },
  { pid: 42, commandLine: "Unity duplicate" },
  { pid: null, commandLine: "Unity CLI status: Game" },
], {
  terminator: async (process) => {
    if (process.pid !== null) terminatedPids.push(process.pid);
    return { forced: true };
  },
});
assert.deepEqual(terminatedPids, [42]);
assert.equal(termination.terminated.length, 1);
assert.equal(termination.forceTerminated.length, 1);
assert.equal(termination.skipped.length, 1);

assert.equal(shouldRetryWindowsTaskkillWithForce({ stderr: "Reason: This process can only be terminated forcefully (with /F option)." }), true);
assert.equal(shouldRetryWindowsTaskkillWithForce({ stderr: "ERROR: The process could not be found." }), false);

console.log("free-unity-pi unity-process tests passed");
