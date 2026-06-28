import { execFile } from "node:child_process";
import { buildUnityBatchmodeArgs, commandTargetsProject } from "./unity-core";
import type { RunningUnityProcess } from "./unity-processes";

export const DEFAULT_UNITY_CLI_COMMAND = "unity";

export type UnityCliCommand = {
  command: string;
  args: string[];
};

export type UnityCliLaunchOptions = {
  editorVersion?: string;
  editorPath?: string;
  timeoutSeconds?: number;
  cliCommand?: string;
};

type ExecFileResult = {
  stdout: string;
  stderr: string;
  error?: Error & { code?: string | number; signal?: string | null };
};

export function resolveUnityCliCommand(options?: { cliCommand?: string; env?: NodeJS.ProcessEnv }): string {
  return options?.cliCommand?.trim() || options?.env?.UNITY_CLI_PATH?.trim() || process.env.UNITY_CLI_PATH?.trim() || DEFAULT_UNITY_CLI_COMMAND;
}

function unityCliBaseArgs(): string[] {
  return ["--no-banner", "--non-interactive"];
}

function appendUnityCliEditorOptions(args: string[], options: UnityCliLaunchOptions): void {
  if (options.editorVersion?.trim()) {
    args.push("--editor-version", options.editorVersion.trim());
  }
  if (options.editorPath?.trim()) {
    args.push("--editor-path", options.editorPath.trim());
  }
}

export function createUnityCliOpenCommand(projectRoot: string, options: UnityCliLaunchOptions = {}): UnityCliCommand {
  const args = [...unityCliBaseArgs(), "open", projectRoot];
  appendUnityCliEditorOptions(args, options);
  return {
    command: resolveUnityCliCommand(options),
    args,
  };
}

const UNITY_CLI_MANAGED_EDITOR_FLAGS_WITH_VALUES = new Set(["-projectpath"]);
const UNITY_CLI_MANAGED_EDITOR_FLAGS = new Set(["-batchmode", "-quit"]);

export function normalizeUnityCliForwardedArgs(extraEditorArgs: string[] = []): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < extraEditorArgs.length; index += 1) {
    const arg = extraEditorArgs[index];
    const lower = arg.toLowerCase();
    const equalsIndex = lower.indexOf("=");
    const flagName = equalsIndex >= 0 ? lower.slice(0, equalsIndex) : lower;

    if (UNITY_CLI_MANAGED_EDITOR_FLAGS.has(flagName)) {
      continue;
    }

    if (UNITY_CLI_MANAGED_EDITOR_FLAGS_WITH_VALUES.has(flagName)) {
      if (equalsIndex < 0) {
        index += 1;
      }
      continue;
    }

    normalized.push(arg);
  }
  return normalized;
}

export function createUnityCliRunCommand(projectRoot: string, extraEditorArgs: string[] = [], options: UnityCliLaunchOptions = {}): UnityCliCommand {
  const args = [...unityCliBaseArgs(), "run", projectRoot];
  const forwardedArgs = normalizeUnityCliForwardedArgs(extraEditorArgs);
  appendUnityCliEditorOptions(args, options);
  if (options.timeoutSeconds !== undefined) {
    args.push("--timeout", String(options.timeoutSeconds));
  }
  if (forwardedArgs.length > 0) {
    args.push("--", ...forwardedArgs);
  }
  return {
    command: resolveUnityCliCommand(options),
    args,
  };
}

export function createUnityCliBatchmodeReportArgs(projectRoot: string, extraEditorArgs: string[] = []): string[] {
  return buildUnityBatchmodeArgs(projectRoot, extraEditorArgs);
}

export function createUnityCliEditorExitCommand(
  projectRoot: string,
  options: { cliCommand?: string; timeoutSeconds?: number } = {},
): UnityCliCommand {
  return {
    command: resolveUnityCliCommand(options),
    args: [
      ...unityCliBaseArgs(),
      "eval",
      "--project-path",
      projectRoot,
      "--timeout",
      String(options.timeoutSeconds ?? 5),
      "UnityEditor.EditorApplication.Exit(0);",
    ],
  };
}

function execFileCollect(command: string, args: string[], options: { timeout?: number } = {}): Promise<ExecFileResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: options.timeout ?? 5000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        stdout: typeof stdout === "string" ? stdout : stdout.toString(),
        stderr: typeof stderr === "string" ? stderr : stderr.toString(),
        error: error as ExecFileResult["error"],
      });
    });
  });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function instancePid(instance: Record<string, unknown>): number | null {
  return getNumber(instance.pid) ?? getNumber(instance.PID) ?? getNumber(instance.processId) ?? getNumber(instance.processID);
}

function instanceProjectText(instance: Record<string, unknown>): string {
  const direct = [
    instance.projectPath,
    instance.project,
    instance.path,
    instance.projectRoot,
    instance.projectDirectory,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof direct === "string" ? direct : JSON.stringify(instance);
}

export function parseUnityCliStatusOutput(output: string, projectRoot: string): RunningUnityProcess[] {
  const payload = parseJsonObject(output);
  const data = getRecord(payload?.data);
  const rawInstances = Array.isArray(data?.instances) ? data.instances : [];

  return rawInstances
    .map((entry) => {
      const instance = getRecord(entry);
      if (!instance) return null;
      const projectText = instanceProjectText(instance);
      if (!commandTargetsProject(projectText, projectRoot)) return null;
      const pid = instancePid(instance);
      const port = instance.port ?? instance.editorPort ?? instance.hostPort;
      return {
        pid,
        commandLine: `Unity CLI status${port !== undefined ? ` port=${String(port)}` : ""}: ${projectText}`,
      } satisfies RunningUnityProcess;
    })
    .filter((entry): entry is RunningUnityProcess => entry !== null);
}

export async function listRunningUnityCliEditorsForProject(
  projectRoot: string,
  options: { cliCommand?: string; timeout?: number } = {},
): Promise<{ processes: RunningUnityProcess[]; warning?: string }> {
  const command = resolveUnityCliCommand(options);
  const result = await execFileCollect(command, ["--format", "json", "--no-banner", "--non-interactive", "status", "--project", projectRoot], {
    timeout: options.timeout ?? 5000,
  });

  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { processes: [] };
  }

  const processes = parseUnityCliStatusOutput(result.stdout, projectRoot);
  if (processes.length > 0) {
    return { processes };
  }

  const payload = parseJsonObject(result.stdout);
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const onlyNoInstances = errors.some((entry) => getRecord(entry)?.code === "STATUS_NO_INSTANCES");
  if (result.error && !onlyNoInstances) {
    const message = result.stderr.trim() || result.error.message;
    return { processes: [], warning: `Unity CLI status check failed; falling back to process scan: ${message}` };
  }

  return { processes: [] };
}
