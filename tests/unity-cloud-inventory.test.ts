import assert from "node:assert/strict";
import { test } from "node:test";
import { registerUnityCloudInventoryTools, unityCloudInventory } from "../src/unity-cloud-inventory";
import { registerUnityInformationTools } from "../src/unity-cli-information";
import type { UnityCliExecutor } from "../src/unity-cli";
const envelope = (command: string, data: unknown, success = true) => ({ stdout: JSON.stringify({ success, command, data, errors: success ? [] : [{ code: "AUTH_REQUIRED", message: "token=private" }], warnings: [] }), stderr: "" });
test("integration factories register exactly four typed tools without dispatch", () => {
  const names: string[] = [];
  const pi = { registerTool: (tool: { name: string }) => { names.push(tool.name); } };
  registerUnityInformationTools(pi as Parameters<typeof registerUnityInformationTools>[0], async () => { throw Error("unexpected dispatch"); });
  registerUnityCloudInventoryTools(pi as Parameters<typeof registerUnityCloudInventoryTools>[0], async () => { throw Error("unexpected dispatch"); });
  assert.deepEqual(names, ["unity_cli_info", "unity_docs_url", "unity_cloud_build_inventory", "unity_pipeline_automation_inventory"]);
});
test("all ten cloud inventory operations dispatch one exact read-only argv", async () => {
  for (const [family, resources] of [["cloud-build", ["targets", "builds"]], ["automation", ["apps", "pipelines", "jobs"]]] as const) {
    for (const resource of resources) for (const operation of ["list", "get"] as const) {
      const calls: string[][] = [];
      const execute: UnityCliExecutor = async (_cmd, args, options) => { calls.push(args); assert.equal(options.timeout, 20000); return envelope(`pipeline ${family} ${resource} ${operation}`, { rows: [{ id: 1 }] }); };
      const result = await unityCloudInventory(family, { resource, operation, ...(operation === "get" ? { id: "42" } : { page: 2, limit: 5 }), cloudOrg: "org", ...(family === "cloud-build" ? { cloudProject: "proj" } : {}) }, execute);
      assert.equal(result.remoteRead, true); assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], ["--format", "json", "--no-banner", "--non-interactive", "pipeline", family, resource, operation, ...(operation === "get" ? ["42"] : []), "--cloud-org", "org", ...(family === "cloud-build" ? ["--cloud-project", "proj"] : []), ...(operation === "list" ? ["--page", "2", "--limit", "5"] : [])]);
      assert.ok(!calls[0].some(x => ["auth", "config", "install", "create", "trigger", "upgrade", "open"].includes(x)));
    }
  }
});
test("build-specific documented filters and pagination remain bounded", async () => {
  const calls: string[][] = [];
  const execute: UnityCliExecutor = async (_cmd, args) => { calls.push(args); return envelope("pipeline", {}); };
  await unityCloudInventory("cloud-build", { resource: "builds", operation: "get", id: "42", buildTarget: "android-release" }, execute);
  assert.deepEqual(calls[0].slice(-2), ["--build-target", "android-release"]);
  await unityCloudInventory("cloud-build", { resource: "targets", operation: "list", platform: "android", buildTargetName: "release", branch: "main" }, execute);
  assert.deepEqual(calls[1].slice(-6), ["--platform", "android", "--build-target-name", "release", "--branch", "main"]);
  await assert.rejects(unityCloudInventory("automation", { resource: "jobs", operation: "list", limit: 101 }, execute), /Invalid pagination/);
  await assert.rejects(unityCloudInventory("automation", { resource: "jobs", operation: "get" }, execute), /requires an ID/);
  await assert.rejects(unityCloudInventory("automation", { resource: "jobs", operation: "get", id: "--auth" }, execute), /Invalid resource ID/);
  await assert.rejects(unityCloudInventory("automation", { resource: "jobs", operation: "list", cloudProject: "other" }, execute), /Unsupported automation/);
  assert.equal(calls.length, 2);
});
test("schema-open cloud data is bounded and recursively redacted; failure cannot become empty inventory", async () => {
  const req = { resource: "apps", operation: "list" as const };
  const result = await unityCloudInventory("automation", req, async () => envelope("pipeline", { items: [{ password: "private", nested: { apiKey: "sensitive", note: "token=private", text: "x".repeat(4000) } }] }));
  assert.doesNotMatch(JSON.stringify(result), /private|sensitive/);
  assert.ok(JSON.stringify(result).length < 4000);
  await assert.rejects(unityCloudInventory("automation", req, async () => envelope("pipeline", {}, false)), error => { assert.match(String(error), /AUTH_REQUIRED/); assert.doesNotMatch(String(error), /private/); return true; });
  await assert.rejects(unityCloudInventory("automation", req, async () => ({ stdout: "", stderr: "password=private", error: new Error("network secret") })), /uncertain/);
  await assert.rejects(unityCloudInventory("automation", req, async () => envelope("pipeline", null)), /invalid data/);
});
