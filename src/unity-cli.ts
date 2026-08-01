import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { applyDefaultUnityBatchmodeArgs, buildUnityBatchmodeArgs, projectPathsMatch } from "./unity-core";
import type { RunningUnityProcess } from "./unity-processes";

export const DEFAULT_UNITY_CLI_COMMAND = "unity";
export const UNITY_PIPELINE_EVAL_MAX_CHARS = 4_000;

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

export type UnityCliDiscoveryState = "not_attempted" | "available" | "absent" | "timeout" | "unavailable";

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
  /** A timeout/startup error is uncertainty, never proof that Pipeline is absent. */
  pipelineDiscovery: UnityCliDiscoveryState;
  commandDiscovery: UnityCliDiscoveryState;
  warnings: string[];
};

export type UnityCliExecResult = {
  stdout: string;
  stderr: string;
  error?: Error & { code?: string | number; signal?: string | null };
};

/** Injectable seam for deterministic capability and planning-dispatch tests. */
export type UnityCliExecutor = (command: string, args: string[], options: { timeout?: number; signal?: AbortSignal }) => Promise<UnityCliExecResult>;

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

export const UNITY_CLI_VERSION_TIMEOUT_MS = 5_000;
/** Pipeline startup/discovery may legitimately finish near five seconds; remain bounded but do not classify it as absent. */
export const UNITY_CLI_DISCOVERY_TIMEOUT_MS = 12_000;

const execFileCollect: UnityCliExecutor = (command, args, options = {}) => {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: options.timeout ?? UNITY_CLI_VERSION_TIMEOUT_MS, signal: options.signal, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        stdout: typeof stdout === "string" ? stdout : stdout.toString(),
        stderr: typeof stderr === "string" ? stderr : stderr.toString(),
        error: error as UnityCliExecResult["error"],
      });
    });
  });
};

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

export function isUnityCliTimeout(result: Pick<UnityCliExecResult, "error">): boolean {
  const error = result.error as (NodeJS.ErrnoException & { killed?: boolean }) | undefined;
  return error?.code === "ETIMEDOUT" || error?.killed === true || error?.signal === "SIGTERM";
}

function cliFailureMessage(result: UnityCliExecResult): string | undefined {
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
  options: { cliCommand?: string; timeout?: number; signal?: AbortSignal; execute?: UnityCliExecutor } = {},
): Promise<UnityCliProjectCapabilities> {
  const execute = options.execute ?? execFileCollect;
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
    pipelineDiscovery: "not_attempted",
    commandDiscovery: "not_attempted",
    warnings: [],
  };
  const command = resolveUnityCliCommand(options);
  const versionTimeout = options.timeout ?? UNITY_CLI_VERSION_TIMEOUT_MS;
  const discoveryTimeout = options.timeout ?? UNITY_CLI_DISCOVERY_TIMEOUT_MS;
  const versionResult = await execute(command, ["--version"], { timeout: versionTimeout, signal: options.signal });
  if (versionResult.error && (versionResult.error as NodeJS.ErrnoException).code === "ENOENT") return result;
  if (versionResult.error) {
    result.warnings.push(`Unity CLI version probe ${isUnityCliTimeout(versionResult) ? "timed out" : "failed"}: ${cliFailureMessage(versionResult) ?? "unknown error"}`);
    return result;
  }
  result.cliAvailable = true;
  result.cliVersion = summarizeUnityCliText(versionResult.stdout, 200, 1) || undefined;

  const pipelineResult = await execute(command, ["--format", "json", "--no-banner", "--non-interactive", "pipeline", "list"], { timeout: discoveryTimeout, signal: options.signal });
  const pipelinePayload = parseJsonObject(pipelineResult.stdout);
  const pipelineData = getRecord(pipelinePayload?.data);
  if (pipelineResult.error || pipelinePayload?.success !== true || !Array.isArray(pipelineData?.instances)) {
    result.pipelineDiscovery = isUnityCliTimeout(pipelineResult) ? "timeout" : "unavailable";
    result.warnings.push(`Unity Pipeline instance discovery ${result.pipelineDiscovery === "timeout" ? "timed out; Pipeline startup state is uncertain" : "failed"}: ${cliFailureMessage(pipelineResult) ?? "malformed or unsupported JSON response"}`);
    return result;
  }
  result.pipelineDiscovery = "available";
  const pipeline = parseUnityCliPipelineListOutput(pipelineResult.stdout, projectRoot);
  result.matchingInstances = pipeline.instances;
  result.latestPipelineVersion = pipeline.latestVersion;
  if (pipeline.instances.length === 0) {
    result.pipelineDiscovery = "absent";
    return result;
  }
  if (pipeline.instances.every((instance) => instance.reachable === false)) {
    result.warnings.push("The exact project copy has Pipeline metadata, but every matching instance is explicitly unreachable.");
    return result;
  }

  result.commandDiscoveryAttempted = true;
  const listResult = await execute(command, ["--format", "json", "--no-banner", "--non-interactive", "list", "--project-path", projectRoot], { timeout: discoveryTimeout, signal: options.signal });
  const catalog = parseUnityCliCommandCatalog(listResult.stdout);
  if (listResult.error || !catalog.valid) {
    result.commandDiscovery = isUnityCliTimeout(listResult) ? "timeout" : "unavailable";
    result.warnings.push(`Unity Pipeline command discovery for the exact project copy ${result.commandDiscovery === "timeout" ? "timed out; command availability is uncertain" : "failed"}: ${cliFailureMessage(listResult) ?? "malformed or unsupported JSON response"}`);
    return result;
  }
  result.commandDiscovery = "available";
  result.advertisedCommands = catalog.commands;
  result.advertisedCommandCount = catalog.total;
  result.advertisedCommandsTruncated = catalog.truncated;
  result.commandDiscoverySucceeded = true;
  return result;
}

/**
 * Purpose-built connected inspection commands intentionally supported by pi-unity.
 * This list is package-owned: callers cannot promote an arbitrary Pipeline command
 * to a planning read by supplying their own allow-list.
 */
export const UNITY_PLANNING_READ_COMMANDS = Object.freeze([
  "get_authoring_root",
  "get_build_settings",
  "get_player_settings",
  "get_scene_hierarchy",
  "editor_status",
  "list_open_scenes",
  "list_build_targets",
] as const);

export type UnityPlanningInspectionRequest = {
  projectRoot: string;
  unityVersion: string;
  /** Command must be advertised by the exact reachable Pipeline copy. */
  command: string;
  args?: string[];
  /** A bounded C# snippet for advertised eval. Pipeline compiles it with Roslyn on the Editor main thread. */
  evalSnippet?: string;
};

export type UnityPlanningInspectionResult =
  | { outcome: "dispatched"; command: string; output: string; truncated: boolean }
  | { outcome: "rejected"; code: string; message: string };

function planningInspectionReadiness(capabilities: UnityCliProjectCapabilities): string | undefined {
  if (!capabilities.cliAvailable) return "unity_cli_unavailable";
  if (capabilities.pipelineDiscovery !== "available") return `pipeline_${capabilities.pipelineDiscovery}`;
  if (!capabilities.commandDiscoverySucceeded || capabilities.commandDiscovery !== "available") return `commands_${capabilities.commandDiscovery}`;
  if (!capabilities.matchingInstances.some((instance) => instance.reachable === true)) return "pipeline_not_reachable";
  if (capabilities.matchingInstances.some((instance) => !Number.isInteger(instance.pid) || (instance.pid ?? 0) <= 0)) return "pipeline_identity_unknown";
  return undefined;
}

function caseInsensitiveField(record: Record<string, unknown>, name: string): unknown {
  const entry = Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function connectedCommandFailure(output: string, isEval: boolean): "malformed" | "failure" | undefined {
  const envelope = parseJsonObject(output);
  if (!envelope) return "malformed";
  if (caseInsensitiveField(envelope, "success") !== true) return "failure";
  const data = getRecord(caseInsensitiveField(envelope, "data"));
  if (!data) return "malformed";
  if (caseInsensitiveField(data, "success") === false) return "failure";
  if (!isEval) return undefined;

  let response: unknown = caseInsensitiveField(data, "result") ?? data;
  if (typeof response === "string") {
    try { response = JSON.parse(response); } catch { return "malformed"; }
  }
  const evalResponse = getRecord(response);
  if (!evalResponse) return "malformed";
  if (caseInsensitiveField(evalResponse, "success") !== true) return "failure";
  const diagnostics = caseInsensitiveField(evalResponse, "diagnostics");
  if (Array.isArray(diagnostics) && diagnostics.some(item => {
    const diagnostic = getRecord(item);
    return String(caseInsensitiveField(diagnostic ?? {}, "severity") ?? "").toLowerCase() === "error";
  })) return "failure";
  return undefined;
}

/**
 * The sole connected planning/eval dispatch seam. It re-discovers the exact canonical copy
 * immediately before execution and accepts advertised package-owned reads or advertised eval.
 * Eval is arbitrary bounded C#, so caller task intent and guidance—not syntax classification—
 * govern mutations. Callers must provide an executor; discovery never dispatches work.
 */
export async function dispatchUnityPlanningInspection(
  request: UnityPlanningInspectionRequest,
  options: {
    cliCommand?: string;
    timeout?: number;
    signal?: AbortSignal;
    execute: UnityCliExecutor;
    inspect?: (projectRoot: string, unityVersion: string) => Promise<UnityCliProjectCapabilities>;
  },
): Promise<UnityPlanningInspectionResult> {
  let projectRoot: string;
  try {
    projectRoot = await realpath(request.projectRoot);
  } catch {
    return { outcome: "rejected", code: "unity_project_identity_unavailable", message: "The Unity project root could not be canonicalized." };
  }
  const inspect = options.inspect ?? ((root, version) => inspectUnityCliProjectCapabilities(root, version, {
    cliCommand: options.cliCommand,
    timeout: options.timeout,
    signal: options.signal,
    execute: options.execute,
  }));
  const initial = await inspect(projectRoot, request.unityVersion);
  const initialFailure = planningInspectionReadiness(initial);
  if (initialFailure) return { outcome: "rejected", code: initialFailure, message: "Exact-copy Pipeline planning inspection is not established." };

  const isEval = request.command === "eval";
  const hasBoundedArgs = (request.args?.length ?? 0) <= 12
    && (request.args ?? []).every((arg) => typeof arg === "string" && arg.length <= 500 && !/[\u0000-\u001f\u007f]/.test(arg));
  if (!hasBoundedArgs) {
    return { outcome: "rejected", code: "planning_command_args_invalid", message: "Connected inspection command arguments exceed the bounded request limits." };
  }
  if (isEval) {
    const snippet = request.evalSnippet?.trim() ?? "";
    if (request.args?.length || !snippet || snippet.length > UNITY_PIPELINE_EVAL_MAX_CHARS || /[\u0000]/.test(snippet)) {
      return { outcome: "rejected", code: "planning_eval_invalid", message: "Eval requires one non-empty bounded C# snippet and no separate arguments." };
    }
  } else if (!UNITY_PLANNING_READ_COMMANDS.includes(request.command as typeof UNITY_PLANNING_READ_COMMANDS[number]) || (request.evalSnippet?.trim() ?? "") !== "") {
    return { outcome: "rejected", code: "planning_command_invalid", message: "Only a package-owned purpose-built inspection command may be selected here." };
  }
  if (!initial.advertisedCommands.includes(request.command)) {
    return { outcome: "rejected", code: "planning_command_unadvertised", message: "The exact Pipeline copy did not advertise the requested command." };
  }

  const refreshed = await inspect(projectRoot, request.unityVersion);
  const refreshedFailure = planningInspectionReadiness(refreshed);
  if (refreshedFailure || !haveSameKnownProcessIds(initial.matchingInstances, refreshed.matchingInstances)) {
    return { outcome: "rejected", code: "unity_project_identity_changed", message: "Pipeline identity changed or disconnected immediately before planning dispatch." };
  }
  if (!refreshed.advertisedCommands.includes(request.command)) {
    return { outcome: "rejected", code: "planning_command_unadvertised", message: "The refreshed exact Pipeline copy did not advertise the requested command." };
  }

  const command = resolveUnityCliCommand({ cliCommand: options.cliCommand });
  const args = [
    "--format", "json", "--no-banner", "--non-interactive", "command", "--project-path", projectRoot,
    "--timeout", String(Math.max(1, Math.ceil((options.timeout ?? UNITY_CLI_DISCOVERY_TIMEOUT_MS) / 1000))),
    request.command,
    ...(isEval ? [request.evalSnippet!.trim()] : request.args ?? []),
  ];
  const execution = await options.execute(command, args, { timeout: options.timeout ?? UNITY_CLI_DISCOVERY_TIMEOUT_MS, signal: options.signal });
  if (execution.error) {
    return { outcome: "rejected", code: isUnityCliTimeout(execution) ? "planning_command_timeout" : "planning_command_failed", message: "Connected command did not complete successfully; its effect may be uncertain." };
  }
  const raw = [execution.stdout, execution.stderr].filter(Boolean).join("\n");
  const output = redactUnityPlanningOutput(summarizeUnityCliText(raw, 4_000, 40));
  const reportedFailure = connectedCommandFailure(execution.stdout, isEval);
  if (reportedFailure) {
    return {
      outcome: "rejected",
      code: reportedFailure === "malformed" ? "planning_command_malformed" : "planning_command_reported_failure",
      message: `${reportedFailure === "malformed" ? "Connected command returned malformed JSON evidence" : "Connected command reported failure"}.${output ? ` ${output}` : ""}`,
    };
  }
  return { outcome: "dispatched", command: request.command, output, truncated: output.length < raw.trim().length };
}

/** Keep connected inspection output useful without returning common credential forms verbatim. */
export function redactUnityPlanningOutput(value: string): string {
  return value
    .replace(/\b((?:bearer|token|api[_ -]?key|password|secret)\s*[:=])\s*[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gi, "[redacted]");
}
