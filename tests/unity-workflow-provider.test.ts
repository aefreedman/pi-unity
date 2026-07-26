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
  assert.deepEqual(await provider.detect(context, { targetPath: tempRoot, operation: "read", signal }), { outcome: "no_match" });

  const preflight = await provider.preflight!(context, { targetPath: nestedTarget, workspaceRoot: projectRoot, operation: "read", signal });
  assert(preflight.outcome === "ready" || (preflight.outcome === "unavailable" && preflight.code === "unity_process_status_timeout"));
  fs.mkdirSync(path.join(projectRoot, "Temp"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "Temp", "UnityLockfile"), "fixture\n");
  assert.deepEqual(await provider.preflight!(context, { targetPath: nestedTarget, workspaceRoot: projectRoot, operation: "read", signal }), {
    outcome: "blocked", code: "unity_native_lockfile_present", retryable: true,
  });
  fs.rmSync(path.join(projectRoot, "Temp"), { recursive: true, force: true });

  for (const resource of provider.resources) {
    const guidance = await provider.loadGuidance!(context, { resourceId: resource.resourceId, purpose: "work", maxChars: 40, signal });
    assert.equal(guidance.outcome, "available");
    if (guidance.outcome === "available") {
      assert.equal(guidance.ref.resourceId, resource.resourceId);
      assert(guidance.content.length <= 40);
    }
  }
  assert.deepEqual(await provider.loadGuidance!(context, { resourceId: "guidance/unity/missing", purpose: "work", maxChars: 10, signal }), {
    outcome: "missing", code: "guidance_resource_missing", retryable: false,
  });

  const malformedRoot = path.join(tempRoot, "malformed");
  fs.mkdirSync(path.join(malformedRoot, "ProjectSettings", "ProjectVersion.txt"), { recursive: true });
  const malformed = await provider.detect(context, { targetPath: malformedRoot, operation: "read", signal });
  assert.deepEqual(malformed, { outcome: "unavailable", code: "unity_marker_invalid", retryable: false });
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await provider.detect({ cwd: tempRoot, signal: aborted.signal }, { targetPath: nestedTarget, operation: "read", signal: aborted.signal }), {
    outcome: "unavailable", code: "aborted", retryable: true,
  });

  const report = await assertWorkflowProviderConformanceV1({
    createProvider: createUnityWorkflowProviderV1,
    matchingTarget: nestedTarget,
    nonMatchingTarget: tempRoot,
    guidanceResourceId: "guidance/unity/work",
  });
  assert.equal(report.passed, true);
  assert(report.checks.includes("provider preflight"));
  assert(report.checks.includes("bounded provider guidance"));
  console.log("pi-unity workflow provider conformance and marker/preflight tests passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
