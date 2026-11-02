import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { redactUnityCredentials } from "./unity-redaction";

/** Bound every host process capture; incomplete output must never become JSON evidence. */
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
