import { existsSync, readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  private?: boolean;
  version?: string;
  publishConfig?: { access?: string };
  pi?: { extensions?: string[]; skills?: string[] };
  scripts?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  engines?: { node?: string };
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

assert.equal(packageJson.private, undefined, "The prepared public release must not retain npm's private publication guard.");
assert.equal(packageJson.version, "0.9.1", "The prepared release version must match the finalized changelog.");
assert.equal(packageJson.publishConfig?.access, "public", "The scoped package must publish with public access.");
assert(packageJson.pi?.extensions?.includes("./index.ts"));
assert(packageJson.pi?.skills?.includes("./skills"));
assert(!packageJson.exports?.["./contracts/v1"], "The removed migration service must not retain a public contract export.");
assert(!packageJson.scripts?.["migrate:unity-docs"], "The removed migration script must not retain an npm command.");
for (const test of ["unity-core.test.ts", "unity-registration.test.ts", "unity-optional-integrations.test.ts", "unity-package-validation.test.ts"]) {
  assert(packageJson.scripts?.test?.includes(test), `Expected npm test to run ${test}.`);
}
assert(!packageJson.scripts?.test?.includes("unity-docs-migration.test.ts"));
assert(!packageJson.scripts?.test?.includes("unity-workflow-optional-integration.test.ts"));

for (const integration of ["@aefree/pi-project-artifacts", "@aefree/pi-file-discovery"]) {
  assert(/^\^\d+\.\d+\.\d+$/.test(packageJson.peerDependencies?.[integration] ?? ""), `Expected optional semver peer ${integration}.`);
  assert(/^\^\d+\.\d+\.\d+$/.test(packageJson.devDependencies?.[integration] ?? ""), `Expected development dependency ${integration}.`);
  assert.equal(packageJson.peerDependenciesMeta?.[integration]?.optional, true, `Expected ${integration} to be optional.`);
  assert.equal(packageJson.dependencies?.[integration], undefined, `${integration} must not be a required runtime dependency.`);
}
assert.equal(packageJson.dependencies?.["@aefree/pi-capability-registry"], undefined, "No remaining Unity runtime contract requires the capability registry.");
assert.equal(packageJson.dependencies?.typebox, "1.3.8", "typebox is statically imported at runtime.");
assert.equal(packageJson.peerDependencies?.typebox, undefined, "typebox is not a host-provided framework dependency.");
assert.equal(packageJson.devDependencies?.tsx, "^4.23.5", "Tests must declare their local TypeScript runner.");
assert(!packageJson.scripts?.test?.includes("npx --yes tsx"), "Tests must use the locally installed tsx.");
assert.equal(packageJson.engines?.node, ">=22.19.0", "Node support must satisfy the declared framework and development packages.");
assert.equal(packageJson.bundledDependencies, undefined);
assert(!JSON.stringify(packageJson).includes("file:../"));

for (const snippet of ["loadArtifactProfileIntegrationV1", "loadFileDiscoveryFilterIntegrationV1", "createOptionalIntegrationRegistryV1", "isOptionalIntegrationActive", "ARTIFACT_PROFILE_REGISTRY_KEY_V1", "FILE_DISCOVERY_FILTER_REGISTRY_KEY_V1"]) {
  assert(indexText.includes(snippet), `Expected optional integration rendezvous: ${snippet}`);
}
assert(!indexText.includes('import(WORKFLOW_CONTRACT_MODULE)'));
assert(!indexText.includes('import(PROJECT_ARTIFACTS_CONTRACT_MODULE)'));
assert(!indexText.includes('import(FILE_DISCOVERY_CONTRACT_MODULE)'));
for (const forbidden of ["unity_migrate_solution_docs", "UnityMigrationServiceV1", "createUnityMigrationService", "UNITY_MIGRATION_PARAMS"]) {
  assert(!indexText.includes(forbidden), `Removed migration surface remains in index.ts: ${forbidden}`);
}
assert(!indexText.includes('from "@aefree/pi-project-artifacts/contracts/v1"'));
assert(!indexText.includes('from "@aefree/pi-file-discovery/contracts/v1"'));
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
assert(readmeText.includes("registry-clean `package-lock.json` is committed"));
assert(changelogText.includes("without selecting schemas or rewriting project documents"));
assert(!changelogText.includes("archive/unpublished-pi-unity-docs-migration"));
assert(changelogText.includes("transactional"));

const lockPath = new URL("../package-lock.json", import.meta.url);
assert(existsSync(lockPath), "A registry-clean lockfile is required for reproducible validation.");
if (existsSync(lockPath)) {
  const lockText = readFileSync(lockPath, "utf8");
  const lock = JSON.parse(lockText) as { packages?: Record<string, { resolved?: unknown; link?: unknown }> };
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    assert(!path.startsWith("../"), `Lockfile must not contain a parent-sibling package entry: ${path}`);
    assert(typeof entry.resolved !== "string" || !entry.resolved.startsWith("../"), `Lockfile must not resolve a parent-sibling package: ${path}`);
    assert.notEqual(entry.link, true, `Lockfile must not contain a workspace link: ${path}`);
  }
}
assert(skillText.includes("unity_project_status") && skillText.includes("one process per project folder"));
assert(guidanceSkillText.includes("unity_guidance_audit") && guidanceSkillText.includes("untrusted evidence"));
assert(debuggingSkillText.includes("exact-version documentation") && debuggingSkillText.includes("observable activation signal"));
assert(pipelineSkillText.includes("unity_pipeline_eval") && pipelineSkillText.includes("known positive executed-test count"));
assert(testBatchText.includes("createUnityTestBatchPlan") && testBatchText.includes("randomUUID"));
assert(batchmodeSourceText.includes("hasKnownPositiveExecutedTestCount") && batchmodeSourceText.includes("isPassingUnityTestEvidence"));

for (const workflow of ["macos.yml", "windows.yml"]) {
  const workflowText = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8");
  assert(workflowText.includes("npm ci --ignore-scripts --no-audit --no-fund"), `${workflow} must validate the committed lockfile.`);
}
const releaseWorkflowText = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
assert(releaseWorkflowText.includes("id-token: write"), "Trusted npm publishing requires GitHub OIDC permission.");
assert(releaseWorkflowText.includes("npm@11.6.2") && releaseWorkflowText.includes("node-version: 22.19.0"), "Trusted publishing must use supported Node and npm versions.");
assert(releaseWorkflowText.includes("npm publish --access public --provenance"), "The release workflow must publish the public scoped package with provenance.");
assert(releaseWorkflowText.includes("existing_git_head") && releaseWorkflowText.includes("GITHUB_SHA"), "Release retries must reconcile npm gitHead with the exact workflow commit.");
assert(!releaseWorkflowText.includes("NODE_AUTH_TOKEN"), "OIDC publishing must not supply a long-lived npm token.");
assert(readFileSync(new URL("../.npmignore", import.meta.url), "utf8").includes(".gitattributes"), "Git attributes must not ship in the npm artifact.");

console.log("pi-unity package validation tests passed");
