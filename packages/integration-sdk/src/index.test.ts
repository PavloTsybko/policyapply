import { describe, expect, it } from "vitest";
import {
  AdapterRegistry,
  INTEGRATION_MANIFEST_API_VERSION,
  IntegrationSdkError,
  parseIntegrationManifest,
  type IntegrationAdapter,
} from "./index.js";

const manifest = () => ({
  apiVersion: INTEGRATION_MANIFEST_API_VERSION,
  integrationId: "synthetic-mail",
  adapterVersion: "1.2.3",
  operations: [
    {
      key: "messages.list",
      kind: "read",
      requiredScopes: ["messages:read"],
      approval: "not-applicable",
      idempotency: "not-applicable",
    },
    {
      key: "messages.archive",
      kind: "mutation",
      requiredScopes: ["messages:archive"],
      approval: "required",
      idempotency: "required",
    },
  ],
});

const adapter = (
  integrationId = "synthetic-mail",
  adapterVersion = "1.2.3",
): IntegrationAdapter => ({ identity: { integrationId, adapterVersion } });

const expectCode = (action: () => unknown, code: string): void => {
  try {
    action();
    throw new Error("Expected action to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(IntegrationSdkError);
    expect((error as IntegrationSdkError).code).toBe(code);
  }
};

describe("parseIntegrationManifest", () => {
  it("copies and deeply freezes a valid closed v1 manifest", () => {
    const input = manifest();
    const parsed = parseIntegrationManifest(input);

    input.operations[0]!.requiredScopes[0] = "messages:write";

    expect(parsed.operations[0]!.requiredScopes).toEqual(["messages:read"]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.operations)).toBe(true);
    expect(Object.isFrozen(parsed.operations[0])).toBe(true);
    expect(Object.isFrozen(parsed.operations[0]!.requiredScopes)).toBe(true);
  });

  it("rejects unsupported API versions without echoing their value", () => {
    try {
      parseIntegrationManifest({ ...manifest(), apiVersion: "future-secret-value" });
      throw new Error("Expected manifest to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationSdkError);
      expect((error as IntegrationSdkError).code).toBe(
        "unsupported_manifest_version",
      );
      expect((error as Error).message).not.toContain("future-secret-value");
    }
  });

  it("rejects unknown configuration or secret-bearing fields", () => {
    expectCode(
      () =>
        parseIntegrationManifest({
          ...manifest(),
          credentials: { token: "synthetic-value-that-must-not-be-accepted" },
        }),
      "invalid_manifest",
    );
    expectCode(
      () =>
        parseIntegrationManifest({
          ...manifest(),
          operations: [
            { ...manifest().operations[0], endpoint: "https://api.example" },
          ],
        }),
      "invalid_manifest",
    );
  });

  it("requires approval and idempotency for mutations", () => {
    expectCode(
      () =>
        parseIntegrationManifest({
          ...manifest(),
          operations: [
            {
              key: "messages.archive",
              kind: "mutation",
              requiredScopes: ["messages:archive"],
              approval: "not-applicable",
              idempotency: "not-applicable",
            },
          ],
        }),
      "invalid_manifest",
    );
  });

  it("rejects duplicate operation keys and duplicate scopes", () => {
    const duplicateOperation = manifest().operations[0]!;
    expectCode(
      () =>
        parseIntegrationManifest({
          ...manifest(),
          operations: [duplicateOperation, { ...duplicateOperation }],
        }),
      "invalid_manifest",
    );
    expectCode(
      () =>
        parseIntegrationManifest({
          ...manifest(),
          operations: [
            {
              ...duplicateOperation,
              requiredScopes: ["messages:read", "messages:read"],
            },
          ],
        }),
      "invalid_manifest",
    );
  });
});

describe("AdapterRegistry", () => {
  it("registers and resolves only an exact integration and version", () => {
    const registry = new AdapterRegistry<IntegrationAdapter>();
    const registered = registry.register(manifest(), adapter());

    expect(
      registry.resolve({
        integrationId: "synthetic-mail",
        adapterVersion: "1.2.3",
      }),
    ).toBe(registered);
    expectCode(
      () =>
        registry.resolve({
          integrationId: "synthetic-mail",
          adapterVersion: "1.2.4",
        }),
      "adapter_not_found",
    );
  });

  it("rejects an adapter whose identity differs from the manifest", () => {
    const registry = new AdapterRegistry<IntegrationAdapter>();
    expectCode(
      () => registry.register(manifest(), adapter("synthetic-calendar")),
      "invalid_adapter",
    );
  });

  it("fails closed on malformed runtime adapter identities and lookups", () => {
    const registry = new AdapterRegistry<IntegrationAdapter>();
    expectCode(
      () => registry.register(manifest(), {} as IntegrationAdapter),
      "invalid_adapter",
    );
    expectCode(
      () =>
        registry.resolve({
          integrationId: "synthetic-mail",
          adapterVersion: "latest",
        }),
      "invalid_adapter",
    );
  });

  it("rejects duplicate exact-version registrations", () => {
    const registry = new AdapterRegistry<IntegrationAdapter>();
    registry.register(manifest(), adapter());
    expectCode(
      () => registry.register(manifest(), adapter()),
      "duplicate_registration",
    );
  });

  it("lists frozen manifests in deterministic identity order", () => {
    const registry = new AdapterRegistry<IntegrationAdapter>();
    registry.register(
      { ...manifest(), integrationId: "synthetic-mail" },
      adapter("synthetic-mail"),
    );
    registry.register(
      { ...manifest(), integrationId: "synthetic-calendar" },
      adapter("synthetic-calendar"),
    );

    const listed = registry.listManifests();
    expect(listed.map(({ integrationId }) => integrationId)).toEqual([
      "synthetic-calendar",
      "synthetic-mail",
    ]);
    expect(Object.isFrozen(listed)).toBe(true);
  });
});
