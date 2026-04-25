import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseUnityVersionText, resolveAbsolutePath } from "./unity-core";

export type UnityProjectCandidate = {
  projectRoot: string;
  projectName: string;
  unityVersion: string;
};

export type UnityProjectDiscoveryResult = {
  candidates: UnityProjectCandidate[];
  visitedDirectories: number;
  truncated: boolean;
};

export type DiscoverUnityProjectsOptions = {
  maxDepth?: number;
  maxDirectories?: number;
  maxCandidates?: number;
};

const DEFAULT_DISCOVERY_OPTIONS: Required<DiscoverUnityProjectsOptions> = {
  maxDepth: 4,
  maxDirectories: 400,
  maxCandidates: 20,
};

const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".vs",
  ".idea",
  ".pi",
  "Library",
  "Temp",
  "Logs",
  "obj",
  "node_modules",
  "Build",
  "Builds",
  "bin",
]);

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readUnityVersion(projectRoot: string): Promise<string> {
  const versionFile = path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt");
  const contents = await fs.readFile(versionFile, "utf8");
  const version = parseUnityVersionText(contents);
  if (!version) {
    throw new Error(`Could not parse Unity version from ${versionFile}`);
  }
  return version;
}

export async function isUnityProjectRoot(dirPath: string): Promise<boolean> {
  const versionFile = path.join(dirPath, "ProjectSettings", "ProjectVersion.txt");
  if (!(await pathExists(versionFile))) {
    return false;
  }

  const assetsDir = path.join(dirPath, "Assets");
  const manifestFile = path.join(dirPath, "Packages", "manifest.json");
  return (await pathExists(assetsDir)) || (await pathExists(manifestFile));
}

export async function findAncestorUnityProject(startDir: string): Promise<UnityProjectCandidate | null> {
  let current = path.resolve(startDir);

  while (true) {
    if (await isUnityProjectRoot(current)) {
      return {
        projectRoot: current,
        projectName: path.basename(current),
        unityVersion: await readUnityVersion(current),
      };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function discoverUnityProjects(
  startDir: string,
  options: DiscoverUnityProjectsOptions = {},
): Promise<UnityProjectDiscoveryResult> {
  const { maxDepth, maxDirectories, maxCandidates } = { ...DEFAULT_DISCOVERY_OPTIONS, ...options };
  const root = path.resolve(startDir);
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const visited = new Set<string>();
  const candidates: UnityProjectCandidate[] = [];
  let visitedDirectories = 0;
  let truncated = false;

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;

    const normalized = path.normalize(next.dir);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    visitedDirectories += 1;

    if (visitedDirectories > maxDirectories) {
      truncated = true;
      break;
    }

    if (await isUnityProjectRoot(next.dir)) {
      candidates.push({
        projectRoot: next.dir,
        projectName: path.basename(next.dir),
        unityVersion: await readUnityVersion(next.dir),
      });
      if (candidates.length >= maxCandidates) {
        truncated = true;
        break;
      }
      continue;
    }

    if (next.depth >= maxDepth) {
      continue;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
      queue.push({ dir: path.join(next.dir, entry.name), depth: next.depth + 1 });
    }
  }

  candidates.sort((left, right) => left.projectRoot.localeCompare(right.projectRoot));
  return { candidates, visitedDirectories, truncated };
}

export async function resolveUnityProjectCandidates(cwd: string, requestedPath?: string): Promise<UnityProjectDiscoveryResult> {
  if (requestedPath?.trim()) {
    const absolutePath = resolveAbsolutePath(cwd, requestedPath);
    const directProject = await findAncestorUnityProject(absolutePath);
    if (directProject) {
      return { candidates: [directProject], visitedDirectories: 0, truncated: false };
    }

    return discoverUnityProjects(absolutePath);
  }

  const ancestorProject = await findAncestorUnityProject(cwd);
  if (ancestorProject) {
    return { candidates: [ancestorProject], visitedDirectories: 0, truncated: false };
  }

  return discoverUnityProjects(cwd);
}
