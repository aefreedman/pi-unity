import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commandTargetsProject, type SupportedPlatform } from "./unity-core";

const execFileAsync = promisify(execFile);

export type RunningUnityProcess = {
  pid: number | null;
  commandLine: string;
};

export type UnityProcessTerminationInfo = {
  forced?: boolean;
};

const SENSITIVE_FLAG = "(?:-{1,2})?(?:access[-_]?token|auth(?:entication)?[-_]?token|api[-_]?key|client[-_]?secret|credential(?:s)?|password|passwd|secret|token)";
const SENSITIVE_VALUE = "(?:\"[^\"]*\"|'[^']*'|[^\\s]+)";
const SENSITIVE_ASSIGNMENT = new RegExp(`(${SENSITIVE_FLAG})(=|:)${SENSITIVE_VALUE}`, "gi");
const SENSITIVE_SEPARATE_ARGUMENT = new RegExp(`(${SENSITIVE_FLAG})\\s+${SENSITIVE_VALUE}`, "gi");

/** Redact values, not flag names, so diagnostics remain actionable without leaking credentials. */
export function redactUnityProcessCommandLine(commandLine: string): string {
  return commandLine
    .replace(SENSITIVE_ASSIGNMENT, "$1$2[REDACTED]")
    .replace(SENSITIVE_SEPARATE_ARGUMENT, "$1 [REDACTED]");
}

export type UnityProcessTerminator = (process: RunningUnityProcess) => Promise<void | UnityProcessTerminationInfo>;
export type UnityProcessIdentityVerifier = (process: RunningUnityProcess) => Promise<boolean>;

export type TerminateUnityProcessesResult = {
  terminated: RunningUnityProcess[];
  forceTerminated: RunningUnityProcess[];
  skipped: RunningUnityProcess[];
};

export function parseWindowsUnityProcessList(output: string, projectRoot: string): RunningUnityProcess[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const commandLine = typeof record.CommandLine === "string" ? record.CommandLine : "";
      const pid = typeof record.ProcessId === "number" ? record.ProcessId : null;
      if (!commandLine || !commandTargetsProject(commandLine, projectRoot, "win32")) {
        return null;
      }
      return { pid, commandLine: redactUnityProcessCommandLine(commandLine) } satisfies RunningUnityProcess;
    })
    .filter((entry): entry is RunningUnityProcess => entry !== null);
}

export function parsePosixUnityProcessList(output: string, projectRoot: string, platform: SupportedPlatform = process.platform): RunningUnityProcess[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      const pid = Number.parseInt(match[1], 10);
      const commandLine = match[2] ?? "";
      const looksLikeUnity = /(^|[\/\s"'])Unity(?:\.app\/Contents\/MacOS\/Unity)?(?=$|[\s"'])/.test(commandLine);
      if (!commandLine || !looksLikeUnity || !commandTargetsProject(commandLine, projectRoot, platform)) {
        return null;
      }
      return {
        pid: Number.isFinite(pid) ? pid : null,
        commandLine: redactUnityProcessCommandLine(commandLine),
      } satisfies RunningUnityProcess;
    })
    .filter((entry): entry is RunningUnityProcess => entry !== null);
}

export function dedupeRunningUnityProcesses(processes: RunningUnityProcess[]): RunningUnityProcess[] {
  const seenPids = new Set<number>();
  const seenCommandLines = new Set<string>();
  const unique: RunningUnityProcess[] = [];

  for (const runningProcess of processes) {
    if (typeof runningProcess.pid === "number" && Number.isInteger(runningProcess.pid) && runningProcess.pid > 0) {
      if (seenPids.has(runningProcess.pid)) continue;
      seenPids.add(runningProcess.pid);
      unique.push(runningProcess);
      continue;
    }

    if (seenCommandLines.has(runningProcess.commandLine)) continue;
    seenCommandLines.add(runningProcess.commandLine);
    unique.push(runningProcess);
  }

  return unique;
}

function getErrorText(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error ?? "");
  }

  const record = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  return [record.stdout, record.stderr, record.message]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

export function shouldRetryWindowsTaskkillWithForce(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return text.includes("/f") && (
    text.includes("forcefully") ||
    text.includes("terminated forcefully") ||
    text.includes("child process") ||
    text.includes("child processes")
  );
}

export async function defaultUnityProcessTerminator(
  runningProcess: RunningUnityProcess,
  platform: SupportedPlatform = process.platform,
): Promise<UnityProcessTerminationInfo> {
  if (typeof runningProcess.pid !== "number" || !Number.isInteger(runningProcess.pid) || runningProcess.pid <= 0) {
    throw new Error(`Cannot close Unity process because no valid PID was reported: ${redactUnityProcessCommandLine(runningProcess.commandLine)}`);
  }

  if (platform === "win32") {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(runningProcess.pid), "/T"], { timeout: 5000, windowsHide: true });
      return { forced: false };
    } catch (error) {
      if (!shouldRetryWindowsTaskkillWithForce(error)) {
        throw error;
      }
      await execFileAsync("taskkill.exe", ["/PID", String(runningProcess.pid), "/T", "/F"], { timeout: 5000, windowsHide: true });
      return { forced: true };
    }
  }

  process.kill(runningProcess.pid, "SIGTERM");
  return { forced: false };
}

export function unityProcessIdentityMatchesCandidates(
  runningProcess: RunningUnityProcess,
  candidates: RunningUnityProcess[],
): boolean {
  return candidates.some((candidate) => candidate.pid === runningProcess.pid
    && (runningProcess.commandLine.startsWith("Unity CLI status") || candidate.commandLine === runningProcess.commandLine));
}

export async function verifyUnityProcessIdentity(
  runningProcess: RunningUnityProcess,
  projectRoot: string,
  platform: SupportedPlatform = process.platform,
): Promise<boolean> {
  if (typeof runningProcess.pid !== "number" || !Number.isInteger(runningProcess.pid) || runningProcess.pid <= 0) {
    return false;
  }

  try {
    if (platform === "win32") {
      const script = [
        "$ErrorActionPreference='Stop';",
        `Get-CimInstance Win32_Process -Filter \"ProcessId = ${runningProcess.pid}\"`,
        "| Select-Object ProcessId, CommandLine",
        "| ConvertTo-Json -Compress",
      ].join(" ");
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 5000, windowsHide: true });
      return unityProcessIdentityMatchesCandidates(
        runningProcess,
        parseWindowsUnityProcessList(stdout, projectRoot),
      );
    }

    const { stdout } = await execFileAsync("ps", ["-p", String(runningProcess.pid), "-o", "pid=,command="], { timeout: 5000 });
    return unityProcessIdentityMatchesCandidates(
      runningProcess,
      parsePosixUnityProcessList(stdout, projectRoot, platform),
    );
  } catch {
    return false;
  }
}

export async function terminateRunningUnityProcesses(
  processes: RunningUnityProcess[],
  options: {
    terminator?: UnityProcessTerminator;
    identityVerifier?: UnityProcessIdentityVerifier;
    onTerminated?: (runningProcess: RunningUnityProcess, info: UnityProcessTerminationInfo) => void;
    signal?: AbortSignal;
  } = {},
): Promise<TerminateUnityProcessesResult> {
  const terminator = options.terminator ?? defaultUnityProcessTerminator;
  const terminated: RunningUnityProcess[] = [];
  const forceTerminated: RunningUnityProcess[] = [];
  const skipped: RunningUnityProcess[] = [];

  for (const runningProcess of dedupeRunningUnityProcesses(processes)) {
    options.signal?.throwIfAborted();
    if (typeof runningProcess.pid !== "number" || !Number.isInteger(runningProcess.pid) || runningProcess.pid <= 0) {
      skipped.push(runningProcess);
      continue;
    }

    if (options.identityVerifier && !(await options.identityVerifier(runningProcess))) {
      skipped.push(runningProcess);
      continue;
    }

    options.signal?.throwIfAborted();
    const terminationInfo = await terminator(runningProcess);
    terminated.push(runningProcess);
    if (terminationInfo?.forced === true) {
      forceTerminated.push(runningProcess);
    }
    options.onTerminated?.(runningProcess, terminationInfo ?? {});
  }

  return { terminated, forceTerminated, skipped };
}

export async function listRunningUnityProcessesForProject(
  projectRoot: string,
  platform: SupportedPlatform = process.platform,
): Promise<{ processes: RunningUnityProcess[]; warning?: string }> {
  try {
    if (platform === "win32") {
      const script = [
        "$ErrorActionPreference='Stop';",
        "Get-CimInstance Win32_Process",
        "| Where-Object { $_.Name -eq 'Unity.exe' }",
        "| Select-Object ProcessId, CommandLine",
        "| ConvertTo-Json -Compress",
      ].join(" ");
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 5000, windowsHide: true });
      return { processes: parseWindowsUnityProcessList(stdout, projectRoot) };
    }

    const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,command="], { timeout: 5000 });
    return { processes: parsePosixUnityProcessList(stdout, projectRoot, platform) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
    return {
      processes: [],
      warning: `Could not verify whether Unity is already running for this project: ${message}`,
    };
  }
}
