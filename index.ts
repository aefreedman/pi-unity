import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { readdir, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getKeybindings, Text, truncateToWidth } from "@mariozechner/pi-tui";
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
import { formatPathForUser, hasUnityCommandLineFlag } from "./src/unity-core";
import { createUnityCliBatchmodeReportArgs, createUnityCliEditorExitCommand, createUnityCliRunCommand, listRunningUnityCliEditorsForProject, resolveUnityCliCommand } from "./src/unity-cli";
import { createUnityBatchmodeCommand, launchUnityCliOpenDetached, launchUnityEditorDetached, resolveUnityEditorPath } from "./src/unity-launch";
import { loadPiUnitySettings, type PiUnitySettings } from "./src/pi-unity-settings";
import { dedupeRunningUnityProcesses, listRunningUnityProcessesForProject, terminateRunningUnityProcesses, type RunningUnityProcess } from "./src/unity-processes";
import { assertUnityProjectNotBusy, getUnityNativeLockfilePath, inspectUnityProjectBusyState, withUnityProjectLaunchMutex } from "./src/unity-project-lock";
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
  closedProcesses?: RunningUnityProcess[];
  forceClosedProcesses?: RunningUnityProcess[];
  removedLockfile?: string;
  piUnitySettings?: PiUnitySettings;
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
  args: Type.Optional(Type.Array(Type.String(), { description: "Additional Unity command-line arguments appended after -batchmode -projectPath <project> for direct editor launch, or forwarded after `unity run <project> --` for Unity CLI launch. pi-unity adds -nographics by default unless useGraphics=true." })),
  useGraphics: Type.Optional(Type.Boolean({ default: false, description: "Set true only when the requested Unity batchmode work requires an active graphics device, such as screenshots, rendering, or visual PlayMode tests. Defaults to false, which adds -nographics." })),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 14400, default: 3600, description: "Timeout in seconds for the batchmode process." })),
  launcher: LAUNCHER_SCHEMA,
  closeBlockingUnityProcess: Type.Optional(Type.Boolean({ default: false, description: "When true, pi-unity may close a running Unity process for the resolved project before launch, but only if piUnity.allowCloseRunningUnityProcess is enabled in Pi settings. The process is selected by project matching, not by model-supplied PID." })),
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

async function chooseProjectCandidateWithWrappingNavigation(
  ctx: ExtensionContext,
  candidates: UnityProjectCandidate[],
): Promise<UnityProjectCandidate | null | undefined> {
  if (ctx.mode !== "tui") {
    return undefined;
  }

  return await ctx.ui.custom<UnityProjectCandidate | null>((tui, theme, _keybindings, done) => {
    let selectedIndex = 0;
    const maxVisible = Math.min(candidates.length, 8);

    const renderCandidate = (candidate: UnityProjectCandidate, isSelected: boolean, width: number): string => {
      const prefix = isSelected ? "→ " : "  ";
      const label = `${prefix}${buildProjectChoiceLabel(ctx.cwd, candidate)}`;
      const line = truncateToWidth(label, Math.max(10, width - 2), "");
      return isSelected ? theme.fg("accent", theme.bold(line)) : line;
    };

    return {
      render(width: number): string[] {
        const lines = [
          theme.fg("accent", theme.bold("Select Unity project")),
          theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
          "",
        ];
        const startIndex = Math.max(
          0,
          Math.min(selectedIndex - Math.floor(maxVisible / 2), candidates.length - maxVisible),
        );
        const endIndex = Math.min(startIndex + maxVisible, candidates.length);
        for (let index = startIndex; index < endIndex; index += 1) {
          const candidate = candidates[index];
          if (!candidate) continue;
          lines.push(renderCandidate(candidate, index === selectedIndex, width));
        }
        if (startIndex > 0 || endIndex < candidates.length) {
          lines.push(theme.fg("dim", `(${selectedIndex + 1}/${candidates.length})`));
        }
        return lines;
      },
      invalidate() {},
      handleInput(data: string) {
        const keybindings = getKeybindings();
        if (keybindings.matches(data, "tui.select.up")) {
          selectedIndex = selectedIndex === 0 ? candidates.length - 1 : selectedIndex - 1;
          tui.requestRender();
          return;
        }
        if (keybindings.matches(data, "tui.select.down")) {
          selectedIndex = selectedIndex === candidates.length - 1 ? 0 : selectedIndex + 1;
          tui.requestRender();
          return;
        }
        if (keybindings.matches(data, "tui.select.confirm")) {
          done(candidates[selectedIndex]);
          return;
        }
        if (keybindings.matches(data, "tui.select.cancel")) {
          done(null);
        }
      },
    };
  });
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

  const wrappedSelection = await chooseProjectCandidateWithWrappingNavigation(ctx, candidates);
  if (wrappedSelection === null) {
    throw new Error("No Unity project was selected.");
  }
  if (wrappedSelection) {
    return wrappedSelection;
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

async function listBlockingUnityProcesses(projectRoot: string): Promise<{ processes: RunningUnityProcess[]; warning?: string }> {
  const cliStatus = await listRunningUnityCliEditorsForProject(projectRoot);
  const running = await listRunningUnityProcessesForProject(projectRoot);
  return {
    processes: dedupeRunningUnityProcesses([...cliStatus.processes, ...running.processes]),
    warning: joinWarnings(cliStatus.warning, running.warning),
  };
}

function formatProcessSummary(processes: RunningUnityProcess[]): string {
  return processes
    .map((process) => `${process.pid ?? "?"}: ${process.commandLine}`)
    .join("\n");
}

async function enforceSingleProcessRule(projectRoot: string): Promise<string | undefined> {
  const running = await listBlockingUnityProcesses(projectRoot);
  if (running.processes.length > 0) {
    throw new Error(
      [
        `Refusing to launch Unity for ${projectRoot} because another Unity process already targets this project.`,
        SINGLE_PROCESS_WARNING,
        formatProcessSummary(running.processes),
      ].join("\n"),
    );
  }

  return running.warning;
}

function assertMayCloseBlockingUnityProcess(
  settings: PiUnitySettings,
  invocation: UnityBatchmodeInvocation,
): void {
  if (!settings.allowCloseRunningUnityProcess) {
    throw new Error("A running Unity process targets this project, but piUnity.allowCloseRunningUnityProcess is not enabled in Pi settings.");
  }

  if (settings.closeRunningUnityProcessOnlyForTests && !invocation.isTestRun) {
    throw new Error("Refusing to close a running Unity process because piUnity.closeRunningUnityProcessOnlyForTests is enabled and this batchmode launch is not a Unity Test Framework run.");
  }
}

async function waitForBlockingUnityProcessesToExit(projectRoot: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    const running = await listBlockingUnityProcesses(projectRoot);
    if (running.warning) {
      throw new Error(`Could not verify that the blocking Unity process exited: ${running.warning}`);
    }
    if (running.processes.length === 0) return;
    await delay(500, undefined, { signal });
  }

  const running = await listBlockingUnityProcesses(projectRoot);
  throw new Error(
    [
      `Timed out waiting for Unity process to exit for ${projectRoot}.`,
      formatProcessSummary(running.processes),
    ].filter(Boolean).join("\n"),
  );
}

async function closeBlockingUnityProcessesForBatchmode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  candidate: UnityProjectCandidate,
  invocation: UnityBatchmodeInvocation,
  closeRequested: boolean,
  signal?: AbortSignal,
): Promise<{ warning?: string; closedProcesses: RunningUnityProcess[]; forceClosedProcesses: RunningUnityProcess[]; settings: PiUnitySettings }> {
  const settings = await loadPiUnitySettings(ctx);
  const running = await listBlockingUnityProcesses(candidate.projectRoot);
  if (running.processes.length === 0) {
    return { warning: running.warning, closedProcesses: [], forceClosedProcesses: [], settings };
  }

  if (!closeRequested) {
    return { warning: running.warning, closedProcesses: [], forceClosedProcesses: [], settings };
  }

  assertMayCloseBlockingUnityProcess(settings, invocation);

  if (running.warning) {
    throw new Error(`Refusing to close Unity because running-process verification is incomplete: ${running.warning}`);
  }

  const closable = running.processes.filter((process) => typeof process.pid === "number" && Number.isInteger(process.pid) && process.pid > 0);
  if (closable.length === 0) {
    throw new Error(
      [
        "Refusing to close Unity because no matching Unity process reported a PID.",
        formatProcessSummary(running.processes),
      ].join("\n"),
    );
  }

  const canRequestGracefulExit = await canUseUnityCli(pi, signal);
  if (canRequestGracefulExit) {
    const exitCommand = createUnityCliEditorExitCommand(candidate.projectRoot, { timeoutSeconds: 5 });
    const exitResult = await pi.exec(exitCommand.command, exitCommand.args, { signal, timeout: 10_000 });
    if (!exitResult.killed && exitResult.code === 0) {
      try {
        await waitForBlockingUnityProcessesToExit(candidate.projectRoot, Math.min(5_000, settings.closeRunningUnityProcessTimeoutMs), signal);
        return {
          warning: joinWarnings(
            running.warning,
            `Requested graceful Unity Editor exit through Unity CLI before batchmode launch because closeBlockingUnityProcess=true and piUnity.allowCloseRunningUnityProcess is enabled.\n${formatProcessSummary(running.processes)}`,
          ),
          closedProcesses: running.processes,
          forceClosedProcesses: [],
          settings,
        };
      } catch {
        // Fall back to OS-level process termination below when the Editor does not exit promptly.
      }
    }
  }

  const result = await terminateRunningUnityProcesses(closable);

  await waitForBlockingUnityProcessesToExit(candidate.projectRoot, settings.closeRunningUnityProcessTimeoutMs, signal);
  const closedSummary = formatProcessSummary(result.terminated);
  const forceClosedSummary = result.forceTerminated.length > 0
    ? `Windows taskkill required /F for these process(es):\n${formatProcessSummary(result.forceTerminated)}`
    : undefined;
  return {
    warning: joinWarnings(
      running.warning,
      `Closed blocking Unity process before batchmode launch because closeBlockingUnityProcess=true and piUnity.allowCloseRunningUnityProcess is enabled.\n${closedSummary}`,
      forceClosedSummary,
    ),
    closedProcesses: result.terminated,
    forceClosedProcesses: result.forceTerminated,
    settings,
  };
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

async function removeStaleLockfileAfterGuardedClose(
  candidate: UnityProjectCandidate,
  closeReport: { closedProcesses: RunningUnityProcess[] },
): Promise<{ warning?: string; removedLockfile?: string }> {
  if (closeReport.closedProcesses.length === 0) {
    return {};
  }

  const running = await listBlockingUnityProcesses(candidate.projectRoot);
  if (running.warning) {
    throw new Error(`Refusing to remove Unity lockfile after guarded close because running-process verification is incomplete: ${running.warning}`);
  }
  if (running.processes.length > 0) {
    throw new Error(
      [
        "Refusing to remove Unity lockfile after guarded close because a Unity process still targets this project.",
        formatProcessSummary(running.processes),
      ].join("\n"),
    );
  }

  const lockState = await inspectUnityProjectBusyState(candidate.projectRoot);
  if (!lockState.nativeLockfileExists) {
    return {};
  }

  const expectedLockfilePath = resolve(getUnityNativeLockfilePath(candidate.projectRoot));
  const actualLockfilePath = resolve(lockState.nativeLockfilePath);
  if (actualLockfilePath !== expectedLockfilePath) {
    throw new Error(
      [
        "Refusing to remove Unity lockfile after guarded close because the lockfile path is not the resolved project's native lockfile path.",
        `Expected: ${expectedLockfilePath}`,
        `Actual: ${actualLockfilePath}`,
      ].join("\n"),
    );
  }

  try {
    await unlink(actualLockfilePath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  return {
    removedLockfile: actualLockfilePath,
    warning: `Removed stale Unity lockfile after pi-unity closed the matching Unity process in this same guarded batchmode call: ${actualLockfilePath}`,
  };
}

async function buildProjectStatusReport(
  ctx: ExtensionContext,
  candidate: UnityProjectCandidate,
): Promise<{ text: string; details: UnityToolDetails }> {
  const lockState = await inspectUnityProjectBusyState(candidate.projectRoot);
  const cliStatus = await listRunningUnityCliEditorsForProject(candidate.projectRoot);
  const processStatus = await listRunningUnityProcessesForProject(candidate.projectRoot);
  const runningProcesses = dedupeRunningUnityProcesses([...cliStatus.processes, ...processStatus.processes]);
  const isBusy = runningProcesses.length > 0;
  const staleLockSuspected = lockState.nativeLockfileExists && !isBusy && !processStatus.warning;
  const warning = joinWarnings(cliStatus.warning, processStatus.warning);
  const piUnitySettings = await loadPiUnitySettings(ctx);

  const lines = [
    `Unity project status for ${formatPathForUser(ctx.cwd, candidate.projectRoot)} using Unity ${candidate.unityVersion}.`,
    `- Native lockfile: ${lockState.nativeLockfileExists ? "present" : "absent"}`,
    `- Lockfile path: ${lockState.nativeLockfilePath}`,
    `- Running Unity processes targeting project: ${runningProcesses.length}`,
    `- piUnity.allowCloseRunningUnityProcess: ${piUnitySettings.allowCloseRunningUnityProcess ? "enabled" : "disabled"}`,
    `- piUnity.closeRunningUnityProcessOnlyForTests: ${piUnitySettings.closeRunningUnityProcessOnlyForTests ? "enabled" : "disabled"}`,
  ];

  if (runningProcesses.length > 0) {
    lines.push(...runningProcesses.map((process) => `  - ${process.pid ?? "?"}: ${process.commandLine}`));
  }

  if (staleLockSuspected) {
    lines.push("- Assessment: native lockfile may be stale; Unity CLI launches may be able to handle it, but direct Editor launches will be blocked by pi-unity safety checks.");
  } else if (isBusy) {
    lines.push("- Assessment: project is busy; do not start another GUI or batchmode Unity process for this project unless this is a guarded batchmode retry using closeBlockingUnityProcess and piUnity.allowCloseRunningUnityProcess is enabled.");
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
      piUnitySettings,
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
      "Never run batchmode against a project that is already open in the GUI editor or already running in batchmode unless closeBlockingUnityProcess=true and piUnity.allowCloseRunningUnityProcess is enabled for that exact project.",
      "Only set closeBlockingUnityProcess=true for a same-project Unity Test Framework run when the user/project has enabled piUnity.allowCloseRunningUnityProcess; pi-unity selects the matching Unity process itself and does not accept arbitrary PIDs.",
      "When closeBlockingUnityProcess=true, prefer launcher='auto' or launcher='unity-cli' unless direct Editor execution is explicitly required; Unity CLI mode is safer around stale native lockfiles.",
      "If pi-unity closes the matching Unity process during the same guarded batchmode call, it may remove that exact project's stale Temp/UnityLockfile after verifying no matching Unity process remains; do not remove Unity lockfiles yourself.",
      "If a launch is blocked by a Unity lockfile, call unity_project_status before asking the user to remove anything.",
      "By default, pi-unity adds -nographics to batchmode launches to avoid unnecessary graphics initialization and focus stealing.",
      "Leave useGraphics=false for ordinary EditMode, non-visual PlayMode, asset import, build, and CI-style validation runs.",
      "Set useGraphics=true only when the requested work requires an active graphics device, such as screenshots, render-texture checks, visual capture, or graphics-dependent PlayMode tests.",
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
          const extraArgs = params.args ?? [];
          const useGraphics = Boolean(params.useGraphics);
          if (useGraphics && hasUnityCommandLineFlag(extraArgs, "-nographics")) {
            throw new Error("useGraphics=true conflicts with an explicit -nographics argument. Remove -nographics or leave useGraphics=false.");
          }
          const invocation = parseUnityBatchmodeInvocation(createUnityCliBatchmodeReportArgs(candidate.projectRoot, extraArgs, { useGraphics }));
          const useUnityCli = await shouldUseUnityCli(pi, params.launcher as UnityLauncherPreference | undefined, signal);
          throwIfAborted(signal);
          const closeReport = await closeBlockingUnityProcessesForBatchmode(
            pi,
            ctx,
            candidate,
            invocation,
            Boolean(params.closeBlockingUnityProcess),
            signal,
          );
          throwIfAborted(signal);
          const lockfileCleanup = await removeStaleLockfileAfterGuardedClose(candidate, closeReport);
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
            ? createUnityCliRunCommand(candidate.projectRoot, extraArgs, {
              editorVersion: candidate.unityVersion,
              editorPath: params.unityEditorPath,
              timeoutSeconds,
              useGraphics,
            })
            : createUnityBatchmodeCommand(editorPath, candidate.projectRoot, extraArgs, { useGraphics });
          const result = await pi.exec(command.command, command.args, { signal, timeout: useUnityCli ? timeoutMs + 30_000 : timeoutMs });
          throwIfAborted(signal);
          const reportArgs = useUnityCli ? createUnityCliBatchmodeReportArgs(candidate.projectRoot, extraArgs, { useGraphics }) : command.args;
          const report = await buildBatchmodeReport(
            ctx,
            candidate,
            editorPath,
            { code: result.code, stdout: result.stdout, stderr: result.stderr, killed: result.killed },
            reportArgs,
            joinWarnings(closeReport.warning, lockfileCleanup.warning, processWarning, lockWarning, discoveryWarning),
          );
          report.details.command = command.command;
          report.details.cliArgs = useUnityCli ? command.args : undefined;
          report.details.launcher = useUnityCli ? "unity-cli" : "editor-executable";
          report.details.closedProcesses = closeReport.closedProcesses;
          report.details.forceClosedProcesses = closeReport.forceClosedProcesses;
          report.details.removedLockfile = lockfileCleanup.removedLockfile;
          report.details.piUnitySettings = closeReport.settings;

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
      const displayArgs = args.useGraphics ? args.args : ["-nographics", ...(args.args ?? [])];
      return renderUnityToolCall("unity_launch_batchmode", args, theme, "batchmode", getBatchmodeVariantLabel(displayArgs));
    },
    renderResult(result, { expanded }, theme) {
      return renderUnityToolResult(result, expanded, theme);
    },
  });
}
