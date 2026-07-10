import { strict as assert } from "node:assert";
import { dedupeRunningUnityProcesses, parsePosixUnityProcessList, parseWindowsUnityProcessList, shouldRetryWindowsTaskkillWithForce, terminateRunningUnityProcesses, unityProcessIdentityMatchesCandidates } from "../src/unity-processes.ts";

const windowsJson = JSON.stringify([
  {
    ProcessId: 101,
    CommandLine: '"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -projectPath "C:/Repo/Game"',
  },
  {
    ProcessId: 202,
    CommandLine: '"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -projectPath "C:/Repo/Other"',
  },
  {
    ProcessId: 303,
    CommandLine: '"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -projectPath "C:/Repo/GameBackup"',
  },
  {
    ProcessId: 404,
    CommandLine: '"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -logFile "C:/Repo/Game" -projectPath "C:/Repo/Other"',
  },
]);
const windowsMatches = parseWindowsUnityProcessList(windowsJson, "C:/Repo/Game");
assert.equal(windowsMatches.length, 1);
assert.equal(windowsMatches[0].pid, 101);

const windowsSpaceMatches = parseWindowsUnityProcessList(JSON.stringify({
  ProcessId: 505,
  CommandLine: '"C:/Program Files/Unity/Hub/Editor/2022.3.18f1/Editor/Unity.exe" -projectPath="C:/Repo/My Game"',
}), "c:\\repo\\my game");
assert.equal(windowsSpaceMatches.length, 1);
assert.equal(windowsSpaceMatches[0].pid, 505);

const posixOutput = [
  '301 /Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity -projectPath /Users/test/Game',
  '302 /usr/bin/python worker.py /Users/test/Game',
  '303 /Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity -projectPath /Users/test/Other',
  '304 "/Applications/Unity/Hub/Editor/2022.3.18f1/Unity.app/Contents/MacOS/Unity" -projectPath="/Users/test/My Game"',
].join("\n");
const posixMatches = parsePosixUnityProcessList(posixOutput, "/Users/test/Game", "darwin");
assert.equal(posixMatches.length, 1);
assert.equal(posixMatches[0].pid, 301);
const quotedPosixMatches = parsePosixUnityProcessList(posixOutput, "/Users/test/My Game", "darwin");
assert.equal(quotedPosixMatches.length, 1);
assert.equal(quotedPosixMatches[0].pid, 304);

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

assert.equal(
  unityProcessIdentityMatchesCandidates(
    { pid: 77, commandLine: "Unity CLI status: /Users/test/Game" },
    [{ pid: 77, commandLine: "Unity -projectPath /Users/test/Game" }],
  ),
  true,
  "A CLI-discovered PID may be revalidated against the current OS command line.",
);
assert.equal(
  unityProcessIdentityMatchesCandidates(
    { pid: 77, commandLine: "Unity -projectPath /Users/test/Game" },
    [{ pid: 77, commandLine: "Unity -projectPath /Users/test/Other" }],
  ),
  false,
  "A recycled PID with changed command identity must not match.",
);

let recycledPidTerminated = false;
const recycledPid = await terminateRunningUnityProcesses([
  { pid: 77, commandLine: "Unity -projectPath /Users/test/Game" },
], {
  identityVerifier: async () => false,
  terminator: async () => {
    recycledPidTerminated = true;
  },
});
assert.equal(recycledPidTerminated, false, "A PID whose identity changed must not be signaled.");
assert.equal(recycledPid.terminated.length, 0);
assert.equal(recycledPid.skipped.length, 1);

assert.equal(shouldRetryWindowsTaskkillWithForce({ stderr: "Reason: This process can only be terminated forcefully (with /F option)." }), true);
assert.equal(shouldRetryWindowsTaskkillWithForce({ stderr: "ERROR: The process could not be found." }), false);

console.log("free-unity-pi unity-process tests passed");
