import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __unityProjectLockInternals,
  acquireUnityProjectLaunchMutex,
  evaluateUnityLaunchSafety,
  assertUnityProjectNotBusy,
  inspectUnityProjectBusyState,
  withUnityProjectLaunchMutex,
} from "../src/unity-project-lock.ts";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createProjectRoot(parent: string, name: string): string {
  const projectRoot = path.join(parent, name);
  ensureDir(path.join(projectRoot, "Temp"));
  return projectRoot;
}

async function assertRejectsWithMessage(callback: () => Promise<unknown>, expectedSnippet: string): Promise<void> {
  await assert.rejects(
    callback,
    (error) => error instanceof Error && error.message.includes(expectedSnippet),
  );
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unity-project-lock-test-"));
const mutexRoot = path.join(tempRoot, "mutexes");

try {
  const projectA = createProjectRoot(tempRoot, "GameA");
  const projectB = createProjectRoot(tempRoot, "GameB");
  const nativeLockfile = path.join(projectA, "Temp", "UnityLockfile");

  const idleState = await inspectUnityProjectBusyState(projectA, { processLister: async () => ({ processes: [] }) });
  assert.equal(idleState.nativeLockfilePath, nativeLockfile);
  assert.equal(idleState.nativeLockfileExists, false);
  await assertUnityProjectNotBusy(projectA, { processLister: async () => ({ processes: [] }) });

  fs.writeFileSync(nativeLockfile, "");
  // Launch-safety route matrix: a CLI may delegate only a proven stale lockfile;
  // process uncertainty and matching identity block every launch route.
  assert.deepEqual(evaluateUnityLaunchSafety("unity-cli", { nativeLockfileExists: true }, { processes: [] }), { allowed: true, staleLockDelegated: true });
  assert.deepEqual(evaluateUnityLaunchSafety("editor-executable", { nativeLockfileExists: true }, { processes: [] }), { allowed: false, reason: "native_lockfile" });
  for (const route of ["unity-cli", "editor-executable"] as const) {
    assert.deepEqual(evaluateUnityLaunchSafety(route, { nativeLockfileExists: false }, { processes: [], warning: "scan failed" }), { allowed: false, reason: "process_unknown" });
    assert.deepEqual(evaluateUnityLaunchSafety(route, { nativeLockfileExists: false }, { processes: [{ pid: 123, commandLine: "Unity -projectPath Game" }] }), { allowed: false, reason: "matching_process" });
  }
  await assertRejectsWithMessage(
    () => assertUnityProjectNotBusy(projectA, { processLister: async () => ({ processes: [] }) }),
    "may be a stale Unity lockfile",
  );
  assert.equal(fs.existsSync(nativeLockfile), true, "Unity native lockfile must not be deleted by preflight.");

  await assertRejectsWithMessage(
    () => assertUnityProjectNotBusy(projectA, { processLister: async () => ({ processes: [], warning: "scan failed" }) }),
    "running-process verification failed",
  );

  await assertRejectsWithMessage(
    () => assertUnityProjectNotBusy(projectA, {
      processLister: async () => ({ processes: [{ pid: 123, commandLine: `Unity.exe -projectPath ${projectA}` }] }),
    }),
    "a Unity process targets this project",
  );
  fs.rmSync(nativeLockfile, { force: true });

  const firstMutex = await acquireUnityProjectLaunchMutex(projectA, {
    mutexRoot,
    randomToken: () => "first-token",
    now: () => new Date("2026-04-27T00:00:00.000Z"),
    processLister: async () => ({ processes: [] }),
  });
  await assertRejectsWithMessage(
    () => acquireUnityProjectLaunchMutex(projectA, {
      mutexRoot,
      processLister: async () => ({ processes: [] }),
    }),
    "already holds the project mutex",
  );

  const secondProjectMutex = await acquireUnityProjectLaunchMutex(projectB, {
    mutexRoot,
    processLister: async () => ({ processes: [] }),
  });
  await secondProjectMutex.release();
  await firstMutex.release();
  assert.equal(fs.existsSync(firstMutex.mutexDir), false, "Released mutex should remove its directory.");

  const staleProject = createProjectRoot(tempRoot, "StaleGame");
  const staleOriginal = await acquireUnityProjectLaunchMutex(staleProject, {
    mutexRoot,
    ownerPid: 987654,
    randomToken: () => "stale-token",
    processLister: async () => ({ processes: [] }),
  });
  const staleReplacement = await acquireUnityProjectLaunchMutex(staleProject, {
    mutexRoot,
    isPidAlive: () => false,
    processLister: async () => ({ processes: [] }),
    randomToken: () => "replacement-token",
  });
  assert.equal(staleReplacement.mutexDir, staleOriginal.mutexDir);
  assert.equal(staleReplacement.metadata.ownerToken, "replacement-token");
  await staleReplacement.release();

  const staleWithNativeLock = createProjectRoot(tempRoot, "StaleWithNativeLock");
  await acquireUnityProjectLaunchMutex(staleWithNativeLock, {
    mutexRoot,
    ownerPid: 111111,
    randomToken: () => "native-stale-token",
    processLister: async () => ({ processes: [] }),
  });
  fs.writeFileSync(path.join(staleWithNativeLock, "Temp", "UnityLockfile"), "");
  await assertRejectsWithMessage(
    () => acquireUnityProjectLaunchMutex(staleWithNativeLock, {
      mutexRoot,
      isPidAlive: () => false,
      processLister: async () => ({ processes: [] }),
    }),
    "Unity's native project lockfile exists",
  );
  fs.rmSync(path.join(staleWithNativeLock, "Temp", "UnityLockfile"), { force: true });

  const releaseSafety = await acquireUnityProjectLaunchMutex(createProjectRoot(tempRoot, "ReleaseSafety"), {
    mutexRoot,
    randomToken: () => "release-token",
    processLister: async () => ({ processes: [] }),
  });
  const metadataPath = path.join(releaseSafety.mutexDir, "metadata.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  fs.writeFileSync(metadataPath, `${JSON.stringify({ ...metadata, ownerToken: "other-token" }, null, 2)}\n`);
  await releaseSafety.release();
  assert.equal(fs.existsSync(releaseSafety.mutexDir), true, "Mismatched owner token must not remove a newer mutex.");
  fs.rmSync(releaseSafety.mutexDir, { recursive: true, force: true });

  const throwProject = createProjectRoot(tempRoot, "ThrowGame");
  await assertRejectsWithMessage(
    () => withUnityProjectLaunchMutex(
      throwProject,
      { mutexRoot, processLister: async () => ({ processes: [] }) },
      async () => {
        throw new Error("callback failed");
      },
    ),
    "callback failed",
  );
  const reacquiredAfterThrow = await acquireUnityProjectLaunchMutex(throwProject, {
    mutexRoot,
    processLister: async () => ({ processes: [] }),
  });
  await reacquiredAfterThrow.release();

  const normalizedRoot = await __unityProjectLockInternals.canonicalizeUnityProjectRoot(`${projectA}${path.sep}`);
  assert.equal(normalizedRoot, await __unityProjectLockInternals.canonicalizeUnityProjectRoot(projectA));

  console.log("pi-unity unity-project-lock tests passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
