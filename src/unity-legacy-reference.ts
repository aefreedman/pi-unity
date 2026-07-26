import { open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { createCapabilityRegistry, type RegistrationToken, type RegistryRecord } from "@aefree/pi-capability-registry";

const REGISTRY_KEY = "@aefree/pi-game-dev/legacy-reference-services/v1";
const PACKAGE_NAME = "@aefree/pi-unity";
const PACKAGE_VERSION = "0.8.3";
const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Exact compatibility rows owned by this package in pi-game-dev's public v1 map. */
export const UNITY_LEGACY_PATHS_V1 = Object.freeze([
  "prompts/cg-migrate-unity-docs-schema.md",
  "references/_shared/unity-repo-research.md",
  "references/_shared/unity-review-guidance.md",
  "references/cg-review/unity-testing.md",
  "references/cg-work/unity-yaml-assets.md",
  "skills/unity-docs/assets/critical-pattern-template.md",
  "skills/unity-docs/assets/resolution-template.md",
  "skills/unity-docs/references/category-selection.md",
  "skills/unity-docs/references/error-handling.md",
  "skills/unity-docs/references/example.md",
  "skills/unity-docs/references/quality-guidelines.md",
  "skills/unity-docs/references/yaml-schema.md",
  "skills/unity-docs/schema.yaml",
  "skills/unity-docs/SKILL.md",
] as const);

type LegacyReferenceService = RegistryRecord & {
  readonly contractVersion: 1;
  readonly kind: "legacy-reference-service";
  readonly owner: { readonly packageName: string; readonly packageVersion: string; readonly packageRoot: string; readonly registeredBy: string };
  readonly legacyPaths: readonly string[];
  read(context: { readonly cwd: string; readonly signal: AbortSignal }, request: { readonly legacyPath: string; readonly offset?: number; readonly limit?: number; readonly signal: AbortSignal }): Promise<Readonly<Record<string, unknown>>>;
};

export function registerUnityLegacyReferencesV1(scope: object): Readonly<{ token: RegistrationToken; unregister(): boolean }> {
  const allowed = new Set<string>(UNITY_LEGACY_PATHS_V1);
  const owner = Object.freeze({ packageName: PACKAGE_NAME, packageVersion: PACKAGE_VERSION, packageRoot: PACKAGE_ROOT, registeredBy: "index.ts" });
  const service: LegacyReferenceService = Object.freeze({
    contractVersion: 1,
    id: "legacy-reference.aefree-pi-unity",
    kind: "legacy-reference-service",
    owner,
    legacyPaths: UNITY_LEGACY_PATHS_V1,
    async read(
      _context: { readonly cwd: string; readonly signal: AbortSignal },
      request: { readonly legacyPath: string; readonly offset?: number; readonly limit?: number; readonly signal: AbortSignal },
    ) {
      if (request.signal.aborted) throw abortError();
      if (!allowed.has(request.legacyPath)) throw new Error("legacy_resource_unmapped");
      const text = await readBoundedText(path.join(PACKAGE_ROOT, "compatibility", "legacy-reference-v1", ...request.legacyPath.split("/")), request.signal);
      const allLines = text.split(/\r?\n/u);
      const start = Math.max(0, Math.trunc(request.offset ?? 1) - 1);
      const count = request.limit === undefined ? undefined : Math.max(0, Math.trunc(request.limit));
      const content = allLines.slice(start, count === undefined ? undefined : start + count).join("\n");
      const resourceId = `pi-unity:${request.legacyPath}`;
      return Object.freeze({
        content,
        legacyPath: request.legacyPath,
        resourceId,
        ...(request.offset === undefined ? {} : { offset: request.offset }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        lines: content === "" ? 0 : content.split(/\r?\n/u).length,
        totalLines: allLines.length,
        provenance: Object.freeze({ packageName: PACKAGE_NAME, packageVersion: PACKAGE_VERSION, resourceId, contractVersion: 1 }),
      });
    },
  });
  const registry = createCapabilityRegistry<LegacyReferenceService>({ registryKey: REGISTRY_KEY, contractVersion: 1, compatibleVersions: [1], validate: assertService });
  const token = registry.register(scope, service);
  let active = true;
  return Object.freeze({ token, unregister() { if (!active) return false; active = false; return registry.unregister(token); } });
}

async function readBoundedText(file: string, signal: AbortSignal): Promise<string> {
  const handle = await open(file, "r");
  try {
    if (signal.aborted) throw abortError();
    const buffer = Buffer.alloc(50 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 50 * 1024) throw new Error("resource_too_large");
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    if (text.split(/\r?\n/u).length > 2_000) throw new Error("resource_too_large");
    return text;
  } finally { await handle.close(); }
}
function assertService(value: unknown): asserts value is LegacyReferenceService {
  const service = value as Partial<LegacyReferenceService>;
  if (!service || service.contractVersion !== 1 || service.kind !== "legacy-reference-service" || typeof service.id !== "string" || !Array.isArray(service.legacyPaths) || typeof service.read !== "function" || typeof service.owner?.packageName !== "string") throw new TypeError("invalid LegacyReferenceServiceV1");
}
function abortError(): Error { const error = new Error("Legacy reference read cancelled."); error.name = "AbortError"; return error; }
