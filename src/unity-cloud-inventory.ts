import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveUnityCliCommand, type UnityCliExecutor } from "./unity-cli";
import { boundedCliData, checkCliResult, positiveInt, validArg } from "./unity-cli-information";

const base = ["--format", "json", "--no-banner", "--non-interactive", "pipeline"];
const operation = Type.Union([Type.Literal("list"), Type.Literal("get")]);
export const cloudBuildParameters = Type.Object({ resource: Type.Union([Type.Literal("targets"), Type.Literal("builds")]), operation, id: Type.Optional(Type.String()), cloudOrg: Type.Optional(Type.String()), cloudProject: Type.Optional(Type.String()), page: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()), buildTarget: Type.Optional(Type.String()), platform: Type.Optional(Type.String()), buildTargetName: Type.Optional(Type.String()), branch: Type.Optional(Type.String()) });
export const automationParameters = Type.Object({ resource: Type.Union([Type.Literal("apps"), Type.Literal("pipelines"), Type.Literal("jobs")]), operation, id: Type.Optional(Type.String()), cloudOrg: Type.Optional(Type.String()), page: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()) });
type Request = { resource: string; operation: "list" | "get"; id?: string; cloudOrg?: string; cloudProject?: string; page?: number; limit?: number; buildTarget?: string; platform?: string; buildTargetName?: string; branch?: string };
export async function unityCloudInventory(family: "cloud-build" | "automation", request: Request, execute: UnityCliExecutor, signal?: AbortSignal) {
  if (!(family === "cloud-build" ? ["targets", "builds"] : ["apps", "pipelines", "jobs"]).includes(request.resource) || !["list", "get"].includes(request.operation)) throw new Error("Invalid cloud inventory resource or operation.");
  const args = [...base, family, request.resource, request.operation];
  if (request.operation === "get") {
    if (request.page !== undefined || request.limit !== undefined || !request.id) throw new Error("Get requires an ID and does not accept pagination.");
    args.push(validArg(request.id, "resource ID"));
  } else if (request.id !== undefined) throw new Error("List does not accept a resource ID.");
  if (family === "automation" && (request.cloudProject !== undefined || request.buildTarget !== undefined || request.platform !== undefined || request.buildTargetName !== undefined || request.branch !== undefined)) throw new Error("Unsupported automation filter.");
  if (request.cloudOrg !== undefined) args.push("--cloud-org", validArg(request.cloudOrg, "cloud organization"));
  if (request.cloudProject !== undefined) args.push("--cloud-project", validArg(request.cloudProject, "cloud project"));
  if (request.operation === "list") {
    args.push("--page", String(positiveInt(request.page, 1, 100000)), "--limit", String(positiveInt(request.limit, 25, 100)));
  }
  if (request.buildTarget !== undefined) {
    if (family !== "cloud-build" || request.resource !== "builds") throw new Error("Build target filter only applies to builds.");
    args.push("--build-target", validArg(request.buildTarget, "build target"));
  }
  for (const [field, flag] of [["platform", "--platform"], ["buildTargetName", "--build-target-name"], ["branch", "--branch"]] as const) {
    const value = request[field];
    if (value !== undefined) {
      if (family !== "cloud-build" || request.resource !== "targets" || request.operation !== "list") throw new Error("Target filter only applies to target lists.");
      args.push(flag, validArg(value, "target filter"));
    }
  }
  const envelope = checkCliResult(await execute(resolveUnityCliCommand(), args, { timeout: 20000, signal }), `pipeline ${family} ${request.resource} ${request.operation}`, "pipeline");
  if (envelope.data === undefined || envelope.data === null || typeof envelope.data !== "object") throw new Error("Cloud inventory returned invalid data; result is uncertain.");
  return { remoteRead: true, family, resource: request.resource, operation: request.operation, selection: { cloudOrg: request.cloudOrg ? "argument" : "CLI environment or saved default", cloudProject: family === "cloud-build" ? request.cloudProject ? "argument" : "CLI environment or saved default" : undefined }, page: request.operation === "list" ? request.page ?? 1 : undefined, limit: request.operation === "list" ? request.limit ?? 25 : undefined, data: boundedCliData(envelope.data), dataBounded: true };
}
export function registerUnityCloudInventoryTools(pi: Pick<ExtensionAPI, "registerTool">, execute: UnityCliExecutor) {
  pi.registerTool({ name: "unity_cloud_build_inventory", label: "Unity Cloud Build inventory", description: "One authenticated remote read: targets or builds list/get. No paging beyond the requested page, login or writes.", parameters: cloudBuildParameters, execute: async (_id, params, signal) => { const data = await unityCloudInventory("cloud-build", params, execute, signal); return { content: [{ type: "text", text: JSON.stringify(data) }], details: data }; } });
  pi.registerTool({ name: "unity_pipeline_automation_inventory", label: "Unity Pipeline Automation inventory", description: "One authenticated remote read: apps, pipelines or jobs list/get. No paging beyond the requested page, login or writes.", parameters: automationParameters, execute: async (_id, params, signal) => { const data = await unityCloudInventory("automation", params, execute, signal); return { content: [{ type: "text", text: JSON.stringify(data) }], details: data }; } });
}
