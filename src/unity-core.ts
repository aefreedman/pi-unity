import * as os from "node:os";
import * as path from "node:path";

export type SupportedPlatform = NodeJS.Platform | "win32" | "darwin" | "linux";

export function normalizeUserPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

export function resolveAbsolutePath(cwd: string, rawPath: string): string {
  const normalized = normalizeUserPath(rawPath);
  return path.isAbsolute(normalized) ? path.normalize(normalized) : path.resolve(cwd, normalized);
}

export function formatPathForUser(cwd: string, absolutePath: string): string {
  const relative = path.relative(cwd, absolutePath);
  if (!relative || relative.startsWith("..")) {
    return absolutePath;
  }
  return relative.split(path.sep).join("/");
}

export function parseUnityVersionText(contents: string): string | null {
  const match = contents.match(/^m_EditorVersion:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

export function normalizeUnityEditorOverride(editorPath: string, platform: SupportedPlatform): string {
  const normalized = path.normalize(editorPath.trim());
  if (platform === "darwin" && normalized.toLowerCase().endsWith(".app")) {
    return path.join(normalized, "Contents", "MacOS", "Unity");
  }
  return normalized;
}

export function buildUnityEditorCandidates(
  version: string,
  platform: SupportedPlatform = process.platform,
  homeDir: string = os.homedir(),
): string[] {
  if (platform === "win32") {
    return [
      path.join("C:/Program Files/Unity/Hub/Editor", version, "Editor", "Unity.exe"),
      path.join("C:/Program Files/Unity", version, "Editor", "Unity.exe"),
      path.join("C:/UnityInstalls", version, "Editor", "Unity.exe"),
    ];
  }

  if (platform === "darwin") {
    return [
      path.join("/Applications/Unity/Hub/Editor", version, "Unity.app", "Contents", "MacOS", "Unity"),
      path.join("/Applications/Unity", version, "Unity.app", "Contents", "MacOS", "Unity"),
    ];
  }

  return [
    path.join(homeDir, "Unity", "Hub", "Editor", version, "Editor", "Unity"),
    path.join(homeDir, "Applications", "Unity", "Hub", "Editor", version, "Editor", "Unity"),
    path.join("/opt/Unity/Hub/Editor", version, "Editor", "Unity"),
    path.join("/opt/Unity", version, "Editor", "Unity"),
    path.join("/opt/unity", version, "Editor", "Unity"),
  ];
}

export function buildUnityOpenEditorArgs(projectRoot: string): string[] {
  return ["-projectPath", projectRoot];
}

export function buildUnityBatchmodeArgs(projectRoot: string, extraArgs: string[] = []): string[] {
  return ["-batchmode", "-projectPath", projectRoot, ...extraArgs];
}

export function normalizeForCommandSearch(value: string, platform: SupportedPlatform = process.platform): string {
  const normalized = path.normalize(value).replace(/\\/g, "/");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function commandTargetsProject(commandLine: string, projectRoot: string, platform: SupportedPlatform = process.platform): boolean {
  const normalizedCommand = normalizeForCommandSearch(commandLine, platform);
  const normalizedProject = normalizeForCommandSearch(projectRoot, platform);
  return normalizedCommand.includes(normalizedProject);
}
