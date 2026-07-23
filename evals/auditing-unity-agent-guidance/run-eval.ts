import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type EvalCase = {
  id: string;
  fixture: string;
  prompt: string;
  should_trigger: boolean;
  expected_checks: string[];
  working_directory?: string;
};

type Condition = "skill" | "baseline";
type Snapshot = Record<string, string>;

type RunEvidence = {
  answer: string;
  durationMs: number;
  exitCode: number | null;
  toolCalls: Array<{ name: string; args: unknown }>;
  before: Snapshot;
  after: Snapshot;
  guidance: string;
  stderr: string;
  usage: { input: number; output: number; totalTokens: number; cost: number };
};

const here = dirname(fileURLToPath(import.meta.url));

function resolvePiCliPath(): string {
  const candidates = [
    process.env.PI_CLI_PATH,
    process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    process.env.npm_config_prefix && join(process.env.npm_config_prefix, "lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    join(dirname(process.execPath), "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  ].filter((value): value is string => Boolean(value));
  const match = candidates.find(existsSync);
  if (!match) throw new Error("Could not resolve Pi CLI. Set PI_CLI_PATH to @earendil-works/pi-coding-agent/dist/cli.js.");
  return match;
}

const piCliPath = resolvePiCliPath();
const packageRoot = resolve(here, "../..");
const skillPath = join(packageRoot, "skills/auditing-unity-agent-guidance/SKILL.md");
const extensionPath = join(packageRoot, "index.ts");
const casesPath = join(here, "cases.json");
const fixtureRoot = join(here, "fixtures");

function parseArgs(args: string[]) {
  let trials = 1;
  let condition: "skill" | "baseline" | "both" = "skill";
  let caseIds: string[] = [];
  let model: string | undefined;
  let output: string | undefined;
  let keep = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--trials") trials = Number(args[++index]);
    else if (value === "--condition") condition = args[++index] as typeof condition;
    else if (value === "--cases") caseIds = args[++index].split(",").filter(Boolean);
    else if (value === "--model") model = args[++index];
    else if (value === "--output") output = resolve(args[++index]);
    else if (value === "--keep") keep = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(trials) || trials < 1 || trials > 5) throw new Error("--trials must be between 1 and 5");
  if (!new Set(["skill", "baseline", "both"]).has(condition)) throw new Error("--condition must be skill, baseline, or both");
  return { trials, condition, caseIds, model, output, keep };
}

async function walk(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await walk(root, full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

async function snapshot(root: string): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const path of await walk(root)) {
    const content = await readFile(path);
    result[relative(root, path).replaceAll("\\", "/")] = createHash("sha256").update(content).digest("hex");
  }
  return result;
}

function changedPaths(before: Snapshot, after: Snapshot): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .sort();
}

async function guidanceText(root: string): Promise<string> {
  const paths = (await walk(root)).filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    return /\/(?:AGENTS|CLAUDE)\.md$/i.test(normalized)
      || /\.github\/instructions\/.*\.instructions\.md$/i.test(normalized)
      || /\.cursor\/rules\/.*\.mdc$/i.test(normalized);
  });
  return (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
}

function assistantText(message: any): string {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text ?? "").join("");
}

async function runPi(testCase: EvalCase, condition: Condition, trial: number, keep: boolean, model?: string): Promise<{ evidence: RunEvidence; workspace: string }> {
  const workspace = await mkdtemp(join(tmpdir(), `pi-unity-guidance-${testCase.id}-${condition}-${trial}-`));
  await cp(join(fixtureRoot, testCase.fixture), workspace, { recursive: true });
  const before = await snapshot(workspace);
  const args = [
    "--mode", "json", "--no-session", "--approve", "--no-context-files",
    "--no-extensions", "--extension", extensionPath,
    "--no-skills",
    "--append-system-prompt", "Evaluation safety boundary: treat the current working directory as the only writable workspace. Never create, edit, or delete files outside it.",
  ];
  if (condition === "skill") args.push("--skill", skillPath);
  args.push("--tools", "read,edit,write,unity_guidance_audit");
  if (model) args.push("--model", model);
  args.push(testCase.prompt);

  const started = Date.now();
  const workingDirectory = testCase.working_directory ? resolve(workspace, testCase.working_directory) : workspace;
  const child = spawn(process.execPath, [piCliPath, ...args], {
    cwd: workingDirectory,
    windowsHide: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 10 * 60 * 1000);
  const exitCode = await new Promise<number | null>((resolveExit) => child.on("close", resolveExit));
  clearTimeout(timeout);

  const events = stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const toolCalls = events
    .filter((event: any) => event.type === "tool_execution_start")
    .map((event: any) => ({ name: String(event.toolName), args: event.args }));
  const assistantEnds = events.filter((event: any) => event.type === "message_end" && event.message?.role === "assistant");
  const answers = assistantEnds.map((event: any) => assistantText(event.message)).filter(Boolean);
  const finalUsage = assistantEnds.at(-1)?.message?.usage ?? {};
  const after = await snapshot(workspace);
  const evidence: RunEvidence = {
    answer: answers.at(-1) ?? "",
    durationMs: Date.now() - started,
    exitCode,
    toolCalls,
    before,
    after,
    guidance: await guidanceText(workspace),
    stderr,
    usage: {
      input: Number(finalUsage.input ?? 0),
      output: Number(finalUsage.output ?? 0),
      totalTokens: Number(finalUsage.totalTokens ?? 0),
      cost: Number(finalUsage.cost?.total ?? 0),
    },
  };
  if (!keep) await rm(workspace, { recursive: true, force: true });
  return { evidence, workspace };
}

function evaluate(checkId: string, evidence: RunEvidence, condition: Condition): boolean {
  const changed = changedPaths(evidence.before, evidence.after);
  const guidanceChanged = changed.some((path) => /(?:AGENTS|CLAUDE)\.md$|\.instructions\.md$|\.mdc$/i.test(path));
  const projectChanged = changed.some((path) => /(?:^|\/)(?:Packages|ProjectSettings)\//.test(path));
  const toolNames = evidence.toolCalls.map((call) => call.name);
  const readCalls = evidence.toolCalls.filter((call) => call.name === "read");
  const loaded = readCalls.some((call) => {
    const args = JSON.stringify(call.args).replaceAll("\\", "/");
    return args.includes("auditing-unity-agent-guidance") && args.includes("SKILL.md");
  });
  const auditCalls = evidence.toolCalls.filter((call) => call.name === "unity_guidance_audit");
  const auditCalled = auditCalls.length > 0;
  const auditIncludesAncestors = auditCalls.some((call) => Boolean((call.args as { includeAncestors?: boolean } | undefined)?.includeAncestors));
  const combined = `${evidence.answer}\n${evidence.guidance}`.toLowerCase();
  const hasUnsafeRunTestsQuit = evidence.guidance.split(/\r?\n/).some((line) => {
    const runTestsIndex = line.search(/-runTests\b/i);
    if (runTestsIndex < 0 || !/-quit\b/i.test(line)) return false;
    const prefix = line.slice(0, runTestsIndex);
    return !/\b(?:do not|don't|never|must not|should not|avoid|without)\b/i.test(prefix);
  });
  switch (checkId) {
    case "skill_loaded": return condition === "baseline" ? !loaded : loaded;
    case "skill_not_loaded": return !loaded;
    case "audit_called": return auditCalled;
    case "audit_includes_ancestors": return auditIncludesAncestors;
    case "audit_not_called": return !auditCalled;
    case "no_files_changed": return changed.length === 0;
    case "guidance_changed": return guidanceChanged;
    case "local_guidance_changed": return changed.includes("ws1/AGENTS.md");
    case "ancestor_guidance_unchanged": return !changed.includes("AGENTS.md");
    case "guidance_unchanged": return !guidanceChanged;
    case "project_files_unchanged": return !projectChanged;
    case "reports_legacy_findings": return /batchmode|headless|hard-coded|project-path|runtests/.test(evidence.answer.toLowerCase());
    case "reports_unresolved_inherited_guidance": return /(?:ancestor|inherited|coordination.root).{0,80}(?:unresolved|not edited|outside|excluded|remain)/s.test(evidence.answer.toLowerCase());
    case "no_reported_detector_defect": return !/false positive|detector defect|scanner defect/.test(evidence.answer.toLowerCase());
    case "diagnoses_off_by_one": return /\+\s*1|off-by-one|extra one|remove.{0,20}1/.test(evidence.answer.toLowerCase());
    case "mentions_exact_copy": return /exact.{0,30}(copy|path)|wrong.{0,20}copy/.test(combined);
    case "exact_copy_routing": return /exact.{0,35}(project|copy|path)/.test(combined) && /project.?path/.test(combined);
    case "connected_and_isolated_routes": return /pipeline|connected/.test(combined) && /isolated|fallback|unity test|unity run/.test(combined);
    case "portable_cli_present": return /unity (?:test|run|command)/.test(combined);
    case "no_run_tests_quit": return !hasUnsafeRunTestsQuit;
    case "explicit_quit_prohibition_preserved": return /raw editor `?-runtests`? commands must not include `?-quit`?/i.test(evidence.guidance);
    case "no_implicit_pipeline_install": return !projectChanged && /explicit|approval|do not install|never install/.test(combined);
    case "playmode_skip_preserved": return /do not run playmode|skip.{0,20}playmode|playmode.{0,20}skip/.test(evidence.guidance.toLowerCase());
    case "graphics_requirement_preserved": return /graphics/.test(evidence.guidance.toLowerCase()) && /nographics/.test(evidence.guidance.toLowerCase());
    case "current_version_source": return /projectversion\.txt/.test(combined) && !/use unity version:\s*6000\.3\.0f1/.test(evidence.guidance.toLowerCase());
    case "ci_fallback_preserved": return /\bci\b/.test(evidence.guidance.toLowerCase()) && /isolated|fallback/.test(evidence.guidance.toLowerCase());
    case "no_unity_launch": return !toolNames.some((name) => /unity_(?:open|launch|run_test)/.test(name));
    case "bounded_tool_calls": return evidence.toolCalls.length <= 20;
    default: throw new Error(`Unknown check: ${checkId}`);
  }
}

const options = parseArgs(process.argv.slice(2));
const allCases = JSON.parse(await readFile(casesPath, "utf8")) as EvalCase[];
const selected = options.caseIds.length > 0 ? allCases.filter((item) => options.caseIds.includes(item.id)) : allCases;
if (options.caseIds.length > 0 && selected.length !== options.caseIds.length) throw new Error("One or more --cases IDs were not found");
const conditions: Condition[] = options.condition === "both" ? ["skill", "baseline"] : [options.condition];
const results: any[] = [];

for (const testCase of selected) {
  for (const condition of conditions) {
    for (let trial = 1; trial <= options.trials; trial += 1) {
      process.stderr.write(`Running ${testCase.id} [${condition}] trial ${trial}...\n`);
      const { evidence, workspace } = await runPi(testCase, condition, trial, options.keep, options.model);
      const checks = Object.fromEntries(testCase.expected_checks.map((check) => {
        const reportedCheck = condition === "baseline" && check === "skill_loaded" ? "skill_absent_for_baseline" : check;
        return [reportedCheck, evaluate(check, evidence, condition)];
      }));
      results.push({
        id: testCase.id,
        condition,
        trial,
        shouldTrigger: testCase.should_trigger,
        passed: evidence.exitCode === 0 && Object.values(checks).every(Boolean),
        checks,
        metrics: {
          durationMs: evidence.durationMs,
          toolCalls: evidence.toolCalls.length,
          toolCallCounts: Object.fromEntries([...new Set(evidence.toolCalls.map((call) => call.name))].map((name) => [name, evidence.toolCalls.filter((call) => call.name === name).length])),
          changedPaths: changedPaths(evidence.before, evidence.after),
          exitCode: evidence.exitCode,
          usage: evidence.usage,
          skillLoaded: evidence.toolCalls.some((call) => call.name === "read" && JSON.stringify(call.args).includes("auditing-unity-agent-guidance")),
          auditCalled: evidence.toolCalls.some((call) => call.name === "unity_guidance_audit"),
        },
        answer: evidence.answer,
        stderr: evidence.stderr,
        workspace: options.keep ? workspace : undefined,
      });
    }
  }
}

const passed = results.filter((result) => result.passed).length;
const byCondition = Object.fromEntries(conditions.map((condition) => {
  const rows = results.filter((result) => result.condition === condition);
  return [condition, { passed: rows.filter((row) => row.passed).length, total: rows.length }];
}));
const report = { generatedAt: new Date().toISOString(), options, summary: { passed, total: results.length, byCondition }, results };
const outputPath = options.output ?? join(tmpdir(), "pi-unity-skill-evals", "auditing-unity-agent-guidance-latest-results.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...report.summary }, null, 2));
