import type {
  ApplyCommand,
  ApplyOutcome,
  AuditReceipt,
  ChangePlan,
} from "@policyapply/contracts";
import {
  ApplyProtocolError,
  createApplyFingerprint,
  createChangePlan,
  decideChangePlan,
  markPlanApplied,
} from "@policyapply/domain";
import { describe, expect, it } from "vitest";
import { ApplyService } from "./apply-service.js";
import { InMemoryApplyRepository } from "./in-memory.js";
import type { ApplyExecutor, ApplyIdFactory } from "./ports.js";

const approvedPlan = (): ChangePlan => {
  const plan = createChangePlan({
    tenantId: "tenant_example_a",
    projectId: "project_example_a",
    createdBy: { principalId: "principal_creator", kind: "agent" },
    createdAt: "2026-08-11T12:00:00.000Z",
    actions: [
      {
        id: "action_example_01",
        type: "example.setting.update",
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

const commandFor = (
  plan: ChangePlan,
  overrides: Partial<ApplyCommand> = {},
): ApplyCommand => ({
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
  ...overrides,
});

const fixedClock = { now: () => "2026-08-11T12:03:00.000Z" };

const ids = (): ApplyIdFactory => {
  let operation = 0;
  let audit = 0;
  return {
    operationId: () => `operation_example_${++operation}`,
    auditId: () => `audit_example_${++audit}`,
  };
};

const completed = (): ApplyOutcome => ({
  outcome: "completed",
  code: "example_applied",
  completedAt: "2026-08-11T12:04:00.000Z",
});

const expectCode = async (
  operation: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(operation).rejects.toBeInstanceOf(ApplyProtocolError);
  await expect(operation).rejects.toMatchObject({ code });
};

describe("ApplyService", () => {
  it("completes once and writes a payload-free immutable audit receipt", async () => {
    const plan = approvedPlan();
    const repository = new InMemoryApplyRepository();
    const operations: string[] = [];
    const executor: ApplyExecutor = {
      execute: async ({ operationId, plan: executablePlan }) => {
        operations.push(operationId);
        expect(Object.isFrozen(executablePlan)).toBe(true);
        return completed();
      },
    };
    const service = new ApplyService(repository, executor, fixedClock, ids());

    const receipt = await service.apply(plan, commandFor(plan));

    expect(receipt.plan.status).toBe("applied");
    expect(receipt.replayed).toBe(false);
    expect(receipt.audit.eventType).toBe("plan.apply.completed");
    expect(operations).toEqual(["operation_example_1"]);
    expect(await repository.listAudit()).toEqual([receipt.audit]);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.audit)).toBe(true);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("parameters");
    expect(serialized).not.toContain("enabled");
    expect(serialized).not.toContain("apply-example-01");
  });

  it("returns the stored receipt on same-key replay without executing twice", async () => {
    const plan = approvedPlan();
    const repository = new InMemoryApplyRepository();
    let calls = 0;
    const service = new ApplyService(
      repository,
      { execute: async () => (calls++, completed()) },
      fixedClock,
      ids(),
    );

    const first = await service.apply(plan, commandFor(plan));
    const replay = await service.apply(plan, commandFor(plan, {
      correlationId: "correlation_retry_02",
      requestedAt: "2026-08-11T12:05:00.000Z",
    }));

    expect(calls).toBe(1);
    expect(replay.replayed).toBe(true);
    expect(replay.audit).toEqual(first.audit);
  });

  it("rejects same-key reuse with a different actor fingerprint", async () => {
    const plan = approvedPlan();
    const repository = new InMemoryApplyRepository();
    const service = new ApplyService(
      repository,
      { execute: async () => completed() },
      fixedClock,
      ids(),
    );
    await service.apply(plan, commandFor(plan));

    await expectCode(
      service.apply(
        plan,
        commandFor(plan, {
          appliedBy: { principalId: "principal_other", kind: "service" },
        }),
      ),
      "idempotency_conflict",
    );
  });

  it("retries a declared retry-safe failure with the same operation ID", async () => {
    const plan = approvedPlan();
    const repository = new InMemoryApplyRepository();
    const operations: string[] = [];
    let calls = 0;
    const service = new ApplyService(
      repository,
      {
        execute: async ({ operationId }) => {
          operations.push(operationId);
          calls += 1;
          return calls === 1
            ? {
                outcome: "failed",
                code: "temporary_unavailable",
                failedAt: "2026-08-11T12:04:00.000Z",
                retrySafe: true,
              }
            : completed();
        },
      },
      fixedClock,
      ids(),
    );

    await expectCode(service.apply(plan, commandFor(plan)), "apply_failed");
    const receipt = await service.apply(plan, commandFor(plan));

    expect(receipt.plan.status).toBe("applied");
    expect(operations).toEqual(["operation_example_1", "operation_example_1"]);
  });

  it("never blindly retries an uncertain executor result", async () => {
    const plan = approvedPlan();
    const repository = new InMemoryApplyRepository();
    let calls = 0;
    const service = new ApplyService(
      repository,
      {
        execute: async () => {
          calls += 1;
          throw new Error("synthetic transport interruption");
        },
      },
      fixedClock,
      ids(),
    );

    await expectCode(service.apply(plan, commandFor(plan)), "apply_uncertain");
    await expectCode(service.apply(plan, commandFor(plan)), "apply_uncertain");
    expect(calls).toBe(1);
  });

  it("records malformed executor output as uncertain", async () => {
    const plan = approvedPlan();
    const service = new ApplyService(
      new InMemoryApplyRepository(),
      { execute: async () => ({ outcome: "completed", body: "unsafe" }) as never },
      fixedClock,
      ids(),
    );
    await expectCode(service.apply(plan, commandFor(plan)), "apply_uncertain");
  });

  it("records a backdated executor result as uncertain", async () => {
    const plan = approvedPlan();
    const service = new ApplyService(
      new InMemoryApplyRepository(),
      {
        execute: async () => ({
          outcome: "completed",
          code: "example_applied",
          completedAt: "2026-08-11T11:59:00.000Z",
        }),
      },
      fixedClock,
      ids(),
    );
    await expectCode(service.apply(plan, commandFor(plan)), "apply_uncertain");
  });

  it("rejects an unapproved or approval-tampered plan before execution", async () => {
    const approved = approvedPlan();
    const draft = createChangePlan({
      tenantId: approved.tenantId,
      projectId: approved.projectId,
      createdBy: approved.createdBy,
      createdAt: approved.createdAt,
      actions: approved.actions,
    });
    let calls = 0;
    const service = new ApplyService(
      new InMemoryApplyRepository(),
      { execute: async () => (calls++, completed()) },
      fixedClock,
      ids(),
    );

    await expectCode(service.apply(draft, commandFor(draft)), "invalid_state");
    const tampered = {
      ...approved,
      approval: { ...approved.approval!, planDigest: "0".repeat(64) },
    };
    await expectCode(
      service.apply(tampered, commandFor(tampered)),
      "content_tampered",
    );
    const approverTampered = {
      ...approved,
      approval: {
        ...approved.approval!,
        decidedBy: { principalId: "principal_substituted", kind: "user" as const },
      },
    };
    await expectCode(
      service.apply(approverTampered, commandFor(approverTampered)),
      "content_tampered",
    );
    expect(calls).toBe(0);
  });

  it("rejects concurrent duplicate apply while the first call is executing", async () => {
    const plan = approvedPlan();
    const repository = new InMemoryApplyRepository();
    let release: ((value: ApplyOutcome) => void) | undefined;
    const waiting = new Promise<ApplyOutcome>((resolve) => {
      release = resolve;
    });
    const service = new ApplyService(
      repository,
      { execute: async () => waiting },
      fixedClock,
      ids(),
    );

    const first = service.apply(plan, commandFor(plan));
    await Promise.resolve();
    await Promise.resolve();
    await expectCode(service.apply(plan, commandFor(plan)), "apply_in_progress");
    release?.(completed());
    await expect(first).resolves.toMatchObject({ replayed: false });
  });
});

describe("InMemoryApplyRepository audit behavior", () => {
  it("refuses an audit ID overwrite", async () => {
    const plan = approvedPlan();
    const repository = new InMemoryApplyRepository();
    const firstCommand = commandFor(plan, { idempotencyKey: "apply-example-01" });
    const secondCommand = commandFor(plan, { idempotencyKey: "apply-example-02" });

    for (const [operationId, command] of [
      ["operation_example_01", firstCommand],
      ["operation_example_02", secondCommand],
    ] as const) {
      const claim = await repository.claim({
        command,
        fingerprint: createApplyFingerprint(plan, command),
        operationId,
        claimedAt: "2026-08-11T12:03:00.000Z",
      });
      expect(claim.kind).toBe("claimed");
      await repository.markExecuting(operationId);
    }

    const outcome = completed() as Extract<ApplyOutcome, { outcome: "completed" }>;
    const audit = (operationId: string): AuditReceipt => ({
      id: "audit_duplicate",
      eventType: "plan.apply.completed",
      tenantId: plan.tenantId,
      projectId: plan.projectId,
      planId: plan.id,
      planRevision: plan.revision,
      planDigest: plan.digest,
      operationId,
      actor: firstCommand.appliedBy,
      occurredAt: outcome.completedAt,
      correlationId: firstCommand.correlationId,
      resultCode: outcome.code,
    });
    const applied = markPlanApplied(plan);
    await repository.completeWithAudit({
      operationId: "operation_example_01",
      outcome,
      plan: applied,
      audit: audit("operation_example_01"),
    });
    await expectCode(
      repository.completeWithAudit({
        operationId: "operation_example_02",
        outcome,
        plan: applied,
        audit: audit("operation_example_02"),
      }),
      "audit_conflict",
    );
  });
});
