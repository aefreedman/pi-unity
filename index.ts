import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveUnityProjectCandidates } from "./src/unity-projects";
import {
  createOptionalIntegrationRegistryV1,
  isOptionalIntegrationActive,
  type OptionalIntegrationRegistryV1,
  type OptionalRegistrationToken,
} from "./src/optional-integration-rendezvous";

const ARTIFACT_PROFILE_REGISTRY_KEY_V1 = "@aefree/pi-project-artifacts/profiles/v1";
const FILE_DISCOVERY_FILTER_REGISTRY_KEY_V1 = "@aefree/pi-file-discovery/filters/v1";

type RegistrationToken = OptionalRegistrationToken;
type ScopedRegistryV1 = OptionalIntegrationRegistryV1;
type ArtifactProfileIntegrationV1 = Readonly<{ registry: ScopedRegistryV1; createProfile: () => Promise<Readonly<Record<string, unknown>>> }>;
type FileDiscoveryFilterIntegrationV1 = Readonly<{ registry: ScopedRegistryV1; createFilter: () => Promise<Readonly<Record<string, unknown>>> }>;

async function loadArtifactProfileIntegrationV1(pi: Pick<ExtensionAPI, "getActiveTools">): Promise<ArtifactProfileIntegrationV1 | undefined> {
  if (!isOptionalIntegrationActive(pi, "project_artifact_search")) return undefined;
  const profileModule = await import("./src/unity-artifact-profile");
  return {
    registry: createOptionalIntegrationRegistryV1(ARTIFACT_PROFILE_REGISTRY_KEY_V1, "@aefree/pi-project-artifacts"),
    createProfile: async () => profileModule.createUnityArtifactProfileV1() as Readonly<Record<string, unknown>>,
  };
}

async function loadFileDiscoveryFilterIntegrationV1(pi: Pick<ExtensionAPI, "getActiveTools">): Promise<FileDiscoveryFilterIntegrationV1 | undefined> {
  if (!isOptionalIntegrationActive(pi, "discover_candidate_files")) return undefined;
  const filterModule = await import("./src/unity-file-discovery-filter");
  return {
    registry: createOptionalIntegrationRegistryV1(FILE_DISCOVERY_FILTER_REGISTRY_KEY_V1, "@aefree/pi-file-discovery"),
    createFilter: async () => filterModule.createUnityFileDiscoveryFilterV1() as Readonly<Record<string, unknown>>,
  };
}

export default function registerUnity(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "unity_find_projects",
    label: "Find Unity Projects",
    description: "Find canonical absolute Unity project roots from an existing directory or the current workspace. Reads project markers only; does not launch, select, or inspect a running Editor.",
    promptSnippet: "Resolve nearby Unity project copies when the exact absolute root is unknown.",
    promptGuidelines: [
      "If the intended root is already known, pass it directly to native Unity CLI commands.",
      "Use absolute roots, not display names. A single result from an incomplete or truncated search does not prove uniqueness.",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ minLength: 1, description: "Existing starting directory, absolute or relative to the session working directory." })),
    }),
    async execute(_id, { path }, signal, _onUpdate, ctx) {
      const result = await resolveUnityProjectCandidates(ctx.cwd, path, signal);
      const lines = [
        result.strategy === "ancestor"
          ? result.incomplete
            ? "Could not verify the nearest containing Unity project; no project root was selected or inferred."
            : "Nearest Unity project containing the starting directory (other copies not searched):"
          : `Unity projects found near ${result.startDirectory}:`,
        ...result.candidates.map(({ projectRoot }) => `- ${projectRoot}`),
      ];
      if (result.strategy === "descendants") {
        if (!result.candidates.length) lines.push("No Unity project found in the searched scope.");
        if (result.truncated) lines.push("Search reached a limit; additional copies may exist.");
        if (result.incomplete) lines.push("Some filesystem entries could not be checked; additional copies may exist.");
      }
      return { content: [{ type: "text", text: lines.join("\n") }], details: result };
    },
  });

  type ScopeRegistrations = Readonly<{
    artifactProfile?: Readonly<{ registry: ScopedRegistryV1; token: RegistrationToken }>;
    fileDiscoveryFilter?: Readonly<{ registry: ScopedRegistryV1; token: RegistrationToken }>;
  }>;
  // Lifecycle handles are session-scoped.
  const registrations = new WeakMap<object, ScopeRegistrations>();
  const unregisterScope = (current: ScopeRegistrations | undefined): boolean => {
    if (current === undefined) return false;
    return [
      current.artifactProfile?.registry.unregister(current.artifactProfile.token) ?? false,
      current.fileDiscoveryFilter?.registry.unregister(current.fileDiscoveryFilter.token) ?? false,
    ].some(Boolean);
  };

  pi.on("session_start", async (_event, ctx) => {
    const scope = ctx.sessionManager;
    unregisterScope(registrations.get(scope));
    // Optional package integrations resolve independently. The Unity extension and
    // its own tools remain usable when either consumer package is not installed.
    const pending = Object.freeze({});
    registrations.set(scope, pending);
    let staged: ScopeRegistrations | undefined;
    try {
      const artifactIntegration = await loadArtifactProfileIntegrationV1(pi);
      if (registrations.get(scope) !== pending) return;
      const fileDiscoveryIntegration = await loadFileDiscoveryFilterIntegrationV1(pi);
      if (registrations.get(scope) !== pending) return;

      // Registration is all-or-nothing: a later contract failure must not leave
      // early optional records in the shared scope.
      const artifactProfile = artifactIntegration === undefined ? undefined : Object.freeze({
        registry: artifactIntegration.registry,
        token: artifactIntegration.registry.register(scope, await artifactIntegration.createProfile()),
      });
      staged = Object.freeze({ ...(artifactProfile === undefined ? {} : { artifactProfile }) });
      const fileDiscoveryFilter = fileDiscoveryIntegration === undefined ? undefined : Object.freeze({
        registry: fileDiscoveryIntegration.registry,
        token: fileDiscoveryIntegration.registry.register(scope, await fileDiscoveryIntegration.createFilter()),
      });
      staged = Object.freeze({ ...staged, ...(fileDiscoveryFilter === undefined ? {} : { fileDiscoveryFilter }) });
      if (registrations.get(scope) !== pending) {
        unregisterScope(staged);
        return;
      }
      registrations.set(scope, staged);
      if (artifactIntegration || fileDiscoveryIntegration) {
        pi.events.emit("pi-unity:capabilities-changed", { scope, contractVersion: 1, action: "registered" });
      }
    } catch (error) {
      unregisterScope(staged);
      if (registrations.get(scope) === pending) registrations.delete(scope);
      throw error;
    }
  });
  pi.on("session_shutdown", (_event, ctx) => {
    const scope = ctx.sessionManager;
    const current = registrations.get(scope);
    if (current === undefined) return;
    const changed = unregisterScope(current);
    registrations.delete(scope);
    if (changed) pi.events.emit("pi-unity:capabilities-changed", { scope, contractVersion: 1, action: "unregistered" });
  });
}
