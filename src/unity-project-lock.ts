import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type SupportedPlatform } from "./unity-core";
import { listRunningUnityProcessesForProject, type RunningUnityProcess } from "./unity-processes";

type ProcessListResult = { processes: RunningUnityProcess[]; warning?: string };
type UnityProcessLister = (projectRoot: string) => Promise<ProcessListResult>;
type PidAliveCheck = (pid: number) => boolean;

export type UnityProjectBusyState = {
  projectRoot: string;
  canonicalProjectRoot: string;
  nativeLockfilePath: string;
  nativeLockfileExists: boolean;
};

export type UnityProjectLaunchMutexMetadata = {
  projectRoot: string;
  canonicalProjectRoot: string;
  ownerPid: number;
  ownerToken: string;
  createdAt: string;
  mode: "batchmode" | "gui";
  toolName: string;
};

export type UnityProjectLaunchMutex = {
  mutexDir: string;
  metadata: UnityProjectLaunchMutexMetadata;
  release: () => Promise<void>;
};

export type UnityProjectBusyOptions = {
  platform?: SupportedPlatform;
  processLister?: UnityProcessLister;
};

export type UnityProjectLaunchMutexOptions = UnityProjectBusyOptions & {
  mode?: "batchmode" | "gui";
  toolName?: string;
  mutexRoot?: string;
  now?: () => Date;
  randomToken?: () => string;
  ownerPid?: number;
  isPidAlive?: PidAliveCheck;
};

const METADATA_FILE = "metadata.json";

function defaultMutexRoot(): string {
  return path.join(os.tmpdir(), "pi-unity-project-locks");
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getUnityNativeLockfilePath(projectRoot: string): string {
  return path.join(projectRoot, "Temp", "UnityLockfile");
}

export async function canonicalizeUnityProjectRoot(
  projectRoot: string,
  platform: SupportedPlatform = process.platform,
): Promise<string> {
  const absoluteProjectRoot = path.resolve(projectRoot);
  let realProjectRoot: string;
  try {
    realProjectRoot = await fs.realpath(absoluteProjectRoot);
  } catch {
    realProjectRoot = absoluteProjectRoot;
  }

  const normalized = path.normalize(realProjectRoot);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function getUnityProjectMutexDir(canonicalProjectRoot: string, mutexRoot: string = defaultMutexRoot()): string {
  const hash = crypto.createHash("sha256").update(canonicalProjectRoot).digest("hex").slice(0, 32);
  return path.join(mutexRoot, hash);
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, "ESRCH")) {
      return false;
    }
    return true;
  }
}

function buildProcessSummary(processes: RunningUnityProcess[]): string {
  return processes
    .map((process) => `${process.pid ?? "?"}: ${process.commandLine}`)
    .join("\n");
}

async function listProcessesSafely(processLister: UnityProcessLister, projectRoot: string): Promise<ProcessListResult> {
  try {
    return await processLister(projectRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
    return { processes: [], warning: `Could not verify whether Unity is already running for this project: ${message}` };
  }
}

export async function inspectUnityProjectBusyState(
  projectRoot: string,
  options: UnityProjectBusyOptions = {},
): Promise<UnityProjectBusyState> {
  const canonicalProjectRoot = await canonicalizeUnityProjectRoot(projectRoot, options.platform);
  const nativeLockfilePath = getUnityNativeLockfilePath(projectRoot);
  const nativeLockfileExists = await pathExists(nativeLockfilePath);
  return {
    projectRoot,
    canonicalProjectRoot,
    nativeLockfilePath,
    nativeLockfileExists,
  };
}

export async function assertUnityProjectNotBusy(
  projectRoot: string,
  options: UnityProjectBusyOptions = {},
): Promise<UnityProjectBusyState> {
  const state = await inspectUnityProjectBusyState(projectRoot, options);
  if (!state.nativeLockfileExists) {
    return state;
  }

  const processLister = options.processLister ?? listRunningUnityProcessesForProject;
  const running = await listProcessesSafely(processLister, projectRoot);
  if (running.warning) {
    throw new Error(
      [
        `Refusing to launch Unity for ${projectRoot} because Unity's native project lockfile exists and running-process verification failed.`,
        `Unity lockfile: ${state.nativeLockfilePath}`,
        running.warning,
        "Inspect the project manually before removing the lockfile or retrying.",
      ].join("\n"),
    );
  }

  if (running.processes.length > 0) {
    throw new Error(
      [
        `Refusing to launch Unity for ${projectRoot} because Unity's native project lockfile exists and a Unity process targets this project.`,
        `Unity lockfile: ${state.nativeLockfilePath}`,
        buildProcessSummary(running.processes),
      ].join("\n"),
    );
  }

  throw new Error(
    [
      `Refusing to launch Unity for ${projectRoot} because Unity's native project lockfile exists.`,
      `Unity lockfile: ${state.nativeLockfilePath}`,
      "No running Unity process targeting this project was detected; this may be a stale Unity lockfile.",
      "Remove the lockfile manually only after confirming no Unity process is using this project.",
    ].join("\n"),
  );
}

function metadataPath(mutexDir: string): string {
  return path.join(mutexDir, METADATA_FILE);
}

function parseMutexMetadata(raw: string): UnityProjectLaunchMutexMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.projectRoot !== "string" ||
    typeof record.canonicalProjectRoot !== "string" ||
    typeof record.ownerPid !== "number" ||
    typeof record.ownerToken !== "string" ||
    typeof record.createdAt !== "string" ||
    (record.mode !== "batchmode" && record.mode !== "gui") ||
    typeof record.toolName !== "string"
  ) {
    return null;
  }

  return record as UnityProjectLaunchMutexMetadata;
}

async function readMutexMetadata(mutexDir: string): Promise<UnityProjectLaunchMutexMetadata | null> {
  try {
    const raw = await fs.readFile(metadataPath(mutexDir), "utf8");
    return parseMutexMetadata(raw);
  } catch {
    return null;
  }
}

function buildMutexConflictMessage(projectRoot: string, metadata: UnityProjectLaunchMutexMetadata, mutexDir: string): string {
  return [
    `Refusing to launch Unity for ${projectRoot} because another Pi Unity launch already holds the project mutex.`,
    `Mutex: ${mutexDir}`,
    `Owner pid: ${metadata.ownerPid}`,
    `Owner tool: ${metadata.toolName}`,
    `Owner mode: ${metadata.mode}`,
    `Created at: ${metadata.createdAt}`,
  ].join("\n");
}

async function clearStaleMutexOrThrow(
  projectRoot: string,
  mutexDir: string,
  metadata: UnityProjectLaunchMutexMetadata,
  options: UnityProjectLaunchMutexOptions,
): Promise<void> {
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  if (isPidAlive(metadata.ownerPid)) {
    throw new Error(buildMutexConflictMessage(projectRoot, metadata, mutexDir));
  }

  const busyState = await inspectUnityProjectBusyState(projectRoot, options);
  if (busyState.nativeLockfileExists) {
    throw new Error(
      [
        `Refusing to clear a stale Pi Unity launch mutex for ${projectRoot} because Unity's native project lockfile exists.`,
        `Mutex: ${mutexDir}`,
        `Unity lockfile: ${busyState.nativeLockfilePath}`,
        "Inspect the project manually before retrying.",
      ].join("\n"),
    );
  }

  const processLister = options.processLister ?? listRunningUnityProcessesForProject;
  const running = await listProcessesSafely(processLister, projectRoot);
  if (running.warning) {
    throw new Error(
      [
        `Refusing to clear a stale Pi Unity launch mutex for ${projectRoot} because running-process verification failed.`,
        `Mutex: ${mutexDir}`,
        running.warning,
      ].join("\n"),
    );
  }

  if (running.processes.length > 0) {
    throw new Error(
      [
        `Refusing to clear a stale Pi Unity launch mutex for ${projectRoot} because a Unity process still targets this project.`,
        `Mutex: ${mutexDir}`,
        buildProcessSummary(running.processes),
      ].join("\n"),
    );
  }

  await fs.rm(mutexDir, { recursive: true, force: true });
}

export async function releaseUnityProjectLaunchMutex(mutexDir: string, ownerToken: string): Promise<void> {
  const metadata = await readMutexMetadata(mutexDir);
  if (!metadata || metadata.ownerToken !== ownerToken) {
    return;
  }

  await fs.rm(mutexDir, { recursive: true, force: true });
}

export async function acquireUnityProjectLaunchMutex(
  projectRoot: string,
  options: UnityProjectLaunchMutexOptions = {},
): Promise<UnityProjectLaunchMutex> {
  const canonicalProjectRoot = await canonicalizeUnityProjectRoot(projectRoot, options.platform);
  const mutexRoot = options.mutexRoot ?? defaultMutexRoot();
  const mutexDir = getUnityProjectMutexDir(canonicalProjectRoot, mutexRoot);
  await fs.mkdir(mutexRoot, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.mkdir(mutexDir);
      const metadata: UnityProjectLaunchMutexMetadata = {
        projectRoot,
        canonicalProjectRoot,
        ownerPid: options.ownerPid ?? process.pid,
        ownerToken: options.randomToken?.() ?? crypto.randomUUID(),
        createdAt: (options.now?.() ?? new Date()).toISOString(),
        mode: options.mode ?? "batchmode",
        toolName: options.toolName ?? "unity_launch_batchmode",
      };

      try {
        await fs.writeFile(metadataPath(mutexDir), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      } catch (error) {
        await fs.rm(mutexDir, { recursive: true, force: true });
        throw error;
      }

      return {
        mutexDir,
        metadata,
        release: () => releaseUnityProjectLaunchMutex(mutexDir, metadata.ownerToken),
      };
    } catch (error) {
      if (!isNodeErrorWithCode(error, "EEXIST")) {
        throw error;
      }

      const metadata = await readMutexMetadata(mutexDir);
      if (!metadata) {
        throw new Error(
          [
            `Refusing to launch Unity for ${projectRoot} because a Pi Unity launch mutex exists but its metadata could not be read.`,
            `Mutex: ${mutexDir}`,
            "Inspect the mutex manually before removing it or retrying.",
          ].join("\n"),
        );
      }

      await clearStaleMutexOrThrow(projectRoot, mutexDir, metadata, options);
    }
  }

  throw new Error(`Refusing to launch Unity for ${projectRoot} because the Pi Unity launch mutex could not be acquired.`);
}

export async function withUnityProjectLaunchMutex<T>(
  projectRoot: string,
  options: UnityProjectLaunchMutexOptions,
  callback: () => Promise<T>,
): Promise<T> {
  const mutex = await acquireUnityProjectLaunchMutex(projectRoot, options);
  try {
    return await callback();
  } finally {
    await mutex.release();
  }
}

export const __unityProjectLockInternals = {
  canonicalizeUnityProjectRoot,
  getUnityNativeLockfilePath,
  getUnityProjectMutexDir,
  defaultIsPidAlive,
};
