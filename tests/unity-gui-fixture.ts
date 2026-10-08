import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { UnityGuiSpawn } from "../src/unity-launch";

export function syntheticGuiSpawn(action: (child: any) => void): { spawn: UnityGuiSpawn; children: any[]; calls: string[][] } {
  const children: any[] = [];
  const calls: string[][] = [];
  return { children, calls, spawn: (_command, args, options) => {
    assertOptions(options);
    calls.push(args);
    const child = Object.assign(new EventEmitter(), { pid: 987, stdout: new PassThrough(), stderr: new PassThrough(), unref() {}, kill() { throw new Error("GUI observation must never kill"); } });
    children.push(child);
    setTimeout(() => action(child), 0);
    return child as unknown as ChildProcess;
  } };
}
function assertOptions(options: Parameters<UnityGuiSpawn>[2]) {
  if (!options.detached || options.stdio.join(",") !== "ignore,pipe,pipe") throw new Error("Unexpected launch options");
}
