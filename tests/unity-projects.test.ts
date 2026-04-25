import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  discoverUnityProjects,
  findAncestorUnityProject,
  isUnityProjectRoot,
  resolveUnityProjectCandidates,
} from "../src/unity-projects.ts";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createUnityProject(root: string, version: string): void {
  ensureDir(path.join(root, "Assets"));
  ensureDir(path.join(root, "ProjectSettings"));
  ensureDir(path.join(root, "Packages"));
  fs.writeFileSync(path.join(root, "ProjectSettings", "ProjectVersion.txt"), `m_EditorVersion: ${version}\n`);
  fs.writeFileSync(path.join(root, "Packages", "manifest.json"), "{}\n");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "free-unity-pi-projects-"));

try {
  const projectRoot = path.join(tempRoot, "workspace", "game-copy");
  createUnityProject(projectRoot, "2022.3.18f1");

  assert.equal(await isUnityProjectRoot(projectRoot), true);
  assert.equal(await isUnityProjectRoot(path.join(tempRoot, "workspace")), false);

  const nestedDir = path.join(projectRoot, "Assets", "Scripts", "Gameplay");
  ensureDir(nestedDir);
  const ancestor = await findAncestorUnityProject(nestedDir);
  assert(ancestor, "Expected ancestor Unity project to be found.");
  assert.equal(ancestor.projectRoot, projectRoot);
  assert.equal(ancestor.unityVersion, "2022.3.18f1");

  const coordinationRoot = path.join(tempRoot, "coordination-root");
  createUnityProject(path.join(coordinationRoot, "ws1", "client"), "2021.3.40f1");
  createUnityProject(path.join(coordinationRoot, "ws2", "client"), "2022.3.18f1");

  const discovered = await discoverUnityProjects(coordinationRoot, { maxDepth: 3, maxDirectories: 50, maxCandidates: 10 });
  assert.equal(discovered.candidates.length, 2);
  assert.equal(discovered.truncated, false);

  const resolvedFromCoordination = await resolveUnityProjectCandidates(coordinationRoot);
  assert.equal(resolvedFromCoordination.candidates.length, 2);

  const explicitResolved = await resolveUnityProjectCandidates(tempRoot, path.join(coordinationRoot, "ws1"));
  assert.equal(explicitResolved.candidates.length, 1);
  assert.equal(explicitResolved.candidates[0].projectRoot, path.join(coordinationRoot, "ws1", "client"));

  const emptyResolved = await resolveUnityProjectCandidates(path.join(tempRoot, "not-a-project"));
  assert.equal(emptyResolved.candidates.length, 0);

  console.log("free-unity-pi unity-project tests passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
