import { existsSync, readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  pi?: { extensions?: string[]; skills?: string[] };
  scripts?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bundledDependencies?: string[];
  exports?: Record<string, string>;
};
const indexText = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const readmeText = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const changelogText = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const skillText = readFileSync(new URL("../skills/unity-batchmode-tests/SKILL.md", import.meta.url), "utf8");
const guidanceSkillText = readFileSync(new URL("../skills/auditing-unity-agent-guidance/SKILL.md", import.meta.url), "utf8");
const pipelineSkillText = readFileSync(new URL("../skills/unity-pipeline-workflows/SKILL.md", import.meta.url), "utf8");
const debuggingSkillText = readFileSync(new URL("../skills/unity-debugging/SKILL.md", import.meta.url), "utf8");
const testBatchText = readFileSync(new URL("../src/unity-test-batch.ts", import.meta.url), "utf8");
const batchmodeSourceText = readFileSync(new URL("../src/unity-batchmode.ts", import.meta.url), "utf8");

assert(packageJson.pi?.extensions?.includes("./index.ts"));
assert(packageJson.pi?.skills?.includes("./skills"));
assert(!packageJson.exports?.["./contracts/v1"], "The removed migration service must not retain a public contract export.");
assert(!packageJson.scripts?.["migrate:unity-docs"], "The removed migration script must not retain an npm command.");
for (const test of ["unity-core.test.ts", "unity-registration.test.ts", "unity-optional-integrations.test.ts", "unity-package-validation.test.ts"]) {
  assert(packageJson.scripts?.test?.includes(test), `Expected npm test to run ${test}.`);
}
assert(!packageJson.scripts?.test?.includes("unity-docs-migration.test.ts"));
assert(!packageJson.scripts?.test?.includes("unity-workflow-optional-integration.test.ts"));

for (const integration of ["@aefree/pi-project-artifacts", "@aefree/pi-repo-search"]) {
  assert(/^\^\d+\.\d+\.\d+$/.test(packageJson.peerDependencies?.[integration] ?? ""), `Expected optional semver peer ${integration}.`);
  assert(/^\^\d+\.\d+\.\d+$/.test(packageJson.devDependencies?.[integration] ?? ""), `Expected development dependency ${integration}.`);
  assert.equal(packageJson.peerDependenciesMeta?.[integration]?.optional, true, `Expected ${integration} to be optional.`);
  assert.equal(packageJson.dependencies?.[integration], undefined, `${integration} must not be a required runtime dependency.`);
}
assert.equal(packageJson.dependencies?.["@aefree/pi-capability-registry"], undefined, "No remaining Unity runtime contract requires the capability registry.");
assert.equal(packageJson.bundledDependencies, undefined);
assert(!JSON.stringify(packageJson).includes("file:../"));

for (const snippet of ["loadArtifactProfileIntegrationV1", "loadRepositoryPolicyIntegrationV1", "createOptionalIntegrationRegistryV1", "isOptionalIntegrationActive", "ARTIFACT_PROFILE_REGISTRY_KEY_V1", "REPOSITORY_POLICY_REGISTRY_KEY_V1"]) {
  assert(indexText.includes(snippet), `Expected optional integration rendezvous: ${snippet}`);
}
assert(!indexText.includes('import(WORKFLOW_CONTRACT_MODULE)'));
assert(!indexText.includes('import(PROJECT_ARTIFACTS_CONTRACT_MODULE)'));
assert(!indexText.includes('import(REPOSITORY_SEARCH_CONTRACT_MODULE)'));
for (const forbidden of ["unity_migrate_solution_docs", "UnityMigrationServiceV1", "createUnityMigrationService", "UNITY_MIGRATION_PARAMS"]) {
  assert(!indexText.includes(forbidden), `Removed migration surface remains in index.ts: ${forbidden}`);
}
assert(!indexText.includes('from "@aefree/pi-project-artifacts/contracts/v1"'));
assert(!indexText.includes('from "@aefree/pi-repo-search/contracts/v1"'));
assert(indexText.includes("name: \"unity_pipeline_eval\"") && indexText.includes("name: \"unity_pipeline_inspect\""));
assert(indexText.includes("name: \"unity_run_test_batch\"") && indexText.includes("name: \"unity_launch_batchmode\""));
assert(indexText.includes("pi.registerCommand(\"unity-open\"") && indexText.includes("piUnity.allowCloseRunningUnityProcess"));

assert(!existsSync(new URL("../contracts/v1.ts", import.meta.url)));
assert(!existsSync(new URL("../src/unity-docs-migration.ts", import.meta.url)));
assert(!existsSync(new URL("../scripts/migrate-unity-docs-schema.ts", import.meta.url)));
assert(!existsSync(new URL("../skills/unity-docs", import.meta.url)));
assert(!existsSync(new URL("../prompts/cg-migrate-unity-docs-schema.md", import.meta.url)));
assert(!existsSync(new URL("../references", import.meta.url)));
for (const skillName of ["unity-debugging", "unity-pipeline-workflows", "unity-batchmode-tests", "unity-interactive-playmode-authoring", "auditing-unity-agent-guidance"]) {
  assert(readmeText.includes(`- \`${skillName}\``), `Expected README skill boundary for ${skillName}.`);
}
assert(!readmeText.includes("unity-docs") && !readmeText.includes("unity_migrate_solution_docs"));
assert(readmeText.includes("global registry rendezvous") && readmeText.includes("optional peer integrations"));
assert(readmeText.includes("No `package-lock.json` is committed"));
assert(changelogText.includes("without selecting schemas or rewriting project documents"));
assert(!changelogText.includes("archive/unpublished-pi-unity-docs-migration"));
assert(changelogText.includes("transactional"));

const lockPath = new URL("../package-lock.json", import.meta.url);
if (existsSync(lockPath)) {
  const lockText = readFileSync(lockPath, "utf8");
  const lock = JSON.parse(lockText) as { packages?: Record<string, { resolved?: unknown; link?: unknown }> };
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    assert(!path.startsWith("../"), `Lockfile must not contain a parent-sibling package entry: ${path}`);
    assert(typeof entry.resolved !== "string" || !entry.resolved.startsWith("../"), `Lockfile must not resolve a parent-sibling package: ${path}`);
    assert.notEqual(entry.link, true, `Lockfile must not contain a workspace link: ${path}`);
  }
} else {
  assert(readmeText.includes("No `package-lock.json` is committed"), "A missing lockfile must retain its documented release blocker.");
}
assert(skillText.includes("unity_project_status") && skillText.includes("one process per project folder"));
assert(guidanceSkillText.includes("unity_guidance_audit") && guidanceSkillText.includes("untrusted evidence"));
assert(debuggingSkillText.includes("exact-version documentation") && debuggingSkillText.includes("observable activation signal"));
assert(pipelineSkillText.includes("unity_pipeline_eval") && pipelineSkillText.includes("known positive executed-test count"));
assert(testBatchText.includes("createUnityTestBatchPlan") && testBatchText.includes("randomUUID"));
assert(batchmodeSourceText.includes("hasKnownPositiveExecutedTestCount") && batchmodeSourceText.includes("isPassingUnityTestEvidence"));

assert(existsSync(new URL("../.github/workflows/macos.yml", import.meta.url)) && existsSync(new URL("../.github/workflows/windows.yml", import.meta.url)));

console.log("pi-unity package validation tests passed");
