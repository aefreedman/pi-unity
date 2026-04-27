import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@mariozechner/pi-tui";
import {
  buildUnityBatchmodeAgentText,
  loadUnityBatchmodeArtifacts,
  parseUnityBatchmodeInvocation,
  parseUnityTestResultsXml,
  summarizeTextForAgent,
  type UnityBatchmodeArtifacts,
  type UnityBatchmodeInvocation,
  type UnityParsedTestResults,
} from "./src/unity-batchmode";
import { formatPathForUser } from "./src/unity-core";
import { createUnityBatchmodeCommand, launchUnityEditorDetached, resolveUnityEditorPath } from "./src/unity-launch";
import { listRunningUnityProcessesForProject } from "./src/unity-processes";
import { assertUnityProjectNotBusy, withUnityProjectLaunchMutex } from "./src/unity-project-lock";
import { resolveUnityProjectCandidates, type UnityProjectCandidate } from "./src/unity-projects";

const GUI_WARNING = "This launches the full Unity Editor GUI and is not the same as batchmode/headless Unity.";
const SINGLE_PROCESS_WARNING = "Unity allows only one process per project folder. GUI Editor and batchmode/headless both count as that one process.";

type UnityToolDetails = {
  mode: "gui" | "batchmode";
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
};

const OPEN_EDITOR_PARAMS = Type.Object({
  path: Type.Optional(Type.String({ description: "Unity project path, workspace copy root, or folder containing project copies." })),
  unityEditorPath: Type.Optional(Type.String({ description: "Optional explicit Unity executable path override." })),
});

const LAUNCH_BATCHMODE_PARAMS = Type.Object({
  path: Type.Optional(Type.String({ description: "Unity project path, workspace copy root, or folder containing project copies." })),
  unityEditorPath: Type.Optional(Type.String({ description: "Optional explicit Unity executable path override." })),
  args: Type.Optional(Type.Array(Type.String(), { description: "Additional Unity command-line arguments appended after -batchmode -projectPath <project>." })),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 14400, default: 3600, description: "Timeout in seconds for the batchmode process." })),
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

async function enforceSingleProcessRule(projectRoot: string): Promise<string | undefined> {
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

  return running.warning;
}

function buildEditorLaunchSummary(
  cwd: string,
  candidate: UnityProjectCandidate,
  editorPath: string,
  warning?: string,
): string {
  return [
    `Launched Unity Editor GUI for ${formatPathForUser(cwd, candidate.projectRoot)} using Unity ${candidate.unityVersion}.`,
    `Editor: ${editorPath}`,
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
  const title = details.mode === "gui" ? "Unity Editor" : getBatchmodeVariantLabel(details.args);
  const projectLabel = details.projectRoot ?? "(unknown project)";
  let text = `${icon} ${theme.fg("toolTitle", theme.bold(title))} ${theme.fg("muted", projectLabel)}`;
  if (details.mode === "batchmode") {
    text += buildBatchmodeStatusLine(details, theme);
    text += buildBatchmodeResultsLine(details, theme);
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
        const editorPath = await resolveUnityEditorPath(candidate.unityVersion);
        const launch = launchUnityEditorDetached(editorPath, candidate.projectRoot);
        const summary = buildEditorLaunchSummary(ctx.cwd, candidate, editorPath, processWarning ?? discoveryWarning);
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
    name: "unity_open_editor",
    label: "Unity Open Editor",
    description: "Open the Unity Editor GUI for a Unity project copy.",
    promptSnippet: "Open the Unity Editor GUI for a resolved Unity project when the user explicitly asks for the editor to open.",
    promptGuidelines: [
      "Use this tool only when the user explicitly wants the Unity Editor GUI opened.",
      "This launches the GUI editor and is not the same as batchmode/headless Unity.",
      "Unity allows only one process per project folder; GUI and batchmode both count.",
      "If the target folder is ambiguous, ask the user to pick the project copy or pass path explicitly.",
    ],
    parameters: OPEN_EDITOR_PARAMS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      throwIfAborted(signal);
      const { candidate, discoveryWarning } = await resolveProjectCandidate(ctx, params.path);
      throwIfAborted(signal);
      const processWarning = await enforceSingleProcessRule(candidate.projectRoot);
      throwIfAborted(signal);
      const editorPath = await resolveUnityEditorPath(candidate.unityVersion, { overridePath: params.unityEditorPath });
      throwIfAborted(signal);
      const launch = launchUnityEditorDetached(editorPath, candidate.projectRoot);
      const text = buildEditorLaunchSummary(ctx.cwd, candidate, editorPath, processWarning ?? discoveryWarning);

      return {
        content: [{ type: "text", text }],
        details: {
          mode: "gui",
          projectRoot: candidate.projectRoot,
          unityVersion: candidate.unityVersion,
          editorPath,
          pid: launch.pid,
          warning: processWarning ?? discoveryWarning,
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
      "For Unity Test Framework runs, always provide absolute -testResults and -logFile paths when practical so the tool can summarize results compactly for the agent.",
      "Prefer reasoning over structured test results and concise excerpts instead of dumping full Unity logs into context.",
      "Do not add -quit automatically for test workflows that rely on the Unity Test Framework runTests behavior; pass only the arguments actually needed.",
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
          await assertUnityProjectNotBusy(candidate.projectRoot);
          throwIfAborted(signal);
          const processWarning = await enforceSingleProcessRule(candidate.projectRoot);
          throwIfAborted(signal);
          const editorPath = await resolveUnityEditorPath(candidate.unityVersion, { overridePath: params.unityEditorPath });
          const batchmode = createUnityBatchmodeCommand(editorPath, candidate.projectRoot, params.args ?? []);
          const timeoutMs = (params.timeoutSeconds ?? 3600) * 1000;
          const result = await pi.exec(batchmode.command, batchmode.args, { signal, timeout: timeoutMs });
          throwIfAborted(signal);
          const report = await buildBatchmodeReport(
            ctx,
            candidate,
            editorPath,
            { code: result.code, stdout: result.stdout, stderr: result.stderr, killed: result.killed },
            batchmode.args,
            processWarning ?? discoveryWarning,
          );

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
