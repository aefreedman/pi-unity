import { strict as assert } from "node:assert";
import { dedupeRunningUnityProcesses, defaultUnityProcessTerminator, parsePosixUnityProcessList, parseWindowsUnityProcessList, redactUnityProcessCommandLine, shouldRetryWindowsTaskkillWithForce, terminateRunningUnityProcesses, unityProcessIdentityMatchesCandidates } from "../src/unity-processes.ts";

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

for (const rendered of [
  redactUnityProcessCommandLine('Unity.exe -projectPath C:/Repo/Game -accessToken "fake access token" --client-secret=realistic-secret --password p@ssw0rd'),
  parseWindowsUnityProcessList(JSON.stringify({ ProcessId: 606, CommandLine: 'Unity.exe -projectPath C:/Repo/Game -accessToken fake-access-token --credential real-credential' }), "C:/Repo/Game")[0]!.commandLine,
]) {
  assert(!rendered.includes("fake access token"));
  assert(!rendered.includes("fake-access-token"));
  assert(!rendered.includes("realistic-secret"));
  assert(!rendered.includes("real-credential"));
  assert.match(rendered, /\[REDACTED\]/);
}

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
await assert.rejects(
  () => defaultUnityProcessTerminator({ pid: null, commandLine: "Unity -accessToken an-actual-looking-token" }),
  (error: unknown) => error instanceof Error && error.message.includes("[REDACTED]") && !error.message.includes("an-actual-looking-token"),
);
const terminatedPids: number[] = [];
const journaledPids: number[] = [];
const termination = await terminateRunningUnityProcesses([
  { pid: 42, commandLine: "Unity -projectPath Game" },
  { pid: 42, commandLine: "Unity duplicate" },
  { pid: null, commandLine: "Unity CLI status: Game" },
], {
  terminator: async (process) => {
    if (process.pid !== null) terminatedPids.push(process.pid);
    return { forced: true };
  },
  onTerminated: (process, info) => {
    if (process.pid !== null && info.forced) journaledPids.push(process.pid);
  },
});
assert.deepEqual(terminatedPids, [42]);
assert.deepEqual(journaledPids, [42], "Expected completed terminations to be journaled immediately for error disclosure.");
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

const abortController = new AbortController();
const abortedTerminationPids: number[] = [];
await assert.rejects(
  terminateRunningUnityProcesses([
    { pid: 101, commandLine: "Unity -projectPath /Users/test/Game" },
    { pid: 102, commandLine: "Unity -projectPath /Users/test/Game" },
  ], {
    signal: abortController.signal,
    terminator: async (process) => {
      if (process.pid !== null) abortedTerminationPids.push(process.pid);
      abortController.abort();
      return { forced: false };
    },
  }),
  /abort/i,
);
assert.deepEqual(abortedTerminationPids, [101], "Cancellation after one closure must prevent later process termination.");

assert.equal(shouldRetryWindowsTaskkillWithForce({ stderr: "Reason: This process can only be terminated forcefully (with /F option)." }), true);
assert.equal(shouldRetryWindowsTaskkillWithForce({ stderr: "ERROR: The process could not be found." }), false);

console.log("pi-unity unity-process tests passed");
