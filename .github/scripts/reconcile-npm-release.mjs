import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageName = packageJson.name;
const packageVersion = packageJson.version;
function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}
function gitCommit(ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" });
  if (result.error || result.status !== 0) fail(`Unable to resolve release source: ${ref}`);
  return result.stdout.trim();
}
if (typeof packageName !== "string" || !packageName || typeof packageVersion !== "string" || !packageVersion || packageVersion.includes("-")) {
  fail("A stable package name/version is required.");
}
const expectedTag = `v${packageVersion}`;
if (process.env.RELEASE_TAG !== expectedTag) fail(`Release tag must be ${expectedTag}.`);
if (process.env.GITHUB_EVENT_NAME === "release") {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (event.action !== "published" || event.release?.draft !== false || event.release?.prerelease !== false || event.release?.tag_name !== expectedTag) {
    fail("Expected a published stable release with the exact version tag.");
  }
} else if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
  if (process.env.GITHUB_REF !== "refs/heads/main") fail("Trusted publication must be dispatched from main.");
} else {
  fail("Unsupported publication event.");
}
const expectedGitHead = gitCommit("HEAD");
if (gitCommit(`refs/tags/${expectedTag}`) !== expectedGitHead) fail("Release tag does not match checked-out source.");
// Dispatch retains its main-only contract; release events use the tag source,
// never the event's potentially unrelated default-branch SHA.
if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch" && process.env.GITHUB_SHA !== expectedGitHead) {
  fail("Dispatch main commit does not match the checked-out release tag.");
}

const packageSpec = `${packageName}@${packageVersion}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmView = spawnSync(npmCommand, ["view", packageSpec, "version", "gitHead", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (npmView.error) {
  console.error(`::error::Unable to execute npm view for ${packageSpec}: ${npmView.error.message}`);
  process.exit(1);
}

if (npmView.status !== 0) {
  if (npmView.stderr.split(/\r?\n/).includes("npm error code E404")) {
    console.log(`${packageSpec} is not published; continuing.`);
    process.exit(0);
  }

  console.error(`::error::Unable to verify whether ${packageSpec} exists on npm (npm view exited ${npmView.status ?? "without a status"}).`);
  process.stderr.write(npmView.stderr);
  process.exit(npmView.status ?? 1);
}

let metadata;
try {
  metadata = JSON.parse(npmView.stdout);
} catch {
  console.error(`::error::Existing npm metadata for ${packageSpec} is not valid JSON.`);
  process.exit(1);
}

if (
  metadata === null ||
  Array.isArray(metadata) ||
  typeof metadata !== "object" ||
  typeof metadata.version !== "string" ||
  metadata.version.length === 0 ||
  typeof metadata.gitHead !== "string" ||
  metadata.gitHead.length === 0
) {
  console.error(`::error::Existing npm metadata for ${packageSpec} must include non-empty string version and gitHead fields.`);
  process.exit(1);
}

if (metadata.version !== packageVersion || metadata.gitHead !== expectedGitHead) {
  console.error(`::error::Existing npm identity does not match ${packageSpec}: version=${metadata.version}, gitHead=${metadata.gitHead}, expectedVersion=${packageVersion}, expectedGitHead=${expectedGitHead}.`);
  process.exit(1);
}

if (typeof process.env.GITHUB_ENV !== "string" || process.env.GITHUB_ENV.length === 0) {
  console.error("::error::GITHUB_ENV is required to skip an already published npm release.");
  process.exit(1);
}
appendFileSync(process.env.GITHUB_ENV, "SKIP_NPM_PUBLISH=true\n");
console.log(`${packageSpec} already matches ${expectedGitHead}; nothing to publish.`);
