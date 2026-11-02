import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { redactUnityCredentials } from "./unity-redaction";

/** Bound structured/probe capture; incomplete output must never become JSON evidence. */
export async function executeUnityCommand(
  pi: Pick<ExtensionAPI, "exec">,
  command: string,
  args: string[],
  options: NonNullable<Parameters<ExtensionAPI["exec"]>[2]>,
): Promise<Awaited<ReturnType<ExtensionAPI["exec"]>>> {
  options.signal?.throwIfAborted();
  const result = await pi.exec(command, args, { ...options, maxBuffer: 2 * 1024 * 1024 });
  options.signal?.throwIfAborted();
  if (result.truncated) {
    throw Object.assign(new Error(`Unity CLI output truncated; command completion is uncertain. ${redactUnityCredentials(result.stderr).slice(0, 1000)}`), { code: "OUTPUT_TRUNCATED" });
  }
  return result;
}

export type UnityLongResult = { code: number; stdout: string; stderr: string; killed: boolean; outputOmitted: boolean };
export type UnityLongExecutor = (command: string, args: string[], options: { signal?: AbortSignal; timeout?: number; cwd?: string }) => Promise<UnityLongResult>;

/**
 * Drain long-running process output without killing on volume. This is diagnostic
 * text only, never structured JSON evidence. Native Editor logs/reports are left
 * untouched. Drop an overflowing stream entirely so a capture boundary cannot
 * expose a partial credential; report omission rather than pretend it is complete.
 */
export const executeUnityLongCommand: UnityLongExecutor = async (command, args, options) => {
  options.signal?.throwIfAborted();
  const result = await new Promise<UnityLongResult>((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const captured = { stdout: "", stderr: "" };
    const bytes = { stdout: 0, stderr: 0 };
    let killed = false;
    let settled = false;
    let exited = false;
    let code: number | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout); clearTimeout(forceKill); clearTimeout(idle);
      options.signal?.removeEventListener("abort", kill);
      child.stdout.destroy(); child.stderr.destroy();
      resolve({ code: exitCode ?? 1, ...captured, killed, outputOmitted: bytes.stdout > 1024 * 1024 || bytes.stderr > 1024 * 1024 });
    };
    const kill = () => {
      if (killed || settled) return;
      killed = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5000);
    };
    const armIdle = () => {
      if (settled) return;
      clearTimeout(idle);
      idle = setTimeout(() => finish(code), 100);
    };
    for (const key of ["stdout", "stderr"] as const) {
      child[key].setEncoding("utf8");
      child[key].on("data", (chunk: string) => {
        if (settled) return;
        if (bytes[key] <= 1024 * 1024) {
          bytes[key] += Buffer.byteLength(chunk);
          captured[key] = bytes[key] > 1024 * 1024
            ? `[${key} omitted: diagnostic capture limit exceeded; output volume did not cancel the process]`
            : captured[key] + chunk;
        }
        if (exited) armIdle();
      });
    }
    child.once("error", error => { captured.stderr = redactUnityCredentials(error.message); finish(1); });
    // Drain queued output, but do not hang on quiet inherited descendant pipes.
    child.once("exit", exitCode => { exited = true; code = exitCode; armIdle(); });
    child.once("close", exitCode => finish(exitCode));
    options.signal?.addEventListener("abort", kill, { once: true });
    if (options.signal?.aborted) kill();
    if (options.timeout && options.timeout > 0) timeout = setTimeout(kill, options.timeout);
  });
  options.signal?.throwIfAborted();
  return result;
};
