/**
 * Minimal adapter for the published capability-registry global protocol.
 *
 * Optional Pi packages have independent Node module roots, so provider packages
 * must rendezvous through the protocol's documented `globalThis[Symbol.for()]`
 * root rather than importing their contract from pi-unity's module root. This
 * adapter only manages pi-unity's known-valid records; schema validation remains
 * owned by each consuming package's contract.
 */
const ROOT_PROTOCOL = "@aefree/pi-capability-registry/root";
const ROOT_PROTOCOL_VERSION = 1;

export type OptionalRegistrationToken = Readonly<{
  registryKey: string;
  contractVersion: 1;
  scope: object;
  ownerKey: string;
  id: string;
  nonce: number;
}>;

type StoredRecord = Readonly<{ nonce: number; record: Readonly<Record<string, unknown>> }>;
type ScopedState = { sequence: number; records: Map<string, StoredRecord> };
type VersionState = { version: 1; scopes: WeakMap<object, ScopedState> };
type RegistryRoot = { protocol: string; protocolVersion: number; registryKey: string; versions: Map<unknown, unknown> };

export type OptionalIntegrationRegistryV1 = Readonly<{
  register: (scope: object, record: Readonly<Record<string, unknown>>) => OptionalRegistrationToken;
  unregister: (token: OptionalRegistrationToken) => boolean;
}>;

export function isOptionalIntegrationActive(pi: { getActiveTools?: () => string[] }, toolName: string): boolean {
  return pi.getActiveTools?.().includes(toolName) ?? false;
}

/**
 * Returns no registry when the owning integration is absent. If its advertised
 * tool is present, create or validate that integration's actual global contract
 * root. A malformed root is an installed/broken contract and throws visibly.
 */
export function createOptionalIntegrationRegistryV1(
  registryKey: string,
  integrationName: string,
): OptionalIntegrationRegistryV1 {
  const globalRecord = globalThis as typeof globalThis & Record<symbol, unknown>;
  const symbol = Symbol.for(registryKey);
  let candidate = globalRecord[symbol];
  if (candidate === undefined) {
    candidate = {
      protocol: ROOT_PROTOCOL,
      protocolVersion: ROOT_PROTOCOL_VERSION,
      registryKey,
      versions: new Map(),
    } satisfies RegistryRoot;
    globalRecord[symbol] = candidate;
  }
  const root = assertRegistryRoot(candidate, registryKey, integrationName);
  let stateCandidate = root.versions.get(1);
  if (stateCandidate === undefined) {
    stateCandidate = { version: 1, scopes: new WeakMap<object, ScopedState>() } satisfies VersionState;
    root.versions.set(1, stateCandidate);
  }
  const version = assertVersionState(stateCandidate, registryKey, integrationName);

  return Object.freeze({
    register(scope, record) {
      if ((typeof scope !== "object" && typeof scope !== "function") || scope === null) {
        throw new TypeError(`${integrationName} contract requires a session scope object.`);
      }
      const owner = record.owner as Record<string, unknown> | undefined;
      if (typeof record.id !== "string" || typeof owner?.packageName !== "string" || typeof owner.packageRoot !== "string") {
        throw new TypeError(`pi-unity attempted an invalid ${integrationName} contract registration.`);
      }
      let scoped = version.scopes.get(scope);
      if (scoped === undefined) {
        scoped = { sequence: 0, records: new Map() };
        version.scopes.set(scope, scoped);
      }
      const ownerKey = `${owner.packageName}\0${owner.packageRoot}\0${record.id}`;
      for (const current of scoped.records.values()) {
        if (current.record.id === record.id && current.record.owner !== owner && ownerKeyFor(current.record) !== ownerKey) {
          throw new TypeError(`Provider id '${record.id}' conflicts in ${integrationName} contract '${registryKey}'.`);
        }
      }
      const nonce = scoped.sequence + 1;
      scoped.records.set(ownerKey, { nonce, record });
      scoped.sequence = nonce;
      return Object.freeze({ registryKey, contractVersion: 1, scope, ownerKey, id: record.id, nonce });
    },
    unregister(token) {
      if (!token || token.registryKey !== registryKey || token.contractVersion !== 1) return false;
      const scoped = version.scopes.get(token.scope);
      const current = scoped?.records.get(token.ownerKey);
      if (current === undefined || current.nonce !== token.nonce || current.record.id !== token.id) return false;
      scoped!.records.delete(token.ownerKey);
      return true;
    },
  });
}

function ownerKeyFor(record: Readonly<Record<string, unknown>>): string {
  const owner = record.owner as Record<string, unknown>;
  return `${String(owner.packageName)}\0${String(owner.packageRoot)}\0${String(record.id)}`;
}

function assertRegistryRoot(value: unknown, registryKey: string, integrationName: string): RegistryRoot {
  if (value === null || typeof value !== "object") throw brokenContract(integrationName, registryKey);
  const root = value as Partial<RegistryRoot>;
  if (root.protocol !== ROOT_PROTOCOL || root.protocolVersion !== ROOT_PROTOCOL_VERSION || root.registryKey !== registryKey || !(root.versions instanceof Map)) {
    throw brokenContract(integrationName, registryKey);
  }
  return root as RegistryRoot;
}

function assertVersionState(value: unknown, registryKey: string, integrationName: string): VersionState {
  if (value === null || typeof value !== "object") throw brokenContract(integrationName, registryKey);
  const state = value as Partial<VersionState>;
  if (state.version !== 1 || !(state.scopes instanceof WeakMap)) throw brokenContract(integrationName, registryKey);
  return state as VersionState;
}

function brokenContract(integrationName: string, registryKey: string): TypeError {
  return new TypeError(`${integrationName} advertises an incompatible capability-registry contract for '${registryKey}'.`);
}
