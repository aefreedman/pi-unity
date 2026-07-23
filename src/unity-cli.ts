import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyDefaultUnityBatchmodeArgs, buildUnityBatchmodeArgs, projectPathsMatch } from "./unity-core";
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
  useGraphics?: boolean;
};

export type UnityCliPipelineInstance = {
  projectPath: string;
  pid: number | null;
  port?: number;
  unityVersion?: string;
  pipelineVersion?: string;
  state?: string;
  reachable?: boolean;
};

export type UnityCliProjectCapabilities = {
  cliAvailable: boolean;
  cliVersion?: string;
  projectSupportsPipeline: boolean;
  pipelinePackageDeclared: boolean;
  pipelinePackageVersion?: string;
  matchingInstances: UnityCliPipelineInstance[];
  advertisedCommands: string[];
  advertisedCommandCount: number;
  advertisedCommandsTruncated: boolean;
  commandDiscoveryAttempted: boolean;
  commandDiscoverySucceeded: boolean;
  latestPipelineVersion?: string;
  warnings: string[];
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
  const forwardedArgs = normalizeUnityCliForwardedArgs(applyDefaultUnityBatchmodeArgs(extraEditorArgs, { useGraphics: options.useGraphics }));
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

export function createUnityCliBatchmodeReportArgs(projectRoot: string, extraEditorArgs: string[] = [], options: { useGraphics?: boolean } = {}): string[] {
  return buildUnityBatchmodeArgs(projectRoot, extraEditorArgs, options);
}

export function createUnityCliEditorExitCommand(
  projectRoot: string,
  options: { cliCommand?: string; timeoutSeconds?: number } = {},
): UnityCliCommand {
  return {
    command: resolveUnityCliCommand(options),
    args: [
      ...unityCliBaseArgs(),
      "command",
      "--project-path",
      projectRoot,
      "--timeout",
      String(options.timeoutSeconds ?? 5),
      "eval",
      "UnityEditor.EditorApplication.Exit(0); return true;",
    ],
  };
}

function execFileCollect(command: string, args: string[], options: { timeout?: number; signal?: AbortSignal } = {}): Promise<ExecFileResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: options.timeout ?? 5000, signal: options.signal, windowsHide: true }, (error, stdout, stderr) => {
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

function instanceProjectPaths(instance: Record<string, unknown>): string[] {
  return [
    instance.projectPath,
    instance.project,
    instance.path,
    instance.projectRoot,
    instance.projectDirectory,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function parseUnityCliStatusOutput(output: string, projectRoot: string): RunningUnityProcess[] {
  const payload = parseJsonObject(output);
  const data = getRecord(payload?.data);
  const rawInstances = Array.isArray(data?.instances) ? data.instances : [];

  return rawInstances
    .map((entry) => {
      const instance = getRecord(entry);
      if (!instance) return null;
      const projectPath = instanceProjectPaths(instance).find((candidate) => projectPathsMatch(candidate, projectRoot));
      if (!projectPath) return null;
      const pid = instancePid(instance);
      const port = instance.port ?? instance.editorPort ?? instance.hostPort;
      return {
        pid,
        commandLine: `Unity CLI status${port !== undefined ? ` port=${String(port)}` : ""}: ${projectPath}`,
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

function optionalString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function optionalBoolean(...values: unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === "boolean");
}

export function summarizeUnityCliText(value: string, maxChars = 1000, maxLines = 10): string {
  const lines = value.trim().split(/\r?\n/).slice(0, maxLines);
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export function parseUnityCliPipelineListOutput(output: string, projectRoot: string): { instances: UnityCliPipelineInstance[]; latestVersion?: string } {
  const payload = parseJsonObject(output);
  const data = getRecord(payload?.data);
  const rawInstances = Array.isArray(data?.instances) ? data.instances : [];
  const instances = rawInstances.flatMap((entry): UnityCliPipelineInstance[] => {
    const instance = getRecord(entry);
    if (!instance) return [];
    const projectPath = instanceProjectPaths(instance).find((candidate) => projectPathsMatch(candidate, projectRoot));
    if (!projectPath) return [];
    const pipelineServer = getRecord(instance.pipelineServer);
    let port = getNumber(instance.port ?? instance.editorPort ?? instance.hostPort) ?? undefined;
    const apiUrl = optionalString(pipelineServer?.apiUrl);
    if (port === undefined && apiUrl) {
      try {
        const parsedPort = Number.parseInt(new URL(apiUrl).port, 10);
        if (Number.isFinite(parsedPort)) port = parsedPort;
      } catch {
        // Keep port unknown when the CLI reports a malformed endpoint.
      }
    }
    const isRunning = optionalBoolean(instance.isRunning);
    return [{
      projectPath,
      pid: instancePid(instance),
      port,
      unityVersion: optionalString(instance.unityVersion, instance.editorVersion, instance.version),
      pipelineVersion: optionalString(instance.pipelineVersion, instance.packageVersion, instance.pipelinePackageVersion),
      state: optionalString(instance.state, instance.status) ?? (isRunning === undefined ? undefined : isRunning ? "running" : "stopped"),
      reachable: optionalBoolean(instance.reachable, instance.serverReachable, instance.isReachable, pipelineServer?.isReachable),
    }];
  });
  return { instances, latestVersion: optionalString(data?.latestVersion) };
}

type UnityCliCommandCatalog = {
  valid: boolean;
  commands: string[];
  total: number;
  truncated: boolean;
};

function parseUnityCliCommandCatalog(output: string): UnityCliCommandCatalog {
  const payload = parseJsonObject(output);
  const data = getRecord(payload?.data);
  const candidates: unknown[] = [];
  let valid = false;
  if (Array.isArray(payload?.data)) {
    valid = true;
    candidates.push(...payload.data);
  }
  for (const key of ["commands", "tools", "items"]) {
    const value = data?.[key];
    if (Array.isArray(value)) {
      valid = true;
      candidates.push(...value);
    }
  }
  const names = candidates.flatMap((entry): string[] => {
    const rawName = typeof entry === "string"
      ? entry
      : optionalString(getRecord(entry)?.name, getRecord(entry)?.command, getRecord(entry)?.id);
    if (!rawName) return [];
    const name = rawName.trim();
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) return [];
    return [name];
  });
  const unique = [...new Set(names)].sort((left, right) => left.localeCompare(right));
  return {
    valid: Boolean(payload?.success === true && valid),
    commands: unique.slice(0, 256),
    total: unique.length,
    truncated: unique.length > 256 || names.length < candidates.length,
  };
}

export function parseUnityCliCommandListOutput(output: string): string[] {
  const catalog = parseUnityCliCommandCatalog(output);
  return catalog.valid ? catalog.commands : [];
}

export function haveSameKnownProcessIds(
  initial: Array<{ pid?: number | null }>,
  refreshed: Array<{ pid?: number | null }>,
): boolean {
  const initialPids = initial.flatMap((item) => item.pid ?? []).sort((left, right) => left - right);
  const refreshedPids = refreshed.flatMap((item) => item.pid ?? []).sort((left, right) => left - right);
  return initialPids.length === initial.length
    && refreshedPids.length === refreshed.length
    && initialPids.length > 0
    && initialPids.join(",") === refreshedPids.join(",");
}

function parseUnityMajorVersion(unityVersion: string): number | null {
  const match = unityVersion.trim().match(/^(\d+)/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : null;
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return getRecord(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

export async function readDeclaredUnityPipelineVersion(projectRoot: string): Promise<string | undefined> {
  const lock = await readJsonFile(join(projectRoot, "Packages", "packages-lock.json"));
  const lockDependencies = getRecord(lock?.dependencies);
  const lockedPipeline = getRecord(lockDependencies?.["com.unity.pipeline"]);
  const lockedVersion = optionalString(lockedPipeline?.version);
  if (lockedVersion) return lockedVersion;

  const manifest = await readJsonFile(join(projectRoot, "Packages", "manifest.json"));
  const manifestDependencies = getRecord(manifest?.dependencies);
  return optionalString(manifestDependencies?.["com.unity.pipeline"]);
}

function cliFailureMessage(result: ExecFileResult): string | undefined {
  const payload = parseJsonObject(result.stdout);
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const messages = errors.flatMap((entry): string[] => {
    const message = optionalString(getRecord(entry)?.message);
    return message ? [message] : [];
  });
  const message = messages[0] ?? (result.stderr.trim() || result.error?.message);
  return message ? summarizeUnityCliText(message) : undefined;
}

export async function inspectUnityCliProjectCapabilities(
  projectRoot: string,
  unityVersion: string,
  options: { cliCommand?: string; timeout?: number; signal?: AbortSignal } = {},
): Promise<UnityCliProjectCapabilities> {
  const pipelinePackageVersion = await readDeclaredUnityPipelineVersion(projectRoot);
  const projectMajor = parseUnityMajorVersion(unityVersion);
  const result: UnityCliProjectCapabilities = {
    cliAvailable: false,
    projectSupportsPipeline: projectMajor !== null && projectMajor >= 6000,
    pipelinePackageDeclared: Boolean(pipelinePackageVersion),
    pipelinePackageVersion,
    matchingInstances: [],
    advertisedCommands: [],
    advertisedCommandCount: 0,
    advertisedCommandsTruncated: false,
    commandDiscoveryAttempted: false,
    commandDiscoverySucceeded: false,
    warnings: [],
  };
  const command = resolveUnityCliCommand(options);
  const timeout = options.timeout ?? 5000;
  const versionResult = await execFileCollect(command, ["--version"], { timeout, signal: options.signal });
  if (versionResult.error && (versionResult.error as NodeJS.ErrnoException).code === "ENOENT") return result;
  if (versionResult.error) {
    result.warnings.push(`Unity CLI version probe failed: ${cliFailureMessage(versionResult) ?? "unknown error"}`);
    return result;
  }
  result.cliAvailable = true;
  result.cliVersion = summarizeUnityCliText(versionResult.stdout, 200, 1) || undefined;

  const pipelineResult = await execFileCollect(command, ["--format", "json", "--no-banner", "--non-interactive", "pipeline", "list"], { timeout, signal: options.signal });
  const pipelinePayload = parseJsonObject(pipelineResult.stdout);
  const pipelineData = getRecord(pipelinePayload?.data);
  if (pipelineResult.error || pipelinePayload?.success !== true || !Array.isArray(pipelineData?.instances)) {
    result.warnings.push(`Unity Pipeline instance discovery failed: ${cliFailureMessage(pipelineResult) ?? "malformed or unsupported JSON response"}`);
    return result;
  }
  const pipeline = parseUnityCliPipelineListOutput(pipelineResult.stdout, projectRoot);
  result.matchingInstances = pipeline.instances;
  result.latestPipelineVersion = pipeline.latestVersion;
  if (pipeline.instances.length === 0) return result;
  if (pipeline.instances.every((instance) => instance.reachable === false)) {
    result.warnings.push("The exact project copy has Pipeline metadata, but every matching instance is explicitly unreachable.");
    return result;
  }

  result.commandDiscoveryAttempted = true;
  const listResult = await execFileCollect(command, ["--format", "json", "--no-banner", "--non-interactive", "list", "--project-path", projectRoot], { timeout, signal: options.signal });
  const catalog = parseUnityCliCommandCatalog(listResult.stdout);
  if (listResult.error || !catalog.valid) {
    result.warnings.push(`Unity Pipeline command discovery failed for the exact project copy: ${cliFailureMessage(listResult) ?? "malformed or unsupported JSON response"}`);
    return result;
  }
  result.advertisedCommands = catalog.commands;
  result.advertisedCommandCount = catalog.total;
  result.advertisedCommandsTruncated = catalog.truncated;
  result.commandDiscoverySucceeded = true;
  return result;
}
