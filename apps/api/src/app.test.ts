import {
  ApplyService,
  InMemoryApplyRepository,
  InMemoryPlanRepository,
  PolicyApplyControlPlane,
} from "@policyapply/application";
import type { ApplyOutcome, Principal } from "@policyapply/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApi } from "./app.js";

const tenantId = "tenant_example_a";
const projectId = "project_example_a";
const allScopes = ["plans:create", "plans:read", "plans:approve", "plans:apply", "audit:read"];

const principal = (
  id: string,
  scopes: readonly string[] = allScopes,
  tenant = tenantId,
): Principal => ({
  id,
  kind: "user",
  tenantId: tenant,
  projectGrants: [{ projectId, scopes }],
});

const tokens = new Map<string, Principal>([
  ["synthetic_creator_token", principal("principal_creator")],
  ["synthetic_approver_token", principal("principal_approver")],
  ["synthetic_other_tenant", principal("principal_other", allScopes, "tenant_example_b")],
  ["synthetic_readonly_tok", principal("principal_reader", ["plans:read"])],
]);

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const idempotencyKey = (scenario: string): string =>
  ["apply", "example", scenario].join("-");
const correlation = { "x-correlation-id": "correlation_example_01" };
const planUrl = `/v1/tenants/${tenantId}/projects/${projectId}/plans`;

const action = {
  id: "action_example_01",
  type: "example.setting.update",
  schemaVersion: "1",
  targetRef: "resource_example_01",
  parameters: { enabled: true },
};

const completed: ApplyOutcome = {
  outcome: "completed",
  code: "example_applied",
  completedAt: "2026-08-11T12:04:00.000Z",
};

const apps: ReturnType<typeof buildApi>[] = [];

const fixture = (
  outcome: () => Promise<ApplyOutcome> = async () => completed,
  readiness?: () => Promise<boolean>,
) => {
  const applyRepository = new InMemoryApplyRepository();
  let operation = 0;
  let audit = 0;
  let executorCalls = 0;
  const applyService = new ApplyService(
    applyRepository,
    { execute: async () => (executorCalls++, outcome()) },
    { now: () => "2026-08-11T12:03:00.000Z" },
    {
      operationId: () => `operation_example_${++operation}`,
      auditId: () => `audit_example_${++audit}`,
    },
  );
  const controlPlane = new PolicyApplyControlPlane(
    new InMemoryPlanRepository(),
    applyService,
    applyRepository,
    { now: () => "2026-08-11T12:02:00.000Z" },
  );
  const app = buildApi({
    controlPlane,
    ...(readiness === undefined ? {} : { readiness }),
    authenticator: {
      authenticate: async (token) => tokens.get(token) ?? null,
    },
  });
  apps.push(app);
  return { app, calls: () => executorCalls };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("PolicyApply reference API", () => {
  it("serves the committed OpenAPI contract with all implemented operations", async () => {
    const { app } = fixture();
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.openapi).toBe("3.1.0");
    expect(Object.values(document.paths).flatMap((path: any) =>
      Object.values(path).map((operation: any) => operation.operationId),
    )).toEqual(expect.arrayContaining([
      "getOpenApi", "createPlan", "getPlan", "decidePlan", "applyPlan", "listAudit",
      "getLiveness", "getReadiness",
    ]));
    expect(document.paths[planUrl.replace(`/v1/tenants/${tenantId}/projects/${projectId}`, "/v1/tenants/{tenantId}/projects/{projectId}")].post["x-required-scope"]).toBe("plans:create");
  });

  it("reports bounded liveness and readiness without authentication", async () => {
    const { app } = fixture();
    expect((await app.inject({ method: "GET", url: "/health/live" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "GET", url: "/health/ready" })).json()).toEqual({ status: "ok" });
    const { app: unavailable } = fixture(async () => completed, async () => false);
    const response = await unavailable.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
  });

  it("rejects missing authentication and never accepts a principal in the body", async () => {
    const { app } = fixture();
    const response = await app.inject({
      method: "POST",
      url: planUrl,
      headers: correlation,
      payload: { actions: [action], principal: principal("principal_injected") },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("principal_injected");
    const unauthenticated = await app.inject({
      method: "POST",
      url: planUrl,
      headers: correlation,
      payload: { actions: [action] },
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it("denies cross-tenant and missing-scope access before resource lookup", async () => {
    const { app } = fixture();
    for (const token of ["synthetic_other_tenant", "synthetic_readonly_tok"]) {
      const response = await app.inject({
        method: "POST",
        url: planUrl,
        headers: { ...auth(token), ...correlation },
        payload: { actions: [action] },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("authorization_denied");
    }
  });

  it("enforces the operation-specific scope on read, decision, apply, and audit", async () => {
    const { app } = fixture();
    const created = (await app.inject({
      method: "POST",
      url: planUrl,
      headers: { ...auth("synthetic_creator_token"), ...correlation },
      payload: { actions: [action] },
    })).json();
    const read = await app.inject({
      method: "GET",
      url: `${planUrl}/${created.id}`,
      headers: { ...auth("synthetic_readonly_tok"), ...correlation },
    });
    expect(read.statusCode).toBe(200);

    const deniedRequests = [
      {
        method: "POST" as const,
        url: `${planUrl}/${created.id}/decisions`,
        payload: { decision: "approved", expectedRevision: created.revision, expectedDigest: created.digest },
      },
      {
        method: "POST" as const,
        url: `${planUrl}/${created.id}/apply`,
        headers: { "idempotency-key": "apply-denied-01" },
        payload: { planRevision: created.revision, planDigest: created.digest },
      },
      {
        method: "GET" as const,
        url: `/v1/tenants/${tenantId}/projects/${projectId}/audit`,
      },
    ];
    for (const request of deniedRequests) {
      const response = await app.inject({
        ...request,
        headers: {
          ...auth("synthetic_readonly_tok"),
          ...correlation,
          ...request.headers,
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("authorization_denied");
    }
  });

  it("runs create, independent approval, idempotent apply, read, and audit", async () => {
    const { app, calls } = fixture();
    const createdResponse = await app.inject({
      method: "POST",
      url: planUrl,
      headers: { ...auth("synthetic_creator_token"), ...correlation },
      payload: { actions: [action] },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();

    const selfApproval = await app.inject({
      method: "POST",
      url: `${planUrl}/${created.id}/decisions`,
      headers: { ...auth("synthetic_creator_token"), ...correlation },
      payload: {
        decision: "approved",
        expectedRevision: created.revision,
        expectedDigest: created.digest,
      },
    });
    expect(selfApproval.statusCode).toBe(409);
    expect(selfApproval.json().error.code).toBe("self_approval");

    const approvedResponse = await app.inject({
      method: "POST",
      url: `${planUrl}/${created.id}/decisions`,
      headers: { ...auth("synthetic_approver_token"), ...correlation },
      payload: {
        decision: "approved",
        expectedRevision: created.revision,
        expectedDigest: created.digest,
      },
    });
    expect(approvedResponse.statusCode).toBe(200);
    const approved = approvedResponse.json();

    const applyRequest = {
      method: "POST" as const,
      url: `${planUrl}/${created.id}/apply`,
      headers: {
        ...auth("synthetic_creator_token"),
        ...correlation,
        "idempotency-key": idempotencyKey("01"),
      },
      payload: { planRevision: approved.revision, planDigest: approved.digest },
    };
    const first = await app.inject(applyRequest);
    const replay = await app.inject(applyRequest);
    expect(first.statusCode).toBe(200);
    expect(first.json().replayed).toBe(false);
    expect(replay.json().replayed).toBe(true);
    expect(calls()).toBe(1);
    const conflictingReplay = await app.inject({
      ...applyRequest,
      headers: { ...applyRequest.headers, "idempotency-key": idempotencyKey("other-02") },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json().error.code).toBe("idempotency_conflict");
    expect(calls()).toBe(1);

    const read = await app.inject({
      method: "GET",
      url: `${planUrl}/${created.id}`,
      headers: { ...auth("synthetic_creator_token"), ...correlation },
    });
    expect(read.json().status).toBe("applied");
    const audit = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tenantId}/projects/${projectId}/audit`,
      headers: { ...auth("synthetic_creator_token"), ...correlation },
    });
    expect(audit.json().items).toHaveLength(1);
    for (const body of [first.body, replay.body, audit.body]) {
      expect(body).not.toContain("parameters");
      expect(body).not.toContain("enabled");
      expect(body).not.toContain(idempotencyKey("01"));
      expect(body).not.toContain("synthetic_creator_token");
    }
  });

  it("rejects secret-like plan fields before persistence", async () => {
    const { app } = fixture();
    const response = await app.inject({
      method: "POST",
      url: planUrl,
      headers: { ...auth("synthetic_creator_token"), ...correlation },
      payload: { actions: [{ ...action, parameters: { apiKey: "not-a-real-value" } }] },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("secret_like_parameter");
    expect(response.body).not.toContain("not-a-real-value");
  });

  it("returns generic bounded validation errors without echoing input", async () => {
    const { app } = fixture();
    const marker = "do-not-echo-this-value";
    const response = await app.inject({
      method: "POST",
      url: planUrl,
      headers: { ...auth("synthetic_creator_token"), ...correlation },
      payload: { actions: [{ ...action, unexpected: marker }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect(response.body).not.toContain(marker);
  });

  it("maps an uncertain apply to 503 and prevents blind retry", async () => {
    const { app, calls } = fixture(async () => {
      throw new Error("synthetic interruption");
    });
    const created = (await app.inject({
      method: "POST", url: planUrl,
      headers: { ...auth("synthetic_creator_token"), ...correlation },
      payload: { actions: [action] },
    })).json();
    const approved = (await app.inject({
      method: "POST", url: `${planUrl}/${created.id}/decisions`,
      headers: { ...auth("synthetic_approver_token"), ...correlation },
      payload: { decision: "approved", expectedRevision: created.revision, expectedDigest: created.digest },
    })).json();
    const request = {
      method: "POST" as const,
      url: `${planUrl}/${created.id}/apply`,
      headers: { ...auth("synthetic_creator_token"), ...correlation, "idempotency-key": idempotencyKey("uncertain-01") },
      payload: { planRevision: approved.revision, planDigest: approved.digest },
    };
    expect((await app.inject(request)).statusCode).toBe(503);
    expect((await app.inject(request)).statusCode).toBe(503);
    expect(calls()).toBe(1);
  });
});
