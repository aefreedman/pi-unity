import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

export type UnityGuidanceHarness = "agents" | "claude" | "copilot" | "cursor";
export type UnityGuidanceProfile = "pi-native" | "portable" | "mixed";
export type UnityGuidanceLevel = "error" | "warning" | "info";

export type UnityGuidanceFinding = {
  ruleId: string;
  category: string;
  level: UnityGuidanceLevel;
  confidence: "high" | "medium" | "low";
  path: string;
  line: number;
  evidence: string;
  consequence: string;
  replacementPolicyId: string;
};

export type UnityGuidanceAuditResult = {
  schemaVersion: 1;
  scope: {
    root: string;
    profile: UnityGuidanceProfile;
    harnesses: UnityGuidanceHarness[];
    includeAncestors: boolean;
  };
  files: Array<{ path: string; harness: UnityGuidanceHarness; sha256: string; bytes: number }>;
  findings: UnityGuidanceFinding[];
  skipped: Array<{ path: string; reason: string }>;
  summary: { filesScanned: number; errors: number; warnings: number; infos: number };
};

export type UnityGuidanceAuditOptions = {
  path: string;
  files?: string[];
  harnesses?: UnityGuidanceHarness[];
  includeAncestors?: boolean;
  profile?: UnityGuidanceProfile;
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
  maxFindings?: number;
  signal?: AbortSignal;
};

const DEFAULT_HARNESSES: UnityGuidanceHarness[] = ["agents", "claude", "copilot", "cursor"];
const ROOT_FILES: Array<[string, UnityGuidanceHarness]> = [
  ["AGENTS.md", "agents"],
  ["CLAUDE.md", "claude"],
  [".github/copilot-instructions.md", "copilot"],
  [".cursorrules", "cursor"],
];
const DISCOVERY_DIRS: Array<[string, UnityGuidanceHarness]> = [
  [".claude/rules", "claude"],
  [".github/instructions", "copilot"],
  [".cursor/rules", "cursor"],
];

function withinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function normalizeEvidence(line: string): string {
  const safe = line.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "�");
  const compact = safe.trim().replace(/\s+/g, " ");
  return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}

function harnessForPath(path: string): UnityGuidanceHarness | null {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const name = basename(normalized);
  if (name === "agents.md") return "agents";
  if (name === "claude.md" || normalized.includes("/.claude/rules/")) return "claude";
  if (name === "copilot-instructions.md" || normalized.includes("/.github/instructions/")) return "copilot";
  if (name === ".cursorrules" || normalized.includes("/.cursor/rules/")) return "cursor";
  return null;
}

async function collectMarkdownFiles(root: string, relativeDir: string, maxFiles: number, signal?: AbortSignal): Promise<string[]> {
  const start = resolve(root, relativeDir);
  const files: string[] = [];
  const queue = [start];
  let visitedDirectories = 0;
  let visitedEntries = 0;
  while (queue.length > 0 && files.length < maxFiles && visitedDirectories < 200 && visitedEntries < 5000) {
    signal?.throwIfAborted();
    const current = queue.shift();
    if (!current) break;
    visitedDirectories += 1;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      signal?.throwIfAborted();
      visitedEntries += 1;
      if (visitedEntries > 5000) break;
      const fullPath = resolve(current, entry.name);
      if (!withinRoot(root, fullPath)) continue;
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.isFile() && [".md", ".mdc"].includes(extname(entry.name).toLowerCase())) files.push(fullPath);
      if (files.length >= maxFiles) break;
    }
  }
  return files;
}

async function discoverFiles(root: string, harnesses: Set<UnityGuidanceHarness>, includeAncestors: boolean, maxFiles: number, signal?: AbortSignal): Promise<string[]> {
  const found = new Set<string>();
  const roots = [root];
  if (includeAncestors) {
    let current = dirname(root);
    for (let index = 0; index < 3 && current !== dirname(current); index += 1) {
      roots.push(current);
      current = dirname(current);
    }
  }
  for (const candidateRoot of roots) {
    signal?.throwIfAborted();
    for (const [relativePath, harness] of ROOT_FILES) {
      if (harnesses.has(harness)) found.add(resolve(candidateRoot, relativePath));
    }
    for (const [relativeDir, harness] of DISCOVERY_DIRS) {
      if (!harnesses.has(harness)) continue;
      for (const path of await collectMarkdownFiles(candidateRoot, relativeDir, Math.max(0, maxFiles - found.size), signal)) found.add(path);
    }
  }
  return [...found].slice(0, maxFiles);
}

function nearbyMentionsFallback(lines: string[], index: number): boolean {
  const context = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join(" ").toLowerCase();
  return /\b(?:fallback|legacy|cold|isolated|ci)\b|\b(?:if|when)\b .*\bunavailable\b/.test(context);
}

function isProhibitedMatch(line: string, pattern: RegExp): boolean {
  const plain = line.replace(/[*_`~]/g, "");
  const match = pattern.exec(plain);
  if (!match || match.index === undefined) return false;
  const clauseStart = Math.max(plain.lastIndexOf(".", match.index), plain.lastIndexOf(";", match.index), plain.lastIndexOf(":", match.index)) + 1;
  const prefix = plain.slice(clauseStart, match.index);
  return /\b(?:do not|don't|never|must not|should not|avoid|forbid|without)\b/i.test(prefix);
}

function addFinding(findings: UnityGuidanceFinding[], finding: UnityGuidanceFinding): void {
  findings.push(finding);
}

export function auditUnityGuidanceText(path: string, text: string): UnityGuidanceFinding[] {
  const findings: UnityGuidanceFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    const evidence = normalizeEvidence(line);
    const common = { path, line: index + 1, evidence };
    const fallback = nearbyMentionsFallback(lines, index);

    if (/-(?:runTests|runtests)\b/.test(line) && /-quit\b/i.test(line) && !isProhibitedMatch(line, /-(?:runTests|runtests)\b/i)) {
      addFinding(findings, {
        ...common,
        ruleId: "tests.quit-with-run-tests",
        category: "test-artifact-correctness",
        level: "error",
        confidence: "high",
        consequence: "Raw Unity Test Framework runs may exit before producing results.",
        replacementPolicyId: "tests.report-producing-route",
      });
    }

    if (/\bunity\s+-batchmode\b/i.test(line) && !isProhibitedMatch(line, /\bunity\s+-batchmode\b/i)) {
      addFinding(findings, {
        ...common,
        ruleId: "commands.ambiguous-bare-unity",
        category: "command-surface",
        level: "warning",
        confidence: "high",
        consequence: "The standalone Unity CLI uses `unity run <project> -- ...`; bare `unity -batchmode` is ambiguous and non-portable.",
        replacementPolicyId: "fallback.direct-editor-explicit",
      });
    }

    if (/(unity\.exe|\/unity\.app\/contents\/macos\/unity).*-batchmode/i.test(line) && !fallback && !isProhibitedMatch(line, /(unity\.exe|\/unity\.app\/contents\/macos\/unity).*-batchmode/i)) {
      addFinding(findings, {
        ...common,
        ruleId: "commands.direct-batchmode-primary",
        category: "routing-policy",
        level: "warning",
        confidence: "medium",
        consequence: "Direct Editor batchmode is still valid as a fallback, but should not be the unconditional primary route when Unity CLI or a reachable Pipeline Editor is available.",
        replacementPolicyId: "routing.connected-then-isolated",
      });
    }

    if ((/use headless unity .*compile|headless unity open\/compile/.test(lower) || (/compile/.test(lower) && /-batchmode/.test(lower))) && !fallback && !isProhibitedMatch(line, /(?:headless unity|compile|-batchmode)/i)) {
      addFinding(findings, {
        ...common,
        ruleId: "compile.headless-only",
        category: "compile-workflow",
        level: "warning",
        confidence: "high",
        consequence: "A reachable exact-copy Pipeline Editor can compile through `recompile` without closing the active Editor or launching a second process.",
        replacementPolicyId: "compile.connected-recompile",
      });
    }

    if (/\bunity\s+command\b/i.test(line) && !/--project-path\b/i.test(line) && !isProhibitedMatch(line, /\bunity\s+command\b/i)) {
      addFinding(findings, {
        ...common,
        ruleId: "pipeline.missing-exact-project",
        category: "project-copy-routing",
        level: "error",
        confidence: "high",
        consequence: "Connected commands can target the wrong Editor when multiple project copies are open.",
        replacementPolicyId: "routing.exact-project-path",
      });
    }

    if (/(?:\bdelete\b|\bremove\b|\bunlink\b|\brm\b|\bdel\b).*(?:temp[\\/]unitylockfile|unitylockfile)/i.test(line) && !isProhibitedMatch(line, /(?:\bdelete\b|\bremove\b|\bunlink\b|\brm\b|\bdel\b)/i)) {
      addFinding(findings, {
        ...common,
        ruleId: "lifecycle.unconditional-lockfile-deletion",
        category: "project-lifecycle",
        level: "error",
        confidence: "high",
        consequence: "Deleting a Unity lockfile without verifying the exact project process can permit competing Editors and corrupt project state.",
        replacementPolicyId: "lifecycle.inspect-before-lockfile-action",
      });
    }

    const arbitraryPidPattern = /\b(?:taskkill(?:\.exe)?|stop-process|kill(?:\.exe)?|process\.kill)\b/i;
    if (arbitraryPidPattern.test(line)
      && /(?:\/pid\b|-id\b|\bpid\b|\$[a-z_]*pid\b)/i.test(line)
      && !/(?:exact|matching|verified).{0,30}project|project.{0,30}(?:exact|matching|verified)/i.test(line)
      && !isProhibitedMatch(line, arbitraryPidPattern)) {
      addFinding(findings, {
        ...common,
        ruleId: "lifecycle.arbitrary-pid-termination",
        category: "project-lifecycle",
        level: "error",
        confidence: "high",
        consequence: "PID-only termination can close an unrelated Unity project copy or another process after PID reuse.",
        replacementPolicyId: "lifecycle.exact-project-process-verification",
      });
    }

    const pipelineCommandPattern = /(?:unity\s+command|pipeline\s+command|run\s+(?:recompile|run_tests|build))/i;
    const pipelineAssumptionContext = lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join(" ");
    if (pipelineCommandPattern.test(line)
      && /(?:manifest(?:\.json)?|com\.unity\.pipeline)/i.test(pipelineAssumptionContext)
      && !/(?:reachable|advertis(?:e|es|ed)|live|capabilit|project_status|editor_status)/i.test(pipelineAssumptionContext)
      && !isProhibitedMatch(line, pipelineCommandPattern)) {
      addFinding(findings, {
        ...common,
        ruleId: "pipeline.manifest-implies-reachability",
        category: "capability-discovery",
        level: "warning",
        confidence: "medium",
        consequence: "A manifest dependency does not prove that the exact project Editor is running, reachable, or advertising a command.",
        replacementPolicyId: "pipeline.live-capability-discovery",
      });
    }

    if (/(?:\bunity\s+list\b|\blist_tests\b|\blist\s+(?:all\s+)?(?:pipeline\s+)?commands\b)/i.test(line)
      && !/(?:filter|limit|bound|specific|narrow|head)/i.test(line)
      && !isProhibitedMatch(line, /(?:\bunity\s+list\b|\blist_tests\b|\blist\s+(?:all\s+)?(?:pipeline\s+)?commands\b)/i)) {
      addFinding(findings, {
        ...common,
        ruleId: "discovery.unbounded-command-or-test-listing",
        category: "context-efficiency",
        level: "info",
        confidence: "medium",
        consequence: "Unbounded command or test discovery can flood agent context in large projects.",
        replacementPolicyId: "discovery.bounded-filtered-output",
      });
    }

    if (/unity version/i.test(line) && /\b(?:20\d{2}|6000)\.\d+\.\d+[abfp]\d+\b/i.test(line) && !isProhibitedMatch(line, /unity version/i)) {
      addFinding(findings, {
        ...common,
        ruleId: "version.hard-coded-project-version",
        category: "version-resolution",
        level: "info",
        confidence: "high",
        consequence: "Project instructions drift when the Editor version changes; resolve ProjectVersion.txt instead.",
        replacementPolicyId: "version.project-version-file",
      });
    }

    if (/pipeline\s+install/i.test(line) && !isProhibitedMatch(line, /pipeline\s+install/i) && !/explicit|approve|confirm|review|optional/i.test(lines.slice(Math.max(0, index - 2), index + 3).join(" "))) {
      addFinding(findings, {
        ...common,
        ruleId: "pipeline.install-undisclosed",
        category: "project-mutation",
        level: "warning",
        confidence: "medium",
        consequence: "Pipeline installation and startup can modify manifest.json, packages-lock.json, and ProjectSettings.asset.",
        replacementPolicyId: "pipeline.explicit-installation",
      });
    }
  }
  return findings;
}

export async function auditUnityGuidance(options: UnityGuidanceAuditOptions): Promise<UnityGuidanceAuditResult> {
  const maxFiles = options.maxFiles ?? 100;
  const maxBytesPerFile = options.maxBytesPerFile ?? 256 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 4 * 1024 * 1024;
  const maxFindings = options.maxFindings ?? 1000;
  const requestedRoot = resolve(options.path);
  const rootStat = await lstat(requestedRoot);
  const root = rootStat.isFile() ? dirname(await realpath(requestedRoot)) : await realpath(requestedRoot);
  const harnesses = new Set(options.harnesses?.length ? options.harnesses : DEFAULT_HARNESSES);
  let candidates: string[];
  if (options.files?.length) {
    candidates = options.files.map((path) => resolve(root, path));
    const outside = candidates.find((path) => !withinRoot(root, path));
    if (outside) throw new Error(`Explicit guidance file is outside the audit root: ${outside}`);
  } else if (rootStat.isFile()) {
    candidates = [requestedRoot];
  } else {
    candidates = await discoverFiles(root, harnesses, Boolean(options.includeAncestors), maxFiles, options.signal);
  }

  const files: UnityGuidanceAuditResult["files"] = [];
  const findings: UnityGuidanceFinding[] = [];
  const skipped: UnityGuidanceAuditResult["skipped"] = [];
  let totalBytes = 0;
  for (const candidate of candidates.slice(0, maxFiles)) {
    options.signal?.throwIfAborted();
    let canonical: string;
    let stats;
    try {
      const candidateStats = await lstat(candidate);
      if (candidateStats.isSymbolicLink()) {
        skipped.push({ path: candidate, reason: "symbolic links are not followed" });
        continue;
      }
      canonical = await realpath(candidate);
      stats = await lstat(canonical);
    } catch {
      if (options.files?.length || rootStat.isFile()) skipped.push({ path: candidate, reason: "not found" });
      continue;
    }
    if (!withinRoot(root, canonical) && !options.includeAncestors) {
      skipped.push({ path: candidate, reason: "outside audit root" });
      continue;
    }
    const harness = harnessForPath(canonical);
    if (!harness || !harnesses.has(harness)) continue;
    if (!stats.isFile()) continue;
    if (stats.size > maxBytesPerFile) {
      skipped.push({ path: canonical, reason: `file exceeds ${maxBytesPerFile} bytes` });
      continue;
    }
    if (totalBytes + stats.size > maxTotalBytes) {
      skipped.push({ path: canonical, reason: `aggregate audit input exceeds ${maxTotalBytes} bytes` });
      break;
    }
    const text = await readFile(canonical, "utf8");
    totalBytes += stats.size;
    files.push({
      path: canonical,
      harness,
      sha256: createHash("sha256").update(text).digest("hex"),
      bytes: Buffer.byteLength(text, "utf8"),
    });
    const remainingFindings = Math.max(0, maxFindings - findings.length);
    const fileFindings = auditUnityGuidanceText(canonical, text);
    findings.push(...fileFindings.slice(0, remainingFindings));
    if (fileFindings.length > remainingFindings) {
      skipped.push({ path: canonical, reason: `finding limit ${maxFindings} reached` });
      break;
    }
  }

  findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.ruleId.localeCompare(right.ruleId));
  return {
    schemaVersion: 1,
    scope: {
      root,
      profile: options.profile ?? "mixed",
      harnesses: [...harnesses],
      includeAncestors: Boolean(options.includeAncestors),
    },
    files,
    findings,
    skipped,
    summary: {
      filesScanned: files.length,
      errors: findings.filter((finding) => finding.level === "error").length,
      warnings: findings.filter((finding) => finding.level === "warning").length,
      infos: findings.filter((finding) => finding.level === "info").length,
    },
  };
}
