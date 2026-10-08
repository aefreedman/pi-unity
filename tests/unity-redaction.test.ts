import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactUnityCredentials, redactUnityCredentialData } from "../src/unity-redaction";
import { redactUnityPlanningOutput } from "../src/unity-cli";
import { redactUnityProcessCommandLine } from "../src/unity-processes";
import { summarizeTextForAgent } from "../src/unity-batchmode";
import { writeNormalizedUnityTestArtifact, type NormalizedUnityTestResult } from "../src/unity-tests";

const inputs = [
  '-accessToken syntheticOne -batchmode', '--authToken=syntheticOne -quit',
  '-password "syntheticOne two words" -quit', "password='syntheticOne two words' useful",
  'token: syntheticOne, useful', '{"accessToken":"syntheticOne two words","count":1}',
  '-androidKeystorePass syntheticOne -androidKeyaliasPass "syntheticOne words" -quit',
  'keyAliasPassword=syntheticOne keystorePassword=syntheticOne',
  '-password "syntheticOne \\"escaped\\" words" -quit',
  '-password "syntheticOne\nremaining quoted tail',
  'Authorization: Bearer syntheticOne', 'Bearer syntheticOne',
  'api_key=@"syntheticOne ""quoted"" words"',
];
for (const input of inputs) {
  for (const redact of [redactUnityCredentials, redactUnityPlanningOutput, redactUnityProcessCommandLine, summarizeTextForAgent]) {
    const safe = redact(input)!;
    assert(!safe.includes("syntheticOne"), safe);
    assert(!safe.includes("two words") && !safe.includes("quoted tail"), safe);
    assert.equal(redact(safe), safe, "Repeated boundary sanitization is idempotent");
  }
}
assert.deepEqual(JSON.parse(redactUnityCredentials('{"accessToken":"syntheticOne \\"quoted\\" words","count":1}')), { accessToken: "[redacted]", count: 1 });
assert.equal(redactUnityCredentials('-password "syntheticOne \\"escaped\\" words" -quit'), '-password [redacted] -quit');
assert.equal(redactUnityCredentials('-password "syntheticOne\nremaining quoted tail'), '-password [redacted]');
assert.equal(redactUnityCredentials('Compilation succeeded: 12 tests, projectPath="Useful Project"'), 'Compilation succeeded: 12 tests, projectPath="Useful Project"');
assert.equal(redactUnityCredentials("mytoken=useful passwordPolicy=strict tokenCount=12"), "mytoken=useful passwordPolicy=strict tokenCount=12");
assert.deepEqual(redactUnityCredentialData({ accessToken: "syntheticOne", nested: { message: inputs[2], total: 1, outcome: "tests_failed" } }), { accessToken: "[redacted]", nested: { message: '-password [redacted] -quit', total: 1, outcome: "tests_failed" } });
assert(!summarizeTextForAgent(`-password "${"syntheticOne ".repeat(100)}" useful`, 1, 30)!.includes("syntheticOne"));

const root = await mkdtemp(join(tmpdir(), "pi-unity-redaction-"));
try {
  const result: NormalizedUnityTestResult = { schemaVersion: 1, source: "unity-cli", platform: "EditMode", outcome: "tests_failed", summary: { total: 1, failed: 1 }, selection: { testFilters: [inputs[0]], testCategories: [] }, tests: [{ name: inputs[1], status: "Failed", message: `-password "${"syntheticOne ".repeat(1000)}"`, stackTrace: inputs[2] }], diagnostics: [inputs[5]], flakyTests: [{ name: inputs[0], attempts: 2 }] };
  const relative = await writeNormalizedUnityTestArtifact(root, result);
  const json = await readFile(join(root, relative), "utf8");
  assert(!json.includes("syntheticOne"), "Durable JSON must redact before bounds");
  const saved = JSON.parse(json);
  assert.equal(saved.outcome, "tests_failed"); assert.deepEqual(saved.summary, result.summary);
  assert(result.tests[0].message!.includes("syntheticOne"), "Normalization must not mutate input evidence");
} finally { await rm(root, { recursive: true, force: true }); }
console.log("Shared credential redaction and durable evidence checks passed.");
