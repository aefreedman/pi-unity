import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type PiUnitySettings = {
  /** Allows pi-unity to close a running Unity process that targets the resolved project before a batchmode launch. */
  allowCloseRunningUnityProcess: boolean;
  /** Keeps automatic process closing constrained to Unity Test Framework runs unless explicitly disabled. */
  closeRunningUnityProcessOnlyForTests: boolean;
  /** Maximum time to wait for the closed Unity process to exit before failing the launch. */
  closeRunningUnityProcessTimeoutMs: number;
};

export type PiUnitySettingsContext = {
  cwd: string;
  isProjectTrusted?: () => boolean;
};

export type LoadPiUnitySettingsOptions = {
  globalSettingsPath?: string;
  projectSettingsPath?: string;
  env?: NodeJS.ProcessEnv;
};

export const DEFAULT_PI_UNITY_SETTINGS: PiUnitySettings = {
  allowCloseRunningUnityProcess: false,
  closeRunningUnityProcessOnlyForTests: true,
  closeRunningUnityProcessTimeoutMs: 30_000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getPiUnitySettingsRecord(settings: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings.piUnity) ? settings.piUnity : {};
}

function getGlobalSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredAgentDir = env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = configuredAgentDir && configuredAgentDir.length > 0
    ? configuredAgentDir
    : join(homedir(), ".pi", "agent");
  return join(agentDir, "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

export function normalizePiUnitySettings(raw: Record<string, unknown>): PiUnitySettings {
  const timeout = typeof raw.closeRunningUnityProcessTimeoutMs === "number" && Number.isFinite(raw.closeRunningUnityProcessTimeoutMs)
    ? Math.max(1_000, Math.min(120_000, Math.trunc(raw.closeRunningUnityProcessTimeoutMs)))
    : DEFAULT_PI_UNITY_SETTINGS.closeRunningUnityProcessTimeoutMs;

  return {
    allowCloseRunningUnityProcess: raw.allowCloseRunningUnityProcess === true,
    closeRunningUnityProcessOnlyForTests: raw.closeRunningUnityProcessOnlyForTests !== false,
    closeRunningUnityProcessTimeoutMs: timeout,
  };
}

export async function loadPiUnitySettings(
  ctx: PiUnitySettingsContext,
  options: LoadPiUnitySettingsOptions = {},
): Promise<PiUnitySettings> {
  const globalPath = options.globalSettingsPath ?? getGlobalSettingsPath(options.env);
  const globalSettings = getPiUnitySettingsRecord(await readJsonFile(globalPath));
  let mergedSettings: Record<string, unknown> = { ...globalSettings };

  if (ctx.isProjectTrusted?.() === true) {
    const projectPath = options.projectSettingsPath ?? getProjectSettingsPath(ctx.cwd);
    const projectSettings = getPiUnitySettingsRecord(await readJsonFile(projectPath));
    mergedSettings = { ...mergedSettings, ...projectSettings };
  }

  return normalizePiUnitySettings(mergedSettings);
}
