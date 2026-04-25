import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commandTargetsProject, type SupportedPlatform } from "./unity-core";

const execFileAsync = promisify(execFile);

export type RunningUnityProcess = {
  pid: number | null;
  commandLine: string;
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
      return { pid, commandLine } satisfies RunningUnityProcess;
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
      const looksLikeUnity = /(^|[\/\s])Unity(?:\.app\/Contents\/MacOS\/Unity)?(\s|$)/.test(commandLine);
      if (!commandLine || !looksLikeUnity || !commandTargetsProject(commandLine, projectRoot, platform)) {
        return null;
      }
      return {
        pid: Number.isFinite(pid) ? pid : null,
        commandLine,
      } satisfies RunningUnityProcess;
    })
    .filter((entry): entry is RunningUnityProcess => entry !== null);
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
