import type {
  ChangePlan,
  JsonValue,
  PlanAction,
} from "@policyapply/contracts";
import { describe, expect, it } from "vitest";
import {
  ChangePlanError,
  computePlanDigest,
  createChangePlan,
  decideChangePlan,
} from "./change-plan.js";

const action = (overrides: Partial<PlanAction> = {}): PlanAction => ({
  id: "action_example_01",
  type: "example.setting.update",
  schemaVersion: "1",
  targetRef: "resource_example_01",
  parameters: { enabled: true, limits: { daily: 10 } },
  ...overrides,
});

const draft = (
  overrides: Partial<Parameters<typeof createChangePlan>[0]> = {},
): ChangePlan =>
  createChangePlan({
    tenantId: "tenant_example_a",
    projectId: "project_example_a",
    createdBy: { principalId: "principal_creator", kind: "agent" },
    createdAt: "2026-08-11T12:00:00.000Z",
    actions: [action()],
    ...overrides,
  });

const decision = (plan: ChangePlan) => ({
  decidedBy: { principalId: "principal_approver", kind: "user" } as const,
  decidedAt: "2026-08-11T12:05:00.000Z",
  decision: "approved" as const,
  expectedRevision: plan.revision,
  expectedDigest: plan.digest,
});

const expectCode = (operation: () => unknown, code: string): void => {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ChangePlanError);
    expect((error as ChangePlanError).code).toBe(code);
  }
};

describe("createChangePlan", () => {
  it("creates a deeply immutable draft with integrity metadata", () => {
    const plan = draft();

    expect(plan.id).toMatch(/^plan_[0-9a-f-]{36}$/);
    expect(plan.status).toBe("draft");
    expect(plan.revision).toBe(1);
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.approval).toBeUndefined();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.actions)).toBe(true);
    expect(Object.isFrozen(plan.actions[0])).toBe(true);
    expect(Object.isFrozen(plan.actions[0]?.parameters)).toBe(true);
    expect(() => {
      (plan.actions[0] as { type: string }).type = "changed";
    }).toThrow(TypeError);
  });

  it("produces the same digest for equivalent parameter key order", () => {
    const first = draft();
    const second = {
      ...first,
      actions: [
        action({ parameters: { nested: { a: 1, b: 2 }, z: 1 } }),
      ],
    };
    const equivalent = {
      ...second,
      actions: [
        action({ parameters: { z: 1, nested: { b: 2, a: 1 } } }),
      ],
    };

    expect(computePlanDigest(second)).toBe(computePlanDigest(equivalent));
  });

  it("changes the digest when immutable content changes", () => {
    const plan = draft();
    const changed = [
      { ...plan, id: "plan_changed" },
      { ...plan, tenantId: "tenant_example_b" },
      { ...plan, projectId: "project_example_b" },
      { ...plan, revision: 2 },
      {
        ...plan,
        createdBy: { principalId: "principal_changed", kind: "user" as const },
      },
      { ...plan, createdAt: "2026-08-11T12:00:01.000Z" },
      { ...plan, actions: [action({ targetRef: "resource_example_02" })] },
    ];

    for (const candidate of changed) {
      expect(computePlanDigest(candidate)).not.toBe(plan.digest);
    }
  });

  it("fails closed on malformed plan inputs", () => {
    const duplicate = action({ id: "action_duplicate" });
    const cases: Array<Partial<Parameters<typeof createChangePlan>[0]>> = [
      { tenantId: "" },
      { projectId: " " },
      { createdAt: "not-a-date" },
      { createdBy: { principalId: "", kind: "user" } },
      { actions: [] },
      { actions: [action({ id: "" })] },
      { actions: [action({ type: "" })] },
      { actions: [action({ schemaVersion: "" })] },
      { actions: [action({ targetRef: "" })] },
      { actions: [duplicate, duplicate] },
      {
        actions: [
          action({ parameters: { invalid: undefined } as unknown as JsonValue }),
        ],
      },
    ];

    for (const overrides of cases) {
      expectCode(() => draft(overrides), "invalid_input");
    }
  });
});

describe("decideChangePlan", () => {
  it("approves a draft against its exact revision and digest", () => {
    const plan = draft();
    const approved = decideChangePlan(plan, decision(plan));

    expect(approved.status).toBe("approved");
    expect(approved.actions).toEqual(plan.actions);
    expect(approved.digest).toBe(plan.digest);
    expect(approved.approval).toEqual({
      decision: "approved",
      decidedAt: "2026-08-11T12:05:00.000Z",
      decidedBy: { principalId: "principal_approver", kind: "user" },
      planRevision: 1,
      planDigest: plan.digest,
    });
    expect(Object.isFrozen(approved.approval)).toBe(true);
  });

  it("supports an independently recorded rejection", () => {
    const plan = draft();
    const rejected = decideChangePlan(plan, {
      ...decision(plan),
      decision: "rejected",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.approval?.decision).toBe("rejected");
  });

  it("rejects self-approval by principal ID even with another actor kind", () => {
    const plan = draft();
    expectCode(
      () =>
        decideChangePlan(plan, {
          ...decision(plan),
          decidedBy: { principalId: "principal_creator", kind: "service" },
        }),
      "self_approval",
    );
  });

  it("rejects stale revisions and mismatched expected digests", () => {
    const plan = draft();
    expectCode(
      () =>
        decideChangePlan(plan, {
          ...decision(plan),
          expectedRevision: plan.revision + 1,
        }),
      "plan_conflict",
    );
    expectCode(
      () =>
        decideChangePlan(plan, {
          ...decision(plan),
          expectedDigest: "0".repeat(64),
        }),
      "digest_mismatch",
    );
  });

  it("rejects a decision timestamp before plan creation", () => {
    const plan = draft();
    expectCode(
      () =>
        decideChangePlan(plan, {
          ...decision(plan),
          decidedAt: "2026-08-11T11:59:59.000Z",
        }),
      "invalid_input",
    );
  });

  it("detects content changes made after digest creation", () => {
    const plan = draft();
    const tampered: ChangePlan = {
      ...plan,
      actions: [action({ targetRef: "resource_tampered" })],
    };
    expectCode(
      () => decideChangePlan(tampered, decision(plan)),
      "content_tampered",
    );
  });

  it("rejects a second decision from a terminal state", () => {
    const plan = draft();
    const approved = decideChangePlan(plan, decision(plan));
    expectCode(
      () => decideChangePlan(approved, decision(approved)),
      "invalid_state",
    );
  });
});
