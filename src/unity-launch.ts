import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  buildUnityBatchmodeArgs,
  buildUnityEditorCandidates,
  buildUnityOpenEditorArgs,
  normalizeUnityEditorOverride,
  type SupportedPlatform,
  type UnityOpenEditorArgsOptions,
} from "./unity-core";
import { createUnityCliOpenCommand, type UnityCliLaunchOptions } from "./unity-cli";

export async function resolveUnityEditorPath(
  unityVersion: string,
  options: {
    overridePath?: string;
    env?: NodeJS.ProcessEnv;
    platform?: SupportedPlatform;
    homeDir?: string;
  } = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir;

  const overrideCandidates = [options.overridePath, env.UNITY_EDITOR_PATH, env.UNITY_PATH]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeUnityEditorOverride(value, platform));

  const autoCandidates = buildUnityEditorCandidates(unityVersion, platform, homeDir);

  for (const candidate of [...overrideCandidates, ...autoCandidates]) {
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
      "Set UNITY_EDITOR_PATH to an explicit executable path or pass unityEditorPath.",
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
