import { createHash } from "node:crypto";
import type {
  ApplyAttempt,
  ApplyOutcome,
  ApplyReceipt,
  AuditReceipt,
  ChangePlan,
} from "@policyapply/contracts";
import type {
  ApplyRepository,
  ClaimApplyInput,
  ClaimApplyResult,
  PlanRepository,
} from "@policyapply/application";
import {
  ApplyProtocolError,
  assertApprovedPlan,
  canonicalJson,
  computePlanDigest,
  freezeChangePlan,
} from "@policyapply/domain";
import type { PoolClient, QueryResultRow } from "pg";

export interface SqlPool {
  connect(): Promise<PoolClient>;
}

interface AttemptRow extends QueryResultRow {
  operation_id: string;
  fingerprint: string;
  status: ApplyAttempt["status"];
  tenant_id: string;
  project_id: string;
  plan_id: string;
  plan_revision: number;
  plan_digest: string;
  actor_id: string;
  actor_kind: ApplyAttempt["appliedBy"]["kind"];
  mode: ApplyAttempt["mode"];
  claimed_at: Date | string;
  outcome: ApplyOutcome | null;
}

interface ReceiptRow extends QueryResultRow {
  plan_id: string;
  tenant_id: string;
  project_id: string;
  plan_revision: number;
  plan_digest: string;
  audit_id: string;
  event_type: AuditReceipt["eventType"];
  operation_id: string;
  actor_id: string;
  actor_kind: AuditReceipt["actor"]["kind"];
  occurred_at: Date | string;
  correlation_id: string;
  result_code: string;
}

interface AuditRow extends QueryResultRow {
  id: string;
  event_type: AuditReceipt["eventType"];
  tenant_id: string;
  project_id: string;
  plan_id: string;
  plan_revision: number;
  plan_digest: string;
  operation_id: string;
  actor_id: string;
  actor_kind: AuditReceipt["actor"]["kind"];
  occurred_at: Date | string;
  correlation_id: string;
  result_code: string;
}

const safeId = (value: string): boolean =>
  /^[A-Za-z0-9._:-]{1,128}$/.test(value);

const instant = (value: Date | string): string => new Date(value).toISOString();

const digestKey = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const attemptFrom = (row: AttemptRow): ApplyAttempt =>
  Object.freeze({
    operationId: row.operation_id,
    fingerprint: row.fingerprint,
    status: row.status,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    planId: row.plan_id,
    planRevision: row.plan_revision,
    planDigest: row.plan_digest,
    appliedBy: Object.freeze({
      principalId: row.actor_id,
      kind: row.actor_kind,
    }),
    mode: row.mode,
    claimedAt: instant(row.claimed_at),
    ...(row.outcome === null
      ? {}
      : { outcome: Object.freeze({ ...row.outcome }) }),
  });

const auditFrom = (row: AuditRow): AuditReceipt =>
  Object.freeze({
    id: row.id,
    eventType: row.event_type,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    planId: row.plan_id,
    planRevision: row.plan_revision,
    planDigest: row.plan_digest,
    operationId: row.operation_id,
    actor: Object.freeze({
      principalId: row.actor_id,
      kind: row.actor_kind,
    }),
    occurredAt: instant(row.occurred_at),
    correlationId: row.correlation_id,
    resultCode: row.result_code,
  });

const receiptFrom = (row: ReceiptRow): ApplyReceipt =>
  Object.freeze({
    plan: Object.freeze({
      id: row.plan_id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      revision: row.plan_revision,
      digest: row.plan_digest,
      status: "applied" as const,
    }),
    audit: auditFrom({
      id: row.audit_id,
      event_type: row.event_type,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      plan_id: row.plan_id,
      plan_revision: row.plan_revision,
      plan_digest: row.plan_digest,
      operation_id: row.operation_id,
      actor_id: row.actor_id,
      actor_kind: row.actor_kind,
      occurred_at: row.occurred_at,
      correlation_id: row.correlation_id,
      result_code: row.result_code,
    }),
    replayed: false,
  });

/**
 * Tenant-bound reference adapter. The tenant is trusted composition context,
 * never a value selected from an incoming request.
 */
export class PostgresApplyRepository implements ApplyRepository, PlanRepository {
  constructor(
    private readonly pool: SqlPool,
    private readonly tenantId: string,
  ) {
    if (!safeId(tenantId)) throw new ApplyProtocolError("invalid_input");
  }

  async create(plan: ChangePlan): Promise<void> {
    this.assertTenant(plan.tenantId);
    if (
      plan.status !== "draft" ||
      plan.approval !== undefined ||
      computePlanDigest(plan) !== plan.digest
    ) {
      throw new ApplyProtocolError("content_tampered");
    }
    try {
      await this.transaction(async (client) => {
        await client.query(
          `INSERT INTO policyapply.change_plans
            (tenant_id, project_id, id, revision, digest, status, document, created_at)
           VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb, $7)`,
          [
            plan.tenantId,
            plan.projectId,
            plan.id,
            plan.revision,
            plan.digest,
            JSON.stringify(plan),
            plan.createdAt,
          ],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ApplyProtocolError("plan_conflict");
      }
      throw error;
    }
  }

  async get(
    tenantId: string,
    projectId: string,
    planId: string,
  ): Promise<ChangePlan | null> {
    this.assertTenant(tenantId);
    return this.transaction(async (client) => {
      const result = await client.query<{ document: ChangePlan }>(
        `SELECT document FROM policyapply.change_plans
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [tenantId, projectId, planId],
      );
      const document = result.rows[0]?.document;
      return document === undefined ? null : freezeChangePlan(document);
    });
  }

  async replaceExact(expected: ChangePlan, replacement: ChangePlan): Promise<void> {
    this.assertTenant(expected.tenantId);
    if (
      replacement.tenantId !== expected.tenantId ||
      replacement.projectId !== expected.projectId ||
      replacement.id !== expected.id ||
      replacement.revision !== expected.revision ||
      replacement.digest !== expected.digest ||
      !(
        (expected.status === "draft" &&
          (replacement.status === "approved" || replacement.status === "rejected")) ||
        (expected.status === "approved" && replacement.status === "applied")
      )
    ) {
      throw new ApplyProtocolError("plan_conflict");
    }
    await this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE policyapply.change_plans
         SET status = $7, document = $8::jsonb, updated_at = transaction_timestamp()
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3
           AND revision = $4 AND digest = $5 AND status = $6
           AND document = $9::jsonb`,
        [
          expected.tenantId,
          expected.projectId,
          expected.id,
          expected.revision,
          expected.digest,
          expected.status,
          replacement.status,
          JSON.stringify(replacement),
          JSON.stringify(expected),
        ],
      );
      if (result.rowCount !== 1) throw new ApplyProtocolError("plan_conflict");
    });
  }

  async storeApprovedPlan(plan: ChangePlan): Promise<void> {
    assertApprovedPlan(plan);
    this.assertTenant(plan.tenantId);
    await this.transaction(async (client) => {
      const result = await client.query<{ document: ChangePlan }>(
        `INSERT INTO policyapply.change_plans
          (tenant_id, project_id, id, revision, digest, status, document, created_at)
         VALUES ($1, $2, $3, $4, $5, 'approved', $6::jsonb, $7)
         ON CONFLICT (tenant_id, project_id, id) DO NOTHING
         RETURNING document`,
        [
          plan.tenantId,
          plan.projectId,
          plan.id,
          plan.revision,
          plan.digest,
          JSON.stringify(plan),
          plan.createdAt,
        ],
      );
      if (result.rowCount === 1) return;
      const existing = await client.query<{ document: ChangePlan }>(
        `SELECT document FROM policyapply.change_plans
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [plan.tenantId, plan.projectId, plan.id],
      );
      if (
        existing.rowCount !== 1 ||
        existing.rows[0] === undefined ||
        canonicalJson(existing.rows[0].document) !== canonicalJson(plan)
      ) {
        throw new ApplyProtocolError("plan_conflict");
      }
    });
  }

  async findByIdempotencyKey(command: ClaimApplyInput["command"]): Promise<ApplyAttempt | null> {
    this.assertTenant(command.tenantId);
    return this.transaction(async (client) => {
      const result = await client.query<AttemptRow>(
        `SELECT * FROM policyapply.apply_attempts
         WHERE tenant_id = $1 AND project_id = $2 AND idempotency_digest = $3`,
        [this.tenantId, command.projectId, digestKey(command.idempotencyKey)],
      );
      const row = result.rows[0];
      return row === undefined ? null : attemptFrom(row);
    });
  }

  async claim(input: ClaimApplyInput): Promise<ClaimApplyResult> {
    this.assertTenant(input.command.tenantId);
    return this.transaction(async (client) => {
      const prior = await client.query<AttemptRow>(
        `SELECT * FROM policyapply.apply_attempts
         WHERE tenant_id = $1 AND project_id = $2 AND idempotency_digest = $3
         FOR UPDATE`,
        [
          this.tenantId,
          input.command.projectId,
          digestKey(input.command.idempotencyKey),
        ],
      );
      const priorRow = prior.rows[0];
      if (priorRow !== undefined) {
        if (priorRow.fingerprint !== input.fingerprint) {
          throw new ApplyProtocolError("idempotency_conflict");
        }
        return { kind: "existing", attempt: attemptFrom(priorRow) };
      }
      const approved = await client.query(
        `SELECT 1 FROM policyapply.change_plans
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3
           AND revision = $4 AND digest = $5 AND status = 'approved'
         FOR SHARE`,
        [
          this.tenantId,
          input.command.projectId,
          input.command.planId,
          input.command.planRevision,
          input.command.planDigest,
        ],
      );
      if (approved.rowCount !== 1) throw new ApplyProtocolError("invalid_state");
      let inserted;
      try {
        inserted = await client.query<AttemptRow>(
          `INSERT INTO policyapply.apply_attempts
          (tenant_id, project_id, operation_id, idempotency_digest, fingerprint,
           status, plan_id, plan_revision, plan_digest, actor_id, actor_kind,
           mode, claimed_at)
         VALUES ($1, $2, $3, $4, $5, 'claimed', $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (tenant_id, project_id, idempotency_digest) DO NOTHING
         RETURNING *`,
        [
          this.tenantId,
          input.command.projectId,
          input.operationId,
          digestKey(input.command.idempotencyKey),
          input.fingerprint,
          input.command.planId,
          input.command.planRevision,
          input.command.planDigest,
          input.command.appliedBy.principalId,
          input.command.appliedBy.kind,
          input.command.mode,
          input.claimedAt,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ApplyProtocolError("idempotency_conflict");
        }
        throw error;
      }
      if (inserted.rowCount === 1 && inserted.rows[0] !== undefined) {
        return { kind: "claimed", attempt: attemptFrom(inserted.rows[0]) };
      }
      const existing = await client.query<AttemptRow>(
        `SELECT * FROM policyapply.apply_attempts
         WHERE tenant_id = $1 AND project_id = $2 AND idempotency_digest = $3
         FOR UPDATE`,
        [
          this.tenantId,
          input.command.projectId,
          digestKey(input.command.idempotencyKey),
        ],
      );
      const row = existing.rows[0];
      if (existing.rowCount !== 1 || row === undefined) {
        throw new ApplyProtocolError("invalid_state");
      }
      if (row.fingerprint !== input.fingerprint) {
        throw new ApplyProtocolError("idempotency_conflict");
      }
      return { kind: "existing", attempt: attemptFrom(row) };
    });
  }

  async markExecuting(operationId: string): Promise<ApplyAttempt> {
    return this.transaction(async (client) => {
      const result = await client.query<AttemptRow>(
        `UPDATE policyapply.apply_attempts
         SET status = 'executing', updated_at = transaction_timestamp()
         WHERE tenant_id = $1 AND operation_id = $2
           AND (status = 'claimed' OR
             (status = 'failed' AND outcome->>'outcome' = 'failed'
              AND outcome->>'retrySafe' = 'true'))
         RETURNING *`,
        [this.tenantId, operationId],
      );
      const row = result.rows[0];
      if (result.rowCount !== 1 || row === undefined) {
        throw new ApplyProtocolError("invalid_state");
      }
      return attemptFrom(row);
    });
  }

  async recordOutcome(
    operationId: string,
    outcome: ApplyOutcome,
  ): Promise<ApplyAttempt> {
    if (outcome.outcome === "completed") {
      throw new ApplyProtocolError("invalid_state");
    }
    return this.transaction(async (client) => {
      const result = await client.query<AttemptRow>(
        `UPDATE policyapply.apply_attempts
         SET status = $3, outcome = $4::jsonb, updated_at = transaction_timestamp()
         WHERE tenant_id = $1 AND operation_id = $2 AND status = 'executing'
         RETURNING *`,
        [this.tenantId, operationId, outcome.outcome, JSON.stringify(outcome)],
      );
      const row = result.rows[0];
      if (result.rowCount !== 1 || row === undefined) {
        throw new ApplyProtocolError("invalid_state");
      }
      return attemptFrom(row);
    });
  }

  async completeWithAudit(input: {
    readonly operationId: string;
    readonly outcome: Extract<ApplyOutcome, { outcome: "completed" }>;
    readonly plan: ChangePlan;
    readonly audit: AuditReceipt;
  }): Promise<ApplyReceipt> {
    this.assertTenant(input.plan.tenantId);
    return this.transaction(async (client) => {
      const locked = await client.query<AttemptRow>(
        `SELECT * FROM policyapply.apply_attempts
         WHERE tenant_id = $1 AND operation_id = $2 FOR UPDATE`,
        [this.tenantId, input.operationId],
      );
      const attempt = locked.rows[0];
      if (
        locked.rowCount !== 1 ||
        attempt === undefined ||
        !this.validCompletion(attempt, input)
      ) {
        throw new ApplyProtocolError("audit_conflict");
      }
      const plan = await client.query(
        `UPDATE policyapply.change_plans
         SET status = 'applied', document = $6::jsonb,
             updated_at = transaction_timestamp()
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3
           AND revision = $4 AND digest = $5 AND status = 'approved'`,
        [
          this.tenantId,
          input.plan.projectId,
          input.plan.id,
          input.plan.revision,
          input.plan.digest,
          JSON.stringify(input.plan),
        ],
      );
      if (plan.rowCount !== 1) throw new ApplyProtocolError("plan_conflict");

      try {
        await client.query(
          `INSERT INTO policyapply.audit_receipts
            (tenant_id, project_id, id, event_type, plan_id, plan_revision,
             plan_digest, operation_id, actor_id, actor_kind, occurred_at,
             correlation_id, result_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            input.audit.tenantId,
            input.audit.projectId,
            input.audit.id,
            input.audit.eventType,
            input.audit.planId,
            input.audit.planRevision,
            input.audit.planDigest,
            input.audit.operationId,
            input.audit.actor.principalId,
            input.audit.actor.kind,
            input.audit.occurredAt,
            input.audit.correlationId,
            input.audit.resultCode,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ApplyProtocolError("audit_conflict");
        }
        throw error;
      }
      await client.query(
        `UPDATE policyapply.apply_attempts
         SET status = 'completed', outcome = $3::jsonb,
             updated_at = transaction_timestamp()
         WHERE tenant_id = $1 AND operation_id = $2`,
        [this.tenantId, input.operationId, JSON.stringify(input.outcome)],
      );
      const receipt = await this.receiptQuery(client, input.operationId);
      if (receipt === null) throw new ApplyProtocolError("invalid_state");
      return receipt;
    });
  }

  async getCompletedReceipt(operationId: string): Promise<ApplyReceipt | null> {
    return this.transaction((client) => this.receiptQuery(client, operationId));
  }

  async listAudit(): Promise<readonly AuditReceipt[]> {
    return this.transaction(async (client) => {
      const result = await client.query<AuditRow>(
        `SELECT * FROM policyapply.audit_receipts
         WHERE tenant_id = $1 ORDER BY occurred_at, id`,
        [this.tenantId],
      );
      return Object.freeze(result.rows.map(auditFrom));
    });
  }

  private assertTenant(value: string): void {
    if (value !== this.tenantId) {
      throw new ApplyProtocolError("plan_conflict");
    }
  }

  private validCompletion(
    attempt: AttemptRow,
    input: {
      readonly operationId: string;
      readonly outcome: Extract<ApplyOutcome, { outcome: "completed" }>;
      readonly plan: ChangePlan;
      readonly audit: AuditReceipt;
    },
  ): boolean {
    return (
      attempt.status === "executing" &&
      input.plan.status === "applied" &&
      input.plan.id === attempt.plan_id &&
      input.plan.projectId === attempt.project_id &&
      input.plan.revision === attempt.plan_revision &&
      input.plan.digest === attempt.plan_digest &&
      input.audit.eventType === "plan.apply.completed" &&
      input.audit.operationId === attempt.operation_id &&
      input.audit.tenantId === attempt.tenant_id &&
      input.audit.projectId === attempt.project_id &&
      input.audit.planId === attempt.plan_id &&
      input.audit.planRevision === attempt.plan_revision &&
      input.audit.planDigest === attempt.plan_digest &&
      input.audit.actor.principalId === attempt.actor_id &&
      input.audit.actor.kind === attempt.actor_kind &&
      input.audit.resultCode === input.outcome.code
    );
  }

  private async receiptQuery(
    client: PoolClient,
    operationId: string,
  ): Promise<ApplyReceipt | null> {
    const result = await client.query<ReceiptRow>(
      `SELECT p.id AS plan_id, p.tenant_id, p.project_id,
              p.revision AS plan_revision, p.digest AS plan_digest,
              a.id AS audit_id, a.event_type, a.operation_id, a.actor_id,
              a.actor_kind, a.occurred_at, a.correlation_id, a.result_code
       FROM policyapply.apply_attempts x
       JOIN policyapply.change_plans p
         ON p.tenant_id = x.tenant_id AND p.project_id = x.project_id
        AND p.id = x.plan_id
       JOIN policyapply.audit_receipts a
         ON a.tenant_id = x.tenant_id AND a.operation_id = x.operation_id
       WHERE x.tenant_id = $1 AND x.operation_id = $2
         AND x.status = 'completed' AND p.status = 'applied'`,
      [this.tenantId, operationId],
    );
    const row = result.rows[0];
    return result.rowCount === 1 && row !== undefined ? receiptFrom(row) : null;
  }

  private async transaction<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('policyapply.tenant_id', $1, true)",
        [this.tenantId],
      );
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure; the pool will discard broken clients.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
