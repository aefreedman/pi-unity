import { realpathSync } from "node:fs";
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

export type UnityOpenEditorArgsOptions = {
  /** Pass Unity Editor's -automated flag. */
  automated?: boolean;
};

export function buildUnityOpenEditorArgs(projectRoot: string, options: UnityOpenEditorArgsOptions = {}): string[] {
  return ["-projectPath", projectRoot, ...(options.automated ? ["-automated"] : [])];
}

export type UnityBatchmodeArgsOptions = {
  useGraphics?: boolean;
};

export function hasUnityCommandLineFlag(args: string[], flag: string): boolean {
  const normalizedFlag = flag.toLowerCase();
  return args.some((arg) => {
    const lower = arg.toLowerCase();
    return lower === normalizedFlag || lower.startsWith(`${normalizedFlag}=`);
  });
}

export function applyDefaultUnityBatchmodeArgs(
  extraArgs: string[] = [],
  options: UnityBatchmodeArgsOptions = {},
): string[] {
  if (options.useGraphics || hasUnityCommandLineFlag(extraArgs, "-nographics")) {
    return [...extraArgs];
  }
  return ["-nographics", ...extraArgs];
}

export function buildUnityBatchmodeArgs(
  projectRoot: string,
  extraArgs: string[] = [],
  options: UnityBatchmodeArgsOptions = {},
): string[] {
  return ["-batchmode", "-projectPath", projectRoot, ...applyDefaultUnityBatchmodeArgs(extraArgs, options)];
}

function pathApiForPlatform(platform: SupportedPlatform): typeof path.win32 | typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

export function normalizeForCommandSearch(value: string, platform: SupportedPlatform = process.platform): string {
  const normalized = pathApiForPlatform(platform).normalize(value.trim());
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function realpathMatchesOnDarwin(candidatePath: string, projectRoot: string, platform: SupportedPlatform): boolean | null {
  if (platform !== "darwin" || process.platform !== "darwin") {
    return null;
  }

  try {
    return realpathSync.native(candidatePath) === realpathSync.native(projectRoot);
  } catch {
    // Only use filesystem identity when both paths can be resolved. Falling back
    // to the case-sensitive textual comparison preserves case-sensitive APFS.
    return null;
  }
}

export function projectPathsMatch(candidatePath: string, projectRoot: string, platform: SupportedPlatform = process.platform): boolean {
  const trimmedCandidatePath = candidatePath.trim();
  const trimmedProjectRoot = projectRoot.trim();
  const isWindowsStyleAbsolutePath = (value: string): boolean => /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
  const comparisonPlatform = isWindowsStyleAbsolutePath(trimmedCandidatePath) && isWindowsStyleAbsolutePath(trimmedProjectRoot)
    ? "win32"
    : platform;
  const pathApi = pathApiForPlatform(comparisonPlatform);
  if (!pathApi.isAbsolute(trimmedCandidatePath) || !pathApi.isAbsolute(trimmedProjectRoot)) {
    return false;
  }

  const realpathMatch = realpathMatchesOnDarwin(trimmedCandidatePath, trimmedProjectRoot, comparisonPlatform);
  if (realpathMatch !== null) {
    return realpathMatch;
  }

  return normalizeForCommandSearch(trimmedCandidatePath, comparisonPlatform) === normalizeForCommandSearch(trimmedProjectRoot, comparisonPlatform);
}

export function parseCommandLineArguments(commandLine: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let tokenStarted = false;

  const pushCurrent = (): void => {
    if (tokenStarted) {
      args.push(current);
      current = "";
      tokenStarted = false;
    }
  };

  for (const character of commandLine) {
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      pushCurrent();
    } else {
      current += character;
      tokenStarted = true;
    }
  }

  pushCurrent();
  return args;
}

export function extractUnityProjectPathArguments(commandLine: string): string[] {
  const values: string[] = [];
  const flagPattern = /(?:^|\s)-projectpath(?=\s|=)/gi;
  let match: RegExpExecArray | null;

  while ((match = flagPattern.exec(commandLine)) !== null) {
    let index = flagPattern.lastIndex;
    while (/\s/.test(commandLine[index] ?? "")) index += 1;
    if (commandLine[index] === "=") {
      index += 1;
      while (/\s/.test(commandLine[index] ?? "")) index += 1;
    }

    const quote = commandLine[index] === "\"" || commandLine[index] === "'" ? commandLine[index] : null;
    if (quote) {
      const end = commandLine.indexOf(quote, index + 1);
      if (end >= 0) {
        values.push(commandLine.slice(index + 1, end));
        flagPattern.lastIndex = end + 1;
      }
      continue;
    }

    const remainder = commandLine.slice(index);
    const nextFlag = remainder.search(/\s+-[A-Za-z][A-Za-z0-9-]*(?=\s|=|$)/);
    const value = (nextFlag >= 0 ? remainder.slice(0, nextFlag) : remainder).trim();
    if (value) values.push(value);
  }

  return values;
}

export function commandTargetsProject(commandLine: string, projectRoot: string, platform: SupportedPlatform = process.platform): boolean {
  return extractUnityProjectPathArguments(commandLine)
    .some((candidatePath) => projectPathsMatch(candidatePath, projectRoot, platform));
}
