import { redactUnityCredentials } from "./unity-redaction";
import { highlightCode, keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { UnityToolDetails } from "../index";
import type { UnityGuidanceAuditResult } from "./unity-guidance-audit";

type Args = { path?: string; args?: unknown[]; code?: string; command?: string; file?: string; entry?: string; dryRun?: boolean; testPlatform?: string; testFilter?: string; testFilters?: string[]; testCategories?: string[]; execution?: string };
type Context = { lastComponent?: unknown; args?: Args; isError?: boolean; expanded?: boolean };
type Result = { content?: Array<{ type: string; text?: string }>; details?: unknown };
type Options = { expanded: boolean; isPartial?: boolean };

function redact(value: string): string {
  return redactUnityCredentials(value).replace(/([:=])\s+(\[redacted\])/gi, "$1$2")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}
export function compactUnityRendererValue(value: unknown, limit = 160): string {
  const text = redact(String(value ?? "")).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
function reuse(context: Context | undefined, value: string): Text {
  const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  text.setText(value);
  return text;
}
function projectName(path?: string): string {
  return compactUnityRendererValue(path?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "auto-resolve", 70);
}
const titles: Record<string, string> = {
  unity_project_status: "Project status", unity_run_tests: "Tests", unity_pipeline_run_tests: "Tests",
  unity_pipeline_recompile: "Recompile", unity_pipeline_eval: "Eval", unity_pipeline_inspect: "Inspect",
  unity_pipeline_run_script: "Run script", unity_inspect_artifacts: "Artifacts", unity_open_editor: "Open Editor",
  unity_launch_batchmode: "Batchmode", unity_guidance_audit: "Guidance audit",
};
export function renderUnityToolCall(name: string, args: Args, theme: Pick<Theme, "fg" | "bold">, _mode?: string, _emphasis?: string, context?: Context): Text {
  const title = args.testPlatform ? `${args.testPlatform} tests` : titles[name] ?? name;
  let text = theme.fg("toolTitle", theme.bold(`Unity · ${title}`)) + theme.fg("dim", `  ${projectName(args.path)}`);
  let subtitle = "";
  if (args.code !== undefined) subtitle = compactUnityRendererValue(args.code, 140);
  else if (args.file) subtitle = `${compactUnityRendererValue(args.file, 120)}${args.entry ? ` · ${compactUnityRendererValue(args.entry, 60)}` : ""}${args.dryRun ? " · compile only" : ""}`;
  else if (args.command) subtitle = compactUnityRendererValue(args.command.replace(/_/g, " "), 100);
  else if (args.testPlatform) {
    subtitle = [...(args.testFilters ?? (args.testFilter ? [args.testFilter] : [])), ...(args.testCategories ?? []).map(value => `category: ${value}`)].map(value => compactUnityRendererValue(value, 100)).join(" · ") || "All tests";
    subtitle = compactUnityRendererValue(subtitle, 180);
  } else if (name === "unity_launch_batchmode") subtitle = _emphasis ?? "";
  if (subtitle && !(args.code && context?.expanded)) text += `\n${theme.fg("muted", subtitle)}`;
  return reuse(context, text);
}
export function renderUnityPipelineCall(name: string, args: Args, theme: Pick<Theme, "fg" | "bold">, context: Context): Text {
  return renderUnityToolCall(name, args, theme, undefined, undefined, context);
}
function content(result: Result): string {
  return redact((result.content ?? []).filter(entry => entry.type === "text").map(entry => entry.text ?? "").join("\n"));
}
function counts(summary?: { passed?: number; failed?: number; skipped?: number }): string {
  return summary ? (["passed", "failed", "skipped"] as const).filter(key => summary[key] !== undefined).map(key => `${summary[key]} ${key}`).join(" · ") : "";
}
function prettyOutput(output: string): string {
  const safe = redact(output);
  try { JSON.parse(safe); }
  catch (error) { if (error instanceof SyntaxError) return safe; throw error; }

  // Validate with JSON.parse, but format tokens directly so JSON number and string lexemes stay exact.
  let formatted = "";
  let depth = 0;
  const indent = () => "  ".repeat(depth);
  for (let index = 0; index < safe.length; index++) {
    const character = safe[index];
    if (/\s/.test(character)) continue;
    if (character === '"') {
      const start = index++;
      while (index < safe.length) {
        if (safe[index] === "\\") index++;
        else if (safe[index] === '"') break;
        index++;
      }
      formatted += safe.slice(start, index + 1);
    } else if (character === "{" || character === "[") {
      let next = index + 1;
      while (/\s/.test(safe[next] ?? "")) next++;
      if (safe[next] === (character === "{" ? "}" : "]")) {
        formatted += character + safe[next];
        index = next;
      } else {
        formatted += `${character}\n`;
        depth++;
        formatted += indent();
      }
    } else if (character === "}" || character === "]") {
      depth--;
      formatted += `\n${indent()}${character}`;
    } else if (character === ",") formatted += `,\n${indent()}`;
    else if (character === ":") formatted += ": ";
    else formatted += character;
  }
  return formatted;
}
export function renderUnityPipelineResult(result: Result, options: Options, theme: Pick<Theme, "fg" | "bold">, context: Context): Text {
  return renderUnityToolResult(result, options.expanded, theme, context, options.isPartial);
}
export function renderUnityToolResult(result: Result, expanded: boolean, theme: Pick<Theme, "fg" | "bold">, context?: Context, isPartial = false): Text {
  const primary = content(result);
  const details = result.details as UnityToolDetails | undefined;
  if (isPartial) return reuse(context, theme.fg("warning", `… ${compactUnityRendererValue(primary || "Waiting for Unity…", 200)}`));
  if (!details?.mode) {
    const text = expanded ? primary : compactUnityRendererValue(primary || "No output", 280);
    return reuse(context, theme.fg(context?.isError ? "error" : "toolOutput", text) + (!expanded && primary ? `\n${theme.fg("dim", keyHint("app.tools.expand", "details"))}` : ""));
  }
  const pipeline = details.pipeline;
  const tests = details.testResult;
  const output = details.pipelineEval ?? details.pipelineInspection ?? details.pipelineRunScript;
  const outcome = tests?.outcome ?? details.testOutcome;
  const uncertain = outcome && ["uncertain", "empty_selection", "timed_out", "cancelled", "passed_with_flakes"].includes(outcome);
  const failed = context?.isError || details.status === "failed" || outcome === "tests_failed" || outcome === "run_error" || output?.outcome === "rejected";
  const tone = uncertain || details.status === "killed" || details.projectState?.processVerificationIncomplete || details.projectState?.staleLockSuspected ? "warning" : failed ? "error" : details.status === "passed" || details.mode === "gui" ? "success" : "warning";
  let summary: string = details.status ?? "Completed";
  if (details.mode === "status") {
    const capabilities = details.cliCapabilities;
    const reachable = capabilities?.matchingInstances.some(instance => instance.reachable === true);
    const state = details.projectState;
    summary = reachable ? "Editor open · Pipeline reachable"
      : capabilities?.matchingInstances.length || state?.runningProcessCount ? "Editor detected · Pipeline reachability unconfirmed"
      : state?.processVerificationIncomplete ? "Process state uncertain"
      : state?.staleLockSuspected ? "No Editor detected · lock may be stale"
      : state ? `No Editor detected · lock ${state.nativeLockfileExists ? "present" : "absent"}`
      : "Project inspected · expand for process and lock state";
    if (details.unityVersion) summary += ` · Unity ${details.unityVersion}`;
  } else if (tests || details.mode === "artifacts") {
    summary = `${details.mode === "artifacts" ? `Inspection ${details.status ?? "unknown"} · Tests: ` : ""}${(outcome ?? "not established").replace(/_/g, " ")}`;
    const testCounts = counts(tests?.summary ?? details.normalizedResult?.summary ?? details.parsedTestResults ?? undefined);
    if (testCounts) summary = details.mode === "tests" && outcome === "passed" ? testCounts : `${summary} · ${testCounts}`;
    if (tests?.durationSeconds !== undefined) summary += ` · ${tests.durationSeconds.toFixed(1)}s`;
    if (details.route) summary += ` · ${details.route}`;
  } else if (pipeline) {
    summary = `${pipeline.operation === "recompile" ? "Recompile" : "Tests"} ${pipeline.terminalState} · ${pipeline.elapsedSeconds.toFixed(1)}s`;
    const testCounts = counts(pipeline.counts);
    if (testCounts) summary += ` · ${testCounts}`;
  } else if (output) {
    summary = output.outcome === "rejected" ? compactUnityRendererValue(output.message, 240) : expanded ? "Completed" : compactUnityRendererValue(output.output || "No output returned", 240);
    if (output.outcome === "dispatched" && output.truncated && !expanded) summary += " · output truncated";
  }
  else if (details.mode === "gui") summary = `Editor launched${details.pid ? ` · PID ${details.pid}` : ""}`;
  else if (details.mode === "batchmode") summary = `${details.status ?? "unknown"} · exit ${details.exitCode ?? "unknown"}${counts(details.parsedTestResults ?? undefined) ? ` · ${counts(details.parsedTestResults ?? undefined)}` : ""}`;
  let text = theme.fg(tone, `${tone === "success" ? "✓" : tone === "error" ? "✗" : "!"} ${summary}`);
  const notices = [details.warning, ...(pipeline?.warnings ?? []), ...(details.evidenceWarnings ?? []), ...(tests?.diagnostics ?? [])].filter((value): value is string => Boolean(value));
  if (pipeline?.playModeHandling && pipeline.playModeHandling !== "not_playing") notices.push(pipeline.playModeHandling === "agent_exited" ? "Play Mode exited by pi-unity" : `Play Mode: ${pipeline.playModeHandling.replace(/_/g, " ")}`);
  if (notices.length) text += `\n${theme.fg("warning", compactUnityRendererValue(notices.join(" · "), expanded ? 1000 : 240))}`;
  const nonPassing = tests?.tests?.filter(test => !["passed", "success"].includes(test.status.toLowerCase())) ?? [];
  const failures = nonPassing.filter(test => ["failed", "error"].includes(test.status.toLowerCase()));
  const diagnostics = nonPassing.filter(test => !["failed", "error"].includes(test.status.toLowerCase()));
  for (const test of [...failures, ...diagnostics].slice(0, expanded ? 8 : 1)) text += `\n${theme.fg("warning", compactUnityRendererValue(`${test.name}: ${test.message || test.status}`, expanded ? 1000 : 200))}`;
  if (expanded) {
    const section = (title: string, body: string) => { if (body) text += `\n\n${theme.fg("toolTitle", theme.bold(title))}\n${body}`; };
    section("Project", theme.fg("muted", redact(details.projectRoot || context?.args?.path || "Unknown project")));
    if (context?.args?.code) section("C#", highlightCode(redact(context.args.code), "csharp").join("\n"));
    if (context?.args?.file) section("Script", theme.fg("toolOutput", redact(`${context.args.file}${context.args.entry ? `\nEntry: ${context.args.entry}` : ""}${context.args.dryRun ? "\nCompile only" : ""}`)));
    if (output?.outcome === "dispatched") section(`Result${output.truncated ? " (truncated)" : ""}`, theme.fg("toolOutput", prettyOutput(output.output)));
    section("Evidence", theme.fg("toolOutput", primary));
    const paths = [...new Set([details.artifactPath, details.normalizedResultPath, details.artifacts?.testResultsPath, details.artifacts?.logFilePath, ...Object.values(tests?.backendArtifacts ?? {})].filter((value): value is string => Boolean(value)))];
    section("Artifacts", theme.fg("muted", redact(paths.join("\n"))));
  } else text += `\n${theme.fg("dim", keyHint("app.tools.expand", "details"))}`;
  return reuse(context, text);
}

export function renderUnityGuidanceResult(result: Result, options: Options, theme: Pick<Theme, "fg" | "bold">, context: Context): Text {
  const details = result.details as UnityGuidanceAuditResult | undefined;
  if (!details?.summary) return renderUnityToolResult(result, options.expanded, theme, context, options.isPartial);
  const { filesScanned, errors, warnings, infos } = details.summary;
  const ancestors = details.ancestorCandidates.length;
  const tone = errors ? "error" : warnings || ancestors ? "warning" : "success";
  let text = theme.fg(tone, `${tone === "success" ? "✓" : "!"} ${filesScanned} files · ${errors} errors · ${warnings} warnings · ${infos} info`);
  if (ancestors) text += `\n${theme.fg("warning", `${ancestors} ancestor files excluded`)}`;
  if (options.expanded) text += `\n\n${theme.fg("toolTitle", theme.bold("Findings"))}\n${theme.fg("toolOutput", content(result))}`;
  else text += `\n${theme.fg("dim", keyHint("app.tools.expand", "details"))}`;
  return reuse(context, text);
}
