import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildUnityBatchmodeArgs,
  buildUnityEditorCandidates,
  buildUnityOpenEditorArgs,
  type SupportedPlatform,
  type UnityOpenEditorArgsOptions,
} from "./unity-core";

/** Direct-executable compatibility fallback. Unity CLI routes must not import this module. */
export async function resolveUnityEditorPath(
  unityVersion: string,
  options: { platform?: SupportedPlatform; homeDir?: string; access?: (candidate: string) => Promise<void> } = {},
): Promise<string> {
  const autoCandidates = buildUnityEditorCandidates(unityVersion, options.platform ?? process.platform, options.homeDir);
  const access = options.access ?? ((candidate: string) => fs.access(candidate, fs.constants.X_OK));
  for (const candidate of autoCandidates) {
    try { await access(candidate); return path.normalize(candidate); } catch { /* Try next exact-version candidate. */ }
  }
  throw new Error(`Could not find a Unity Editor executable for Unity ${unityVersion}. Install that exact Editor version through your normal Unity installation workflow, or install Unity CLI so it can resolve the project version.`);
}

export function launchUnityEditorDetached(editorPath: string, projectRoot: string, options: UnityOpenEditorArgsOptions = {}): { pid: number | undefined; args: string[]; command: string } {
  const args = buildUnityOpenEditorArgs(projectRoot, options);
  const child = (awaitableSpawn)(editorPath, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { pid: child.pid, args, command: editorPath };
}

// Kept local so this module owns direct process creation entirely.
import { spawn as awaitableSpawn } from "node:child_process";

export function createUnityBatchmodeCommand(editorPath: string, projectRoot: string, extraArgs: string[] = [], options: { useGraphics?: boolean } = {}): { command: string; args: string[] } {
  return { command: editorPath, args: buildUnityBatchmodeArgs(projectRoot, extraArgs, options) };
}
