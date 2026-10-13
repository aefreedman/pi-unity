import { readFileSync } from "node:fs";

// The owning manifest is the single runtime selector, independent of invocation cwd.
export function declaredPiVersion(manifestUrl = new URL("../../package.json", import.meta.url)): string {
  const version = JSON.parse(readFileSync(manifestUrl, "utf8")).devDependencies?.["@earendil-works/pi-coding-agent"];
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Pi development dependency must declare an exact stable version");
  return version;
}

export function assertPiVersion(installed: unknown, declared = declaredPiVersion()): void {
  if (installed !== declared) throw new Error(`This eval requires Pi ${declared} exactly; found ${String(installed)}`);
}
