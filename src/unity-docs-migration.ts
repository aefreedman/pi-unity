import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile, readdir, realpath, stat, unlink } from "node:fs/promises";
import * as path from "node:path";
import { assertPhysicalContainment, atomicReplace, exclusiveWrite, fsyncDirectory, withDirectoryLock, withMutationQueue, type FailureInjector } from "@aefree/pi-project-artifacts/core";
import { assertUnityMigrationRequestV1, type UnityMigrationExecutionContextV1, type UnityMigrationMappingV1, type UnityMigrationRequestV1, type UnityMigrationResultV1, type UnityMigrationServiceV1, type UnityClassificationV2 } from "../contracts/v1";
import { UNITY_CATEGORIES, UNITY_DOC_TYPES, UNITY_FAILURE_MODES, UNITY_LEGACY_PROBLEM_TYPES, validateUnityV2Classification } from "./unity-artifact-profile";

export const UNITY_MIGRATION_PLAN_SCHEMA = "@aefree/pi-unity/unity-docs-migration-plan" as const;
export const UNITY_MIGRATION_JOURNAL_SCHEMA = "@aefree/pi-unity/unity-docs-migration-journal" as const;
const PACKAGE_VERSION = "0.8.3";
const CLASSIFICATION_FIELDS = ["schema_version", "problem_type", "doc_type", "category", "failure_mode"] as const;

type ClassificationField = typeof CLASSIFICATION_FIELDS[number];
export type MigrationConflict = Readonly<{ code: string; path?: string; destination?: string; summary: string }>;
export type MigrationOperation = Readonly<{
  id: string;
  kind: "migrate" | "link_update";
  source: string;
  destination: string;
  sourceHash: string;
  targetHash: string;
  sourceMode: number;
  content: string;
  classification?: UnityClassificationV2;
}>;
export type UnityMigrationPlan = Readonly<{
  schema: typeof UNITY_MIGRATION_PLAN_SCHEMA;
  version: 1;
  workspaceRoot: string;
  solutionsRoot: string;
  artifactRoot: string;
  move: boolean;
  operations: readonly MigrationOperation[];
  conflicts: readonly MigrationConflict[];
  summary: Readonly<{ scanned: number; migrated: number; moved: number; linkUpdates: number; conflicts: number }>;
  manifestHash: string;
}>;
type JournalOperation = MigrationOperation & { state: "staged" | "destination_written" | "source_removed" | "verified" | "rolled_back" };
type MigrationJournal = {
  schema: typeof UNITY_MIGRATION_JOURNAL_SCHEMA;
  version: 1;
  runId: string;
  planHash: string;
  recovery: Readonly<Record<string, unknown>>;
  state: "applying" | "interrupted" | "applied" | "rolling_back" | "rolled_back";
  operations: JournalOperation[];
};
type FrontmatterField = {
  key: ClassificationField;
  lineStart: number;
  lineEnd: number;
  valueStart: number;
  valueEnd: number;
  value: string;
  quote: "'" | "\"" | "";
  comment?: string;
  lineEnding: string;
};
type ParsedFrontmatter = { content: string; rawStart: number; rawEnd: number; bodyStart: number; lineEnding: string; fields: ReadonlyMap<ClassificationField, readonly FrontmatterField[]> };
type MarkdownPathToken = { start: number; end: number; rawPath: string };

const DEFAULT_PROBLEM_TYPE_MAP: Readonly<Record<string, UnityClassificationV2>> = Object.freeze({
  build_error: { doc_type: "solution", category: "build_ci", failure_mode: "build_failure" },
  editor_crash: { doc_type: "solution", category: "editor_workflow", failure_mode: "editor_crash" },
  runtime_error: { doc_type: "solution", category: "gameplay_code", failure_mode: "runtime_exception" },
  performance_issue: { doc_type: "solution", category: "performance", failure_mode: "performance_regression" },
  asset_import_issue: { doc_type: "solution", category: "asset_pipeline", failure_mode: "asset_import_failure" },
  physics_bug: { doc_type: "solution", category: "physics_navigation", failure_mode: "incorrect_behavior" },
  rendering_bug: { doc_type: "solution", category: "rendering_shaders", failure_mode: "visual_artifact" },
  ui_bug: { doc_type: "solution", category: "ui", failure_mode: "incorrect_behavior" },
  audio_bug: { doc_type: "solution", category: "audio", failure_mode: "incorrect_behavior" },
  animation_bug: { doc_type: "solution", category: "animation_timeline", failure_mode: "incorrect_behavior" },
  input_bug: { doc_type: "solution", category: "input", failure_mode: "incorrect_behavior" },
  integration_issue: { doc_type: "solution", category: "packages_integrations", failure_mode: "incorrect_behavior" },
  logic_error: { doc_type: "solution", category: "gameplay_code", failure_mode: "incorrect_behavior" },
  editor_workflow: { doc_type: "solution", category: "editor_workflow", failure_mode: "workflow_friction" },
  best_practice: { doc_type: "pattern", category: "gameplay_code", failure_mode: "workflow_friction" },
  documentation_gap: { doc_type: "documentation_gap", category: "project_configuration", failure_mode: "documentation_gap" },
  serialization_issue: { doc_type: "solution", category: "serialization_data", failure_mode: "incorrect_behavior" },
  platform_specific: { doc_type: "solution", category: "platform", failure_mode: "incorrect_behavior" },
});
const CATEGORY_DIRECTORIES: Readonly<Record<string, string>> = Object.freeze({
  build_ci: "build-ci", editor_workflow: "editor-workflow", asset_pipeline: "asset-pipeline", packages_integrations: "packages-integrations",
  project_configuration: "project-configuration", serialization_data: "serialization-data", prefabs_scenes: "prefabs-scenes", gameplay_code: "gameplay-code",
  physics_navigation: "physics-navigation", rendering_shaders: "rendering-shaders", ui: "ui", animation_timeline: "animation-timeline", audio: "audio", input: "input",
  performance: "performance", platform: "platform", testing_validation: "testing-validation", tooling_vcs: "tooling-vcs", critical_patterns: "patterns",
});

export async function planUnityDocsMigration(
  context: UnityMigrationExecutionContextV1,
  request: Extract<UnityMigrationRequestV1, { operation: "plan" | "apply" }>,
): Promise<UnityMigrationPlan> {
  throwIfAborted(context.signal);
  const roots = await resolveMigrationRoots(request);
  const sourceFiles = await listMarkdown(roots.solutionsRoot, context.signal);
  const plannedSources: Array<{ source: string; destination: string; content: string; classification: UnityClassificationV2; sourceHash: string; sourceMode: number }> = [];
  const conflicts: MigrationConflict[] = [];
  for (const source of sourceFiles) {
    throwIfAborted(context.signal);
    const original = await readFile(source, "utf8");
    const relative = normalize(path.relative(roots.solutionsRoot, source));
    let frontmatter: ParsedFrontmatter;
    try { frontmatter = parseFrontmatter(original); }
    catch (error) {
      conflicts.push(conflict(error instanceof MigrationError ? error.code : "frontmatter_unroundtrippable", relative, error instanceof Error ? error.message : String(error)));
      continue;
    }
    const duplicate = CLASSIFICATION_FIELDS.find((key) => (frontmatter.fields.get(key)?.length ?? 0) > 1);
    if (duplicate !== undefined) {
      conflicts.push(conflict("classification_field_duplicate", relative, `Classification field '${duplicate}' occurs more than once; exact range patching has no safe authority.`));
      continue;
    }
    const classification = classify(frontmatter, relative, request.mapping, conflicts);
    if (classification === undefined) continue;
    const content = patchFrontmatter(frontmatter, classification);
    const destination = request.move === false ? source : path.join(roots.solutionsRoot, CATEGORY_DIRECTORIES[classification.category]!, path.basename(source));
    await assertPhysicalContainment(roots.artifactRoot, destination, "migration destination");
    plannedSources.push({ source, destination, content, classification, sourceHash: hashText(original), sourceMode: (await stat(source)).mode });
  }
  await detectDestinationCollisions(plannedSources, conflicts);
  const blockedSources = new Set(conflicts.flatMap((entry) => entry.path ? [path.resolve(roots.solutionsRoot, entry.path)] : []));
  const applicableSources = plannedSources.filter((entry) => !blockedSources.has(entry.source));
  const moveMap = new Map(applicableSources.filter((entry) => pathKey(entry.source) !== pathKey(entry.destination)).map((entry) => [pathKey(entry.source), entry.destination]));
  const sourceByPath = new Map(applicableSources.map((entry) => [pathKey(entry.source), entry]));
  const operations: MigrationOperation[] = [];
  const artifactFiles = await listMarkdown(roots.artifactRoot, context.signal);
  for (const artifact of artifactFiles) {
    throwIfAborted(context.signal);
    const sourcePlan = sourceByPath.get(pathKey(artifact));
    const original = await readFile(artifact, "utf8");
    const destination = sourcePlan?.destination ?? artifact;
    const baseContent = sourcePlan?.content ?? original;
    const linkedContent = updateMarkdownLinks(baseContent, artifact, destination, moveMap);
    if (sourcePlan === undefined && linkedContent === original) continue;
    operations.push(Object.freeze({
      id: `op-${String(operations.length + 1).padStart(4, "0")}`,
      kind: sourcePlan === undefined ? "link_update" : "migrate",
      source: artifact,
      destination,
      sourceHash: hashText(original),
      targetHash: hashText(linkedContent),
      sourceMode: (await stat(artifact)).mode,
      content: linkedContent,
      ...(sourcePlan === undefined ? {} : { classification: sourcePlan.classification }),
    }));
  }
  operations.sort((left, right) => normalize(left.source).localeCompare(normalize(right.source)) || normalize(left.destination).localeCompare(normalize(right.destination)));
  await reconcileFinalLinks(operations, moveMap, conflicts);
  const core = {
    schema: UNITY_MIGRATION_PLAN_SCHEMA,
    version: 1 as const,
    workspaceRoot: roots.workspaceRoot,
    solutionsRoot: roots.solutionsRoot,
    artifactRoot: roots.artifactRoot,
    move: request.move !== false,
    operations: Object.freeze(operations),
    conflicts: Object.freeze(conflicts.sort(compareConflict)),
    summary: Object.freeze({
      scanned: sourceFiles.length,
      migrated: operations.filter((entry) => entry.kind === "migrate").length,
      moved: operations.filter((entry) => entry.kind === "migrate" && pathKey(entry.source) !== pathKey(entry.destination)).length,
      linkUpdates: operations.filter((entry) => entry.kind === "link_update").length,
      conflicts: conflicts.length,
    }),
  };
  return Object.freeze({ ...core, manifestHash: hashText(stableStringify(core)) });
}

export async function applyUnityDocsMigration(
  context: UnityMigrationExecutionContextV1,
  request: Extract<UnityMigrationRequestV1, { operation: "apply" }>,
  failureInjector?: FailureInjector,
): Promise<{ plan: UnityMigrationPlan; runDirectory: string; journal: MigrationJournal }> {
  let plan = await planUnityDocsMigration(context, request);
  assertApprovedPlan(plan, request.approvalHash);
  const lockPath = migrationLockPath(plan);
  await assertPhysicalContainment(plan.workspaceRoot, lockPath, "migration lock path");
  return await withMutationQueue(plan.solutionsRoot, async () => await withDirectoryLock(lockPath, migrationLockOwner(plan), async () => {
    // A queued waiter must replan under the lock; the approval binds this exact preimage.
    plan = await planUnityDocsMigration(context, request);
    assertApprovedPlan(plan, request.approvalHash);
    const runRoot = request.runRoot ? path.resolve(request.runRoot) : path.join(plan.workspaceRoot, ".pi-unity", "migrations");
    const physicalRunRoot = await prepareRunRoot(plan, runRoot);
    const runDirectory = path.join(physicalRunRoot, `${new Date().toISOString().replace(/[:.]/gu, "-")}-${plan.manifestHash.slice(7, 19)}-${randomUUID().slice(0, 8)}`);
    await assertPhysicalContainment(plan.workspaceRoot, runDirectory, "migration run directory");
    await mkdir(runDirectory);
    const physicalRunDirectory = await realpath(runDirectory);
    await assertPhysicalContainment(plan.workspaceRoot, physicalRunDirectory, "migration run directory");
    const backupRoot = path.join(physicalRunDirectory, "backup");
    const stageRoot = path.join(physicalRunDirectory, "stage");
    await assertPhysicalContainment(physicalRunDirectory, backupRoot, "migration backup root");
    await mkdir(backupRoot);
    await assertPhysicalContainment(physicalRunDirectory, stageRoot, "migration stage root");
    await mkdir(stageRoot);
    const planPath = path.join(physicalRunDirectory, "plan.json");
    await assertPhysicalContainment(physicalRunDirectory, planPath, "migration plan path");
    await exclusiveWrite(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    for (const operation of plan.operations) {
      await assertOperationContained(plan, operation);
      const backup = backupPath(backupRoot, operation.id);
      const stage = stagePath(stageRoot, operation.id);
      await failureInjector?.("migration_before_backup_write", { backup, backupRoot, runDirectory: physicalRunDirectory, id: operation.id });
      await assertPhysicalContainment(physicalRunDirectory, backup, "migration backup path");
      await exclusiveWrite(backup, await readFile(operation.source));
      await chmod(backup, operation.sourceMode).catch(ignoreWindowsModeError);
      if (hashBytes(await readFile(backup)) !== operation.sourceHash) throw new MigrationError("backup_hash_mismatch", `Backup verification failed for ${operation.source}`);
      await failureInjector?.("migration_before_stage_write", { stage, stageRoot, runDirectory: physicalRunDirectory, id: operation.id });
      await assertPhysicalContainment(physicalRunDirectory, stage, "migration stage path");
      await exclusiveWrite(stage, operation.content);
      await chmod(stage, operation.sourceMode).catch(ignoreWindowsModeError);
      if (hashBytes(await readFile(stage)) !== operation.targetHash) throw new MigrationError("stage_hash_mismatch", `Stage verification failed for ${operation.destination}`);
    }
    const journal: MigrationJournal = {
      schema: UNITY_MIGRATION_JOURNAL_SCHEMA,
      version: 1,
      runId: path.basename(physicalRunDirectory),
      planHash: plan.manifestHash,
      recovery: request.recovery.mode === "backup" ? { mode: "backup", backupRoot } : { mode: "backup+vcs", backupRoot, checkpoint: request.recovery.checkpoint },
      state: "applying",
      operations: plan.operations.map((operation) => ({ ...operation, state: "staged" })),
    };
    await writeJournal(physicalRunDirectory, journal, false);
    try {
      await applyJournal(context, physicalRunDirectory, plan, journal, failureInjector);
      return { plan, runDirectory: physicalRunDirectory, journal };
    } catch (error) {
      if (error instanceof MigrationInterruption) {
        transitionJournalState(journal, ["applying"], "interrupted");
        await writeJournal(physicalRunDirectory, journal, true);
        throw error;
      }
      await rollbackJournal(context, physicalRunDirectory, plan, journal);
      throw error;
    }
  }, { signal: context.signal, physicalRoot: plan.workspaceRoot }));
}

export async function recoverUnityDocsMigration(
  context: UnityMigrationExecutionContextV1,
  runDirectory: string,
  action: "resume" | "rollback",
  failureInjector?: FailureInjector,
  workspaceRoot = context.cwd,
): Promise<MigrationJournal> {
  const physicalWorkspace = await realpath(workspaceRoot);
  const physicalRunDirectory = await realpath(runDirectory);
  if (!isInside(physicalWorkspace, physicalRunDirectory)) throw new MigrationError("recovery_root_escape", "Migration run directory must be physically contained by workspaceRoot.");
  let { journal, plan } = await loadAndValidateRun(physicalWorkspace, physicalRunDirectory);
  const physicalSolutions = await realpath(plan.solutionsRoot);
  const lockPath = migrationLockPath(plan);
  await assertPhysicalContainment(physicalWorkspace, lockPath, "migration recovery lock path");
  return await withMutationQueue(physicalSolutions, async () => await withDirectoryLock(lockPath, migrationLockOwner(plan), async () => {
    ({ journal, plan } = await loadAndValidateRun(physicalWorkspace, physicalRunDirectory));
    if (action === "resume") {
      if (!["applying", "interrupted"].includes(journal.state)) throw new MigrationError("recovery_transition_invalid", `Cannot resume a journal in '${journal.state}' state.`);
      if (journal.operations.some((operation) => operation.state === "rolled_back")) throw new MigrationError("recovery_transition_invalid", "Cannot resume a journal containing rolled-back operations.");
      try { await applyJournal(context, physicalRunDirectory, plan, journal, failureInjector); }
      catch (error) {
        if (journal.state === "applying") {
          transitionJournalState(journal, ["applying"], "interrupted");
          await writeJournal(physicalRunDirectory, journal, true);
        }
        throw error;
      }
    } else {
      if (!["applying", "interrupted", "applied", "rolling_back"].includes(journal.state)) throw new MigrationError("recovery_transition_invalid", `Cannot roll back a journal in '${journal.state}' state.`);
      await rollbackJournal(context, physicalRunDirectory, plan, journal);
    }
    return journal;
  }, { signal: context.signal, physicalRoot: physicalWorkspace }));
}

async function applyJournal(context: UnityMigrationExecutionContextV1, runDirectory: string, plan: UnityMigrationPlan, journal: MigrationJournal, failureInjector?: FailureInjector): Promise<void> {
  transitionJournalState(journal, ["applying", "interrupted"], "applying");
  await writeJournal(runDirectory, journal, true);
  for (const operation of journal.operations) {
    throwIfAborted(context.signal);
    if (operation.state === "verified") continue;
    if (operation.state === "rolled_back") throw new MigrationError("operation_transition_invalid", `Cannot apply rolled-back operation ${operation.id}.`);
    await assertOperationContained(plan, operation);
    const stage = stagePath(path.join(runDirectory, "stage"), operation.id);
    await assertPhysicalContainment(runDirectory, stage, "migration stage path");
    if (hashBytes(await readFile(stage)) !== operation.targetHash) throw new MigrationError("stage_changed", `Staged output changed: ${stage}`);
    const samePath = pathKey(operation.source) === pathKey(operation.destination);
    if (samePath) {
      const currentHash = await fileHash(operation.source);
      if (currentHash !== operation.sourceHash && currentHash !== operation.targetHash) throw new MigrationError("source_changed", `Source changed outside migration: ${operation.source}`);
      if (currentHash !== operation.targetHash) {
        await assertPhysicalContainment(plan.artifactRoot, operation.source, "migration destination");
        await atomicReplace(operation.source, operation.content, { validatedExisting: true });
        await chmod(operation.source, operation.sourceMode).catch(ignoreWindowsModeError);
      }
      advanceOperationState(operation, "destination_written");
      await writeJournal(runDirectory, journal, true);
      await inject(failureInjector, "migration_destination_written", operation);
      if (await fileHash(operation.destination) !== operation.targetHash) throw new MigrationError("target_hash_mismatch", `Target verification failed: ${operation.destination}`);
      advanceOperationState(operation, "verified");
      await writeJournal(runDirectory, journal, true);
      await inject(failureInjector, "migration_verified", operation);
      continue;
    }
    let sourceHash = await fileHash(operation.source);
    let targetHash = await fileHash(operation.destination);
    if (operation.state === "staged") {
      if (targetHash === operation.targetHash && (sourceHash === operation.sourceHash || sourceHash === undefined)) {
        advanceOperationState(operation, "destination_written");
        await writeJournal(runDirectory, journal, true);
      } else {
        if (sourceHash !== operation.sourceHash) throw new MigrationError("source_changed", `Source changed outside migration: ${operation.source}`);
        if (targetHash !== undefined) throw new MigrationError("destination_occupied", `Destination became occupied: ${operation.destination}`);
        await inject(failureInjector, "migration_before_destination_write", operation);
        await assertPhysicalContainment(plan.artifactRoot, operation.destination, "migration destination");
        await mkdir(path.dirname(operation.destination), { recursive: true });
        await assertPhysicalContainment(plan.artifactRoot, operation.destination, "migration destination");
        await exclusiveWrite(operation.destination, await readFile(stage));
        await chmod(operation.destination, operation.sourceMode).catch(ignoreWindowsModeError);
        await fsyncDirectory(path.dirname(operation.destination));
        advanceOperationState(operation, "destination_written");
        await writeJournal(runDirectory, journal, true);
        await inject(failureInjector, "migration_destination_written", operation);
      }
    }
    sourceHash = await fileHash(operation.source);
    targetHash = await fileHash(operation.destination);
    if (targetHash !== operation.targetHash) throw new MigrationError("target_changed", `Written target changed during recovery: ${operation.destination}`);
    if (operation.state === "destination_written") {
      if (sourceHash === operation.sourceHash) {
        await assertPhysicalContainment(plan.artifactRoot, operation.source, "migration source");
        await unlink(operation.source);
        await fsyncDirectory(path.dirname(operation.source));
      } else if (sourceHash !== undefined) throw new MigrationError("source_changed", `Source changed before removal: ${operation.source}`);
      advanceOperationState(operation, "source_removed");
      await writeJournal(runDirectory, journal, true);
      await inject(failureInjector, "migration_source_removed", operation);
    }
    if (await fileHash(operation.destination) !== operation.targetHash || await fileHash(operation.source) !== undefined) throw new MigrationError("move_verification_failed", `Move verification failed: ${operation.source}`);
    advanceOperationState(operation, "verified");
    await writeJournal(runDirectory, journal, true);
    await inject(failureInjector, "migration_verified", operation);
  }
  transitionJournalState(journal, ["applying"], "applied");
  await writeJournal(runDirectory, journal, true);
}

async function rollbackJournal(context: UnityMigrationExecutionContextV1, runDirectory: string, plan: UnityMigrationPlan, journal: MigrationJournal): Promise<void> {
  transitionJournalState(journal, ["applying", "interrupted", "applied", "rolling_back"], "rolling_back");
  await writeJournal(runDirectory, journal, true);
  const backupRoot = path.join(runDirectory, "backup");
  for (const operation of [...journal.operations].reverse()) {
    throwIfAborted(context.signal);
    if (operation.state === "rolled_back") continue;
    await assertOperationContained(plan, operation);
    const backupPathname = backupPath(backupRoot, operation.id);
    await assertPhysicalContainment(runDirectory, backupPathname, "migration backup path");
    const backup = await readFile(backupPathname);
    if (hashBytes(backup) !== operation.sourceHash) throw new MigrationError("backup_changed", `Backup changed: ${operation.id}`);
    const samePath = pathKey(operation.source) === pathKey(operation.destination);
    if (!samePath) {
      const targetHash = await fileHash(operation.destination);
      if (targetHash !== undefined && targetHash !== operation.targetHash) throw new MigrationError("rollback_target_conflict", `Rollback refused externally changed target: ${operation.destination}`);
      if (targetHash === operation.targetHash) {
        await assertPhysicalContainment(plan.artifactRoot, operation.destination, "migration destination");
        await unlink(operation.destination);
        await fsyncDirectory(path.dirname(operation.destination));
      }
      const sourceHash = await fileHash(operation.source);
      if (sourceHash === undefined) {
        await assertPhysicalContainment(plan.artifactRoot, operation.source, "migration source");
        await mkdir(path.dirname(operation.source), { recursive: true });
        await assertPhysicalContainment(plan.artifactRoot, operation.source, "migration source");
        await exclusiveWrite(operation.source, backup);
        await chmod(operation.source, operation.sourceMode).catch(ignoreWindowsModeError);
        await fsyncDirectory(path.dirname(operation.source));
      } else if (sourceHash !== operation.sourceHash) throw new MigrationError("rollback_source_conflict", `Rollback refused externally changed source: ${operation.source}`);
    } else {
      const currentHash = await fileHash(operation.source);
      if (currentHash !== operation.sourceHash && currentHash !== operation.targetHash) throw new MigrationError("rollback_source_conflict", `Rollback refused externally changed source: ${operation.source}`);
      if (currentHash !== operation.sourceHash) {
        await assertPhysicalContainment(plan.artifactRoot, operation.source, "migration source");
        await atomicReplace(operation.source, backup, { validatedExisting: true });
        await chmod(operation.source, operation.sourceMode).catch(ignoreWindowsModeError);
      }
    }
    operation.state = "rolled_back";
    await writeJournal(runDirectory, journal, true);
  }
  transitionJournalState(journal, ["rolling_back"], "rolled_back");
  await writeJournal(runDirectory, journal, true);
}

export function createUnityMigrationServiceV1(options: { failureInjector?: FailureInjector } = {}): UnityMigrationServiceV1 {
  return Object.freeze({
    contractVersion: 1,
    id: "unity-docs-migration.v1",
    kind: "unity-migration-service",
    owner: Object.freeze({ packageName: "@aefree/pi-unity", packageVersion: PACKAGE_VERSION, packageRoot: path.resolve(fileURLToPath(new URL("..", import.meta.url))), registeredBy: "index.ts" }),
    async execute(context, request) {
      assertUnityMigrationRequestV1(request);
      if (!context || typeof context.cwd !== "string" || !context.signal || typeof context.signal.aborted !== "boolean") throw new TypeError("UnityMigrationExecutionContextV1 is invalid");
      if (request.operation === "plan") {
        const plan = await planUnityDocsMigration(context, request);
        return migrationResult(formatPlanForCli(plan), { operation: "plan", plan, approvalHash: plan.manifestHash }, plan.conflicts.length === 0 ? "executed" : "blocked");
      }
      if (request.operation === "apply") {
        const applied = await applyUnityDocsMigration(context, request, options.failureInjector);
        return migrationResult(`Unity docs migration applied. Run: ${applied.runDirectory}\nOperations: ${applied.plan.operations.length}`, { operation: "apply", runDirectory: applied.runDirectory, plan: applied.plan, journalState: applied.journal.state }, "executed");
      }
      const journal = await recoverUnityDocsMigration(context, request.runDirectory, request.action, options.failureInjector, request.workspaceRoot);
      return migrationResult(`Unity docs migration recovery ${request.action} completed with state ${journal.state}.`, { operation: "recover", runDirectory: request.runDirectory, journalState: journal.state }, "executed");
    },
  });
}
function migrationResult(text: string, details: Readonly<Record<string, unknown>>, executionGate: "executed" | "blocked"): UnityMigrationResultV1 {
  return Object.freeze({ text, details: Object.freeze(details), provenance: Object.freeze({ schema: "@aefree/pi-unity/migration-provenance", version: 1, serviceId: "unity-docs-migration.v1", packageName: "@aefree/pi-unity", packageVersion: PACKAGE_VERSION, contractVersion: 1, executionGate }) });
}
export function formatPlanForCli(plan: UnityMigrationPlan): string { return [`Unity docs migration plan ${plan.manifestHash}.`, `Scanned: ${plan.summary.scanned}; migrated: ${plan.summary.migrated}; moved: ${plan.summary.moved}; link updates: ${plan.summary.linkUpdates}; conflicts: ${plan.summary.conflicts}.`, ...(plan.conflicts.length ? ["Conflicts:", ...plan.conflicts.slice(0, 25).map((entry) => `- ${entry.code}: ${entry.path ?? "(global)"} — ${entry.summary}`)] : ["Dry run only. Apply requires this exact approvalHash plus a backup/VCS recovery gate."])].join("\n"); }

function classify(frontmatter: ParsedFrontmatter, relative: string, mapping: UnityMigrationMappingV1 | undefined, conflicts: MigrationConflict[]): UnityClassificationV2 | undefined {
  const legacy = scalar(frontmatter, "problem_type");
  const existing = { doc_type: scalar(frontmatter, "doc_type"), category: scalar(frontmatter, "category"), failure_mode: scalar(frontmatter, "failure_mode") };
  const present = Object.values(existing).filter(Boolean).length;
  const override = mapping?.pathOverrides?.[relative];
  if (present === 3) {
    const issues = validateUnityV2Classification(numberScalar(frontmatter, "schema_version"), existing);
    if (issues.length === 0) return existing as UnityClassificationV2;
    conflicts.push(conflict("v2_invalid", relative, issues.map((entry) => entry.summary).join(" ")));
    return undefined;
  }
  if (present > 0) {
    if (override && validClassification(override)) return override;
    conflicts.push(conflict("hybrid_authority", relative, "Partial v2 classification cannot inherit from problem_type; provide a complete exact-path override."));
    return undefined;
  }
  if (!legacy) { conflicts.push(conflict("classification_missing", relative, "No legacy problem_type or complete v2 classification found.")); return undefined; }
  if (!(UNITY_LEGACY_PROBLEM_TYPES as readonly string[]).includes(legacy) && !mapping?.problemTypeMap?.[legacy]) { conflicts.push(conflict("problem_type_unknown", relative, `Unknown legacy problem_type '${legacy}' requires a complete mapping.`)); return undefined; }
  const mapped = mapping?.problemTypeMap?.[legacy] ?? DEFAULT_PROBLEM_TYPE_MAP[legacy];
  if (!mapped || !validClassification(mapped)) { conflicts.push(conflict("mapping_incomplete", relative, `Mapping for '${legacy}' must provide complete valid doc_type/category/failure_mode.`)); return undefined; }
  if (override !== undefined) {
    if (!validClassification(override)) { conflicts.push(conflict("path_override_incomplete", relative, "Exact path override must provide complete valid classification.")); return undefined; }
    return override;
  }
  return mapped;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const opening = /^---(\r?\n)/u.exec(content);
  if (!opening) throw new MigrationError("frontmatter_missing", "Unity solution has no complete YAML frontmatter.");
  const closingExpression = /^---[ \t]*(?:\r?\n|$)/gmu;
  closingExpression.lastIndex = opening[0].length;
  const closing = closingExpression.exec(content);
  if (!closing) throw new MigrationError("frontmatter_missing", "Unity solution has unterminated YAML frontmatter.");
  const rawStart = opening[0].length;
  const rawEnd = closing.index;
  const raw = content.slice(rawStart, rawEnd);
  const fields = new Map<ClassificationField, FrontmatterField[]>();
  let offset = rawStart;
  for (const lineWithEnding of raw.match(/.*(?:\r\n|\n|$)/gu) ?? []) {
    if (lineWithEnding === "") continue;
    const ending = /\r\n$/u.test(lineWithEnding) ? "\r\n" : /\n$/u.test(lineWithEnding) ? "\n" : "";
    const line = ending ? lineWithEnding.slice(0, -ending.length) : lineWithEnding;
    const broadKey = /^([^\s][^:]*):/u.exec(line)?.[1]?.trim().replace(/^['"]|['"]$/gu, "");
    if (broadKey && (CLASSIFICATION_FIELDS as readonly string[]).includes(broadKey) && !line.startsWith(`${broadKey}:`)) {
      throw new MigrationError("classification_field_unroundtrippable", `Classification field '${broadKey}' uses unsupported YAML key syntax.`);
    }
    const keyMatch = /^([A-Za-z0-9_-]+):(.*)$/u.exec(line);
    if (keyMatch && (CLASSIFICATION_FIELDS as readonly string[]).includes(keyMatch[1]!)) {
      const key = keyMatch[1] as ClassificationField;
      const parsed = parseClassificationScalar(keyMatch[2]!, key);
      const restStart = offset + key.length + 1;
      const field: FrontmatterField = {
        key,
        lineStart: offset,
        lineEnd: offset + lineWithEnding.length,
        valueStart: restStart + parsed.valueStart,
        valueEnd: restStart + parsed.valueEnd,
        value: parsed.value,
        quote: parsed.quote,
        ...(parsed.comment === undefined ? {} : { comment: parsed.comment }),
        lineEnding: ending,
      };
      const list = fields.get(key) ?? [];
      list.push(field);
      fields.set(key, list);
    } else if (/^(?:\?|<<:|%YAML)/u.test(line) && CLASSIFICATION_FIELDS.some((key) => line.includes(key))) {
      throw new MigrationError("classification_field_unroundtrippable", "Classification data uses unsupported complex YAML syntax.");
    }
    offset += lineWithEnding.length;
  }
  return { content, rawStart, rawEnd, bodyStart: closing.index + closing[0].length, lineEnding: opening[1]!, fields };
}

function parseClassificationScalar(rest: string, key: string): { valueStart: number; valueEnd: number; value: string; quote: "'" | "\"" | ""; comment?: string } {
  const leading = /^\s*/u.exec(rest)![0].length;
  if (leading === rest.length) throw new MigrationError("classification_field_unroundtrippable", `Classification field '${key}' has a non-scalar or empty value.`);
  const text = rest.slice(leading);
  let quote: "'" | "\"" | "" = "";
  let valueEndInText: number;
  if (text[0] === "'" || text[0] === "\"") {
    quote = text[0] as "'" | "\"";
    let closed = -1;
    for (let index = 1; index < text.length; index += 1) {
      if (quote === "\"" && text[index] === "\\") { index += 1; continue; }
      if (quote === "'" && text[index] === "'" && text[index + 1] === "'") { index += 1; continue; }
      if (text[index] === quote) { closed = index; break; }
    }
    if (closed < 0) throw new MigrationError("classification_field_unroundtrippable", `Classification field '${key}' has an unterminated quoted scalar.`);
    valueEndInText = closed + 1;
  } else {
    if (/^[|>{[&*!]/u.test(text)) throw new MigrationError("classification_field_unroundtrippable", `Classification field '${key}' is not a simple scalar.`);
    const comment = /\s+#/u.exec(text);
    valueEndInText = (comment?.index ?? text.length);
    while (valueEndInText > 0 && /\s/u.test(text[valueEndInText - 1]!)) valueEndInText -= 1;
  }
  const trailing = text.slice(valueEndInText);
  if (trailing.trim() !== "" && !/^\s+#/u.test(trailing)) throw new MigrationError("classification_field_unroundtrippable", `Classification field '${key}' has unsupported trailing YAML syntax.`);
  const raw = text.slice(0, valueEndInText);
  const value = quote === "\"" ? decodeDoubleQuoted(raw, key) : quote === "'" ? raw.slice(1, -1).replaceAll("''", "'") : raw;
  if (value.trim() === "") throw new MigrationError("classification_field_unroundtrippable", `Classification field '${key}' is empty.`);
  const commentIndex = trailing.indexOf("#");
  return { valueStart: leading, valueEnd: leading + valueEndInText, value: value.trim(), quote, ...(commentIndex < 0 ? {} : { comment: trailing.slice(commentIndex) }) };
}
function decodeDoubleQuoted(raw: string, key: string): string {
  try { return JSON.parse(raw) as string; }
  catch { throw new MigrationError("classification_field_unroundtrippable", `Classification field '${key}' has an unsupported quoted scalar.`); }
}
function patchFrontmatter(frontmatter: ParsedFrontmatter, classification: UnityClassificationV2): string {
  const desired: Readonly<Record<"schema_version" | "doc_type" | "category" | "failure_mode", string>> = {
    schema_version: "2", doc_type: classification.doc_type, category: classification.category, failure_mode: classification.failure_mode,
  };
  const patches: Array<{ start: number; end: number; text: string }> = [];
  const missing: string[] = [];
  for (const key of ["schema_version", "doc_type", "category", "failure_mode"] as const) {
    const field = frontmatter.fields.get(key)?.[0];
    if (!field) { missing.push(`${key}: ${desired[key]}`); continue; }
    patches.push({ start: field.valueStart, end: field.valueEnd, text: renderScalar(desired[key], field.quote) });
  }
  const legacy = frontmatter.fields.get("problem_type")?.[0];
  if (legacy) patches.push({ start: legacy.lineStart, end: legacy.lineEnd, text: legacy.comment ? `${legacy.comment}${legacy.lineEnding}` : "" });
  if (missing.length > 0) patches.push({ start: frontmatter.rawStart, end: frontmatter.rawStart, text: `${missing.join(frontmatter.lineEnding)}${frontmatter.lineEnding}` });
  let output = frontmatter.content;
  for (const patch of patches.sort((left, right) => right.start - left.start || right.end - left.end)) output = `${output.slice(0, patch.start)}${patch.text}${output.slice(patch.end)}`;
  return output;
}
function renderScalar(value: string, quote: "'" | "\"" | ""): string { return quote === "'" ? `'${value.replaceAll("'", "''")}'` : quote === "\"" ? JSON.stringify(value) : value; }
function scalar(frontmatter: ParsedFrontmatter, key: ClassificationField): string | undefined { return frontmatter.fields.get(key)?.[0]?.value; }
function numberScalar(frontmatter: ParsedFrontmatter, key: ClassificationField): number | undefined { const value = scalar(frontmatter, key); return value && /^\d+$/u.test(value) ? Number(value) : undefined; }

async function detectDestinationCollisions(plans: Array<{ source: string; destination: string }>, conflicts: MigrationConflict[]): Promise<void> {
  const map = new Map<string, Array<{ source: string; destination: string }>>();
  for (const plan of plans) (map.get(pathKey(plan.destination)) ?? (map.set(pathKey(plan.destination), []), map.get(pathKey(plan.destination))!)).push(plan);
  for (const matches of map.values()) if (matches.length > 1) for (const match of matches) conflicts.push({ code: "destination_collision", path: match.source, destination: match.destination, summary: "Multiple sources normalize/case-fold to the same destination." });
  for (const plan of plans) {
    if (pathKey(plan.source) === pathKey(plan.destination)) continue;
    const existingSource = plans.some((candidate) => pathKey(candidate.source) === pathKey(plan.destination));
    if (existingSource) { conflicts.push({ code: "destination_source_overlap", path: plan.source, destination: plan.destination, summary: "Destination is another migration source and ordering would be ambiguous." }); continue; }
    try { await stat(plan.destination); conflicts.push({ code: "destination_exists", path: plan.source, destination: plan.destination, summary: "Destination already exists and will never be overwritten by migration." }); }
    catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  }
}

function updateMarkdownLinks(content: string, oldFile: string, newFile: string, moveMap: ReadonlyMap<string, string>): string {
  const sourceMoved = pathKey(oldFile) !== pathKey(newFile);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const token of markdownPathTokens(content)) {
    const decoded = decodeMarkdownPath(token.rawPath);
    if (decoded === undefined || isExternalMarkdownPath(decoded)) continue;
    const oldTarget = path.resolve(path.dirname(oldFile), decoded);
    const movedTarget = moveMap.get(pathKey(oldTarget));
    if (!sourceMoved && movedTarget === undefined) continue;
    const finalTarget = movedTarget ?? oldTarget;
    let relative = normalize(path.relative(path.dirname(newFile), finalTarget));
    if (!relative.startsWith(".")) relative = `./${relative}`;
    if (token.rawPath.includes("%")) relative = encodeURI(relative);
    replacements.push({ start: token.start, end: token.end, text: relative });
  }
  let output = content;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
  return output;
}

function markdownPathTokens(content: string): MarkdownPathToken[] {
  const excluded = markdownCodeRanges(content);
  const tokens: MarkdownPathToken[] = [];
  const add = (start: number, end: number, rawPath: string, markdownOnly: boolean) => {
    if (excluded.some((range) => start >= range.start && start < range.end) || tokens.some((token) => start < token.end && end > token.start)) return;
    const suffixes = [rawPath.indexOf("#"), rawPath.indexOf("?")].filter((index) => index >= 0);
    const suffix = suffixes.length === 0 ? -1 : Math.min(...suffixes);
    const pathOnly = suffix < 0 ? rawPath : rawPath.slice(0, suffix);
    if (pathOnly === "" || (markdownOnly && !/\.md$/iu.test(pathOnly))) return;
    tokens.push({ start, end: start + pathOnly.length, rawPath: pathOnly });
  };
  for (const match of content.matchAll(/\]\(\s*(<[^>\r\n]+>|[^\s)\r\n]+)(?=\s*(?:["'][^)\r\n]*["'])?\s*\))/gmu)) {
    const whole = match[1]!;
    const raw = whole.startsWith("<") ? whole.slice(1, -1) : whole;
    const local = match.index! + match[0].indexOf(whole) + (whole.startsWith("<") ? 1 : 0);
    add(local, local + raw.length, raw, false);
  }
  for (const match of content.matchAll(/^[ \t]{0,3}\[[^\]\r\n]+\]:[ \t]*(<[^>\r\n]+>|\S+)/gmu)) {
    const whole = match[1]!;
    const raw = whole.startsWith("<") ? whole.slice(1, -1) : whole;
    const local = match.index! + match[0].lastIndexOf(whole) + (whole.startsWith("<") ? 1 : 0);
    add(local, local + raw.length, raw, false);
  }
  for (const match of content.matchAll(/(?:^|[\s'"])((?:\.{1,2}\/|(?:docs|todos|solutions)\/)[^\s<>()\[\]`"']+?\.md(?:#[^\s<>()\[\]`"']+)?)/gimu)) {
    const raw = match[1]!;
    const local = match.index! + match[0].lastIndexOf(raw);
    add(local, local + raw.length, raw, true);
  }
  return tokens.sort((left, right) => left.start - right.start);
}
function markdownCodeRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const lines = [...content.matchAll(/^(```|~~~)[^\r\n]*(?:\r?\n|$)/gmu)];
  let open: { marker: string; start: number } | undefined;
  for (const line of lines) {
    const marker = line[1]!;
    if (!open) open = { marker, start: line.index! };
    else if (open.marker === marker) { ranges.push({ start: open.start, end: line.index! + line[0].length }); open = undefined; }
  }
  if (open) ranges.push({ start: open.start, end: content.length });
  for (const match of content.matchAll(/`[^`\r\n]*`/gu)) ranges.push({ start: match.index!, end: match.index! + match[0].length });
  return ranges;
}
async function reconcileFinalLinks(operations: readonly MigrationOperation[], moveMap: ReadonlyMap<string, string>, conflicts: MigrationConflict[]): Promise<void> {
  const plannedDestinations = new Set(operations.map((operation) => pathKey(operation.destination)));
  for (const operation of operations) {
    for (const token of markdownPathTokens(operation.content)) {
      const decoded = decodeMarkdownPath(token.rawPath);
      if (decoded === undefined || isExternalMarkdownPath(decoded)) continue;
      const resolved = path.resolve(path.dirname(operation.destination), decoded);
      const finalTarget = moveMap.get(pathKey(resolved)) ?? resolved;
      if (!plannedDestinations.has(pathKey(finalTarget)) && !await pathExists(finalTarget)) conflicts.push({ code: "broken_link_after_move", path: normalize(operation.destination), destination: normalize(finalTarget), summary: `Local Markdown link '${token.rawPath}' has no final target after migration.` });
    }
  }
}
function decodeMarkdownPath(raw: string): string | undefined { try { return decodeURI(raw); } catch { return undefined; } }
function isExternalMarkdownPath(raw: string): boolean { return /^[a-z][a-z0-9+.-]*:/iu.test(raw) || raw.startsWith("/") || raw.startsWith("#"); }
async function pathExists(target: string): Promise<boolean> { try { await stat(target); return true; } catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; } }

async function resolveMigrationRoots(request: Extract<UnityMigrationRequestV1, { operation: "plan" | "apply" }>): Promise<{ workspaceRoot: string; solutionsRoot: string; artifactRoot: string }> {
  const workspaceRoot = await realpath(request.workspaceRoot);
  const solutionsRoot = await realpath(request.solutionsRoot);
  const artifactRoot = await realpath(request.artifactRoot ?? path.dirname(solutionsRoot));
  if (!isInside(workspaceRoot, artifactRoot) || !isInside(artifactRoot, solutionsRoot)) throw new MigrationError("root_escape", "artifactRoot/solutionsRoot must be physically contained by workspaceRoot.");
  return { workspaceRoot, solutionsRoot, artifactRoot };
}
async function prepareRunRoot(plan: UnityMigrationPlan, runRoot: string): Promise<string> {
  if (!isInside(plan.workspaceRoot, runRoot)) throw new MigrationError("run_root_escape", "Migration run root must stay inside workspaceRoot.");
  if (isInside(plan.artifactRoot, runRoot) || isInside(runRoot, plan.artifactRoot)) throw new MigrationError("run_root_overlap", "Migration run root must not overlap authoritative artifact roots.");
  await assertPhysicalContainment(plan.workspaceRoot, runRoot, "migration run root");
  await mkdir(runRoot, { recursive: true });
  const physical = await realpath(runRoot);
  if (!isInside(plan.workspaceRoot, physical)) throw new MigrationError("run_root_escape", "Migration run root escaped workspaceRoot through physical ancestry.");
  if (isInside(plan.artifactRoot, physical) || isInside(physical, plan.artifactRoot)) throw new MigrationError("run_root_overlap", "Migration run root physically overlaps authoritative artifact roots.");
  return physical;
}
async function assertOperationContained(plan: UnityMigrationPlan, operation: Pick<MigrationOperation, "source" | "destination">): Promise<void> {
  await assertPhysicalContainment(plan.artifactRoot, operation.source, "migration source");
  await assertPhysicalContainment(plan.artifactRoot, operation.destination, "migration destination");
}
async function loadAndValidateRun(physicalWorkspace: string, runDirectory: string): Promise<{ journal: MigrationJournal; plan: UnityMigrationPlan }> {
  await assertPhysicalContainment(physicalWorkspace, runDirectory, "migration run directory");
  const journalPath = path.join(runDirectory, "journal.json");
  const planPath = path.join(runDirectory, "plan.json");
  await assertPhysicalContainment(runDirectory, journalPath, "migration journal path");
  await assertPhysicalContainment(runDirectory, planPath, "migration plan path");
  const journal = validateJournal(JSON.parse(await readFile(journalPath, "utf8")) as unknown);
  const plan = validatePlan(JSON.parse(await readFile(planPath, "utf8")) as unknown);
  if (pathKey(plan.workspaceRoot) !== pathKey(physicalWorkspace)) throw new MigrationError("recovery_workspace_mismatch", "Migration plan belongs to a different workspace root.");
  if (journal.planHash !== plan.manifestHash || journal.operations.length !== plan.operations.length) throw new MigrationError("recovery_plan_mismatch", "Run journal and plan hashes/operation counts differ.");
  const physicalArtifact = await realpath(plan.artifactRoot);
  const physicalSolutions = await realpath(plan.solutionsRoot);
  if (!isInside(physicalWorkspace, physicalArtifact) || !isInside(physicalArtifact, physicalSolutions)) throw new MigrationError("recovery_root_escape", "Approved migration roots no longer resolve inside the workspace.");
  for (let index = 0; index < plan.operations.length; index += 1) {
    const planned = plan.operations[index]!;
    const recorded = journal.operations[index]!;
    await assertOperationContained(plan, planned);
    const { state: _state, ...comparable } = recorded;
    if (stableStringify(comparable) !== stableStringify(planned)) throw new MigrationError("recovery_operation_mismatch", `Journal operation ${recorded.id} differs from its approved plan.`);
  }
  return { journal, plan };
}
function assertApprovedPlan(plan: UnityMigrationPlan, approvalHash: string): void {
  if (plan.manifestHash !== approvalHash) throw new MigrationError("approval_mismatch", "The approved migration manifest no longer matches current source files.", { expected: approvalHash, actual: plan.manifestHash });
  if (plan.conflicts.length > 0) throw new MigrationError("migration_conflicts", "Migration has unresolved conflicts; exact path overrides are required before apply.", { conflicts: plan.conflicts });
}
function transitionJournalState(journal: MigrationJournal, allowed: readonly MigrationJournal["state"][], next: MigrationJournal["state"]): void {
  if (!allowed.includes(journal.state)) throw new MigrationError("journal_transition_invalid", `Journal transition ${journal.state} -> ${next} is inadmissible.`);
  journal.state = next;
}
function advanceOperationState(operation: JournalOperation, next: JournalOperation["state"]): void {
  if (operation.state === next) return;
  const allowed: Readonly<Record<JournalOperation["state"], readonly JournalOperation["state"][]>> = {
    staged: ["destination_written"], destination_written: ["source_removed", "verified"], source_removed: ["verified"], verified: [], rolled_back: [],
  };
  if (!allowed[operation.state].includes(next)) throw new MigrationError("operation_transition_invalid", `Operation ${operation.id} transition ${operation.state} -> ${next} is inadmissible.`);
  operation.state = next;
}
async function listMarkdown(root: string, signal: AbortSignal): Promise<string[]> {
  const output: string[] = [];
  const stack = [root];
  while (stack.length) {
    throwIfAborted(signal);
    const current = stack.pop()!;
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory() && ![".git", ".pi-unity", ".pi-project-artifacts", "node_modules"].includes(entry.name)) stack.push(child);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) output.push(await realpath(child));
    }
  }
  return output.sort((left, right) => normalize(left).localeCompare(normalize(right)));
}
async function writeJournal(runDirectory: string, journal: MigrationJournal, replace: boolean): Promise<void> {
  const target = path.join(runDirectory, "journal.json");
  await assertPhysicalContainment(runDirectory, target, "migration journal path");
  await atomicReplace(target, `${JSON.stringify(journal, null, 2)}\n`, { validatedExisting: replace });
}
function validateJournal(value: unknown): MigrationJournal {
  const journal = value as MigrationJournal;
  if (!journal || journal.schema !== UNITY_MIGRATION_JOURNAL_SCHEMA || journal.version !== 1 || !Array.isArray(journal.operations)
    || !["applying", "interrupted", "applied", "rolling_back", "rolled_back"].includes(journal.state)
    || journal.operations.some((operation) => !["staged", "destination_written", "source_removed", "verified", "rolled_back"].includes(operation.state))) throw new MigrationError("journal_invalid", "Migration journal is invalid.");
  return journal;
}
function validatePlan(value: unknown): UnityMigrationPlan {
  const plan = value as UnityMigrationPlan;
  if (!plan || plan.schema !== UNITY_MIGRATION_PLAN_SCHEMA || plan.version !== 1 || !Array.isArray(plan.operations) || !Array.isArray(plan.conflicts) || typeof plan.manifestHash !== "string" || plan.operations.some((operation) => !Number.isSafeInteger(operation.sourceMode))) throw new MigrationError("plan_invalid", "Migration plan is invalid.");
  const { manifestHash, ...core } = plan;
  if (hashText(stableStringify(core)) !== manifestHash) throw new MigrationError("plan_hash_invalid", "Migration plan content no longer matches its manifest hash.");
  return plan;
}
function backupPath(root: string, id: string): string { return path.join(root, `${id}.original`); }
function stagePath(root: string, id: string): string { return path.join(root, `${id}.target`); }
async function fileHash(file: string): Promise<string | undefined> { try { return hashBytes(await readFile(file)); } catch (error) { if (hasCode(error, "ENOENT")) return undefined; throw error; } }
async function inject(injector: FailureInjector | undefined, point: string, operation: JournalOperation): Promise<void> { await injector?.(point, { id: operation.id, source: operation.source, destination: operation.destination }); }
function migrationLockPath(plan: Pick<UnityMigrationPlan, "workspaceRoot" | "solutionsRoot">): string { return path.join(plan.workspaceRoot, ".pi-unity", `unity-docs-migration-${shortHash(plan.solutionsRoot)}.lock`); }
function migrationLockOwner(plan: UnityMigrationPlan): Readonly<Record<string, unknown>> { return Object.freeze({ schema: "@aefree/pi-project-artifacts/lock", version: 1, owner: "unity-docs-migration", pid: process.pid, createdAt: new Date().toISOString(), planHash: plan.manifestHash }); }
function validClassification(value: UnityClassificationV2): boolean { return value !== null && typeof value === "object" && (UNITY_DOC_TYPES as readonly string[]).includes(value.doc_type) && (UNITY_CATEGORIES as readonly string[]).includes(value.category) && (UNITY_FAILURE_MODES as readonly string[]).includes(value.failure_mode); }
function stableStringify(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortValue); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortValue(entry)])); return value; }
function conflict(code: string, relative: string, summary: string): MigrationConflict { return { code, path: relative, summary }; }
function compareConflict(left: MigrationConflict, right: MigrationConflict): number { return (left.path ?? "").localeCompare(right.path ?? "") || left.code.localeCompare(right.code) || (left.destination ?? "").localeCompare(right.destination ?? ""); }
function hashText(value: string): string { return hashBytes(Buffer.from(value)); }
function hashBytes(value: Uint8Array): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function shortHash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function pathKey(value: string): string { return normalize(path.resolve(value)).normalize("NFKC").toLowerCase(); }
function normalize(value: string): string { return value.replaceAll("\\", "/"); }
function isInside(parent: string, child: string): boolean { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw new MigrationError("aborted", "Unity migration was aborted."); }
function hasCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code; }
function ignoreWindowsModeError(error: unknown): void { if (process.platform !== "win32") throw error; }

export class MigrationError extends Error { readonly code: string; readonly details: Readonly<Record<string, unknown>>; constructor(code: string, message: string, details: Record<string, unknown> = {}) { super(message); this.name = "MigrationError"; this.code = code; this.details = Object.freeze(details); } }
/** Failure-injection marker that intentionally leaves the journal recoverable instead of rolling back immediately. */
export class MigrationInterruption extends MigrationError { constructor(message = "Synthetic migration interruption") { super("migration_interrupted", message); } }
