import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strict as assert } from "node:assert";
import { loadPiUnitySettings, normalizePiUnitySettings } from "../src/pi-unity-settings.ts";

const normalizedDefaults = normalizePiUnitySettings({});
assert.equal(normalizedDefaults.allowCloseRunningUnityProcess, false);
assert.equal(normalizedDefaults.closeRunningUnityProcessOnlyForTests, true);
assert.equal(normalizedDefaults.closeRunningUnityProcessTimeoutMs, 30_000);

const clampedTimeout = normalizePiUnitySettings({ closeRunningUnityProcessTimeoutMs: 999_999 });
assert.equal(clampedTimeout.closeRunningUnityProcessTimeoutMs, 120_000);

const root = await mkdtemp(join(tmpdir(), "pi-unity-settings-"));
try {
  const globalPath = join(root, "global-settings.json");
  const projectPath = join(root, "project-settings.json");
  await writeFile(globalPath, JSON.stringify({
    piUnity: {
      allowCloseRunningUnityProcess: true,
      closeRunningUnityProcessOnlyForTests: true,
      closeRunningUnityProcessTimeoutMs: 20_000,
    },
  }));
  await writeFile(projectPath, JSON.stringify({
    piUnity: {
      closeRunningUnityProcessOnlyForTests: false,
    },
  }));

  const untrusted = await loadPiUnitySettings(
    { cwd: root, isProjectTrusted: () => false },
    { globalSettingsPath: globalPath, projectSettingsPath: projectPath },
  );
  assert.equal(untrusted.allowCloseRunningUnityProcess, true);
  assert.equal(untrusted.closeRunningUnityProcessOnlyForTests, true);

  const trusted = await loadPiUnitySettings(
    { cwd: root, isProjectTrusted: () => true },
    { globalSettingsPath: globalPath, projectSettingsPath: projectPath },
  );
  assert.equal(trusted.allowCloseRunningUnityProcess, true);
  assert.equal(trusted.closeRunningUnityProcessOnlyForTests, false);
  assert.equal(trusted.closeRunningUnityProcessTimeoutMs, 20_000);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("pi-unity settings tests passed");
