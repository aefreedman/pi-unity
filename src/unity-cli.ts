import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { applyDefaultUnityBatchmodeArgs, buildUnityBatchmodeArgs, projectPathsMatch } from "./unity-core";
import type { RunningUnityProcess } from "./unity-processes";

export const DEFAULT_UNITY_CLI_COMMAND = "unity";
export const UNITY_PIPELINE_EVAL_MAX_CHARS = 4_000;

export type UnityCliCommand = {
  command: string;
  args: string[];
};

export type UnityCliLaunchOptions = {
  editorVersionOverride?: string;
  timeoutSeconds?: number;
  cliCommand?: string;
  useGraphics?: boolean;
  /** Forward Unity Editor's -automated flag through `unity open --args`. */
  automated?: boolean;
  /** Native unity run log destination; never combine with forwarded -logFile. */
  logFilePath?: string;
  tailLog?: boolean;
};

export type UnityCliTestOptions = UnityCliLaunchOptions & {
  testPlatform: "EditMode" | "PlayMode";
  testFilters?: string[];
  testCategories?: string[];
  retries?: number;
  rerunFailed?: boolean;
  shard?: string;
  shardInventoryPath?: string;
  reportPaths?: { nunit?: string; junit?: string; log?: string };
  coverage?: boolean;
  coverageOptions?: string;
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

export type UnityCliCommandParameter = {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
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
  /** Display-oriented command descriptors. They are never capability evidence. */
  advertisedCommandParameters?: Record<string, readonly UnityCliCommandParameter[]>;
  /** Complete, bounded, unambiguous descriptors eligible for exact capability gates. */
  verifiedCommandParameters?: Record<string, readonly UnityCliCommandParameter[]>;
  /** True only when the exact live Pipeline descriptor advertises raw argv support. */
  pipelineSupportsExecArgv?: boolean;
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
  error?: Error & { code?: string | number | null; signal?: string | null; killed?: boolean };
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
  if (options.editorVersionOverride?.trim()) {
    args.push("--editor-version", options.editorVersionOverride.trim());
  }
}

export function createUnityCliOpenCommand(projectRoot: string, options: UnityCliLaunchOptions = {}): UnityCliCommand {
  const args = [...unityCliBaseArgs(), "open", projectRoot];
  appendUnityCliEditorOptions(args, options);
  if (options.automated) args.push("--args", "-automated");
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

export function createUnityCliTestCommand(projectRoot: string, options: UnityCliTestOptions): UnityCliCommand {
  const args = [...unityCliBaseArgs(), "test", projectRoot, "--mode", options.testPlatform];
  appendUnityCliEditorOptions(args, options);
  if (options.timeoutSeconds !== undefined) args.push("--timeout", String(options.timeoutSeconds));
  if (options.testFilters?.length) args.push("--filter", options.testFilters.join(";"));
  if (options.retries) args.push("--retries", String(options.retries));
  if (options.rerunFailed) args.push("--rerun-failed");
  if (options.shard) args.push("--shard", options.shard);
  if (options.shardInventoryPath) args.push("--shard-inventory", options.shardInventoryPath);
  const nunit = options.reportPaths?.nunit;
  const junit = options.reportPaths?.junit;
  if (nunit && junit) args.push("--output", nunit, "--report-format", "nunit,junit", "--junit-output", junit);
  else if (junit) args.push("--output", junit, "--report-format", "junit");
  else if (nunit) args.push("--output", nunit, "--report-format", "nunit");
  if (options.coverage) args.push("--coverage");
  if (options.coverageOptions) args.push("--coverage-options", options.coverageOptions);
  const editorArgs: string[] = [];
  if (!options.useGraphics) editorArgs.push("-nographics");
  if (options.testCategories?.length) editorArgs.push("-testCategory", options.testCategories.join(";"));
  if (options.reportPaths?.log) editorArgs.push("-logFile", options.reportPaths.log);
  if (editorArgs.length > 0) args.push("--", ...editorArgs);
  return { command: resolveUnityCliCommand(options), args };
}

export function createUnityCliRunCommand(projectRoot: string, extraEditorArgs: string[] = [], options: UnityCliLaunchOptions = {}): UnityCliCommand {
  const args = [...unityCliBaseArgs(), "run", projectRoot];
  const forwardedArgs = normalizeUnityCliForwardedArgs(applyDefaultUnityBatchmodeArgs(extraEditorArgs, { useGraphics: options.useGraphics }));
  appendUnityCliEditorOptions(args, options);
  if (options.logFilePath !== undefined && forwardedArgs.some(arg => /^-logfile(?:$|[=:])/i.test(arg))) {
    throw new Error("Native --log-file conflicts with forwarded -logFile; select only one log destination.");
  }
  if (options.tailLog === false && options.logFilePath === undefined) throw new Error("tailLog=false requires native logFilePath.");
  if (options.logFilePath !== undefined) args.push("--log-file", options.logFilePath);
  if (options.tailLog === false) args.push("--no-tail");
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
        stdout,
        stderr,
        error: error ?? undefined,
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
  options: { cliCommand?: string; timeout?: number; execute?: UnityCliExecutor } = {},
): Promise<{ processes: RunningUnityProcess[]; warning?: string }> {
  const command = resolveUnityCliCommand(options);
  const result = await (options.execute ?? execFileCollect)(command, ["--format", "json", "--no-banner", "--non-interactive", "status", "--project-path", projectRoot], {
    timeout: options.timeout ?? 5000,
  });

  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { processes: [] };
  }

  const processes = parseUnityCliStatusOutput(result.stdout, projectRoot);
  const payload = parseJsonObject(result.stdout);
  const statusWarnings = envelopeMessages(payload, "warnings");
  if (statusWarnings.length > 0) {
    return { processes, warning: `Unity CLI status response is incomplete; process absence is uncertain: ${statusWarnings.join("; ")}` };
  }
  if (processes.length > 0) return { processes };


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
  parametersByCommand: Record<string, readonly UnityCliCommandParameter[]>;
  verifiedParametersByCommand: Record<string, readonly UnityCliCommandParameter[]>;
  total: number;
  truncated: boolean;
};

function isBoundedDescriptorString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value);
}

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

  const parametersByCommand: Record<string, readonly UnityCliCommandParameter[]> = {};
  const verifiedCandidates = new Map<string, Array<readonly UnityCliCommandParameter[] | undefined>>();
  const names: string[] = [];
  for (const entry of candidates) {
    const record = getRecord(entry);
    const rawName = typeof entry === "string" ? entry : optionalString(record?.name, record?.command, record?.id);
    if (!isBoundedDescriptorString(rawName)) continue;
    const name = rawName.trim();
    if (!isBoundedDescriptorString(name)) continue;
    names.push(name);

    // Preserve a best-effort descriptor for status display, but retain authoritative
    // evidence only when every declared parameter is valid and the array was not cut.
    const rawParameters = record?.parameters;
    let parsed: UnityCliCommandParameter[] | undefined;
    if (Array.isArray(rawParameters) && rawParameters.length <= 32) {
      parsed = [];
      for (const item of rawParameters) {
        const parameter = getRecord(item);
        const parameterName = parameter?.name;
        const type = parameter?.type;
        if (!isBoundedDescriptorString(parameterName) || !isBoundedDescriptorString(type) || typeof parameter?.required !== "boolean") {
          parsed = undefined;
          break;
        }
        parsed.push({ name: parameterName, type, required: parameter.required, ...(Object.prototype.hasOwnProperty.call(parameter, "defaultValue") ? { defaultValue: parameter.defaultValue } : {}) });
      }
    }
    if (!(name in parametersByCommand) && parsed) parametersByCommand[name] = parsed;
    const entries = verifiedCandidates.get(name) ?? [];
    entries.push(parsed);
    verifiedCandidates.set(name, entries);
  }

  const unique = [...new Set(names)].sort((left, right) => left.localeCompare(right));
  const commands = unique.slice(0, 256);
  const verifiedParametersByCommand = Object.fromEntries([...verifiedCandidates].flatMap(([name, descriptors]) =>
    descriptors.length === 1 && descriptors[0] ? [[name, descriptors[0]]] : [],
  ));
  return {
    valid: Boolean(payload?.success === true && valid),
    commands,
    parametersByCommand: Object.fromEntries(commands.flatMap(name => parametersByCommand[name] ? [[name, parametersByCommand[name]]] : [])),
    verifiedParametersByCommand,
    total: unique.length,
    truncated: unique.length > 256,
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

/** Read only the public capability names; the descriptor's authentication token is never retained or surfaced. */
async function readPipelineDescriptorCapabilities(projectRoot: string): Promise<string[] | undefined> {
  const descriptor = await readJsonFile(join(projectRoot, "Library", "Pipeline", ".unity-pipeline-port"));
  if (!descriptor) return undefined;
  const values = Array.isArray(descriptor.capabilities) ? descriptor.capabilities : [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value)))];
}

export function isUnityCliTimeout(result: Pick<UnityCliExecResult, "error">): boolean {
  const error = result.error;
  return error?.code === "ETIMEDOUT" || error?.killed === true || error?.signal === "SIGTERM";
}

const UNITY_CLI_MAX_DIAGNOSTICS = 8;
function envelopeMessages(payload: Record<string, unknown> | null, fieldName: "errors" | "warnings" | "info"): string[] {
  const entries = Array.isArray(payload?.[fieldName]) ? payload[fieldName] : [];
  return entries.slice(0, UNITY_CLI_MAX_DIAGNOSTICS).flatMap((entry): string[] => {
    const item = getRecord(entry);
    const message = optionalString(item?.message, item?.detail, typeof entry === "string" ? entry : undefined);
    return message ? [redactUnityPlanningOutput(summarizeUnityCliText(message, 1_000, 10))] : [];
  });
}

/** Warnings make discovery incomplete; informational descriptor/envelope notes do not. */
function cliEnvelopeDiagnostics(payload: Record<string, unknown> | null): string[] {
  return envelopeMessages(payload, "warnings").map(message => `warning: ${message}`);
}
function cliEnvelopeInfo(payload: Record<string, unknown> | null): string[] {
  return envelopeMessages(payload, "info").map(message => `info: ${message}`);
}

function cliFailureMessage(result: UnityCliExecResult): string | undefined {
  const payload = parseJsonObject(result.stdout);
  const message = envelopeMessages(payload, "errors")[0] ?? (result.stderr.trim() || result.error?.message);
  return message ? summarizeUnityCliText(redactUnityPlanningOutput(message)) : undefined;
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
  // Explicitly select the supported human formatter: inherited UNITY_FORMAT must not turn
  // --version into JSON (or another representation) and corrupt capability reporting.
  const versionResult = await execute(command, ["--format", "human", "--version"], { timeout: versionTimeout, signal: options.signal });
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
  const pipelineDiagnostics = cliEnvelopeDiagnostics(pipelinePayload);
  result.warnings.push(...cliEnvelopeInfo(pipelinePayload));
  if (pipelineResult.error || pipelinePayload?.success !== true || !Array.isArray(pipelineData?.instances) || pipelineDiagnostics.length > 0) {
    result.pipelineDiscovery = isUnityCliTimeout(pipelineResult) ? "timeout" : "unavailable";
    const diagnostic = pipelineDiagnostics.join("; ") || cliFailureMessage(pipelineResult) || "malformed or unsupported JSON response";
    result.warnings.push(`Unity Pipeline instance discovery ${result.pipelineDiscovery === "timeout" ? "timed out; Pipeline startup state is uncertain" : "is incomplete or failed; Pipeline startup state is uncertain"}: ${diagnostic}`);
    // Retain any known positive exact-copy instance descriptors, but never use this
    // incomplete response as a safe launch or connected-dispatch signal.
    result.matchingInstances = parseUnityCliPipelineListOutput(pipelineResult.stdout, projectRoot).instances;
    return result;
  }
  result.pipelineDiscovery = "available";
  const pipeline = parseUnityCliPipelineListOutput(pipelineResult.stdout, projectRoot);
  result.matchingInstances = pipeline.instances;
  const descriptorCapabilities = await readPipelineDescriptorCapabilities(projectRoot);
  result.pipelineSupportsExecArgv = descriptorCapabilities?.includes("exec.argv") === true;
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
  // `unity list` normalizes parameter types/defaults, while `unity command` with no command
  // returns the live Pipeline catalog descriptor needed for exact capability-gated forwarding.
  const listResult = await execute(command, ["--format", "json", "--no-banner", "--non-interactive", "command", "--project-path", projectRoot, "--detail", "full"], { timeout: discoveryTimeout, signal: options.signal });
  const catalog = parseUnityCliCommandCatalog(listResult.stdout);
  const listPayload = parseJsonObject(listResult.stdout);
  const commandDiagnostics = cliEnvelopeDiagnostics(listPayload);
  result.warnings.push(...cliEnvelopeInfo(listPayload));
  if (listResult.error || !catalog.valid || commandDiagnostics.length > 0) {
    result.commandDiscovery = isUnityCliTimeout(listResult) ? "timeout" : "unavailable";
    result.warnings.push(`Unity Pipeline command discovery for the exact project copy ${result.commandDiscovery === "timeout" ? "timed out; command availability is uncertain" : "is incomplete or failed; command availability is uncertain"}: ${commandDiagnostics.join("; ") || cliFailureMessage(listResult) || "malformed or unsupported JSON response"}`);
    // Commands in a warning-bearing catalog are informational only, not advertised
    // capability evidence. Keep descriptors for status visibility without enabling dispatch.
    result.advertisedCommands = catalog.commands;
    result.advertisedCommandParameters = catalog.parametersByCommand;
    result.verifiedCommandParameters = catalog.verifiedParametersByCommand;
    result.advertisedCommandCount = catalog.total;
    result.advertisedCommandsTruncated = catalog.truncated;
    return result;
  }
  result.commandDiscovery = "available";
  result.advertisedCommands = catalog.commands;
  result.advertisedCommandParameters = catalog.parametersByCommand;
  result.verifiedCommandParameters = catalog.verifiedParametersByCommand;
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
  "get_runtime_pipeline_settings",
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
  /** Verified Pipeline eval dispatcher wait in milliseconds; distinct from the CLI/host wait. */
  handlerTimeoutMilliseconds?: number;
};

export type UnityPlanningInspectionResult =
  | { outcome: "dispatched"; command: string; output: string; truncated: boolean }
  | { outcome: "rejected"; code: string; message: string };

export type UnityPipelineRunScriptRequest = {
  projectRoot: string;
  unityVersion: string;
  file: string;
  entry?: string;
  args?: unknown[];
  dryRun?: boolean;
};

/** Attach bounded native discovery guidance without changing the readiness decision. */
export function unityCapabilityDiagnosticSuffix(capabilities: UnityCliProjectCapabilities): string {
  const message = summarizeUnityCliText(redactUnityPlanningOutput(capabilities.warnings.slice(0, 8).join("; ")), 1_000, 10);
  return message ? ` ${message}` : "";
}

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

function runScriptCommandFailure(output: string): "malformed" | "failure" | undefined {
  const envelope = parseJsonObject(output);
  if (!envelope || caseInsensitiveField(envelope, "success") !== true) return envelope ? "failure" : "malformed";
  const wrapper = getRecord(caseInsensitiveField(envelope, "data")) ?? envelope;
  if (caseInsensitiveField(wrapper, "success") === false) return "failure";
  let response: unknown = caseInsensitiveField(wrapper, "result");
  // Legacy wrapper puts the documented RunScriptResponse in data.result; compact
  // transport puts it in result. A bare success envelope has no command evidence.
  if (typeof response === "string") { try { response = JSON.parse(response); } catch { return "malformed"; } }
  const result = getRecord(response);
  if (!result || !Object.prototype.hasOwnProperty.call(result, "diagnostics") || !Array.isArray(caseInsensitiveField(result, "diagnostics"))) return "malformed";
  if (caseInsensitiveField(result, "success") === false || caseInsensitiveField(result, "failed") === true) return "failure";
  const diagnostics = caseInsensitiveField(result, "diagnostics") as unknown[];
  if (diagnostics.some(item => {
    const diagnostic = getRecord(item);
    return String(caseInsensitiveField(diagnostic ?? {}, "severity") ?? "").toLowerCase() === "error";
  })) return "failure";
  return undefined;
}

function hasVerifiedEvalTimeoutContract(capabilities: UnityCliProjectCapabilities): boolean {
  const parameters = capabilities.verifiedCommandParameters?.eval;
  return capabilities.pipelineSupportsExecArgv === true
    && Array.isArray(parameters)
    && parameters.length === 2
    && parameters[0]?.name === "code"
    && parameters[0]?.type === "String"
    && parameters[0]?.required === true
    && parameters[1]?.name === "timeout"
    && parameters[1]?.type === "Int32"
    && parameters[1]?.required === false
    && parameters[1]?.defaultValue === 5000;
}

function connectedCommandFailure(output: string, isEval: boolean): "malformed" | "failure" | undefined {
  const envelope = parseJsonObject(output);
  if (!envelope) return "malformed";
  if (caseInsensitiveField(envelope, "success") !== true) return "failure";
  // Pipeline 0.6 compact responses omit the CLI wrapper's data field.
  const data = getRecord(caseInsensitiveField(envelope, "data")) ?? envelope;
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
  if (initialFailure) return { outcome: "rejected", code: initialFailure, message: `Exact-copy Pipeline planning inspection is not established.${unityCapabilityDiagnosticSuffix(initial)}` };

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
    if (request.handlerTimeoutMilliseconds !== undefined && (!Number.isInteger(request.handlerTimeoutMilliseconds) || request.handlerTimeoutMilliseconds < 1 || request.handlerTimeoutMilliseconds > 86_400_000)) {
      return { outcome: "rejected", code: "planning_eval_invalid", message: "Eval handler timeout must be an integer from 1 to 86400000 milliseconds." };
    }
    if (request.handlerTimeoutMilliseconds !== undefined && !hasVerifiedEvalTimeoutContract(initial)) {
      return { outcome: "rejected", code: "planning_eval_timeout_unavailable", message: "The exact Pipeline copy does not establish raw argv support and the documented eval timeout signature; eval was not dispatched." };
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
    return { outcome: "rejected", code: "unity_project_identity_changed", message: `Pipeline identity changed or disconnected immediately before planning dispatch.${unityCapabilityDiagnosticSuffix(refreshed)}` };
  }
  if (!refreshed.advertisedCommands.includes(request.command)) {
    return { outcome: "rejected", code: "planning_command_unadvertised", message: "The refreshed exact Pipeline copy did not advertise the requested command." };
  }
  if (isEval && request.handlerTimeoutMilliseconds !== undefined && !hasVerifiedEvalTimeoutContract(refreshed)) {
    return { outcome: "rejected", code: "planning_eval_timeout_unavailable", message: "The exact Pipeline eval timeout capability changed before dispatch; eval was not dispatched." };
  }

  const command = resolveUnityCliCommand({ cliCommand: options.cliCommand });
  const args = [
    "--format", "json", "--no-banner", "--non-interactive", "command", "--project-path", projectRoot,
    "--timeout", String(Math.max(1, Math.ceil((options.timeout ?? UNITY_CLI_DISCOVERY_TIMEOUT_MS) / 1000))),
    request.command,
    ...(isEval ? [request.evalSnippet!.trim(), ...(request.handlerTimeoutMilliseconds === undefined ? [] : [String(request.handlerTimeoutMilliseconds)])] : request.args ?? []),
  ];
  const execution = await options.execute(command, args, { timeout: options.timeout ?? UNITY_CLI_DISCOVERY_TIMEOUT_MS, signal: options.signal });
  const raw = [execution.stdout, execution.stderr].filter(Boolean).join("\n");
  const output = summarizeUnityCliText(redactUnityPlanningOutput(raw), 4_000, 40);
  if (execution.error) {
    return { outcome: "rejected", code: isUnityCliTimeout(execution) ? "planning_command_timeout" : "planning_command_failed", message: `Connected command did not complete successfully; its effect may be uncertain.${output ? ` ${output}` : ""}` };
  }
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

/** Dispatch the documented Pipeline 0.6 ephemeral run_script form; hotpatch is deliberately not exposed. */
export async function dispatchUnityPipelineRunScript(
  request: UnityPipelineRunScriptRequest,
  options: { cliCommand?: string; timeout?: number; signal?: AbortSignal; execute: UnityCliExecutor; inspect?: (projectRoot: string, unityVersion: string) => Promise<UnityCliProjectCapabilities> },
): Promise<UnityPlanningInspectionResult> {
  let projectRoot: string; let file: string;
  try { projectRoot = await realpath(request.projectRoot); file = await realpath(request.file); } catch {
    return { outcome: "rejected", code: "run_script_path_unavailable", message: "The project root or existing script file could not be canonicalized." };
  }
  const relativeFile = relative(projectRoot, file);
  let fileStats: Awaited<ReturnType<typeof stat>>;
  try { fileStats = await stat(file); } catch { return { outcome: "rejected", code: "run_script_file_invalid", message: "run_script requires one readable existing C# file." }; }
  if (!relativeFile || isAbsolute(relativeFile) || relativeFile === ".." || relativeFile.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || !fileStats.isFile() || !/\.cs$/i.test(relativeFile)) return { outcome: "rejected", code: "run_script_file_invalid", message: "run_script requires one existing .cs file inside the exact project root." };
  let serializedArgs: string;
  try { serializedArgs = JSON.stringify(request.args ?? []); } catch { return { outcome: "rejected", code: "run_script_args_invalid", message: "run_script arguments must be JSON-serializable." }; }
  if (serializedArgs === undefined || serializedArgs.length > 4_000 || (request.entry?.length ?? 0) > 500 || /[\u0000-\u001f\u007f]/.test(request.entry ?? "")) return { outcome: "rejected", code: "run_script_args_invalid", message: "run_script entry or JSON arguments exceed bounded request limits." };
  const inspect = options.inspect ?? ((root, version) => inspectUnityCliProjectCapabilities(root, version, { cliCommand: options.cliCommand, timeout: options.timeout, signal: options.signal, execute: options.execute }));
  const initial = await inspect(projectRoot, request.unityVersion);
  if (planningInspectionReadiness(initial) || !initial.advertisedCommands.includes("run_script")) return { outcome: "rejected", code: "run_script_unavailable", message: `The exact reachable Pipeline copy does not establish advertised run_script support.${unityCapabilityDiagnosticSuffix(initial)}` };
  const refreshed = await inspect(projectRoot, request.unityVersion);
  if (planningInspectionReadiness(refreshed) || !haveSameKnownProcessIds(initial.matchingInstances, refreshed.matchingInstances) || !refreshed.advertisedCommands.includes("run_script")) return { outcome: "rejected", code: "unity_project_identity_changed", message: `Pipeline identity or run_script availability changed immediately before dispatch.${unityCapabilityDiagnosticSuffix(refreshed)}` };
  const timeout = Math.max(1, Math.min(options.timeout ?? 30_000, 86_400_000));
  const args = ["--format", "json", "--no-banner", "--non-interactive", "command", "--project-path", projectRoot, "--timeout", String(Math.ceil(timeout / 1000)), "run_script", "--file", relativeFile, "--mode", "ephemeral", "--args", serializedArgs, "--timeout_ms", String(timeout), ...(request.entry?.trim() ? ["--entry", request.entry.trim()] : []), ...(request.dryRun ? ["--dry_run", "true"] : [])];
  const execution = await options.execute(resolveUnityCliCommand({ cliCommand: options.cliCommand }), args, { timeout, signal: options.signal });
  const raw = [execution.stdout, execution.stderr].filter(Boolean).join("\n"); const output = summarizeUnityCliText(redactUnityPlanningOutput(raw), 4_000, 40);
  if (execution.error) return { outcome: "rejected", code: isUnityCliTimeout(execution) ? "run_script_timeout" : "run_script_failed", message: `run_script did not complete successfully; its effect may be uncertain.${output ? ` ${output}` : ""}` };
  const failure = runScriptCommandFailure(execution.stdout);
  if (failure) return { outcome: "rejected", code: failure === "malformed" ? "run_script_malformed" : "run_script_reported_failure", message: `${failure === "malformed" ? "run_script returned malformed JSON evidence" : "run_script reported failure"}.${output ? ` ${output}` : ""}` };
  return { outcome: "dispatched", command: "run_script", output, truncated: output.length < raw.trim().length };
}

/** Keep connected inspection output useful without returning common credential forms verbatim. */
export function redactUnityPlanningOutput(value: string): string {
  return value
    .replace(/\b((?:bearer|token|api[_ -]?key|password|secret)\s*[:=])\s*[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gi, "[redacted]");
}
