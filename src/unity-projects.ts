import * as fs from "node:fs/promises";
import * as path from "node:path";

export type UnityProjectCandidate = { projectRoot: string; projectName: string };
export type UnityProjectDiscoveryResult = {
  startDirectory: string;
  strategy: "ancestor" | "descendants";
  candidates: UnityProjectCandidate[];
  visitedDirectories: number;
  truncated: boolean;
  incomplete: boolean;
};

const MAX_DEPTH = 4;
const MAX_DIRECTORIES = 400;
const MAX_CANDIDATES = 20;
const SKIPPED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", ".vs", ".idea", ".pi", "library", "temp", "logs",
  "obj", "node_modules", "build", "builds", "bin",
]);

async function checkProject(root: string): Promise<boolean> {
  async function marker(relativePath: string, kind: "file" | "directory"): Promise<boolean> {
    try {
      const info = await fs.stat(path.join(root, relativePath));
      return kind === "file" ? info.isFile() : info.isDirectory();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return false;
      throw error;
    }
  }
  return await marker("ProjectSettings/ProjectVersion.txt", "file") &&
    (await marker("Assets", "directory") || await marker("Packages/manifest.json", "file"));
}

export async function resolveUnityProjectCandidates(
  cwd: string, requestedPath?: string, signal?: AbortSignal,
): Promise<UnityProjectDiscoveryResult> {
  signal?.throwIfAborted();
  if (requestedPath !== undefined && !requestedPath.trim()) throw new Error("Supply a nonblank existing starting directory.");
  const startDirectory = await fs.realpath(path.resolve(cwd, requestedPath ?? "."));
  if (!(await fs.stat(startDirectory)).isDirectory()) throw new Error("The Unity project search must start at a directory.");
  const result: UnityProjectDiscoveryResult = {
    startDirectory, strategy: "ancestor", candidates: [], visitedDirectories: 0, truncated: false, incomplete: false,
  };
  async function isProject(root: string): Promise<boolean> {
    signal?.throwIfAborted();
    result.visitedDirectories++;
    try { return await checkProject(root); }
    catch { result.incomplete = true; return false; }
  }
  function addProject(root: string): void {
    result.candidates.push({ projectRoot: root, projectName: path.basename(root) });
  }

  for (let root = startDirectory; ; root = path.dirname(root)) {
    if (await isProject(root)) {
      signal?.throwIfAborted();
      addProject(root);
      return result;
    }
    if (root === path.dirname(root)) break;
  }

  result.strategy = "descendants";
  const queue = [{ root: startDirectory, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    signal?.throwIfAborted();
    const { root, depth } = queue[index];
    // The starting directory was already checked by the ancestor walk.
    if (depth > 0 && await isProject(root)) {
      if (result.candidates.length === MAX_CANDIDATES) {
        result.truncated = true;
        break;
      }
      addProject(root);
      continue;
    }

    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        if (depth === MAX_DEPTH || queue.length === MAX_DIRECTORIES) {
          result.truncated = true;
          break;
        }
        queue.push({ root: path.join(root, entry.name), depth: depth + 1 });
      }
    } catch { result.incomplete = true; }
  }
  signal?.throwIfAborted();
  result.candidates.sort((left, right) => left.projectRoot.localeCompare(right.projectRoot));
  return result;
}
