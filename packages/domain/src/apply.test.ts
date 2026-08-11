import type { ApplyCommand, ChangePlan } from "@policyapply/contracts";
import { describe, expect, it } from "vitest";
import { createChangePlan, decideChangePlan } from "./change-plan.js";
import {
  ApplyProtocolError,
  createApplyFingerprint,
  markPlanApplied,
  validateApplyCommand,
} from "./apply.js";

const approved = (): ChangePlan => {
  const plan = createChangePlan({
    tenantId: "tenant_example_a",
    projectId: "project_example_a",
    createdBy: { principalId: "principal_creator", kind: "agent" },
    createdAt: "2026-08-11T12:00:00.000Z",
    actions: [
      {
        id: "action_example_01",
        type: "example.update",
        schemaVersion: "1",
        targetRef: "resource_example_01",
        parameters: { enabled: true },
      },
    ],
  });
  return decideChangePlan(plan, {
    decidedBy: { principalId: "principal_approver", kind: "user" },
    decidedAt: "2026-08-11T12:01:00.000Z",
    decision: "approved",
    expectedRevision: plan.revision,
    expectedDigest: plan.digest,
  });
};

const command = (plan: ChangePlan): ApplyCommand => ({
  tenantId: plan.tenantId,
  projectId: plan.projectId,
  planId: plan.id,
  planRevision: plan.revision,
  planDigest: plan.digest,
  appliedBy: { principalId: "principal_applier", kind: "service" },
  idempotencyKey: "apply-example-01",
  correlationId: "correlation_example_01",
  requestedAt: "2026-08-11T12:02:00.000Z",
  mode: "execute-v1",
});

describe("apply protocol", () => {
  it("creates a stable fingerprint that ignores tracing metadata", () => {
    const plan = approved();
    const first = command(plan);
    const retry = {
      ...first,
      correlationId: "correlation_retry_02",
      requestedAt: "2026-08-11T12:03:00.000Z",
    };
    expect(createApplyFingerprint(plan, first)).toBe(
      createApplyFingerprint(plan, retry),
    );
  });

  it("changes the fingerprint when the applying actor changes", () => {
    const plan = approved();
    const first = command(plan);
    const changed = {
      ...first,
      appliedBy: { principalId: "principal_other", kind: "service" as const },
    };
    expect(createApplyFingerprint(plan, first)).not.toBe(
      createApplyFingerprint(plan, changed),
    );
  });

  it("rejects malformed keys and exact-plan conflicts", () => {
    const plan = approved();
    expect(() =>
      validateApplyCommand(plan, { ...command(plan), idempotencyKey: "short" }),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() =>
      validateApplyCommand(plan, {
        ...command(plan),
        correlationId: "unsafe correlation with spaces",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() =>
      validateApplyCommand(plan, {
        ...command(plan),
        projectId: "project_example_b",
      }),
    ).toThrowError(expect.objectContaining({ code: "plan_conflict" }));
    expect(() =>
      validateApplyCommand(plan, {
        ...command(plan),
        planDigest: "0".repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ code: "digest_mismatch" }));
  });

  it("returns a frozen applied plan only from an approved exact plan", () => {
    const plan = approved();
    const applied = markPlanApplied(plan);
    expect(applied.status).toBe("applied");
    expect(Object.isFrozen(applied)).toBe(true);
    expect(() => markPlanApplied(applied)).toThrow(ApplyProtocolError);
  });
});
