import { resolve } from "node:path";
import { isUnityProjectRoot, readUnityVersion } from "./unity-projects";
import { redactUnityPlanningOutput, resolveUnityCliCommand, summarizeUnityCliText, type UnityCliExecutor, type UnityCliExecResult } from "./unity-cli";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const flags = ["--format", "json", "--no-banner", "--non-interactive"];
const safeText = (text: string, length = 300) => summarizeUnityCliText(redactUnityPlanningOutput(text), length, 3);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function boundedCliData(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 300 || depth > 6) return "[truncated]";
  if (typeof value === "string") return safeText(value, 300);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => boundedCliData(item, depth + 1, budget));
  const obj = record(value);
  if (!obj) return null;
  return Object.fromEntries(Object.entries(obj).slice(0, 50).map(([key, item]) => [safeText(key, 80), /secret|token|password|credential|api[_-]?key|authorization|private[_-]?key/i.test(key) ? "[redacted]" : boundedCliData(item, depth + 1, budget)]));
}
export function checkCliResult(result: UnityCliExecResult, expected: string, alternate?: string): Record<string, unknown> {
  if (result.error) throw new Error(`Unity ${expected} failed${result.error.code === "ETIMEDOUT" || result.error.killed ? " (timeout)" : ""}; result is uncertain.`);
  if (result.stdout.length > 2_000_000) throw new Error(`Unity ${expected} response exceeded size limit; result is uncertain.`);
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`Unity ${expected} returned malformed JSON; result is uncertain.`); }
  const envelope = record(parsed);
  if (!envelope || (envelope.command !== expected && envelope.command !== alternate) || typeof envelope.success !== "boolean" || !Array.isArray(envelope.errors) || !Array.isArray(envelope.warnings)) throw new Error(`Unity ${expected} returned an invalid envelope; result is uncertain.`);
  if (!envelope.success || envelope.errors.length || envelope.warnings.length) {
    const diagnostics = [...envelope.errors, ...envelope.warnings].slice(0, 3).map(item => {
      const entry = record(item);
      return safeText(String(entry?.code ?? ""), 50) + ": " + safeText(String(entry?.message ?? ""), 180);
    }).join("; ");
    throw new Error(`Unity ${expected} reported failure or warnings; result is uncertain.${diagnostics ? ` ${diagnostics}` : ""}`);
  }
  return envelope;
}
export function validArg(value: string, label: string, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith("-")) throw new Error(`Invalid ${label}.`);
  return value.trim();
}
export function positiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error("Invalid pagination or output limit.");
  return value;
}
const resultText = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data });
export const unityCliInfoParameters = Type.Object({ include: Type.Optional(Type.Array(Type.Union([Type.Literal("commands"), Type.Literal("changelog")]), { maxItems: 2 })), commandPrefixes: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })), maxCommands: Type.Optional(Type.Integer()), maxChangelogChars: Type.Optional(Type.Integer()) });
export const unityDocsUrlParameters = Type.Object({ topic: Type.String(), path: Type.Optional(Type.String()), kind: Type.Optional(Type.Union([Type.Literal("api"), Type.Literal("manual"), Type.Literal("search")])), editorVersion: Type.Optional(Type.String()) });
export async function unityCliInfo(params: { include?: ("commands" | "changelog")[]; commandPrefixes?: string[]; maxCommands?: number; maxChangelogChars?: number }, execute: UnityCliExecutor, signal?: AbortSignal) {
  const include = params.include ?? [];
  if (include.length > 2 || new Set(include).size !== include.length || include.some(x => x !== "commands" && x !== "changelog")) throw new Error("Invalid include selection.");
  const prefixes = (params.commandPrefixes ?? []).map(x => validArg(x, "command prefix", 120));
  if (prefixes.length > 20 || prefixes.some(x => !/^[\w-]+(?: [\w-]+)*$/.test(x))) throw new Error("Invalid command prefix.");
  const maxCommands = positiveInt(params.maxCommands, 50, 200);
  const maxChangelogChars = positiveInt(params.maxChangelogChars, 8000, 20000);
  const output: Record<string, unknown> = {};
  for (const command of include) {
    const envelope = checkCliResult(await execute(resolveUnityCliCommand(), [...flags, command], { timeout: 10000, signal }), command);
    const data = record(envelope.data);
    if (!data) throw new Error(`Unity ${command} returned invalid data; result is uncertain.`);
    if (command === "changelog") {
      if (typeof data.version !== "string" || typeof data.changelog !== "string") throw new Error("Unity changelog returned invalid data; result is uncertain.");
      output.cliVersion = safeText(data.version, 80);
      output.changelog = redactUnityPlanningOutput(data.changelog.slice(0, maxChangelogChars));
      output.changelogTruncated = data.changelog.length > maxChangelogChars;
    } else {
      if (!Array.isArray(data.commands)) throw new Error("Unity commands returned invalid manifest; result is uncertain.");
      const selected: unknown[] = []; let matching = 0; let visited = 0;
      function visit(nodes: unknown[], parent: string) {
        for (const raw of nodes) {
          if (++visited > 10000) throw new Error("Unity command manifest exceeded traversal limit; result is uncertain.");
          const node = record(raw);
          if (!node || typeof node.name !== "string" || !/^[\w-]{1,80}$/.test(node.name) || !Array.isArray(node.subcommands)) throw new Error("Unity command manifest contains invalid entries; result is uncertain.");
          const path = parent ? `${parent} ${node.name}` : node.name;
          if (!prefixes.length || prefixes.some(prefix => path === prefix || path.startsWith(prefix + " "))) {
            matching++;
            if (selected.length < maxCommands && JSON.stringify(selected).length < 40_000) selected.push({ path, description: boundedCliData(node.description), arguments: boundedCliData(node.arguments), options: boundedCliData(node.options) });
          }
          if (path.split(" ").length > 12) throw new Error("Unity command manifest nesting exceeded limit; result is uncertain.");
          visit(node.subcommands, path);
        }
      }
      visit(data.commands, "");
      output.commands = selected; output.matchingCount = matching; output.commandsTruncated = matching > selected.length;
    }
  }
  return output;
}
export async function unityDocsUrl(params: { topic: string; path?: string; kind?: "api" | "manual" | "search"; editorVersion?: string }, execute: UnityCliExecutor, cwd: string, signal?: AbortSignal) {
  const topic = validArg(params.topic, "documentation topic", 500);
  if (params.kind && !["api", "manual", "search"].includes(params.kind)) throw new Error("Invalid documentation kind.");
  let version: string | undefined;
  let versionSource: "project" | "explicit" | "cli-current" = "cli-current";
  if (params.path !== undefined) {
    const path = resolve(cwd, validArg(params.path, "project path", 1000));
    if (!(await isUnityProjectRoot(path))) throw new Error("Explicit path is not a Unity project root.");
    try { version = await readUnityVersion(path); } catch { throw new Error("Explicit project has no readable Unity version."); }
    versionSource = "project";
  }
  if (params.editorVersion !== undefined) {
    version = validArg(params.editorVersion, "editor version", 40);
    if (!/^\d{4}\.\d+(?:\.\d+[abfp]\d+)?$/.test(version)) throw new Error("Invalid editor version.");
    versionSource = "explicit";
  }
  const args = [...flags, "docs", "--url", ...(params.kind === "manual" ? ["--manual"] : params.kind === "search" ? ["--search"] : []), ...(version ? ["--editor-version", version] : []), topic];
  const envelope = checkCliResult(await execute(resolveUnityCliCommand(), args, { timeout: 10000, signal }), "docs");
  const data = record(envelope.data);
  if (typeof data?.url !== "string" || data.opened !== false || (version && data.version !== version)) throw new Error("Unity docs returned invalid URL evidence; result is uncertain.");
  let url: URL;
  try { url = new URL(data.url); } catch { throw new Error("Unity docs returned invalid URL evidence; result is uncertain."); }
  if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2048) throw new Error("Unity docs returned unsafe URL evidence; result is uncertain.");
  return { url: url.href, topic, kind: params.kind ?? "api", editorVersion: version, versionSource };
}
export function registerUnityInformationTools(pi: Pick<ExtensionAPI, "registerTool">, execute: UnityCliExecutor) {
  pi.registerTool({ name: "unity_cli_info", label: "Unity CLI information", description: "Bounded read-only global command manifest and installed changelog; never connected Editor commands.", parameters: unityCliInfoParameters, execute: async (_id, params, signal) => resultText(await unityCliInfo(params, execute, signal)) });
  pi.registerTool({ name: "unity_docs_url", label: "Unity docs URL", description: "Resolve an official HTTPS documentation URL without opening a browser. Use explicit project root or version for project-matched documentation; sibling pi-unity-docs owns content and cache.", parameters: unityDocsUrlParameters, execute: async (_id, params, signal, _update, ctx) => resultText(await unityDocsUrl(params, execute, ctx.cwd, signal)) });
}
