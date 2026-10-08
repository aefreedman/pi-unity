import { spawn, type ChildProcess } from "node:child_process";
import { createUnityCliOpenCommand, type UnityCliLaunchOptions } from "./unity-cli";
import { redactUnityCredentials } from "./unity-redaction";

export type UnityGuiLaunchResult = {
  command: string;
  args: string[];
  /** Launcher child only; never evidence of an Editor PID. */
  cliPid?: number;
  outcome: "completed" | "failed" | "timeout" | "cancelled";
  exitCode?: number | null;
  exitSignal?: string | null;
  diagnostics: string;
};
export type UnityGuiSpawn = (command: string, args: string[], options: { detached: boolean; stdio: ["ignore", "pipe", "pipe"]; windowsHide: boolean }) => ChildProcess;

/** Observe CLI completion, not Editor readiness. Cancellation never kills either process. */
export async function launchUnityCliOpenDetached(
  projectRoot: string,
  options: UnityCliLaunchOptions & { signal?: AbortSignal; observationTimeoutMs?: number; spawn?: UnityGuiSpawn } = {},
): Promise<UnityGuiLaunchResult> {
  const cli = createUnityCliOpenCommand(projectRoot, options);
  if (options.signal?.aborted) return { ...cli, outcome: "cancelled", diagnostics: "Launch cancelled before dispatch." };
  return new Promise(resolve => {
    let child: ChildProcess;
    let settled = false;
    const buffers = { stdout: "", stderr: "" };
    const overflow = { stdout: false, stderr: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: UnityGuiLaunchResult["outcome"], extra: Partial<UnityGuiLaunchResult> = {}, error = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      const diagnostics = [buffers.stdout, buffers.stderr, error].filter(Boolean).map(text => {
        const safe = redactUnityCredentials(text);
        return safe.length > 4000 ? safe.slice(0, 4000) + "\n[truncated]" : safe;
      }).join("\n");
      resolve({ ...cli, cliPid: child?.pid, outcome, diagnostics, ...extra });
      // Continue draining without retaining output or keeping Pi alive. Do not kill or
      // close the pipes: the CLI may still be completing an already-started Editor launch.
      child?.unref();
      for (const stream of [child?.stdout, child?.stderr]) (stream as unknown as { unref?: () => void } | null)?.unref?.();
    };
    const abort = () => finish("cancelled");
    try {
      child = (options.spawn ?? spawn)(cli.command, cli.args, { detached: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
      for (const key of ["stdout", "stderr"] as const) {
        child[key]?.setEncoding("utf8");
        child[key]?.on("data", (chunk: string) => {
          if (settled || overflow[key]) return;
          // Drop an oversized stream entirely rather than expose a credential split
          // at the raw retention boundary. Redaction always precedes display truncation.
          if (buffers[key].length + chunk.length > 65536) {
            overflow[key] = true;
            buffers[key] = `[${key} omitted: capture limit exceeded]`;
          } else buffers[key] += chunk;
        });
      }
      child.on("error", error => finish("failed", {}, error.message));
      child.on("close", (code, signal) => finish(code === 0 && !signal ? "completed" : "failed", { exitCode: code, exitSignal: signal }));
      timer = setTimeout(() => finish("timeout"), Math.max(1, Math.min(options.observationTimeoutMs ?? 30000, 30000)));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    } catch (error) {
      finish("failed", {}, error instanceof Error ? error.message : String(error));
    }
  });
}

export function summarizeUnityGuiLaunch(result: UnityGuiLaunchResult): string {
  const summary = result.outcome === "completed"
    ? "Unity CLI open completed successfully; Editor readiness and Editor PID are not verified."
    : result.outcome === "failed"
      ? "Unity CLI open failed or refused the launch. No retry, direct fallback, or project upgrade was attempted."
      : `Unity CLI open observation ${result.outcome === "timeout" ? "timed out" : "was cancelled"}; launch completion is uncertain. An Editor may already be running. No process was killed; inspect the exact project copy before another launch.`;
  return [summary, result.exitCode !== undefined ? `CLI exit: ${result.exitCode}${result.exitSignal ? ` (${result.exitSignal})` : ""}` : "", result.diagnostics].filter(Boolean).join("\n");
}
