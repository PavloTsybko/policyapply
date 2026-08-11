export const INTEGRATION_MANIFEST_API_VERSION =
  "policyapply.dev/integration-manifest/v1" as const;

export interface ReadOperationManifest {
  readonly key: string;
  readonly kind: "read";
  readonly requiredScopes: readonly string[];
  readonly approval: "not-applicable";
  readonly idempotency: "not-applicable";
}

export interface MutationOperationManifest {
  readonly key: string;
  readonly kind: "mutation";
  readonly requiredScopes: readonly string[];
  readonly approval: "required";
  readonly idempotency: "required";
}

export type IntegrationOperationManifest =
  | ReadOperationManifest
  | MutationOperationManifest;

export interface IntegrationManifestV1 {
  readonly apiVersion: typeof INTEGRATION_MANIFEST_API_VERSION;
  readonly integrationId: string;
  readonly adapterVersion: string;
  readonly operations: readonly IntegrationOperationManifest[];
}

export interface AdapterIdentity {
  readonly integrationId: string;
  readonly adapterVersion: string;
}

export interface IntegrationAdapter {
  readonly identity: AdapterIdentity;
}

export interface AdapterRegistration<TAdapter extends IntegrationAdapter> {
  readonly manifest: IntegrationManifestV1;
  readonly adapter: TAdapter;
}

export type IntegrationSdkErrorCode =
  | "invalid_manifest"
  | "unsupported_manifest_version"
  | "invalid_adapter"
  | "duplicate_registration"
  | "adapter_not_found";

export class IntegrationSdkError extends Error {
  readonly code: IntegrationSdkErrorCode;

  constructor(code: IntegrationSdkErrorCode, message: string) {
    super(message);
    this.name = "IntegrationSdkError";
    this.code = code;
  }
}

const manifestKeys = new Set([
  "apiVersion",
  "integrationId",
  "adapterVersion",
  "operations",
]);
const operationKeys = new Set([
  "key",
  "kind",
  "requiredScopes",
  "approval",
  "idempotency",
]);
const adapterIdentityKeys = new Set(["integrationId", "adapterVersion"]);
const identifierPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const scopePattern = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean => Object.keys(value).every((key) => allowed.has(key));

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 80 &&
  identifierPattern.test(value);

const isScope = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 120 && scopePattern.test(value);

const invalidManifest = (): never => {
  throw new IntegrationSdkError(
    "invalid_manifest",
    "Integration manifest validation failed.",
  );
};

const parseOperation = (input: unknown): IntegrationOperationManifest => {
  if (!isRecord(input) || !hasOnlyKeys(input, operationKeys)) {
    return invalidManifest();
  }
  if (
    !isIdentifier(input.key) ||
    !Array.isArray(input.requiredScopes) ||
    input.requiredScopes.length === 0 ||
    input.requiredScopes.some((scope) => !isScope(scope)) ||
    new Set(input.requiredScopes).size !== input.requiredScopes.length
  ) {
    return invalidManifest();
  }

  const requiredScopes = Object.freeze([
    ...input.requiredScopes,
  ]) as readonly string[];
  if (
    input.kind === "read" &&
    input.approval === "not-applicable" &&
    input.idempotency === "not-applicable"
  ) {
    return Object.freeze({
      key: input.key,
      kind: "read",
      requiredScopes,
      approval: "not-applicable",
      idempotency: "not-applicable",
    });
  }
  if (
    input.kind === "mutation" &&
    input.approval === "required" &&
    input.idempotency === "required"
  ) {
    return Object.freeze({
      key: input.key,
      kind: "mutation",
      requiredScopes,
      approval: "required",
      idempotency: "required",
    });
  }
  return invalidManifest();
};

/** Parse, copy, and freeze a closed v1 manifest without echoing input values. */
export function parseIntegrationManifest(input: unknown): IntegrationManifestV1 {
  if (!isRecord(input) || !hasOnlyKeys(input, manifestKeys)) {
    return invalidManifest();
  }
  if (input.apiVersion !== INTEGRATION_MANIFEST_API_VERSION) {
    throw new IntegrationSdkError(
      "unsupported_manifest_version",
      "Integration manifest API version is unsupported.",
    );
  }
  if (
    !isIdentifier(input.integrationId) ||
    typeof input.adapterVersion !== "string" ||
    input.adapterVersion.length > 80 ||
    !semverPattern.test(input.adapterVersion) ||
    !Array.isArray(input.operations) ||
    input.operations.length === 0
  ) {
    return invalidManifest();
  }

  const operations = input.operations.map(parseOperation);
  if (new Set(operations.map(({ key }) => key)).size !== operations.length) {
    return invalidManifest();
  }

  return Object.freeze({
    apiVersion: INTEGRATION_MANIFEST_API_VERSION,
    integrationId: input.integrationId,
    adapterVersion: input.adapterVersion,
    operations: Object.freeze(operations),
  });
}

const registryKey = (identity: AdapterIdentity): string =>
  `${identity.integrationId}\u0000${identity.adapterVersion}`;

const parseAdapterIdentity = (input: unknown): AdapterIdentity => {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, adapterIdentityKeys) ||
    !isIdentifier(input.integrationId) ||
    typeof input.adapterVersion !== "string" ||
    input.adapterVersion.length > 80 ||
    !semverPattern.test(input.adapterVersion)
  ) {
    throw new IntegrationSdkError(
      "invalid_adapter",
      "Adapter identity validation failed.",
    );
  }
  return Object.freeze({
    integrationId: input.integrationId,
    adapterVersion: input.adapterVersion,
  });
};

/**
 * Exact-version registry. It selects adapters but cannot execute them or bypass
 * the application control plane.
 */
export class AdapterRegistry<TAdapter extends IntegrationAdapter> {
  readonly #registrations = new Map<string, AdapterRegistration<TAdapter>>();

  register(
    manifestInput: unknown,
    adapter: TAdapter,
  ): AdapterRegistration<TAdapter> {
    const manifest = parseIntegrationManifest(manifestInput);
    if (typeof adapter !== "object" || adapter === null) {
      throw new IntegrationSdkError(
        "invalid_adapter",
        "Adapter identity validation failed.",
      );
    }
    const identity = parseAdapterIdentity(adapter.identity);
    if (
      identity.integrationId !== manifest.integrationId ||
      identity.adapterVersion !== manifest.adapterVersion
    ) {
      throw new IntegrationSdkError(
        "invalid_adapter",
        "Adapter identity does not match its manifest.",
      );
    }

    const key = registryKey(identity);
    if (this.#registrations.has(key)) {
      throw new IntegrationSdkError(
        "duplicate_registration",
        "Adapter version is already registered.",
      );
    }

    const registration = Object.freeze({ manifest, adapter });
    this.#registrations.set(key, registration);
    return registration;
  }

  resolve(identity: AdapterIdentity): AdapterRegistration<TAdapter> {
    const parsedIdentity = parseAdapterIdentity(identity);
    const registration = this.#registrations.get(registryKey(parsedIdentity));
    if (registration === undefined) {
      throw new IntegrationSdkError(
        "adapter_not_found",
        "Exact adapter version is not registered.",
      );
    }
    return registration;
  }

  listManifests(): readonly IntegrationManifestV1[] {
    return Object.freeze(
      [...this.#registrations.values()]
        .map(({ manifest }) => manifest)
        .sort((left, right) =>
          registryKey(left).localeCompare(registryKey(right)),
        ),
    );
  }
}
