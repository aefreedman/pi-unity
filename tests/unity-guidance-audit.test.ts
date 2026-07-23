import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditUnityGuidance, auditUnityGuidanceText } from "../src/unity-guidance-audit";

const findings = auditUnityGuidanceText("AGENTS.md", `
# Unity
- Unity Version: 6000.3.0f1
- Use headless Unity open/compile as the compile check:
\`\`\`powershell
Unity.exe -batchmode -projectPath Game -quit -logFile compile.log
Unity.exe -batchmode -projectPath Game -runTests -quit -testResults results.xml
unity command recompile
unity pipeline install
\`\`\`
`);
assert(findings.some((finding) => finding.ruleId === "version.hard-coded-project-version"));
assert(findings.some((finding) => finding.ruleId === "compile.headless-only"));
assert(findings.some((finding) => finding.ruleId === "tests.quit-with-run-tests"));
assert(findings.some((finding) => finding.ruleId === "pipeline.missing-exact-project"));
assert(findings.some((finding) => finding.ruleId === "pipeline.install-undisclosed"));
assert(!auditUnityGuidanceText("AGENTS.md", "Do not combine -runTests with -quit.").some((finding) => finding.ruleId === "tests.quit-with-run-tests"));
assert(!auditUnityGuidanceText("AGENTS.md", "Raw Editor `-runTests` commands must not include `-quit`.").some((finding) => finding.ruleId === "tests.quit-with-run-tests"));
assert.equal(auditUnityGuidanceText("AGENTS.md", "Never use unity -batchmode.\nDo not use unity command without --project-path.\nAvoid hard-coded Unity Version 6000.3.0f1.").length, 0);
assert(auditUnityGuidanceText("AGENTS.md", "Run EditMode with -runTests -quit. Do not run PlayMode tests.").some((finding) => finding.ruleId === "tests.quit-with-run-tests"), "A later unrelated prohibition must not suppress an unsafe command earlier on the line.");
const lifecycleAndDiscovery = auditUnityGuidanceText("AGENTS.md", `
Delete Temp/UnityLockfile before launching Unity.
Run Stop-Process -Id $pid if Unity hangs.
If com.unity.pipeline is present in manifest.json, run unity command --project-path Game recompile.
Run list_tests before selecting tests.
`);
for (const ruleId of [
  "lifecycle.unconditional-lockfile-deletion",
  "lifecycle.arbitrary-pid-termination",
  "pipeline.manifest-implies-reachability",
  "discovery.unbounded-command-or-test-listing",
]) {
  assert(lifecycleAndDiscovery.some((finding) => finding.ruleId === ruleId), `Expected guidance audit rule: ${ruleId}`);
}
const guardedLifecycleAndDiscovery = auditUnityGuidanceText("AGENTS.md", `
Never delete Temp/UnityLockfile automatically.
Terminate only the verified exact project PID with Stop-Process -Id $pid.
If com.unity.pipeline is present, first verify the exact Editor is reachable and advertises recompile before running unity command --project-path Game recompile.
Run list_tests with a narrow filter and bounded output.
`);
for (const ruleId of [
  "lifecycle.unconditional-lockfile-deletion",
  "lifecycle.arbitrary-pid-termination",
  "pipeline.manifest-implies-reachability",
  "discovery.unbounded-command-or-test-listing",
]) {
  assert(!guardedLifecycleAndDiscovery.some((finding) => finding.ruleId === ruleId), `Expected guarded guidance not to trigger: ${ruleId}`);
}

const sanitized = auditUnityGuidanceText("AGENTS.md", "Unity Version: 6000.3.0f1\u001b[31m\u202e");
assert(sanitized[0].evidence.includes("�") && !sanitized[0].evidence.includes("\u001b"));

const fallback = auditUnityGuidanceText("AGENTS.md", `
## Direct Editor fallback
If the Unity CLI is unavailable, use Unity.exe -batchmode -projectPath Game -quit.
`);
assert(!fallback.some((finding) => finding.ruleId === "commands.direct-batchmode-primary"));
const specificPrimary = auditUnityGuidanceText("AGENTS.md", "Use this specific primary command: Unity.exe -batchmode -projectPath Game -quit.");
assert(specificPrimary.some((finding) => finding.ruleId === "commands.direct-batchmode-primary"), "The `ci` substring in specific must not suppress findings.");

const root = await mkdtemp(join(tmpdir(), "pi-unity-guidance-audit-"));
try {
  await writeFile(join(root, "AGENTS.md"), "Use `unity command --project-path Game recompile`.\n");
  await mkdir(join(root, ".github", "instructions"), { recursive: true });
  await writeFile(join(root, ".github", "instructions", "unity.instructions.md"), "Use `unity -batchmode -projectPath Game`.\n");
  const result = await auditUnityGuidance({ path: root });
  assert.equal(result.summary.filesScanned, 2);
  assert.equal(result.files.every((file) => file.sha256.length === 64), true);
  assert(result.findings.some((finding) => finding.ruleId === "commands.ambiguous-bare-unity"));
  assert.equal(result.scope.profile, "mixed");

  const nestedWorkspace = join(root, "ws1");
  await mkdir(nestedWorkspace);
  await writeFile(join(nestedWorkspace, "AGENTS.md"), "Use the exact project path.\n");
  const localOnly = await auditUnityGuidance({ path: nestedWorkspace });
  assert(localOnly.ancestorCandidates.some((candidate) => candidate.path === join(root, "AGENTS.md")), "Expected excluded inherited instructions to be disclosed.");
  assert.equal(localOnly.files.length, 1);
  const withAncestors = await auditUnityGuidance({ path: nestedWorkspace, includeAncestors: true });
  assert(withAncestors.files.some((file) => file.path === join(root, "AGENTS.md")), "Expected includeAncestors to scan inherited instructions.");
  assert.equal(withAncestors.ancestorCandidates.length, 0);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("pi-unity guidance audit tests passed");
