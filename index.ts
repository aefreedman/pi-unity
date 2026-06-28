import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Text } from "@mariozechner/pi-tui";
import {
  buildUnityBatchmodeAgentText,
  loadUnityBatchmodeArtifacts,
  parseUnityBatchmodeInvocation,
  parseUnityTestResultsXml,
  formatParsedTestResultsForAgent,
  summarizeTextForAgent,
  type UnityBatchmodeArtifacts,
  type UnityBatchmodeInvocation,
  type UnityParsedTestResults,
} from "./src/unity-batchmode";
import { formatPathForUser } from "./src/unity-core";
import { createUnityCliBatchmodeReportArgs, createUnityCliRunCommand, listRunningUnityCliEditorsForProject, resolveUnityCliCommand } from "./src/unity-cli";
import { createUnityBatchmodeCommand, launchUnityCliOpenDetached, launchUnityEditorDetached, resolveUnityEditorPath } from "./src/unity-launch";
import { listRunningUnityProcessesForProject } from "./src/unity-processes";
import { assertUnityProjectNotBusy, inspectUnityProjectBusyState, withUnityProjectLaunchMutex } from "./src/unity-project-lock";
import { resolveUnityProjectCandidates, type UnityProjectCandidate } from "./src/unity-projects";

const GUI_WARNING = "This launches the full Unity Editor GUI and is not the same as batchmode/headless Unity.";
const SINGLE_PROCESS_WARNING = "Unity allows only one process per project folder. GUI Editor and batchmode/headless both count as that one process.";

type UnityToolDetails = {
  mode: "gui" | "batchmode" | "status" | "artifacts";
  projectRoot: string;
  unityVersion: string;
  editorPath: string;
  warning?: string;
  pid?: number;
  command?: string;
  args?: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  invocation?: UnityBatchmodeInvocation;
  artifacts?: UnityBatchmodeArtifacts;
  parsedTestResults?: UnityParsedTestResults | null;
  status?: "passed" | "failed" | "killed";
  launcher?: "unity-cli" | "editor-executable";
  cliArgs?: string[];
};

const LAUNCHER_SCHEMA = Type.Optional(Type.Union([
  Type.Literal("auto"),
  Type.Literal("unity-cli"),
  Type.Literal("editor-executable"),
], { description: "Launch backend. Defaults to auto, which prefers the Unity CLI and falls back to direct editor executable launch when the CLI is unavailable." }));

type UnityLauncherPreference = "auto" | "unity-cli" | "editor-executable";

const OPEN_EDITOR_PARAMS = Type.Object({
  path: Type.Optional(Type.String({ description: "Unity project path, workspace copy root, or folder containing project copies." })),
  unityEditorPath: Type.Optional(Type.String({ description: "Optional explicit Unity executable path override." })),
  launcher: LAUNCHER_SCHEMA,
});

const LAUNCH_BATCHMODE_PARAMS = Type.Object({
  path: Type.Optional(Type.String({ description: "Unity project path, workspace copy root, or folder containing project copies." })),
  unityEditorPath: Type.Optional(Type.String({ description: "Optional explicit Unity executable path override." })),
  args: Type.Optional(Type.Array(Type.String(), { description: "Additional Unity command-line arguments appended after -batchmode -projectPath <project> for direct editor launch, or forwarded after `unity run <project> --` for Unity CLI launch." })),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 14400, default: 3600, description: "Timeout in seconds for the batchmode process." })),
  launcher: LAUNCHER_SCHEMA,
});

const PROJECT_STATUS_PARAMS = Type.Object({
  path: Type.Optional(Type.String({ description: "Unity project path, workspace copy root, or folder containing project copies." })),
});

const INSPECT_ARTIFACTS_PARAMS = Type.Object({
  path: Type.Optional(Type.String({ description: "Unity project path, workspace copy root, or folder containing project copies." })),
  testResultsPath: Type.Optional(Type.String({ description: "Unity Test Framework XML results path. Relative paths are resolved against cwd and the Unity project root." })),
  logFilePath: Type.Optional(Type.String({ description: "Unity log file path. Relative paths are resolved against cwd and the Unity project root." })),
  latestFromLogs: Type.Optional(Type.Boolean({ default: true, description: "When paths are omitted, inspect the newest .xml and .log files under the project's Logs folder." })),
  maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 60, description: "Maximum log/output lines to include." })),
  maxChars: Type.Optional(Type.Integer({ minimum: 500, maximum: 20000, default: 6000, description: "Maximum log/output characters to include." })),
});

function buildProjectChoiceLabel(cwd: string, candidate: UnityProjectCandidate): string {
  return `${candidate.projectName} (${candidate.unityVersion}) — ${formatPathForUser(cwd, candidate.projectRoot)}`;
}

function formatCandidateList(cwd: string, candidates: UnityProjectCandidate[]): string {
  return candidates
    .map((candidate) => `- ${candidate.projectName} (${candidate.unityVersion}) — ${formatPathForUser(cwd, candidate.projectRoot)}`)
    .join("\n");
}

async function chooseProjectCandidate(
  ctx: ExtensionContext,
  candidates: UnityProjectCandidate[],
): Promise<UnityProjectCandidate> {
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (!ctx.hasUI) {
    throw new Error(
      [
        "Multiple Unity projects were found. Pass path explicitly.",
        formatCandidateList(ctx.cwd, candidates),
      ].join("\n"),
    );
  }

  const labels = candidates.map((candidate) => buildProjectChoiceLabel(ctx.cwd, candidate));
  const selected = await ctx.ui.select("Select Unity project", labels);
  if (!selected) {
    throw new Error("No Unity project was selected.");
  }

  const index = labels.indexOf(selected);
  if (index < 0) {
    throw new Error("Selected Unity project could not be resolved.");
  }

  return candidates[index];
}

async function resolveProjectCandidate(
  ctx: ExtensionContext,
  requestedPath?: string,
): Promise<{ candidate: UnityProjectCandidate; discoveryWarning?: string }> {
  const result = await resolveUnityProjectCandidates(ctx.cwd, requestedPath);
  if (result.candidates.length === 0) {
    throw new Error(
      requestedPath?.trim()
        ? `No Unity project was found at or under ${requestedPath}.`
        : "No Unity project was found from the current working directory. Pass path explicitly if needed.",
    );
  }

  const candidate = await chooseProjectCandidate(ctx, result.candidates);
  const discoveryWarning = result.truncated
    ? "Unity project discovery was truncated; pass path explicitly if the intended project was not listed."
    : undefined;

  return { candidate, discoveryWarning };
}

function joinWarnings(...warnings: Array<string | undefined>): string | undefined {
  const present = warnings.filter((warning): warning is string => Boolean(warning && warning.trim().length > 0));
  return present.length > 0 ? present.join("\n") : undefined;
}

async function enforceSingleProcessRule(projectRoot: string): Promise<string | undefined> {
  const cliStatus = await listRunningUnityCliEditorsForProject(projectRoot);
  if (cliStatus.processes.length > 0) {
    const processSummary = cliStatus.processes
      .map((process) => `${process.pid ?? "?"}: ${process.commandLine}`)
      .join("\n");
    throw new Error(
      [
        `Refusing to launch Unity for ${projectRoot} because Unity CLI reports an Editor already targets this project.`,
        SINGLE_PROCESS_WARNING,
        processSummary,
      ].join("\n"),
    );
  }

  const running = await listRunningUnityProcessesForProject(projectRoot);
  if (running.processes.length > 0) {
    const processSummary = running.processes
      .map((process) => `${process.pid ?? "?"}: ${process.commandLine}`)
      .join("\n");
    throw new Error(
      [
        `Refusing to launch Unity for ${projectRoot} because another Unity process already targets this project.`,
        SINGLE_PROCESS_WARNING,
        processSummary,
      ].join("\n"),
    );
  }

  return cliStatus.warning ?? running.warning;
}

async function buildProjectStatusReport(
  ctx: ExtensionContext,
  candidate: UnityProjectCandidate,
): Promise<{ text: string; details: UnityToolDetails }> {
  const lockState = await inspectUnityProjectBusyState(candidate.projectRoot);
  const cliStatus = await listRunningUnityCliEditorsForProject(candidate.projectRoot);
  const processStatus = await listRunningUnityProcessesForProject(candidate.projectRoot);
  const runningProcesses = [...cliStatus.processes, ...processStatus.processes];
  const isBusy = runningProcesses.length > 0;
  const staleLockSuspected = lockState.nativeLockfileExists && !isBusy && !processStatus.warning;
  const warning = joinWarnings(cliStatus.warning, processStatus.warning);

  const lines = [
    `Unity project status for ${formatPathForUser(ctx.cwd, candidate.projectRoot)} using Unity ${candidate.unityVersion}.`,
    `- Native lockfile: ${lockState.nativeLockfileExists ? "present" : "absent"}`,
    `- Lockfile path: ${lockState.nativeLockfilePath}`,
    `- Running Unity processes targeting project: ${runningProcesses.length}`,
  ];

  if (runningProcesses.length > 0) {
    lines.push(...runningProcesses.map((process) => `  - ${process.pid ?? "?"}: ${process.commandLine}`));
  }

  if (staleLockSuspected) {
    lines.push("- Assessment: native lockfile may be stale; Unity CLI launches may be able to handle it, but direct Editor launches will be blocked by pi-unity safety checks.");
  } else if (isBusy) {
    lines.push("- Assessment: project is busy; do not start another GUI or batchmode Unity process for this project.");
  } else {
    lines.push("- Assessment: project appears available for a Unity launch.");
  }

  if (warning) {
    lines.push("", warning);
  }

  return {
    text: lines.join("\n"),
    details: {
      mode: "status",
      projectRoot: candidate.projectRoot,
      unityVersion: candidate.unityVersion,
      editorPath: "",
      warning,
      status: isBusy ? "failed" : "passed",
    },
  };
}

async function findNewestFile(root: string, suffixes: string[]): Promise<string | undefined> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && suffixes.some((suffix) => entry.name.toLowerCase().endsWith(suffix)))
    .map(async (entry) => {
      const fullPath = join(root, entry.name);
      const stats = await stat(fullPath);
      return { fullPath, mtimeMs: stats.mtimeMs };
    }));
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.fullPath;
}

function resolveArtifactPath(cwd: string, projectRoot: string, value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (isAbsolute(trimmed)) return trimmed;
  return resolve(cwd, trimmed).startsWith(projectRoot) ? resolve(cwd, trimmed) : resolve(projectRoot, trimmed);
}

async function buildArtifactInspectionReport(
  ctx: ExtensionContext,
  candidate: UnityProjectCandidate,
  params: { testResultsPath?: string; logFilePath?: string; latestFromLogs?: boolean; maxLines?: number; maxChars?: number },
): Promise<{ text: string; details: UnityToolDetails }> {
  const useLatest = params.latestFromLogs !== false;
  const logsRoot = join(candidate.projectRoot, "Logs");
  const testResultsPath = resolveArtifactPath(ctx.cwd, candidate.projectRoot, params.testResultsPath)
    ?? (useLatest ? await findNewestFile(logsRoot, [".xml"]) : undefined);
  const logFilePath = resolveArtifactPath(ctx.cwd, candidate.projectRoot, params.logFilePath)
    ?? (useLatest ? await findNewestFile(logsRoot, [".log", ".txt"]) : undefined);
  const invocation: UnityBatchmodeInvocation = {
    isTestRun: Boolean(testResultsPath),
    usesNoGraphics: false,
    testResultsPath,
    logFilePath,
  };
  const artifacts = await loadUnityBatchmodeArtifacts(ctx.cwd, candidate.projectRoot, invocation);
  const parsedTestResults = artifacts.testResultsXml ? parseUnityTestResultsXml(artifacts.testResultsXml) : null;
  const status = parsedTestResults && ((parsedTestResults.failed ?? 0) > 0 || parsedTestResults.failedTests.length > 0)
    ? "failed"
    : "passed";
  const lines = [
    `Unity artifacts inspected for ${formatPathForUser(ctx.cwd, candidate.projectRoot)} using Unity ${candidate.unityVersion}.`,
    testResultsPath ? `Requested test results: ${testResultsPath}` : "Requested test results: (none found)",
    logFilePath ? `Requested log file: ${logFilePath}` : "Requested log file: (none found)",
  ];

  if (parsedTestResults) {
    lines.push(...formatParsedTestResultsForAgent(parsedTestResults));
  }

  for (const warning of artifacts.warnings) lines.push(warning);
  const logSummary = summarizeTextForAgent(artifacts.logText, params.maxLines ?? 60, params.maxChars ?? 6000);
  if (logSummary) {
    lines.push("Relevant log output:", logSummary);
  }

  return {
    text: lines.join("\n"),
    details: {
      mode: "artifacts",
      projectRoot: candidate.projectRoot,
      unityVersion: candidate.unityVersion,
      editorPath: "",
      invocation,
      artifacts,
      parsedTestResults,
      status,
    },
  };
}

function buildEditorLaunchSummary(
  cwd: string,
  candidate: UnityProjectCandidate,
  editorPath: string,
  warning?: string,
  launcher: "unity-cli" | "editor-executable" = "editor-executable",
): string {
  return [
    `Launched Unity Editor GUI for ${formatPathForUser(cwd, candidate.projectRoot)} using Unity ${candidate.unityVersion}.`,
    launcher === "unity-cli" ? `Launcher: unity open (${editorPath})` : `Editor: ${editorPath}`,
    GUI_WARNING,
    SINGLE_PROCESS_WARNING,
    ...(warning ? [warning] : []),
  ].join("\n");
}

function deriveBatchmodeStatus(
  exitCode: number,
  killed: boolean,
  parsedTestResults?: UnityParsedTestResults | null,
): "passed" | "failed" | "killed" {
  if (killed) return "killed";
  if (parsedTestResults && ((parsedTestResults.failed ?? 0) > 0 || parsedTestResults.failedTests.length > 0)) {
    return "failed";
  }
  return exitCode === 0 ? "passed" : "failed";
}

function getBatchmodeVariantLabel(args?: string[]): "Unity (headless)" | "Unity (graphics)" {
  const invocation = parseUnityBatchmodeInvocation(args ?? []);
  return invocation.usesNoGraphics ? "Unity (headless)" : "Unity (graphics)";
}

async function buildBatchmodeReport(
  ctx: ExtensionContext,
  candidate: UnityProjectCandidate,
  editorPath: string,
  result: { code: number; stdout: string; stderr: string; killed?: boolean },
  args: string[],
  warning?: string,
): Promise<{ text: string; details: UnityToolDetails }> {
  const invocation = parseUnityBatchmodeInvocation(args);
  const artifacts = await loadUnityBatchmodeArtifacts(ctx.cwd, candidate.projectRoot, invocation);
  const parsedTestResults = artifacts.testResultsXml ? parseUnityTestResultsXml(artifacts.testResultsXml) : null;
  const status = deriveBatchmodeStatus(result.code, Boolean(result.killed), parsedTestResults);
  const text = buildUnityBatchmodeAgentText({
    displayProjectPath: formatPathForUser(ctx.cwd, candidate.projectRoot),
    unityVersion: candidate.unityVersion,
    editorPath,
    exitCode: result.code,
    killed: Boolean(result.killed),
    invocation,
    artifacts,
    parsedTestResults,
    stdout: result.stdout,
    stderr: result.stderr,
    warning,
    singleProcessWarning: SINGLE_PROCESS_WARNING,
  });

  return {
    text,
    details: {
      mode: "batchmode",
      projectRoot: candidate.projectRoot,
      unityVersion: candidate.unityVersion,
      editorPath,
      command: editorPath,
      args,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      killed: Boolean(result.killed),
      warning,
      invocation,
      artifacts,
      parsedTestResults,
      status,
    },
  };
}

function renderUnityToolCall(
  name: string,
  args: { path?: string; args?: string[] },
  theme: any,
  modeLabel: string,
  emphasis: string,
): Text {
  const pathLabel = args.path?.trim() ? args.path : "auto-resolve";
  const extraArgs = Array.isArray(args.args) && args.args.length > 0
    ? args.args.slice(0, 4).join(" ") + (args.args.length > 4 ? ` ... +${args.args.length - 4}` : "")
    : undefined;
  let text =
    theme.fg("toolTitle", theme.bold(`${name} `)) +
    theme.fg("accent", modeLabel) +
    theme.fg("muted", ` (${emphasis})`);
  text += `\n  ${theme.fg("accent", pathLabel)}`;
  if (extraArgs) {
    text += `\n  ${theme.fg("muted", extraArgs)}`;
  }
  return new Text(text, 0, 0);
}

function getToolTextContent(result: any): string {
  return Array.isArray(result.content)
    ? result.content.filter((entry: any) => entry?.type === "text").map((entry: any) => String(entry.text ?? "")).join("\n")
    : "";
}

function buildBatchmodeStatusLine(details: UnityToolDetails, theme: any): string {
  const status = details.status ?? "passed";
  let line = `\n  ${theme.fg("accent", `status=${status}`)}${theme.fg("muted", ` exit=${details.exitCode ?? 0}`)}`;
  if (details.invocation?.testPlatform) {
    line += ` ${theme.fg("muted", `platform=${details.invocation.testPlatform}`)}`;
  }
  return line;
}

function buildBatchmodeResultsLine(details: UnityToolDetails, theme: any): string {
  if (!details.parsedTestResults) {
    return "";
  }

  const parts = [
    details.parsedTestResults.total !== undefined ? `total ${details.parsedTestResults.total}` : undefined,
    details.parsedTestResults.passed !== undefined ? `passed ${details.parsedTestResults.passed}` : undefined,
    details.parsedTestResults.failed !== undefined ? `failed ${details.parsedTestResults.failed}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? `\n  ${theme.fg("muted", parts.join(" • "))}` : "";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Unity tool execution aborted.");
  }
}

async function canUseUnityCli(pi: ExtensionAPI, signal?: AbortSignal): Promise<boolean> {
  try {
    throwIfAborted(signal);
    const command = resolveUnityCliCommand();
    const result = await pi.exec(command, ["--version"], { signal, timeout: 5000 });
    throwIfAborted(signal);
    return !result.killed && result.code === 0;
  } catch {
    return false;
  }
}

async function shouldUseUnityCli(
  pi: ExtensionAPI,
  launcher: UnityLauncherPreference | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  const preference = launcher ?? "auto";
  if (preference === "editor-executable") {
    return false;
  }

  const available = await canUseUnityCli(pi, signal);
  if (preference === "unity-cli" && !available) {
    throw new Error("Unity CLI launcher was requested, but the `unity` command is not available. Set UNITY_CLI_PATH or use launcher='editor-executable'.");
  }

  return available;
}

function renderUnityToolResult(result: any, expanded: boolean, theme: any): Text {
  const details = result.details as UnityToolDetails | undefined;
  const primaryText = getToolTextContent(result);

  if (!details) {
    return new Text(primaryText || "(no output)", 0, 0);
  }

  const icon = details.mode === "gui"
    ? theme.fg("success", "◉")
    : details.status === "passed"
      ? theme.fg("success", "✓")
      : details.status === "killed"
        ? theme.fg("warning", "! ")
        : theme.fg("error", "✗");
  const title = details.mode === "gui"
    ? "Unity Editor"
    : details.mode === "status"
      ? "Unity Project Status"
      : details.mode === "artifacts"
        ? "Unity Artifacts"
        : getBatchmodeVariantLabel(details.args);
  const projectLabel = details.projectRoot ?? "(unknown project)";
  let text = `${icon} ${theme.fg("toolTitle", theme.bold(title))} ${theme.fg("muted", projectLabel)}`;
  if (details.mode === "batchmode") {
    text += buildBatchmodeStatusLine(details, theme);
    text += buildBatchmodeResultsLine(details, theme);
  } else if (details.mode === "status") {
    text += `\n  ${theme.fg("accent", `status=${details.status ?? "passed"}`)}`;
  }

  if (expanded && primaryText) {
    text += `\n\n${theme.fg("toolOutput", primaryText)}`;
  } else if (!expanded && details.mode === "batchmode") {
    const snippet = summarizeTextForAgent(details.stderr) ?? summarizeTextForAgent(details.stdout);
    if (snippet) {
      text += `\n  ${theme.fg("muted", snippet.split(/\r?\n/)[0])}`;
    }
  }

  return new Text(text, 0, 0);
}

export default function freeUnityPi(pi: ExtensionAPI) {
  pi.registerCommand("unity-open", {
    description: "Open the Unity Editor GUI for the current Unity project copy or choose one from nearby candidates.",
    handler: async (args, ctx) => {
      try {
        const { candidate, discoveryWarning } = await resolveProjectCandidate(ctx, args.trim() || undefined);
        const processWarning = await enforceSingleProcessRule(candidate.projectRoot);
        let launcher: "unity-cli" | "editor-executable" = "editor-executable";
        let editorPath = await resolveUnityEditorPath(candidate.unityVersion).catch(() => "Unity CLI resolved editor");
        let launch: { pid: number | undefined; args: string[]; command: string };
        if (await canUseUnityCli(pi)) {
          launcher = "unity-cli";
          launch = launchUnityCliOpenDetached(candidate.projectRoot, { editorVersion: candidate.unityVersion });
        } else {
          editorPath = await resolveUnityEditorPath(candidate.unityVersion);
          launch = launchUnityEditorDetached(editorPath, candidate.projectRoot);
        }
        const summary = buildEditorLaunchSummary(ctx.cwd, candidate, editorPath, processWarning ?? discoveryWarning, launcher);
        ctx.ui.notify(summary, "info");
        if (launch.pid) {
          ctx.ui.notify(`Unity process started with pid ${launch.pid}.`, "info");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
        ctx.ui.notify(message, "error");
      }
    },
  });

  pi.registerTool({
    name: "unity_project_status",
    label: "Unity Project Status",
    description: "Inspect Unity project lockfile and running-process status without launching Unity.",
    promptSnippet: "Show whether a Unity project appears busy, has a native Unity lockfile, or has a stale lockfile before launch.",
    promptGuidelines: [
      "Use this when Unity launch attempts are blocked by project lockfiles or when you need to know whether a Unity project is currently open.",
      "Do not delete Unity lockfiles automatically; report the status and safe next action to the user.",
      "If Unity CLI is configured, status includes Unity CLI process discovery plus direct process scanning.",
    ],
    parameters: PROJECT_STATUS_PARAMS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      throwIfAborted(signal);
      const { candidate } = await resolveProjectCandidate(ctx, params.path);
      throwIfAborted(signal);
      const report = await buildProjectStatusReport(ctx, candidate);
      return {
        content: [{ type: "text", text: report.text }],
        details: report.details,
        isError: report.details.status === "failed",
      };
    },
    renderCall(args, theme) {
      return renderUnityToolCall("unity_project_status", args, theme, "status", "inspects project lock");
    },
    renderResult(result, { expanded }, theme) {
      return renderUnityToolResult(result, expanded, theme);
    },
  });

  pi.registerTool({
    name: "unity_inspect_artifacts",
    label: "Unity Inspect Artifacts",
    description: "Summarize existing Unity log files and Unity Test Framework XML results without launching Unity.",
    promptSnippet: "Inspect existing Unity logs or test result XML files without launching Unity.",
    promptGuidelines: [
      "Use unity_inspect_artifacts after Unity failures when existing -testResults or -logFile artifacts need concise parsing without another Unity launch.",
      "Prefer unity_inspect_artifacts over ad hoc bash parsing of Unity XML/log files when paths are known or Logs/ contains recent artifacts.",
      "unity_inspect_artifacts does not launch Unity and is safe to use even when the Unity project is busy.",
    ],
    parameters: INSPECT_ARTIFACTS_PARAMS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      throwIfAborted(signal);
      const { candidate } = await resolveProjectCandidate(ctx, params.path);
      throwIfAborted(signal);
      const report = await buildArtifactInspectionReport(ctx, candidate, params);
      return {
        content: [{ type: "text", text: report.text }],
        details: report.details,
        isError: report.details.status === "failed",
      };
    },
    renderCall(args, theme) {
      return renderUnityToolCall("unity_inspect_artifacts", args, theme, "artifacts", "reads logs/results");
    },
    renderResult(result, { expanded }, theme) {
      return renderUnityToolResult(result, expanded, theme);
    },
  });

  pi.registerTool({
    name: "unity_open_editor",
    label: "Unity Open Editor",
    description: "Open the Unity Editor GUI for a Unity project copy.",
    promptSnippet: "Open the Unity Editor GUI for a resolved Unity project when the user explicitly asks for the editor to open.",
    promptGuidelines: [
      "Use this tool only when the user explicitly wants the Unity Editor GUI opened.",
      "This launches the GUI editor and is not the same as batchmode/headless Unity.",
      "Unity allows only one process per project folder; GUI and batchmode both count.",
      "If the target folder is ambiguous, ask the user to pick the project copy or pass path explicitly.",
      "Use launcher='editor-executable' when Unity CLI argument handling or Hub project resolution is suspected to differ from direct Editor launch.",
    ],
    parameters: OPEN_EDITOR_PARAMS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      throwIfAborted(signal);
      const { candidate, discoveryWarning } = await resolveProjectCandidate(ctx, params.path);
      throwIfAborted(signal);
      const processWarning = await enforceSingleProcessRule(candidate.projectRoot);
      throwIfAborted(signal);
      const useUnityCli = await shouldUseUnityCli(pi, params.launcher as UnityLauncherPreference | undefined, signal);
      throwIfAborted(signal);
      let launcher: "unity-cli" | "editor-executable" = "editor-executable";
      let editorPath = await resolveUnityEditorPath(candidate.unityVersion, { overridePath: params.unityEditorPath }).catch(() => "Unity CLI resolved editor");
      let launch: { pid: number | undefined; args: string[]; command: string };
      if (useUnityCli) {
        launcher = "unity-cli";
        launch = launchUnityCliOpenDetached(candidate.projectRoot, {
          editorVersion: candidate.unityVersion,
          editorPath: params.unityEditorPath,
        });
      } else {
        editorPath = await resolveUnityEditorPath(candidate.unityVersion, { overridePath: params.unityEditorPath });
        launch = launchUnityEditorDetached(editorPath, candidate.projectRoot);
      }
      const text = buildEditorLaunchSummary(ctx.cwd, candidate, editorPath, processWarning ?? discoveryWarning, launcher);

      return {
        content: [{ type: "text", text }],
        details: {
          mode: "gui",
          projectRoot: candidate.projectRoot,
          unityVersion: candidate.unityVersion,
          editorPath,
          pid: launch.pid,
          command: launch.command,
          args: launch.args,
          warning: processWarning ?? discoveryWarning,
          launcher,
        } satisfies UnityToolDetails,
      };
    },
    renderCall(args, theme) {
      return renderUnityToolCall("unity_open_editor", args, theme, "gui", "opens editor window");
    },
    renderResult(result, { expanded }, theme) {
      return renderUnityToolResult(result, expanded, theme);
    },
  });

  pi.registerTool({
    name: "unity_launch_batchmode",
    label: "Unity CLI",
    description: "Run Unity via CLI in batchmode for a resolved Unity project copy.",
    promptSnippet: "Launch Unity via CLI in batchmode for a resolved Unity project when the user explicitly asks for batchmode or when a Unity workflow needs it.",
    promptGuidelines: [
      "Use this tool for Unity CLI batchmode execution, not for opening the GUI editor.",
      "Unity allows only one process per project folder; GUI and batchmode both count.",
      "Never run batchmode against a project that is already open in the GUI editor or already running in batchmode.",
      "If a launch is blocked by a Unity lockfile, call unity_project_status before asking the user to remove anything.",
      "For Unity Test Framework runs, always provide absolute -testResults and -logFile paths when practical so the tool can summarize results compactly for the agent.",
      "Prefer reasoning over structured test results and concise excerpts instead of dumping full Unity logs into context.",
      "Do not add -quit automatically for test workflows that rely on the Unity Test Framework runTests behavior; pass only the arguments actually needed.",
      "Use launcher='editor-executable' when a Unity CLI wrapper argument differs from direct Editor executable behavior; in auto mode, args are forwarded after `unity run <project> --`.",
    ],
    parameters: LAUNCH_BATCHMODE_PARAMS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      throwIfAborted(signal);
      const { candidate, discoveryWarning } = await resolveProjectCandidate(ctx, params.path);
      throwIfAborted(signal);

      return withUnityProjectLaunchMutex(
        candidate.projectRoot,
        { mode: "batchmode", toolName: "unity_launch_batchmode" },
        async () => {
          throwIfAborted(signal);
          const timeoutSeconds = params.timeoutSeconds ?? 3600;
          const timeoutMs = timeoutSeconds * 1000;
          const useUnityCli = await shouldUseUnityCli(pi, params.launcher as UnityLauncherPreference | undefined, signal);
          throwIfAborted(signal);
          const lockState = useUnityCli
            ? await inspectUnityProjectBusyState(candidate.projectRoot)
            : await assertUnityProjectNotBusy(candidate.projectRoot);
          throwIfAborted(signal);
          const processWarning = await enforceSingleProcessRule(candidate.projectRoot);
          const lockWarning = useUnityCli && lockState.nativeLockfileExists
            ? `Unity CLI launch selected; native Unity lockfile exists at ${lockState.nativeLockfilePath}. No running project process was found by pi-unity preflight, so the launch is being delegated to the Unity CLI instead of blocked as a stale lockfile.`
            : undefined;
          throwIfAborted(signal);
          const editorPath = useUnityCli
            ? await resolveUnityEditorPath(candidate.unityVersion, { overridePath: params.unityEditorPath }).catch(() => "Unity CLI resolved editor")
            : await resolveUnityEditorPath(candidate.unityVersion, { overridePath: params.unityEditorPath });
          const command = useUnityCli
            ? createUnityCliRunCommand(candidate.projectRoot, params.args ?? [], {
              editorVersion: candidate.unityVersion,
              editorPath: params.unityEditorPath,
              timeoutSeconds,
            })
            : createUnityBatchmodeCommand(editorPath, candidate.projectRoot, params.args ?? []);
          const result = await pi.exec(command.command, command.args, { signal, timeout: useUnityCli ? timeoutMs + 30_000 : timeoutMs });
          throwIfAborted(signal);
          const reportArgs = useUnityCli ? createUnityCliBatchmodeReportArgs(candidate.projectRoot, params.args ?? []) : command.args;
          const report = await buildBatchmodeReport(
            ctx,
            candidate,
            editorPath,
            { code: result.code, stdout: result.stdout, stderr: result.stderr, killed: result.killed },
            reportArgs,
            joinWarnings(processWarning, lockWarning, discoveryWarning),
          );
          report.details.command = command.command;
          report.details.cliArgs = useUnityCli ? command.args : undefined;
          report.details.launcher = useUnityCli ? "unity-cli" : "editor-executable";

          if (result.killed) {
            throw new Error(report.text);
          }

          return {
            content: [{ type: "text", text: report.text }],
            details: report.details,
            isError: report.details.status === "failed",
          };
        },
      );
    },
    renderCall(args, theme) {
      return renderUnityToolCall("unity_launch_batchmode", args, theme, "batchmode", getBatchmodeVariantLabel(args.args));
    },
    renderResult(result, { expanded }, theme) {
      return renderUnityToolResult(result, expanded, theme);
    },
  });
}
