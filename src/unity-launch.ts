import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  buildUnityBatchmodeArgs,
  buildUnityEditorCandidates,
  buildUnityOpenEditorArgs,
  type SupportedPlatform,
  type UnityOpenEditorArgsOptions,
} from "./unity-core";
import { createUnityCliOpenCommand, type UnityCliLaunchOptions } from "./unity-cli";

export async function resolveUnityEditorPath(
  unityVersion: string,
  options: {
    platform?: SupportedPlatform;
    homeDir?: string;
  } = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const autoCandidates = buildUnityEditorCandidates(unityVersion, platform, options.homeDir);

  for (const candidate of autoCandidates) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return path.normalize(candidate);
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    [
      `Could not find a Unity Editor executable for Unity ${unityVersion}.`,
      "Install that exact Editor version through your normal Unity installation workflow, or use Unity CLI after it can resolve that version."
    ].join(" "),
  );
}

export function launchUnityEditorDetached(
  editorPath: string,
  projectRoot: string,
  options: UnityOpenEditorArgsOptions = {},
): { pid: number | undefined; args: string[]; command: string } {
  const args = buildUnityOpenEditorArgs(projectRoot, options);
  const child = spawn(editorPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return { pid: child.pid, args, command: editorPath };
}

export function launchUnityCliOpenDetached(
  projectRoot: string,
  options: UnityCliLaunchOptions = {},
): { pid: number | undefined; args: string[]; command: string } {
  const cli = createUnityCliOpenCommand(projectRoot, options);
  const child = spawn(cli.command, cli.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return { pid: child.pid, args: cli.args, command: cli.command };
}

export function createUnityBatchmodeCommand(
  editorPath: string,
  projectRoot: string,
  extraArgs: string[] = [],
  options: { useGraphics?: boolean } = {},
): { command: string; args: string[] } {
  return {
    command: editorPath,
    args: buildUnityBatchmodeArgs(projectRoot, extraArgs, options),
  };
}
