import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assertWorkflowGuidanceContributorConformanceV1 } from "@aefree/pi-workflow/contracts/v1/conformance";
import { selectWorkflowGuidanceResourcesV1 } from "@aefree/pi-workflow/runtime/v1";
import {
  UNITY_WORKFLOW_GUIDANCE_CONTRIBUTOR_ID_V1,
  UNITY_WORKFLOW_GUIDANCE_CONTRIBUTOR_OWNER_V1,
  createUnityWorkflowGuidanceContributorV1,
} from "../src/unity-workflow-guidance-contributor.ts";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unity-workflow-guidance-contributor-"));
const projectRoot = path.join(tempRoot, "workspace", "game");
const nestedTarget = path.join(projectRoot, "Assets", "Scripts", "Player.cs");
const workflowGuidanceContributorSource = fs.readFileSync(new URL("../src/unity-workflow-guidance-contributor.ts", import.meta.url), "utf8");
const expectedPlanGuidance = [
  fs.readFileSync(new URL("../references/unity-repo-research.md", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../references/workflow/plan.md", import.meta.url), "utf8"),
].join("\n\n");
const expectedWorkGuidance = fs.readFileSync(new URL("../references/workflow/work.md", import.meta.url), "utf8");
const retainedValidationRules = [
  "known positive executed-test count and no failures before calling XML evidence passing.",
  "Honor explicit PlayMode skips.",
  "inspect the exact current-run artifacts once and do not relaunch unchanged work without a new hypothesis.",
] as const;
fs.mkdirSync(path.dirname(nestedTarget), { recursive: true });
fs.mkdirSync(path.join(projectRoot, "ProjectSettings"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 2022.3.18f1\n");
fs.writeFileSync(nestedTarget, "// fixture\n");

try {
  const contributor = createUnityWorkflowGuidanceContributorV1();
  assert.equal(contributor.id, UNITY_WORKFLOW_GUIDANCE_CONTRIBUTOR_ID_V1);
  assert.equal(contributor.owner.packageName, "@aefree/pi-unity");
  assert.equal(contributor.owner.packageVersion, JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  assert.equal(contributor.owner.packageRoot, UNITY_WORKFLOW_GUIDANCE_CONTRIBUTOR_OWNER_V1.packageRoot);
  assert(path.isAbsolute(contributor.owner.packageRoot), "workflow guidance contributor owner must retain its physical package root");
  assert.deepEqual(contributor.resources.map((resource) => resource.resourceId), ["guidance/unity/plan", "guidance/unity/work", "guidance/unity/review"]);
  for (const [purpose, expectedResourceIds] of [
    ["plan", ["guidance/unity/plan"]],
    ["work", ["guidance/unity/work"]],
    ["review", ["guidance/unity/review"]],
    ["validation", []],
  ] as const) {
    assert.deepEqual(selectWorkflowGuidanceResourcesV1(contributor.resources, purpose).map((resource) => resource.resourceId), expectedResourceIds, `${purpose} selection must not load unrelated resources or fall back to all guidance`);
  }

  const signal = new AbortController().signal;
  const context = { cwd: tempRoot, signal };
  const detected = await contributor.detect(context, { targetPath: nestedTarget, workflow: "work", signal });
  assert.deepEqual(detected.outcome, "applicable");
  if (detected.outcome === "applicable") assert.equal(detected.root, projectRoot);
  const noMatchRoot = path.join(tempRoot, "not-unity");
  fs.mkdirSync(noMatchRoot);
  assert.deepEqual(await contributor.detect(context, { targetPath: noMatchRoot, workflow: "work", signal }), { outcome: "not_applicable" });
  const nestedWorkspaceDetection = await contributor.detect(context, { targetPath: path.join(tempRoot, "workspace"), workflow: "work", signal });
  assert.equal(nestedWorkspaceDetection.outcome, "applicable", "A parent with exactly one nested Unity copy is deterministic.");

  for (const name of ["copy-a", "copy-b"]) {
    const candidate = path.join(tempRoot, "ambiguous", name);
    fs.mkdirSync(path.join(candidate, "Assets"), { recursive: true });
    fs.mkdirSync(path.join(candidate, "ProjectSettings"), { recursive: true });
    fs.writeFileSync(path.join(candidate, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.4.7f1\n");
  }
  assert.deepEqual(await contributor.detect(context, { targetPath: path.join(tempRoot, "ambiguous"), workflow: "work", signal }), {
    outcome: "unavailable", code: "unity_project_ambiguous", retryable: false,
  });

  for (const resource of contributor.resources) {
    const guidance = await contributor.loadGuidance!(context, { resourceId: resource.resourceId, purpose: "work", maxChars: 40, signal });
    assert.equal(guidance.outcome, "available");
    if (guidance.outcome === "available") {
      assert.equal(guidance.ref.resourceId, resource.resourceId);
      assert(guidance.content.length <= 40);
    }
  }
  assert(!workflowGuidanceContributorSource.includes("Unity planning research (apply only after engine.unity matches)"), "Plan guidance must not retain the old detailed inline string.");
  assert(workflowGuidanceContributorSource.includes("MARKDOWN_GUIDANCE_FILES") && workflowGuidanceContributorSource.includes("references/workflow/plan.md") && workflowGuidanceContributorSource.includes("references/workflow/work.md"), "Plan and work guidance must name packaged Markdown resources.");
  assert(!workflowGuidanceContributorSource.includes("Unity work: preserve one-process-per-project safety"), "Work guidance must not retain the old inline summary.");
  const fullPlan = await contributor.loadGuidance!(context, { resourceId: "guidance/unity/plan", purpose: "work", maxChars: expectedPlanGuidance.length + 1, signal });
  assert.equal(fullPlan.outcome, "available");
  if (fullPlan.outcome === "available") {
    assert.equal(fullPlan.content, expectedPlanGuidance, "Plan guidance must compose the packaged canonical research and connected-planning overlay.");
    assert.equal(fullPlan.truncated, false);
    assert.equal(fullPlan.ref.packageName, "@aefree/pi-unity");
    assert.equal(fullPlan.ref.packageVersion, contributor.owner.packageVersion);
    assert(!/[A-Za-z]:[\\/]|\/(?:Users|home)\//.test(fullPlan.content), "Plan guidance must not contain a machine-specific absolute path.");
    for (const snippet of ["ProjectSettings/ProjectVersion.txt", "Packages/manifest.json", "Packages/packages-lock.json", "1. Project guidance and checked-in docs.", "2. Engine, package, or platform docs included with or installed locally for the exact detected versions.", "3. Active Pi Unity/package documentation tools or databases when installed.", "4. Official vendor docs reachable through available tools.", "unity_plan_inspect", "package-owned purpose-built read", "Never install or upgrade documentation, packages, or Pipeline merely to plan", "verification gap"]) {
      assert(fullPlan.content.includes(snippet), `Missing planning guidance: ${snippet}`);
    }
  }
  const boundedPlan = await contributor.loadGuidance!(context, { resourceId: "guidance/unity/plan", purpose: "work", maxChars: 80, signal });
  assert.equal(boundedPlan.outcome, "available");
  if (boundedPlan.outcome === "available") {
    assert.equal(boundedPlan.content, expectedPlanGuidance.slice(0, 80));
    assert.equal(boundedPlan.truncated, true);
  }
  const fullWork = await contributor.loadGuidance!(context, { resourceId: "guidance/unity/work", purpose: "work", maxChars: expectedWorkGuidance.length + 1, signal });
  assert.equal(fullWork.outcome, "available");
  if (fullWork.outcome === "available") {
    assert.equal(fullWork.content, expectedWorkGuidance, "Work guidance must load from packaged Markdown.");
    assert.equal(fullWork.truncated, false);
    assert.deepEqual(fullWork.ref, { packageName: "@aefree/pi-unity", packageVersion: contributor.owner.packageVersion, resourceId: "guidance/unity/work" });
    assert(!/[A-Za-z]:[\\/]|\/(?:Users|home)\//.test(fullWork.content), "Work guidance must not contain a machine-specific absolute path.");
    for (const snippet of ["unity_project_status", "recompile_status", "known positive executed-test count", "NUnit XML", "Do not silently switch to batchmode", "Do not delete lockfiles or terminate arbitrary PIDs"]) {
      assert(fullWork.content.includes(snippet), `Missing Unity work guidance: ${snippet}`);
    }
    for (const rule of retainedValidationRules) {
      assert.equal(fullWork.content.split(rule).length - 1, 1, `Work guidance must retain validation rule exactly once: ${rule}`);
    }
  }
  const boundedWork = await contributor.loadGuidance!(context, { resourceId: "guidance/unity/work", purpose: "work", maxChars: 80, signal });
  assert.equal(boundedWork.outcome, "available");
  if (boundedWork.outcome === "available") {
    assert.equal(boundedWork.content, expectedWorkGuidance.slice(0, 80));
    assert.equal(boundedWork.truncated, true);
  }
  for (const resourceId of ["guidance/unity/missing", "guidance/unity/validation"]) {
    assert.deepEqual(await contributor.loadGuidance!(context, { resourceId, purpose: "validation", maxChars: 10, signal }), {
      outcome: "missing", code: "guidance_resource_missing", retryable: false,
    }, `${resourceId} must remain unavailable rather than becoming a general or load-all fallback resource`);
  }

  for (const [name, contents] of [["empty", ""], ["garbage", "not a Unity version"], ["unparseable", "m_EditorVersion: \n"]] as const) {
    const malformedRoot = path.join(tempRoot, "malformed", name);
    fs.mkdirSync(path.join(malformedRoot, "ProjectSettings"), { recursive: true });
    fs.writeFileSync(path.join(malformedRoot, "ProjectSettings", "ProjectVersion.txt"), contents);
    const malformed = await contributor.detect(context, { targetPath: malformedRoot, workflow: "work", signal });
    assert.deepEqual(malformed, { outcome: "unavailable", code: "unity_marker_invalid", retryable: false }, `${name} ProjectVersion content must not activate engine.unity`);
  }
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await contributor.detect({ cwd: tempRoot, signal: aborted.signal }, { targetPath: nestedTarget, workflow: "work", signal: aborted.signal }), {
    outcome: "unavailable", code: "aborted", retryable: true,
  });
  for (const resourceId of ["guidance/unity/plan", "guidance/unity/work"] as const) {
    assert.deepEqual(await contributor.loadGuidance!({ cwd: tempRoot, signal: aborted.signal }, { resourceId, purpose: "work", maxChars: 10, signal: aborted.signal }), {
      outcome: "unavailable", code: "aborted", retryable: true,
    });
  }

  const report = await assertWorkflowGuidanceContributorConformanceV1({
    createContributor: createUnityWorkflowGuidanceContributorV1,
    matchingTarget: nestedTarget,
    nonMatchingTarget: noMatchRoot,
    guidanceResourceId: "guidance/unity/work",
  });
  assert.equal(report.passed, true);
  assert(report.checks.includes("bounded guidance"));
  console.log("pi-unity workflow guidance contributor conformance and marker applicability tests passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
