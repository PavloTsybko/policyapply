import type {
  ApplyAttempt,
  ApplyOutcome,
  ApplyReceipt,
  AuditReceipt,
  ChangePlan,
} from "@policyapply/contracts";
import { ApplyProtocolError } from "@policyapply/domain";
import type {
  ApplyRepository,
  ClaimApplyInput,
  ClaimApplyResult,
} from "./ports.js";

const freezeAttempt = (attempt: ApplyAttempt): ApplyAttempt =>
  Object.freeze({
    ...attempt,
    appliedBy: Object.freeze({ ...attempt.appliedBy }),
    ...(attempt.outcome === undefined
      ? {}
      : { outcome: Object.freeze({ ...attempt.outcome }) }),
  });

const freezeAudit = (audit: AuditReceipt): AuditReceipt =>
  Object.freeze({ ...audit, actor: Object.freeze({ ...audit.actor }) });

const freezeReceipt = (receipt: ApplyReceipt): ApplyReceipt =>
  Object.freeze({
    ...receipt,
    plan: Object.freeze({ ...receipt.plan }),
    audit: freezeAudit(receipt.audit),
  });

const keyFor = (input: ClaimApplyInput): string =>
  `${input.command.tenantId}\u0000${input.command.projectId}\u0000${input.command.idempotencyKey}`;

/** Test/reference storage only; not crash-safe or cross-process durable. */
export class InMemoryApplyRepository implements ApplyRepository {
  readonly #attemptsByOperation = new Map<string, ApplyAttempt>();
  readonly #operationByKey = new Map<string, string>();
  readonly #receipts = new Map<string, ApplyReceipt>();
  readonly #auditById = new Map<string, AuditReceipt>();

  async claim(input: ClaimApplyInput): Promise<ClaimApplyResult> {
    const key = keyFor(input);
    const existingOperation = this.#operationByKey.get(key);
    if (existingOperation !== undefined) {
      const attempt = this.#attemptsByOperation.get(existingOperation);
      if (attempt === undefined) {
        throw new ApplyProtocolError("invalid_state");
      }
      if (attempt.fingerprint !== input.fingerprint) {
        throw new ApplyProtocolError("idempotency_conflict");
      }
      return { kind: "existing", attempt };
    }
    if (this.#attemptsByOperation.has(input.operationId)) {
      throw new ApplyProtocolError("idempotency_conflict");
    }

    const attempt = freezeAttempt({
      operationId: input.operationId,
      fingerprint: input.fingerprint,
      status: "claimed",
      tenantId: input.command.tenantId,
      projectId: input.command.projectId,
      planId: input.command.planId,
      planRevision: input.command.planRevision,
      planDigest: input.command.planDigest,
      appliedBy: input.command.appliedBy,
      mode: input.command.mode,
      claimedAt: input.claimedAt,
    });
    this.#operationByKey.set(key, input.operationId);
    this.#attemptsByOperation.set(input.operationId, attempt);
    return { kind: "claimed", attempt };
  }

  async markExecuting(operationId: string): Promise<ApplyAttempt> {
    const attempt = this.#requiredAttempt(operationId);
    const retrying =
      attempt.status === "failed" &&
      attempt.outcome?.outcome === "failed" &&
      attempt.outcome.retrySafe;
    if (attempt.status !== "claimed" && !retrying) {
      throw new ApplyProtocolError("invalid_state");
    }
    const executing = freezeAttempt({ ...attempt, status: "executing" });
    this.#attemptsByOperation.set(operationId, executing);
    return executing;
  }

  async recordOutcome(
    operationId: string,
    outcome: ApplyOutcome,
  ): Promise<ApplyAttempt> {
    const attempt = this.#requiredAttempt(operationId);
    if (attempt.status !== "executing" || outcome.outcome === "completed") {
      throw new ApplyProtocolError("invalid_state");
    }
    const updated = freezeAttempt({
      ...attempt,
      status: outcome.outcome,
      outcome,
    });
    this.#attemptsByOperation.set(operationId, updated);
    return updated;
  }

  async completeWithAudit(input: {
    readonly operationId: string;
    readonly outcome: Extract<ApplyOutcome, { outcome: "completed" }>;
    readonly plan: ChangePlan;
    readonly audit: AuditReceipt;
  }): Promise<ApplyReceipt> {
    const attempt = this.#requiredAttempt(input.operationId);
    if (
      attempt.status !== "executing" ||
      this.#receipts.has(input.operationId) ||
      this.#auditById.has(input.audit.id) ||
      input.outcome.outcome !== "completed" ||
      input.plan.status !== "applied" ||
      input.plan.id !== attempt.planId ||
      input.plan.revision !== attempt.planRevision ||
      input.plan.digest !== attempt.planDigest ||
      input.audit.eventType !== "plan.apply.completed" ||
      input.audit.operationId !== attempt.operationId ||
      input.audit.tenantId !== attempt.tenantId ||
      input.audit.projectId !== attempt.projectId ||
      input.audit.planId !== attempt.planId ||
      input.audit.planRevision !== attempt.planRevision ||
      input.audit.planDigest !== attempt.planDigest ||
      input.audit.actor.principalId !== attempt.appliedBy.principalId ||
      input.audit.actor.kind !== attempt.appliedBy.kind ||
      input.audit.resultCode !== input.outcome.code
    ) {
      throw new ApplyProtocolError("audit_conflict");
    }
    const audit = freezeAudit(input.audit);
    const receipt = freezeReceipt({
      plan: {
        id: input.plan.id,
        tenantId: input.plan.tenantId,
        projectId: input.plan.projectId,
        revision: input.plan.revision,
        digest: input.plan.digest,
        status: "applied",
      },
      audit,
      replayed: false,
    });
    this.#auditById.set(audit.id, audit);
    this.#receipts.set(input.operationId, receipt);
    this.#attemptsByOperation.set(
      input.operationId,
      freezeAttempt({ ...attempt, status: "completed", outcome: input.outcome }),
    );
    return receipt;
  }

  async getCompletedReceipt(operationId: string): Promise<ApplyReceipt | null> {
    return this.#receipts.get(operationId) ?? null;
  }

  async listAudit(): Promise<readonly AuditReceipt[]> {
    return Object.freeze([...this.#auditById.values()]);
  }

  #requiredAttempt(operationId: string): ApplyAttempt {
    const attempt = this.#attemptsByOperation.get(operationId);
    if (attempt === undefined) {
      throw new ApplyProtocolError("invalid_state");
    }
    return attempt;
  }
}
