#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { exclusiveWrite } from "@aefree/pi-project-artifacts/core";
import type { UnityMigrationMappingV1 } from "../contracts/v1";
import { applyUnityDocsMigration, formatPlanForCli, planUnityDocsMigration, recoverUnityDocsMigration } from "../src/unity-docs-migration";

type Args = {
  workspaceRoot?: string; solutionsRoot?: string; artifactRoot?: string; mappingPath?: string; reportPath?: string;
  approvalHash?: string; runRoot?: string; apply: boolean; move: boolean; recoveryMode: "backup" | "vcs"; checkpoint?: string;
  recoverRun?: string; recoverAction?: "resume" | "rollback"; help: boolean;
};
function usage(): string { return `Unity solution-doc schema v1/v2 migration (dry-run by default).\n\nUsage:\n  npx tsx scripts/migrate-unity-docs-schema.ts --solutions-root <docs/solutions> [--write-report <exclusive-path>]\n  npx tsx scripts/migrate-unity-docs-schema.ts --solutions-root <docs/solutions> --apply --approval-hash sha256:<hash> --recovery backup\n  npx tsx scripts/migrate-unity-docs-schema.ts --workspace-root <root> --recover-run <run-dir> --recover-action resume|rollback\n\nOptions:\n  --workspace-root <path>    Workspace containing the artifact root. Inferred as two parents above docs/solutions.\n  --solutions-root <path>    Required for plan/apply.\n  --artifact-root <path>     Authorized inbound-link scope. Defaults to parent of solutions root.\n  --mapping <path>           JSON with complete problemTypeMap/pathOverrides classifications.\n  --write-report <path>      Exclusively create a JSON report; never overwrites.\n  --no-move                  Update schema/links without category-folder moves.\n  --apply                    Apply only the exact approved current plan.\n  --approval-hash <hash>     Exact dry-run manifestHash required by apply.\n  --run-root <path>          Run journal root outside authoritative artifacts.\n  --recovery backup|vcs      Required apply recovery gate; byte backups are always created.\n  --checkpoint <id>          Required with vcs; recorded in addition to byte backups.\n  --recover-run <path>       Existing run directory to recover.\n  --recover-action <action>  resume or rollback.\n`; }
function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, move: true, recoveryMode: "backup", help: false };
  const value = (index: number, name: string) => { const next = argv[index + 1]; if (!next || next.startsWith("--")) throw new Error(`${name} requires a value`); return next; };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--no-move") args.move = false;
    else if (arg === "--workspace-root") args.workspaceRoot = value(index++, arg);
    else if (arg === "--solutions-root" || arg === "--root") args.solutionsRoot = value(index++, arg);
    else if (arg === "--artifact-root") args.artifactRoot = value(index++, arg);
    else if (arg === "--mapping") args.mappingPath = value(index++, arg);
    else if (arg === "--write-report") args.reportPath = value(index++, arg);
    else if (arg === "--approval-hash") args.approvalHash = value(index++, arg);
    else if (arg === "--run-root") args.runRoot = value(index++, arg);
    else if (arg === "--recovery") { const mode = value(index++, arg); if (mode !== "backup" && mode !== "vcs") throw new Error("--recovery must be backup or vcs"); args.recoveryMode = mode; }
    else if (arg === "--checkpoint") args.checkpoint = value(index++, arg);
    else if (arg === "--recover-run") args.recoverRun = value(index++, arg);
    else if (arg === "--recover-action") { const action = value(index++, arg); if (action !== "resume" && action !== "rollback") throw new Error("--recover-action must be resume or rollback"); args.recoverAction = action; }
    else if (arg === "--include-manual-review") throw new Error("--include-manual-review is unsafe and no longer supported; provide complete exact-path overrides and approve a new plan");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  if (args.recoverRun) {
    if (!args.workspaceRoot || !args.recoverAction) throw new Error("Recovery requires --workspace-root and --recover-action");
    const context = { cwd: process.cwd(), signal: new AbortController().signal };
    const journal = await recoverUnityDocsMigration(context, path.resolve(args.recoverRun), args.recoverAction, undefined, path.resolve(args.workspaceRoot));
    console.log(`Recovery ${args.recoverAction}: ${journal.state}`);
    return;
  }
  if (!args.solutionsRoot) throw new Error("--solutions-root is required");
  const solutionsRoot = path.resolve(args.solutionsRoot);
  const workspaceRoot = path.resolve(args.workspaceRoot ?? path.dirname(path.dirname(solutionsRoot)));
  const artifactRoot = path.resolve(args.artifactRoot ?? path.dirname(solutionsRoot));
  const mapping = args.mappingPath ? JSON.parse(await readFile(path.resolve(args.mappingPath), "utf8")) as UnityMigrationMappingV1 : undefined;
  const base = { workspaceRoot, solutionsRoot, artifactRoot, ...(mapping === undefined ? {} : { mapping }), move: args.move };
  const context = { cwd: process.cwd(), signal: new AbortController().signal };
  if (!args.apply) {
    const plan = await planUnityDocsMigration(context, { operation: "plan", ...base });
    console.log(formatPlanForCli(plan));
    if (args.reportPath) { await exclusiveWrite(path.resolve(args.reportPath), `${JSON.stringify(plan, null, 2)}\n`); console.log(`Report created: ${path.resolve(args.reportPath)}`); }
    return;
  }
  if (!args.approvalHash) throw new Error("--apply requires --approval-hash from the exact current dry run");
  if (args.recoveryMode === "vcs" && !args.checkpoint) throw new Error("--recovery vcs requires --checkpoint; byte backups are still created");
  const recovery = args.recoveryMode === "backup" ? { mode: "backup" as const } : { mode: "vcs" as const, checkpoint: args.checkpoint! };
  const applied = await applyUnityDocsMigration(context, { operation: "apply", ...base, approvalHash: args.approvalHash, recovery, ...(args.runRoot ? { runRoot: path.resolve(args.runRoot) } : {}) });
  const report = { plan: applied.plan, runDirectory: applied.runDirectory, journalState: applied.journal.state };
  console.log(`Migration applied. Run directory: ${applied.runDirectory}`);
  if (args.reportPath) { await exclusiveWrite(path.resolve(args.reportPath), `${JSON.stringify(report, null, 2)}\n`); console.log(`Report created: ${path.resolve(args.reportPath)}`); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
