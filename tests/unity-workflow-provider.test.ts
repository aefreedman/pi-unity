import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assertWorkflowProviderConformanceV1 } from "@aefree/pi-workflow/contracts/v1/conformance";
import {
  UNITY_WORKFLOW_PROVIDER_ID_V1,
  UNITY_WORKFLOW_PROVIDER_OWNER_V1,
  createUnityWorkflowProviderV1,
} from "../src/unity-workflow-provider.ts";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unity-workflow-provider-"));
const projectRoot = path.join(tempRoot, "workspace", "game");
const nestedTarget = path.join(projectRoot, "Assets", "Scripts", "Player.cs");
const workflowProviderSource = fs.readFileSync(new URL("../src/unity-workflow-provider.ts", import.meta.url), "utf8");
const expectedPlanGuidance = [
  fs.readFileSync(new URL("../references/_shared/unity-repo-research.md", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../references/workflow/plan.md", import.meta.url), "utf8"),
].join("\n\n");
fs.mkdirSync(path.dirname(nestedTarget), { recursive: true });
fs.mkdirSync(path.join(projectRoot, "ProjectSettings"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 2022.3.18f1\n");
fs.writeFileSync(nestedTarget, "// fixture\n");

try {
  const provider = createUnityWorkflowProviderV1();
  assert.equal(provider.id, UNITY_WORKFLOW_PROVIDER_ID_V1);
  assert.equal(provider.kind, "engine");
  assert.equal(provider.owner.packageName, "@aefree/pi-unity");
  assert.equal(provider.owner.packageVersion, JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  assert.equal(provider.owner.packageRoot, UNITY_WORKFLOW_PROVIDER_OWNER_V1.packageRoot);
  assert(path.isAbsolute(provider.owner.packageRoot), "workflow provider owner must retain its physical package root");

  const signal = new AbortController().signal;
  const context = { cwd: tempRoot, signal };
  const detected = await provider.detect(context, { targetPath: nestedTarget, operation: "read", signal });
  assert.deepEqual(detected.outcome, "match");
  if (detected.outcome === "match") assert.equal(detected.workspaceRoot, projectRoot);
  const noMatchRoot = path.join(tempRoot, "not-unity");
  fs.mkdirSync(noMatchRoot);
  assert.deepEqual(await provider.detect(context, { targetPath: noMatchRoot, operation: "read", signal }), { outcome: "no_match" });
  const nestedWorkspaceDetection = await provider.detect(context, { targetPath: path.join(tempRoot, "workspace"), operation: "read", signal });
  assert.equal(nestedWorkspaceDetection.outcome, "match", "A parent with exactly one nested Unity copy is deterministic.");

  const preflight = await provider.preflight!(context, { targetPath: nestedTarget, workspaceRoot: projectRoot, operation: "read", signal });
  assert.deepEqual(preflight, { outcome: "ready" });
  fs.mkdirSync(path.join(projectRoot, "Temp"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "Temp", "UnityLockfile"), "fixture\n");
  assert.deepEqual(await provider.preflight!(context, { targetPath: nestedTarget, workspaceRoot: projectRoot, operation: "read", signal }), { outcome: "ready" }, "An open Editor lockfile must not block read/planning preflight.");
  fs.rmSync(path.join(projectRoot, "Temp"), { recursive: true, force: true });

  for (const name of ["copy-a", "copy-b"]) {
    const candidate = path.join(tempRoot, "ambiguous", name);
    fs.mkdirSync(path.join(candidate, "Assets"), { recursive: true });
    fs.mkdirSync(path.join(candidate, "ProjectSettings"), { recursive: true });
    fs.writeFileSync(path.join(candidate, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.4.7f1\n");
  }
  assert.deepEqual(await provider.detect(context, { targetPath: path.join(tempRoot, "ambiguous"), operation: "read", signal }), {
    outcome: "unavailable", code: "unity_project_ambiguous", retryable: false,
  });

  for (const resource of provider.resources) {
    const guidance = await provider.loadGuidance!(context, { resourceId: resource.resourceId, purpose: "work", maxChars: 40, signal });
    assert.equal(guidance.outcome, "available");
    if (guidance.outcome === "available") {
      assert.equal(guidance.ref.resourceId, resource.resourceId);
      assert(guidance.content.length <= 40);
    }
  }
  assert(!workflowProviderSource.includes("Unity planning research (apply only after engine.unity matches)"), "Plan guidance must not retain the old detailed inline string.");
  assert(workflowProviderSource.includes("PLAN_GUIDANCE_FILES") && workflowProviderSource.includes("references/workflow/plan.md"), "Plan guidance must name packaged Markdown resources.");
  const fullPlan = await provider.loadGuidance!(context, { resourceId: "guidance/unity/plan", purpose: "work", maxChars: expectedPlanGuidance.length + 1, signal });
  assert.equal(fullPlan.outcome, "available");
  if (fullPlan.outcome === "available") {
    assert.equal(fullPlan.content, expectedPlanGuidance, "Plan guidance must compose the packaged canonical research and connected-planning overlay.");
    assert.equal(fullPlan.truncated, false);
    assert.equal(fullPlan.ref.packageName, "@aefree/pi-unity");
    assert.equal(fullPlan.ref.packageVersion, provider.owner.packageVersion);
    assert(!/[A-Za-z]:[\\/]|\/(?:Users|home)\//.test(fullPlan.content), "Plan guidance must not contain a machine-specific absolute path.");
    for (const snippet of ["ProjectSettings/ProjectVersion.txt", "Packages/manifest.json", "Packages/packages-lock.json", "1. Project guidance and checked-in docs.", "2. Engine, package, or platform docs included with or installed locally for the exact detected versions.", "3. Active Pi Unity/package documentation tools or databases when installed.", "4. Official vendor docs reachable through available tools.", "unity_plan_inspect", "package-owned purpose-built read", "Never install or upgrade documentation, packages, or Pipeline merely to plan", "verification gap"]) {
      assert(fullPlan.content.includes(snippet), `Missing planning guidance: ${snippet}`);
    }
  }
  const boundedPlan = await provider.loadGuidance!(context, { resourceId: "guidance/unity/plan", purpose: "work", maxChars: 80, signal });
  assert.equal(boundedPlan.outcome, "available");
  if (boundedPlan.outcome === "available") {
    assert.equal(boundedPlan.content, expectedPlanGuidance.slice(0, 80));
    assert.equal(boundedPlan.truncated, true);
  }
  assert.deepEqual(await provider.loadGuidance!(context, { resourceId: "guidance/unity/missing", purpose: "work", maxChars: 10, signal }), {
    outcome: "missing", code: "guidance_resource_missing", retryable: false,
  });

  for (const [name, contents] of [["empty", ""], ["garbage", "not a Unity version"], ["unparseable", "m_EditorVersion: \n"]] as const) {
    const malformedRoot = path.join(tempRoot, "malformed", name);
    fs.mkdirSync(path.join(malformedRoot, "ProjectSettings"), { recursive: true });
    fs.writeFileSync(path.join(malformedRoot, "ProjectSettings", "ProjectVersion.txt"), contents);
    const malformed = await provider.detect(context, { targetPath: malformedRoot, operation: "read", signal });
    assert.deepEqual(malformed, { outcome: "unavailable", code: "unity_marker_invalid", retryable: false }, `${name} ProjectVersion content must not activate engine.unity`);
  }
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await provider.detect({ cwd: tempRoot, signal: aborted.signal }, { targetPath: nestedTarget, operation: "read", signal: aborted.signal }), {
    outcome: "unavailable", code: "aborted", retryable: true,
  });
  assert.deepEqual(await provider.loadGuidance!({ cwd: tempRoot, signal: aborted.signal }, { resourceId: "guidance/unity/plan", purpose: "work", maxChars: 10, signal: aborted.signal }), {
    outcome: "unavailable", code: "aborted", retryable: true,
  });

  const report = await assertWorkflowProviderConformanceV1({
    createProvider: createUnityWorkflowProviderV1,
    matchingTarget: nestedTarget,
    nonMatchingTarget: noMatchRoot,
    guidanceResourceId: "guidance/unity/work",
  });
  assert.equal(report.passed, true);
  assert(report.checks.includes("provider preflight"));
  assert(report.checks.includes("bounded provider guidance"));
  console.log("pi-unity workflow provider conformance and marker/preflight tests passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
