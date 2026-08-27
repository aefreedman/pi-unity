import { spawn } from "node:child_process";
import { createUnityCliOpenCommand, type UnityCliLaunchOptions } from "./unity-cli";

/** Unity CLI GUI launch path. Direct executable fallback lives in unity-editor-fallback.ts. */
export function launchUnityCliOpenDetached(projectRoot: string, options: UnityCliLaunchOptions = {}): { pid: number | undefined; args: string[]; command: string } {
  const cli = createUnityCliOpenCommand(projectRoot, options);
  const child = spawn(cli.command, cli.args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { pid: child.pid, args: cli.args, command: cli.command };
}
