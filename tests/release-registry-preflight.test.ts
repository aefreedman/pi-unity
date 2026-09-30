import { strict as assert } from "node:assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageName = "@aefree/pi-unity";
const packageVersion = "0.14.0";
let expectedGitHead: string;
const preflightScript = fileURLToPath(new URL("../.github/scripts/reconcile-npm-release.mjs", import.meta.url));

function runGate(scenario: string, eventName = "workflow_dispatch", overrides: Record<string, string> = {}, wrongTagCommit = false, releaseOverrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pi-unity-release-preflight-"));
  try {
    const binDirectory = join(directory, "bin");
    const environmentFile = join(directory, "github-env");
    const callsFile = join(directory, "npm-calls");
    mkdirSync(binDirectory);
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name: packageName, version: packageVersion }));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git("init", "--quiet");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture");
    expectedGitHead = git("rev-parse", "HEAD");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "tag", "-a", `v${packageVersion}`, "-m", "fixture", expectedGitHead);
    if (wrongTagCommit) {
      git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "different source");
    }
    const eventPath = join(directory, "event.json");
    writeFileSync(eventPath, JSON.stringify({ action: "published", release: { tag_name: `v${packageVersion}`, draft: false, prerelease: false, ...releaseOverrides } }));
    const npmFixture = [
      "#!/usr/bin/env node",
      'const { appendFileSync } = require("node:fs");',
      'appendFileSync(process.env.NPM_CALLS, process.argv.slice(2).join(" ") + "\\n");',
      "switch (process.env.NPM_SCENARIO) {",
      '  case "absent":',
      '    process.stderr.write("npm error code E404\\n");',
      "    process.exit(17);",
      '  case "matching":',
      `    process.stdout.write('{"version":"${packageVersion}","gitHead":"${expectedGitHead}"}\\n');`,
      "    break;",
      '  case "version-mismatch":',
      `    process.stdout.write('{"version":"0.13.0","gitHead":"${expectedGitHead}"}\\n');`,
      "    break;",
      '  case "head-mismatch":',
      `    process.stdout.write('{"version":"${packageVersion}","gitHead":"abcdefabcdefabcdefabcdefabcdefabcdefabcd"}\\n');`,
      "    break;",
      '  case "missing-head":',
      `    process.stdout.write('{"version":"${packageVersion}"}\\n');`,
      "    break;",
      '  case "malformed-json":',
      '    process.stdout.write("{not json\\n");',
      "    break;",
      '  case "non-e404":',
      '    process.stderr.write("npm error code E401\\nnpm error Unauthorized\\n");',
      "    process.exit(17);",
      "  default:",
      '    process.stderr.write("unexpected synthetic scenario: " + process.env.NPM_SCENARIO + "\\n");',
      "    process.exit(99);",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(binDirectory, "npm"), npmFixture);
    writeFileSync(join(binDirectory, "npm.cmd"), `@node "%~dp0npm" %*\r\n`);
    chmodSync(join(binDirectory, "npm"), 0o755);

    const result = spawnSync(process.execPath, [preflightScript], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF: eventName === "release" ? `refs/tags/v${packageVersion}` : "refs/heads/main",
        GITHUB_SHA: eventName === "release" ? "unrelated-default-branch-sha" : expectedGitHead,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: eventPath,
        RELEASE_TAG: `v${packageVersion}`,
        ...overrides,
        GITHUB_ENV: environmentFile,
        NPM_CALLS: callsFile,
        NPM_SCENARIO: scenario,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    const environment = existsSync(environmentFile) ? readFileSync(environmentFile, "utf8") : "";
    const calls = existsSync(callsFile) ? readFileSync(callsFile, "utf8") : "";
    return { status: result.status, output, environment, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const absent = runGate("absent");
assert.equal(absent.status, 0, "Only npm's explicit E404 response may allow publication.");
assert(absent.output.includes(`${packageName}@${packageVersion} is not published; continuing.`));
assert.equal(absent.environment, "");
assert.equal(absent.calls, `view ${packageName}@${packageVersion} version gitHead --json\n`);

const matching = runGate("matching");
assert.equal(matching.status, 0, "A matching published identity must skip publication.");
assert(matching.output.includes(`already matches ${expectedGitHead}; nothing to publish.`));
assert.equal(matching.environment, "SKIP_NPM_PUBLISH=true\n");

for (const scenario of ["version-mismatch", "head-mismatch"]) {
  const result = runGate(scenario);
  assert.equal(result.status, 1, `${scenario} must stop instead of publishing an existing version.`);
  assert(result.output.includes("Existing npm identity does not match"));
  assert.equal(result.environment, "");
}

const missingHead = runGate("missing-head");
assert.equal(missingHead.status, 1, "Published metadata without gitHead must stop publication.");
assert(missingHead.output.includes("must include non-empty string version and gitHead fields."));

const malformedJson = runGate("malformed-json");
assert.equal(malformedJson.status, 1, "Malformed npm metadata must stop publication.");
assert(malformedJson.output.includes("is not valid JSON."));

const nonE404 = runGate("non-e404");
assert.equal(nonE404.status, 17, "Registry/auth failures must preserve npm's nonzero exit status.");
assert(nonE404.output.includes("Unable to verify whether"));
assert(nonE404.output.includes("npm error code E401"), "Failure diagnostics must be retained.");
assert.equal(nonE404.environment, "");

for (const scenario of ["absent", "matching", "version-mismatch", "head-mismatch", "missing-head", "malformed-json", "non-e404"]) {
  const result = runGate(scenario, "release");
  assert.equal(result.status, ["absent", "matching"].includes(scenario) ? 0 : scenario === "non-e404" ? 17 : 1, `release ${scenario}`);
}
for (const eventName of ["release", "workflow_dispatch"]) {
  for (const overrides of [{ RELEASE_TAG: "v0.0.0" }, { RELEASE_TAG: "" }]) {
    const result = runGate("absent", eventName, overrides);
    assert.equal(result.status, 1);
    assert.equal(result.calls, "", "Wrong/empty tag must fail before npm.");
  }
  const result = runGate("absent", eventName, {}, true);
  assert.equal(result.status, 1);
  assert.equal(result.calls, "", "Tag/checkout mismatch must fail before npm.");
}
for (const overrides of [{ GITHUB_REF: "refs/heads/other" }, { GITHUB_SHA: "wrong-main-sha" }]) {
  assert.equal(runGate("absent", "workflow_dispatch", overrides).status, 1);
}
for (const releaseOverrides of [{ tag_name: "v0.0.0" }, { prerelease: true }, { draft: true }]) {
  const result = runGate("absent", "release", {}, false, releaseOverrides);
  assert.equal(result.status, 1);
  assert.equal(result.calls, "");
}
console.log("release registry preflight tests passed");
