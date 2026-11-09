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
      const execute: UnityCliExecutor = async (_cmd, args, options) => { calls.push(args); assert.equal(options.timeout, 20000); return envelope(`pipeline ${family} ${resource}${operation === "get" ? " get" : ""}`, operation === "get" ? { id: "42" } : { items: [{ id: "42" }], total: 9, nextPage: 3, partial: false }); };
      const result = await unityCloudInventory(family, { resource, operation, ...(operation === "get" ? { id: "42" } : { page: 2, limit: 5 }), cloudOrg: "org", ...(family === "cloud-build" ? { cloudProject: "proj", ...(resource === "builds" && operation === "get" ? { buildTarget: "target" } : {}) } : {}) }, execute);
      assert.equal(result.remoteRead, true); assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], ["--format", "json", "--no-banner", "--non-interactive", "pipeline", family, resource, ...(operation === "get" ? ["get", "42"] : []), "--cloud-org", "org", ...(family === "cloud-build" ? ["--cloud-project", "proj"] : []), ...(operation === "list" ? ["--page", "2", "--limit", "5"] : []), ...(family === "cloud-build" && resource === "builds" && operation === "get" ? ["--build-target", "target"] : [])]);
      assert.ok(!calls[0].some(x => ["auth", "config", "install", "create", "trigger", "upgrade", "open"].includes(x)));
    }
  }
});
test("build-specific documented filters and pagination remain bounded", async () => {
  const calls: string[][] = [];
  const execute: UnityCliExecutor = async (_cmd, args) => { calls.push(args); return envelope(args.includes("get") ? "pipeline cloud-build builds get" : "pipeline cloud-build targets", args.includes("get") ? { id: "42" } : { items: [], total: 0, nextPage: null, partial: false }); };
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
test("canonical cloud listings retain partial and continuation metadata and reject invalid contracts", async () => {
  const request = { resource: "apps", operation: "list" as const, limit: 100 };
  const data = { items: Array.from({ length: 80 }, (_, id) => ({ id })), total: null, nextPage: 2, partial: true };
  let calls = 0;
  const result = await unityCloudInventory("automation", request, async () => { calls++; return envelope("pipeline automation apps", data); });
  assert.equal(calls, 1); assert.equal(result.inventoryComplete, false);
  assert.deepEqual(result.listing, { partial: true, total: null, nextPage: 2, returnedCount: 80, outputTruncated: true });
  assert.equal((result.data as {items: unknown[]}).items.length, 50);
  for (const changed of [{ items: {} }, { items: [null] }, { partial: "true" }, { total: -1 }, { total: undefined }, { nextPage: 1 }, { nextPage: "2" }, { nextPage: undefined }]) {
    await assert.rejects(unityCloudInventory("automation", request, async () => envelope("pipeline automation apps", { ...data, ...changed })), /invalid listing/);
  }
  for (const command of ["pipeline", "pipeline automation apps list", "pipeline automation jobs"]) {
    await assert.rejects(unityCloudInventory("automation", request, async () => envelope(command, data)), /invalid envelope/);
  }
  await assert.rejects(unityCloudInventory("automation", { resource: "apps", operation: "get", id: "42" }, async () => envelope("pipeline automation apps get", {})), /empty get/);
  await assert.rejects(unityCloudInventory("cloud-build", { resource: "builds", operation: "get", id: "42" }, async () => { throw Error("must not dispatch"); }), /requires a build target/);
});

test("schema-open cloud data is bounded and recursively redacted; failure cannot become empty inventory", async () => {
  const req = { resource: "apps", operation: "list" as const };
  const result = await unityCloudInventory("automation", req, async () => envelope("pipeline automation apps", { items: [{ password: "private", nested: { apiKey: "sensitive", note: "token=private", text: "x".repeat(4000) } }], total: null, nextPage: 2, partial: true }));
  assert.doesNotMatch(JSON.stringify(result), /private|sensitive/);
  assert.ok(JSON.stringify(result).length < 4000);
  await assert.rejects(unityCloudInventory("automation", req, async () => envelope("pipeline automation apps", {}, false)), error => { assert.match(String(error), /AUTH_REQUIRED/); assert.doesNotMatch(String(error), /private/); return true; });
  await assert.rejects(unityCloudInventory("automation", req, async () => ({ stdout: "", stderr: "password=private", error: new Error("network secret") })), /uncertain/);
  await assert.rejects(unityCloudInventory("automation", req, async () => envelope("pipeline automation apps", null)), /invalid data/);
  const valid = envelope("pipeline automation apps", { items: [], total: 0, nextPage: null, partial: false });
  await assert.rejects(unityCloudInventory("automation", req, async () => ({ ...valid, error: new Error("failed exit") })), /uncertain/);
  await assert.rejects(unityCloudInventory("automation", req, async () => ({ stdout: JSON.stringify({ ...JSON.parse(valid.stdout), warnings: ["partial remote failure"] }), stderr: "" })), /warnings/);
  const empty = await unityCloudInventory("automation", req, async () => valid);
  assert.equal(empty.listing?.returnedCount, 0); assert.equal(empty.inventoryComplete, false);
});
