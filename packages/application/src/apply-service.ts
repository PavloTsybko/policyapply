import { randomUUID } from "node:crypto";
import type {
  ApplyAttempt,
  ApplyCommand,
  ApplyOutcome,
  ApplyReceipt,
  AuditReceipt,
  ChangePlan,
} from "@policyapply/contracts";
import {
  ApplyProtocolError,
  createApplyFingerprint,
  freezeApprovedPlan,
  markPlanApplied,
} from "@policyapply/domain";
import type {
  ApplyClock,
  ApplyExecutor,
  ApplyIdFactory,
  ApplyRepository,
} from "./ports.js";

const defaultClock: ApplyClock = {
  now: () => new Date().toISOString(),
};

const defaultIds: ApplyIdFactory = {
  operationId: () => `operation_${randomUUID()}`,
  auditId: () => `audit_${randomUUID()}`,
};

const isNonEmpty = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 128;

const isSafeOpaqueId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

const validInstant = (value: unknown): value is string =>
  isNonEmpty(value) && !Number.isNaN(Date.parse(value));

const normalizeOutcome = (value: unknown): ApplyOutcome | null => {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<ApplyOutcome> & Record<string, unknown>;
  if (!isNonEmpty(candidate.code) || !/^[a-z][a-z0-9._-]{0,63}$/.test(candidate.code)) {
    return null;
  }
  if (candidate.outcome === "completed" && validInstant(candidate.completedAt)) {
    return Object.freeze({
      outcome: "completed",
      code: candidate.code,
      completedAt: new Date(candidate.completedAt).toISOString(),
    });
  }
  if (
    candidate.outcome === "failed" &&
    validInstant(candidate.failedAt) &&
    typeof candidate.retrySafe === "boolean"
  ) {
    return Object.freeze({
      outcome: "failed",
      code: candidate.code,
      failedAt: new Date(candidate.failedAt).toISOString(),
      retrySafe: candidate.retrySafe,
    });
  }
  if (candidate.outcome === "uncertain" && validInstant(candidate.observedAt)) {
    return Object.freeze({
      outcome: "uncertain",
      code: candidate.code,
      observedAt: new Date(candidate.observedAt).toISOString(),
    });
  }
  return null;
};

const replayReceipt = (receipt: ApplyReceipt): ApplyReceipt =>
  Object.freeze({ ...receipt, replayed: true });

const existingResult = async (
  repository: ApplyRepository,
  attempt: ApplyAttempt,
): Promise<ApplyReceipt | null> => {
  if (attempt.status === "completed") {
    const receipt = await repository.getCompletedReceipt(attempt.operationId);
    if (receipt === null) throw new ApplyProtocolError("invalid_state");
    return replayReceipt(receipt);
  }
  if (attempt.status === "claimed" || attempt.status === "executing") {
    throw new ApplyProtocolError("apply_in_progress");
  }
  if (attempt.status === "uncertain") {
    throw new ApplyProtocolError("apply_uncertain");
  }
  if (
    attempt.outcome?.outcome !== "failed" ||
    !attempt.outcome.retrySafe
  ) {
    throw new ApplyProtocolError("apply_failed");
  }
  return null;
};

export class ApplyService {
  constructor(
    private readonly repository: ApplyRepository,
    private readonly executor: ApplyExecutor,
    private readonly clock: ApplyClock = defaultClock,
    private readonly ids: ApplyIdFactory = defaultIds,
  ) {}

  async apply(plan: ChangePlan, command: ApplyCommand): Promise<ApplyReceipt> {
    const immutablePlan = freezeApprovedPlan(plan);
    const fingerprint = createApplyFingerprint(immutablePlan, command);
    const operationId = this.ids.operationId();
    const claimedAt = this.clock.now();
    if (!isSafeOpaqueId(operationId) || !validInstant(claimedAt)) {
      throw new ApplyProtocolError("invalid_input");
    }

    const claim = await this.repository.claim({
      command,
      fingerprint,
      operationId,
      claimedAt: new Date(claimedAt).toISOString(),
    });
    if (claim.kind === "existing") {
      const replay = await existingResult(this.repository, claim.attempt);
      if (replay !== null) return replay;
    }

    const attempt = claim.attempt;
    await this.repository.markExecuting(attempt.operationId);

    let rawOutcome: unknown;
    try {
      rawOutcome = await this.executor.execute({
        operationId: attempt.operationId,
        plan: immutablePlan,
      });
    } catch {
      await this.recordUncertain(attempt.operationId, "executor_threw");
      throw new ApplyProtocolError("apply_uncertain");
    }

    const outcome = normalizeOutcome(rawOutcome);
    if (outcome === null) {
      await this.recordUncertain(attempt.operationId, "executor_invalid_result");
      throw new ApplyProtocolError("apply_uncertain");
    }
    const outcomeAt =
      outcome.outcome === "completed"
        ? outcome.completedAt
        : outcome.outcome === "failed"
          ? outcome.failedAt
          : outcome.observedAt;
    if (Date.parse(outcomeAt) < Date.parse(command.requestedAt)) {
      await this.recordUncertain(attempt.operationId, "executor_time_invalid");
      throw new ApplyProtocolError("apply_uncertain");
    }
    if (outcome.outcome === "failed") {
      await this.repository.recordOutcome(attempt.operationId, outcome);
      throw new ApplyProtocolError("apply_failed");
    }
    if (outcome.outcome === "uncertain") {
      await this.repository.recordOutcome(attempt.operationId, outcome);
      throw new ApplyProtocolError("apply_uncertain");
    }

    const auditId = this.ids.auditId();
    if (!isSafeOpaqueId(auditId)) {
      await this.recordUncertain(attempt.operationId, "audit_id_invalid");
      throw new ApplyProtocolError("apply_uncertain");
    }
    const appliedPlan = markPlanApplied(immutablePlan);
    const audit: AuditReceipt = Object.freeze({
      id: auditId,
      eventType: "plan.apply.completed",
      tenantId: command.tenantId,
      projectId: command.projectId,
      planId: command.planId,
      planRevision: command.planRevision,
      planDigest: command.planDigest,
      operationId: attempt.operationId,
      actor: Object.freeze({ ...command.appliedBy }),
      occurredAt: outcome.completedAt,
      correlationId: command.correlationId,
      resultCode: outcome.code,
    });
    try {
      return await this.repository.completeWithAudit({
        operationId: attempt.operationId,
        outcome,
        plan: appliedPlan,
        audit,
      });
    } catch {
      try {
        await this.recordUncertain(attempt.operationId, "finalize_uncertain");
      } catch {
        // Completion may already be durable; a retry must inspect repository state.
      }
      throw new ApplyProtocolError("apply_uncertain");
    }
  }

  async recordUncertain(operationId: string, code: string): Promise<void> {
    const observedAt = this.clock.now();
    if (!validInstant(observedAt)) {
      throw new ApplyProtocolError("invalid_input");
    }
    await this.repository.recordOutcome(operationId, {
      outcome: "uncertain",
      code,
      observedAt: new Date(observedAt).toISOString(),
    });
  }
}
