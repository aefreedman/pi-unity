import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { applyUnityDocsMigration, MigrationInterruption, planUnityDocsMigration, recoverUnityDocsMigration } from "../src/unity-docs-migration";

const context = (cwd: string) => ({ cwd, signal: new AbortController().signal });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-unity-migration-"));
  await mkdir(path.join(root, "docs", "solutions"), { recursive: true });
  return { root, docs: path.join(root, "docs"), solutions: path.join(root, "docs", "solutions") };
}
async function put(root: string, relative: string, content: string) { const target = path.join(root, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); return target; }
function legacy(problemType = "runtime_error", body = "Body") { return `---\nproblem_type: ${problemType}\nmodule: Gameplay\n---\n# Legacy\n\n${body}\n`; }

{
  const fx = await fixture();
  try {
    await put(fx.solutions, "one/same.md", legacy());
    await put(fx.solutions, "two/same.md", legacy());
    const collision = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    assert(collision.conflicts.some((entry) => entry.code === "destination_collision"), "normalized many-to-one destination collision must block");
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    await put(fx.solutions, "hybrid.md", `---\nproblem_type: runtime_error\nschema_version: 2\ncategory: gameplay_code\n---\n# Hybrid\n`);
    const blocked = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    assert(blocked.conflicts.some((entry) => entry.code === "hybrid_authority"));
    const mapped = await planUnityDocsMigration(context(fx.root), {
      operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs,
      mapping: { pathOverrides: { "hybrid.md": { doc_type: "solution", category: "gameplay_code", failure_mode: "runtime_exception" } } },
    });
    assert.equal(mapped.conflicts.length, 0);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    const outbound = "See [index](../../../index.md) and [asset](../../../images/pic.png).\n\n[index-ref]: ../../../index.md#top\n\nBare ../../../index.md\n";
    const source = await put(fx.solutions, "old/deep/linked.md", legacy("runtime_error", outbound));
    const skippedLinker = await put(fx.docs, "index.md", "# Index\n\nSee [legacy](solutions/old/deep/linked.md).\n");
    await put(fx.docs, "images/pic.png", "synthetic image bytes");
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.summary.moved, 1);
    assert.equal(plan.summary.linkUpdates, 1, "inbound link in a skipped/non-solution artifact must be reconciled");
    const destination = path.join(fx.solutions, "gameplay-code", "linked.md");
    const applied = await applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, approvalHash: plan.manifestHash, recovery: { mode: "backup" } });
    assert.equal(applied.journal.state, "applied");
    assert.equal(existsSync(source), false);
    const migrated = await readFile(destination, "utf8");
    assert.match(migrated, /schema_version: 2/);
    assert.match(migrated, /\]\(\.\.\/\.\.\/index\.md\)/, "inline outbound link to an unmoved target must be rebased");
    assert.match(migrated, /\[asset\]\(\.\.\/\.\.\/images\/pic\.png\)/, "non-Markdown local outbound links must also be rebased");
    assert.match(migrated, /^\[index-ref\]: \.\.\/\.\.\/index\.md#top$/m, "reference-style link must be rebased");
    assert.match(migrated, /^Bare \.\.\/\.\.\/index\.md$/m, "bare local Markdown path must be rebased");
    assert.match(await readFile(skippedLinker, "utf8"), /solutions\/gameplay-code\/linked\.md/);
    const journal = await recoverUnityDocsMigration(context(fx.root), applied.runDirectory, "rollback");
    assert.equal(journal.state, "rolled_back");
    assert.equal(await readFile(source, "utf8"), legacy("runtime_error", outbound));
    assert.equal(await readFile(skippedLinker, "utf8"), "# Index\n\nSee [legacy](solutions/old/deep/linked.md).\n");
    assert.equal(existsSync(destination), false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    const source = await put(fx.solutions, "interrupt.md", legacy());
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    let runDirectory: string | undefined;
    try {
      await applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, approvalHash: plan.manifestHash, recovery: { mode: "vcs", checkpoint: "synthetic-revision" } }, (point) => {
        if (point === "migration_destination_written") throw new MigrationInterruption();
      });
      assert.fail("expected synthetic interruption");
    } catch (error) {
      assert(error instanceof MigrationInterruption);
      const runs = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(fx.root, ".pi-unity", "migrations")));
      assert.equal(runs.length, 1);
      runDirectory = path.join(fx.root, ".pi-unity", "migrations", runs[0]!);
    }
    const resumed = await recoverUnityDocsMigration(context(fx.root), runDirectory!, "resume");
    assert.equal(resumed.state, "applied");
    assert.equal(existsSync(source), false);
    const rolledBack = await recoverUnityDocsMigration(context(fx.root), runDirectory!, "rollback");
    assert.equal(rolledBack.state, "rolled_back");
    assert.equal(await readFile(source, "utf8"), legacy());
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    await put(fx.solutions, "source/existing.md", legacy());
    await put(fx.solutions, "gameplay-code/existing.md", "# Pre-existing destination\n");
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    assert(plan.conflicts.some((entry) => entry.code === "destination_exists"), "pre-existing destination must block without overwrite");
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    await put(fx.solutions, "external.md", legacy());
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    await put(fx.solutions, "external.md", legacy("runtime_error", "external edit"));
    await assert.rejects(
      applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, approvalHash: plan.manifestHash, recovery: { mode: "backup" } }),
      (error: any) => error.code === "approval_mismatch",
    );
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    const original = `---\n# keep-leading-comment\ncustom_z: keep\nproblem_type: 'runtime_error' # preserve-legacy-comment\ncustom_a:\n  nested: true\n---\n# Exact body\n\nBody bytes stay.\n`;
    const source = await put(fx.solutions, "preserve.md", original);
    if (process.platform !== "win32") await chmod(source, 0o751);
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    assert.equal(plan.conflicts.length, 0);
    const operation = plan.operations.find((entry) => entry.source === source)!;
    assert.match(operation.content, /^---\nschema_version: 2\ndoc_type: solution\ncategory: gameplay_code\nfailure_mode: runtime_exception\n# keep-leading-comment/m);
    assert.match(operation.content, /custom_z: keep\n# preserve-legacy-comment\ncustom_a:\n  nested: true\n---\n# Exact body\n\nBody bytes stay\.\n$/);
    const applied = await applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, approvalHash: plan.manifestHash, recovery: { mode: "backup" } });
    const destination = path.join(fx.solutions, "gameplay-code", "preserve.md");
    if (process.platform !== "win32") assert.equal((await stat(destination)).mode & 0o777, 0o751, "destination must preserve POSIX source mode");
    await recoverUnityDocsMigration(context(fx.root), applied.runDirectory, "rollback");
    assert.equal(await readFile(source, "utf8"), original, "rollback must restore exact frontmatter/body bytes");
    if (process.platform !== "win32") assert.equal((await stat(source)).mode & 0o777, 0o751, "rollback must restore POSIX source mode");
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    await put(fx.solutions, "duplicate.md", `---\nproblem_type: runtime_error\nproblem_type: logic_error\n---\n# Duplicate\n`);
    await put(fx.solutions, "complex.md", `---\nproblem_type: |\n  runtime_error\n---\n# Complex\n`);
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    assert(plan.conflicts.some((entry) => entry.code === "classification_field_duplicate"));
    assert(plan.conflicts.some((entry) => entry.code === "classification_field_unroundtrippable"));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    await put(fx.solutions, "broken.md", legacy("runtime_error", "See [missing](../never-existed.md)."));
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    assert(plan.conflicts.some((entry) => entry.code === "broken_link_after_move"), "final virtual link reconciliation must block a missing local target");
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "pi-unity-migration-outside-"));
  try {
    await put(fx.solutions, "escape.md", legacy());
    const escapedCategory = path.join(fx.solutions, "gameplay-code");
    await symlink(outside, escapedCategory, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs }),
      (error: any) => error.code === "path_escape",
      "nearest-existing physical ancestor must reject destination junction escapes",
    );
  } finally { await rm(fx.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "pi-unity-run-outside-"));
  try {
    await put(fx.solutions, "run-root.md", legacy());
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    const runLink = path.join(fx.root, "run-link");
    await symlink(outside, runLink, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, runRoot: runLink, approvalHash: plan.manifestHash, recovery: { mode: "backup" } }),
      (error: any) => error.code === "path_escape" || error.code === "run_root_escape",
      "physical run-root escape must block before mutation",
    );
  } finally { await rm(fx.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "pi-unity-swap-outside-"));
  try {
    const source = await put(fx.solutions, "swap.md", legacy());
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    await assert.rejects(
      applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, approvalHash: plan.manifestHash, recovery: { mode: "backup" } }, async (point) => {
        if (point === "migration_before_destination_write") await symlink(outside, path.join(fx.solutions, "gameplay-code"), process.platform === "win32" ? "junction" : "dir");
      }),
      (error: any) => error.code === "path_escape",
      "destination must be revalidated immediately after a junction swap and before write",
    );
    assert.equal(await readFile(source, "utf8"), legacy(), "failed containment must leave the authoritative source untouched");
  } finally { await rm(fx.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "pi-unity-lock-outside-"));
  try {
    const source = await put(fx.solutions, "lock-escape.md", legacy());
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    await symlink(outside, path.join(fx.root, ".pi-unity"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, approvalHash: plan.manifestHash, recovery: { mode: "backup" } }),
      (error: any) => error.code === "path_escape",
      "physical migration-lock escape must block before lock creation",
    );
    assert.equal(await readFile(source, "utf8"), legacy());
  } finally { await rm(fx.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
}

for (const swapPoint of ["migration_before_backup_write", "migration_before_stage_write"] as const) {
  const fx = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "pi-unity-run-child-outside-"));
  try {
    const source = await put(fx.solutions, `${swapPoint}.md`, legacy());
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    await assert.rejects(
      applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, approvalHash: plan.manifestHash, recovery: { mode: "backup" } }, async (point, details) => {
        if (point !== swapPoint) return;
        const childRoot = String(swapPoint === "migration_before_backup_write" ? details?.backupRoot : details?.stageRoot);
        await rm(childRoot, { recursive: true, force: true });
        await symlink(outside, childRoot, process.platform === "win32" ? "junction" : "dir");
      }),
      (error: any) => error.code === "path_escape",
      `${swapPoint} must revalidate its nearest physical ancestor immediately before write`,
    );
    assert.equal(await readFile(source, "utf8"), legacy());
  } finally { await rm(fx.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
}

{
  const fx = await fixture();
  try {
    await put(fx.solutions, "concurrent-recovery.md", legacy());
    const plan = await planUnityDocsMigration(context(fx.root), { operation: "plan", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs });
    let runDirectory = "";
    await assert.rejects(
      applyUnityDocsMigration(context(fx.root), { operation: "apply", workspaceRoot: fx.root, solutionsRoot: fx.solutions, artifactRoot: fx.docs, approvalHash: plan.manifestHash, recovery: { mode: "backup" } }, (point) => { if (point === "migration_destination_written") throw new MigrationInterruption(); }),
      MigrationInterruption,
    );
    const runs = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(fx.root, ".pi-unity", "migrations")));
    runDirectory = path.join(fx.root, ".pi-unity", "migrations", runs[0]!);
    const results = await Promise.allSettled([
      recoverUnityDocsMigration(context(fx.root), runDirectory, "resume"),
      recoverUnityDocsMigration(context(fx.root), runDirectory, "rollback"),
    ]);
    assert(results.some((result) => result.status === "fulfilled"), "queued concurrent recovery must make deterministic progress");
    const source = path.join(fx.solutions, "concurrent-recovery.md");
    const destination = path.join(fx.solutions, "gameplay-code", "concurrent-recovery.md");
    assert.notEqual(existsSync(source), existsSync(destination), "serialized resume/rollback must not leave duplicate or missing authority");
    const journal = JSON.parse(await readFile(path.join(runDirectory, "journal.json"), "utf8"));
    assert(["applied", "rolled_back"].includes(journal.state));
    if (journal.state === "applied") await assert.rejects(recoverUnityDocsMigration(context(fx.root), runDirectory, "resume"), (error: any) => error.code === "recovery_transition_invalid");
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}

console.log("pi-unity docs migration integrity and recovery fixture tests passed");
