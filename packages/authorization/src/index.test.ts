import type {
  Principal,
  ProjectAuthorizationRequest,
} from "@policyapply/contracts";
import { describe, expect, it } from "vitest";
import { authorizeProjectAction } from "./index.js";

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  id: "principal_example_01",
  kind: "agent",
  tenantId: "tenant_example_a",
  projectGrants: [
    {
      projectId: "project_example_a",
      scopes: ["plans:read", "plans:create"],
    },
  ],
  ...overrides,
});

const request = (
  overrides: Partial<ProjectAuthorizationRequest> = {},
): ProjectAuthorizationRequest => ({
  tenantId: "tenant_example_a",
  projectId: "project_example_a",
  requiredScopes: ["plans:create"],
  now: "2026-08-10T12:00:00.000Z",
  ...overrides,
});

describe("authorizeProjectAction", () => {
  it("allows an exact tenant, project, and scope grant", () => {
    expect(authorizeProjectAction(principal(), request())).toEqual({
      allowed: true,
      principalId: "principal_example_01",
      tenantId: "tenant_example_a",
      projectId: "project_example_a",
      grantedScopes: ["plans:read", "plans:create"],
    });
  });

  it("allows a request with no required scopes after project authorization", () => {
    expect(
      authorizeProjectAction(principal(), request({ requiredScopes: [] })),
    ).toMatchObject({ allowed: true });
  });

  it("denies a cross-tenant request even when project and scope names match", () => {
    expect(
      authorizeProjectAction(
        principal(),
        request({ tenantId: "tenant_example_b" }),
      ),
    ).toEqual({ allowed: false, reason: "tenant_mismatch" });
  });

  it("denies a project that is not explicitly granted", () => {
    expect(
      authorizeProjectAction(
        principal(),
        request({ projectId: "project_example_b" }),
      ),
    ).toEqual({ allowed: false, reason: "project_not_granted" });
  });

  it("denies and reports every missing scope", () => {
    expect(
      authorizeProjectAction(
        principal(),
        request({ requiredScopes: ["plans:approve", "plans:apply"] }),
      ),
    ).toEqual({
      allowed: false,
      reason: "scope_missing",
      missingScopes: ["plans:approve", "plans:apply"],
    });
  });

  it("denies a revoked principal", () => {
    expect(
      authorizeProjectAction(
        principal({ revokedAt: "2026-08-10T11:59:00.000Z" }),
        request(),
      ),
    ).toEqual({ allowed: false, reason: "principal_revoked" });
  });

  it("denies an expired principal at the exact expiry boundary", () => {
    expect(
      authorizeProjectAction(
        principal({ expiresAt: "2026-08-10T12:00:00.000Z" }),
        request(),
      ),
    ).toEqual({ allowed: false, reason: "principal_expired" });
  });

  it("fails closed on malformed identifiers, scopes, or timestamps", () => {
    const cases: Array<[Principal, ProjectAuthorizationRequest]> = [
      [principal({ id: "" }), request()],
      [principal({ kind: "invalid" as Principal["kind"] }), request()],
      [
        principal({ projectGrants: [{ projectId: "", scopes: [] }] }),
        request(),
      ],
      [
        principal({
          projectGrants: [
            { projectId: "project_example_a", scopes: ["plans:create"] },
            { projectId: "project_example_a", scopes: ["plans:read"] },
          ],
        }),
        request(),
      ],
      [
        principal({
          projectGrants: [
            { projectId: "project_example_a", scopes: ["plans:create", ""] },
          ],
        }),
        request(),
      ],
      [principal(), request({ tenantId: " " })],
      [principal(), request({ projectId: "" })],
      [principal(), request({ requiredScopes: [""] })],
      [principal(), request({ now: "not-a-date" })],
      [principal({ expiresAt: "not-a-date" }), request()],
      [principal({ revokedAt: "not-a-date" }), request()],
    ];

    for (const [candidatePrincipal, candidateRequest] of cases) {
      expect(
        authorizeProjectAction(candidatePrincipal, candidateRequest),
      ).toEqual({ allowed: false, reason: "invalid_request" });
    }
  });

  it("does not treat wildcard-looking scopes as authority", () => {
    expect(
      authorizeProjectAction(
        principal({
          projectGrants: [
            { projectId: "project_example_a", scopes: ["plans:*"] },
          ],
        }),
        request({ requiredScopes: ["plans:apply"] }),
      ),
    ).toEqual({
      allowed: false,
      reason: "scope_missing",
      missingScopes: ["plans:apply"],
    });
  });
});
