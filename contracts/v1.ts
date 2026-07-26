import { createCapabilityRegistry, type CapabilityRegistry, type RegistryOwner, type RegistryRecord, type VersionCatalog } from "@aefree/pi-capability-registry";

export const UNITY_MIGRATION_CONTRACT_VERSION_V1 = 1 as const;
export const UNITY_MIGRATION_SERVICE_REGISTRY_KEY_V1 = "@aefree/pi-unity/migration-services/v1" as const;

export interface UnityMigrationOwnerV1 extends RegistryOwner { readonly packageVersion: string; readonly registeredBy: string }
export interface UnityMigrationExecutionContextV1 { readonly cwd: string; readonly requestId?: string; readonly signal: AbortSignal }
export interface UnityClassificationV2 { readonly doc_type: string; readonly category: string; readonly failure_mode: string }
export interface UnityMigrationMappingV1 {
  readonly problemTypeMap?: Readonly<Record<string, UnityClassificationV2>>;
  readonly pathOverrides?: Readonly<Record<string, UnityClassificationV2>>;
}
export type UnityMigrationRequestV1 =
  | {
      readonly operation: "plan";
      readonly workspaceRoot: string;
      readonly solutionsRoot: string;
      readonly artifactRoot?: string;
      readonly mapping?: UnityMigrationMappingV1;
      readonly move?: boolean;
    }
  | {
      readonly operation: "apply";
      readonly workspaceRoot: string;
      readonly solutionsRoot: string;
      readonly artifactRoot?: string;
      readonly mapping?: UnityMigrationMappingV1;
      readonly move?: boolean;
      readonly approvalHash: string;
      readonly runRoot?: string;
      readonly recovery: { readonly mode: "backup" } | { readonly mode: "vcs"; readonly checkpoint: string };
    }
  | {
      readonly operation: "recover";
      readonly workspaceRoot: string;
      readonly runDirectory: string;
      readonly action: "resume" | "rollback";
    };
export interface UnityMigrationResultV1 {
  readonly text: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<{
    schema: "@aefree/pi-unity/migration-provenance";
    version: 1;
    serviceId: string;
    packageName: "@aefree/pi-unity";
    packageVersion: string;
    contractVersion: 1;
    executionGate: "executed" | "blocked";
  }>;
}
export interface UnityMigrationServiceV1 extends RegistryRecord {
  readonly contractVersion: 1;
  readonly kind: "unity-migration-service";
  readonly owner: UnityMigrationOwnerV1;
  execute(context: UnityMigrationExecutionContextV1, request: UnityMigrationRequestV1): Promise<UnityMigrationResultV1>;
}
export type UnityMigrationResolutionV1 =
  | { readonly outcome: "available"; readonly records: readonly Readonly<UnityMigrationServiceV1>[]; readonly catalog: VersionCatalog }
  | { readonly outcome: "missing" | "incompatible" | "duplicate"; readonly code: "missing_registration" | "incompatible_contract" | "duplicate_registration"; readonly expectedContractVersion: 1; readonly registryKey: string; readonly providerIds: readonly string[]; readonly catalog: VersionCatalog };

export function createUnityMigrationServiceRegistryV1(): CapabilityRegistry<UnityMigrationServiceV1> {
  return createCapabilityRegistry({ registryKey: UNITY_MIGRATION_SERVICE_REGISTRY_KEY_V1, contractVersion: 1, compatibleVersions: [1], validate: assertUnityMigrationServiceV1 });
}
export function resolveUnityMigrationServiceV1(scope: object, registry = createUnityMigrationServiceRegistryV1()): UnityMigrationResolutionV1 {
  const catalog = registry.catalog(scope);
  const records = registry.snapshotCompatible(scope);
  if (records.length > 1) return Object.freeze({ outcome: "duplicate", code: "duplicate_registration", expectedContractVersion: 1, registryKey: registry.registryKey, providerIds: Object.freeze(records.map((record) => record.id).sort()), catalog });
  if (records.length === 1) return Object.freeze({ outcome: "available", records, catalog });
  const incompatible = catalog.status === "incompatible";
  return Object.freeze({ outcome: incompatible ? "incompatible" : "missing", code: incompatible ? "incompatible_contract" : "missing_registration", expectedContractVersion: 1, registryKey: registry.registryKey, providerIds: Object.freeze(catalog.versions.filter((entry) => !entry.compatible).flatMap((entry) => entry.registrations.map((registration) => registration.id)).sort()), catalog });
}
export function assertUnityMigrationServiceV1(value: unknown): asserts value is UnityMigrationServiceV1 {
  const record = asRecord(value, "UnityMigrationServiceV1");
  if (record.contractVersion !== 1 || record.kind !== "unity-migration-service" || typeof record.id !== "string" || typeof record.execute !== "function") throw new TypeError("UnityMigrationServiceV1 shape is invalid");
  const owner = asRecord(record.owner, "UnityMigrationServiceV1.owner");
  for (const field of ["packageName", "packageVersion", "packageRoot", "registeredBy"] as const) if (typeof owner[field] !== "string" || owner[field] === "") throw new TypeError(`UnityMigrationServiceV1.owner.${field} is invalid`);
}
export function assertUnityMigrationRequestV1(value: unknown): asserts value is UnityMigrationRequestV1 {
  const request = asRecord(value, "UnityMigrationRequestV1");
  if (request.operation === "recover") {
    assertAbsolute(request.workspaceRoot, "workspaceRoot"); assertAbsolute(request.runDirectory, "runDirectory");
    if (request.action !== "resume" && request.action !== "rollback") throw new TypeError("recover action is invalid");
    return;
  }
  if (request.operation !== "plan" && request.operation !== "apply") throw new TypeError("migration operation is invalid");
  assertAbsolute(request.workspaceRoot, "workspaceRoot"); assertAbsolute(request.solutionsRoot, "solutionsRoot");
  if (request.artifactRoot !== undefined) assertAbsolute(request.artifactRoot, "artifactRoot");
  if (request.operation === "apply") {
    if (typeof request.approvalHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(request.approvalHash)) throw new TypeError("approvalHash is invalid");
    const recovery = asRecord(request.recovery, "recovery");
    if (recovery.mode !== "backup" && !(recovery.mode === "vcs" && typeof recovery.checkpoint === "string" && recovery.checkpoint !== "")) throw new TypeError("recovery gate is invalid");
  }
}
function assertAbsolute(value: unknown, label: string): void { if (typeof value !== "string" || !(value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/u.test(value))) throw new TypeError(`${label} must be absolute`); }
function asRecord(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
