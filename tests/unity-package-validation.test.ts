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

assert.equal(packageJson.private, undefined, "The prepared public release must not retain npm's private publication guard.");
assert.equal(changelogText.match(/^## (\d+\.\d+\.\d+) - /m)?.[1], packageJson.version, "The prepared release version must match the latest finalized changelog.");
assert(changelogText.includes(`## ${packageJson.version} - `), "The prepared release must have a changelog entry.");
assert(changelogText.includes("## Unreleased"), "Retain the unreleased section for future work.");
assert.equal(packageJson.publishConfig?.access, "public", "The scoped package must publish with public access.");
assert(packageJson.pi?.extensions?.includes("./index.ts"));
assert(packageJson.pi?.skills?.includes("./skills"));
assert(!packageJson.exports?.["./contracts/v1"], "The removed migration service must not retain a public contract export.");
assert(!packageJson.scripts?.["migrate:unity-docs"], "The removed migration script must not retain an npm command.");
for (const test of ["unity-projects.test.ts", "pi-host-compatibility.test.ts", "unity-optional-integrations.test.ts", "release-registry-preflight.test.ts", "unity-package-validation.test.ts"]) {
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
assert.equal(packageJson.dependencies?.typebox, undefined, "Pi supplies TypeBox; do not install a production copy.");
assert.equal(packageJson.peerDependencies?.typebox, "*");
assert.equal(packageJson.peerDependenciesMeta?.typebox?.optional, true);
assert.equal(packageJson.devDependencies?.typebox, "1.3.8");
for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
  assert.equal(packageJson.dependencies?.[name], undefined, `Pi supplies ${name}; do not install a production copy.`);
  assert.equal(packageJson.peerDependencies?.[name], "*");
  assert.match(packageJson.devDependencies?.[name] ?? "", /^\d+\.\d+\.\d+$/, "Pi validation dependencies must be exact versions");
  assert.equal(JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8")).version, packageJson.devDependencies?.[name], "installed Pi must match the manifest");
}
assert.equal(packageJson.devDependencies?.tsx, "4.23.15", "Tests must declare the locally validated TypeScript runner.");
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
for (const skill of ["unity-pipeline-workflows", "unity-debugging", "unity-interactive-playmode-authoring", "consulting-unity-documentation"]) {
  assert(readmeText.includes(`skills/${skill}/SKILL.md`));
  assert(existsSync(new URL(`../skills/${skill}/SKILL.md`, import.meta.url)));
}
assert(readmeText.includes("`pi-unity-docs` is optional"));

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
for (const workflow of ["macos.yml", "windows.yml"]) {
  const workflowText = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8");
  assert(workflowText.includes("npm ci --ignore-scripts --no-audit --no-fund"), `${workflow} must validate the committed lockfile.`);
}
const releaseWorkflowText = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
assert(releaseWorkflowText.includes("id-token: write"), "Trusted npm publishing requires GitHub OIDC permission.");
assert(releaseWorkflowText.includes("npm@11.6.2") && releaseWorkflowText.includes("node-version: 22.19.0"), "Trusted publishing must use supported Node and npm versions.");
assert(releaseWorkflowText.includes("npm publish --access public --provenance"), "The release workflow must publish the public scoped package with provenance.");
assert(releaseWorkflowText.includes("node .github/scripts/reconcile-npm-release.mjs"), "The release workflow must run its tested npm identity gate.");
const releasePreflightText = readFileSync(new URL("../.github/scripts/reconcile-npm-release.mjs", import.meta.url), "utf8");
assert(releasePreflightText.includes("metadata.version") && releasePreflightText.includes("metadata.gitHead") && releasePreflightText.includes("GITHUB_SHA"), "Release retries must reconcile structured npm version and gitHead metadata with the exact workflow commit.");
assert(releasePreflightText.includes('includes("npm error code E404")'), "Only npm's explicit version-not-found response may permit publication.");
assert(!releaseWorkflowText.includes("NODE_AUTH_TOKEN"), "OIDC publishing must not supply a long-lived npm token.");
const npmIgnoreText = readFileSync(new URL("../.npmignore", import.meta.url), "utf8");
assert(npmIgnoreText.includes(".gitattributes"), "Git attributes must not ship in the npm artifact.");
assert(npmIgnoreText.includes(".pi-subagents/"), "Local pi-subagents review artifacts must not ship in the npm artifact.");

console.log("pi-unity package validation tests passed");
