import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ApplyService } from "@policyapply/application";
import type { ApplyCommand, ApplyOutcome, ChangePlan } from "@policyapply/contracts";
import {
  ApplyProtocolError,
  createApplyFingerprint,
  createChangePlan,
  decideChangePlan,
  markPlanApplied,
} from "@policyapply/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresApplyRepository } from "./repository.js";

const testDatabaseUrl = process.env.POLICYAPPLY_TEST_DATABASE_URL;
const testDatabaseName =
  testDatabaseUrl === undefined ? "" : new URL(testDatabaseUrl).pathname.slice(1);
const safeTestDatabase = testDatabaseName.endsWith("_test");
const validTestDatabaseName = /^[a-z][a-z0-9_]{0,54}_test$/.test(testDatabaseName);
const integration = safeTestDatabase && validTestDatabaseName ? describe : describe.skip;
const runtimeRole = "policyapply_test_runtime";
const runtimePassword = "synthetic_test_only_password";

const approvedPlan = (tenantId: string, projectId: string): ChangePlan => {
  const plan = createChangePlan({
    tenantId,
    projectId,
    createdBy: { principalId: "principal_creator", kind: "agent" },
    createdAt: "2026-08-11T12:00:00.000Z",
    actions: [{
      id: "action_example_01",
      type: "example.setting.update",
      schemaVersion: "1",
      targetRef: "resource_example_01",
      parameters: { enabled: true },
    }],
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

const completed: ApplyOutcome = {
  outcome: "completed",
  code: "example_applied",
  completedAt: "2026-08-11T12:04:00.000Z",
};

const expectCode = async (
  operation: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(operation).rejects.toBeInstanceOf(ApplyProtocolError);
  await expect(operation).rejects.toMatchObject({ code });
};

integration("PostgresApplyRepository", () => {
  const admin = new Pool({ connectionString: testDatabaseUrl });
  let runtime: Pool;
  const tenantA = "tenant_example_a";
  const tenantB = "tenant_example_b";
  const projectA = "project_example_a";
  const projectB = "project_example_b";

  beforeAll(async () => {
    if (!safeTestDatabase || !validTestDatabaseName) {
      throw new Error("test database name must be safe and end with _test");
    }
    const migration = await readFile(
      fileURLToPath(new URL("../migrations/0001_core.sql", import.meta.url)),
      "utf8",
    );
    await admin.query(migration);
    await admin.query(
      `CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE ${testDatabaseName} TO ${runtimeRole}`);
    await admin.query(`GRANT USAGE ON SCHEMA policyapply TO ${runtimeRole}`);
    await admin.query(
      `GRANT SELECT ON policyapply.tenants, policyapply.projects TO ${runtimeRole}`,
    );
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE ON policyapply.change_plans,
       policyapply.apply_attempts TO ${runtimeRole}`,
    );
    await admin.query("GRANT SELECT, INSERT ON policyapply.audit_receipts TO policyapply_test_runtime");
    for (const [tenant, project] of [[tenantA, projectA], [tenantB, projectB]]) {
      await admin.query("INSERT INTO policyapply.tenants (id) VALUES ($1)", [tenant]);
      await admin.query(
        "INSERT INTO policyapply.projects (tenant_id, id) VALUES ($1, $2)",
        [tenant, project],
      );
    }
    const url = new URL(testDatabaseUrl!);
    url.username = runtimeRole;
    url.password = runtimePassword;
    runtime = new Pool({ connectionString: url.toString(), max: 4 });
  });

  afterAll(async () => {
    await runtime?.end();
    await admin.end();
  });

  it("uses a non-superuser runtime role and forced RLS on every table", async () => {
    const role = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
      [runtimeRole],
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const tables = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT relname, relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'policyapply' AND c.relkind = 'r' ORDER BY relname`,
    );
    expect(tables.rows).toEqual([
      { relname: "apply_attempts", relforcerowsecurity: true },
      { relname: "audit_receipts", relforcerowsecurity: true },
      { relname: "change_plans", relforcerowsecurity: true },
      { relname: "projects", relforcerowsecurity: true },
      { relname: "tenants", relforcerowsecurity: true },
    ]);
  });

  it("denies a direct cross-tenant query", async () => {
    const client = await runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('policyapply.tenant_id', $1, true)", [tenantA]);
      const visible = await client.query(
        "SELECT id FROM policyapply.projects WHERE tenant_id = $1",
        [tenantB],
      );
      expect(visible.rows).toEqual([]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("persists an exact draft-to-approval transition through the plan port", async () => {
    const repository = new PostgresApplyRepository(runtime, tenantA);
    const draft = createChangePlan({
      tenantId: tenantA,
      projectId: projectA,
      createdBy: { principalId: "principal_plan_port_creator", kind: "agent" },
      createdAt: "2026-08-11T12:00:00.000Z",
      actions: [{
        id: "action_plan_port_01",
        type: "example.setting.update",
        schemaVersion: "1",
        targetRef: "resource_plan_port_01",
        parameters: { enabled: true },
      }],
    });
    await repository.create(draft);
    expect(await repository.get(tenantA, projectA, draft.id)).toEqual(draft);
    const approved = decideChangePlan(draft, {
      decidedBy: { principalId: "principal_plan_port_approver", kind: "user" },
      decidedAt: "2026-08-11T12:01:00.000Z",
      decision: "approved",
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
    });
    await repository.replaceExact(draft, approved);
    expect(await repository.get(tenantA, projectA, draft.id)).toEqual(approved);
    await expectCode(repository.replaceExact(draft, approved), "plan_conflict");
  });

  it("persists atomically and replays without a second execution", async () => {
    const plan = approvedPlan(tenantA, projectA);
    const repository = new PostgresApplyRepository(runtime, tenantA);
    await repository.storeApprovedPlan(plan);
    let calls = 0;
    const service = new ApplyService(
      repository,
      { execute: async () => (calls++, completed) },
      { now: () => "2026-08-11T12:03:00.000Z" },
      {
        operationId: () => `operation_example_${calls + 1}`,
        auditId: () => "audit_example_01",
      },
    );
    const first = await service.apply(plan, commandFor(plan));
    const replay = await service.apply(plan, commandFor(plan, {
      requestedAt: "2026-08-11T12:05:00.000Z",
      correlationId: "correlation_replay_02",
    }));

    expect(calls).toBe(1);
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, audit: first.audit });
    expect(await repository.listAudit()).toEqual([first.audit]);
    const persisted = await admin.query<{ body: string }>(
      `SELECT coalesce(string_agg(row_to_json(x)::text, ''), '') AS body
       FROM (SELECT idempotency_digest, fingerprint, status, outcome
             FROM policyapply.apply_attempts) x`,
    );
    expect(persisted.rows[0]?.body).not.toContain("apply-example-01");
    expect(JSON.stringify(first)).not.toContain("parameters");
  });

  it("rejects key conflicts and tenant-boundary mismatches", async () => {
    const plan = approvedPlan(tenantB, projectB);
    const repository = new PostgresApplyRepository(runtime, tenantB);
    await repository.storeApprovedPlan(plan);
    const service = new ApplyService(
      repository,
      { execute: async () => completed },
      { now: () => "2026-08-11T12:03:00.000Z" },
      {
        operationId: () => "operation_tenant_b_01",
        auditId: () => "audit_tenant_b_01",
      },
    );
    await service.apply(plan, commandFor(plan));
    await expectCode(service.apply(plan, commandFor(plan, {
      appliedBy: { principalId: "principal_other", kind: "service" },
    })), "idempotency_conflict");
    await expectCode(
      new PostgresApplyRepository(runtime, tenantA).storeApprovedPlan(plan),
      "plan_conflict",
    );
  });

  it("enforces append-only audit rows", async () => {
    await expect(
      admin.query("UPDATE policyapply.audit_receipts SET result_code = 'changed'"),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      admin.query("DELETE FROM policyapply.audit_receipts"),
    ).rejects.toMatchObject({ code: "55000" });
    const count = await admin.query<{ count: string }>(
      "SELECT count(*) FROM policyapply.audit_receipts",
    );
    expect(Number(count.rows[0]?.count)).toBe(2);
  });

  it("rolls back plan state when audit finalization conflicts", async () => {
    const plan = approvedPlan(tenantA, projectA);
    const repository = new PostgresApplyRepository(runtime, tenantA);
    await repository.storeApprovedPlan(plan);
    const command = commandFor(plan, { idempotencyKey: "apply-atomic-rollback-01" });
    await repository.claim({
      command,
      fingerprint: createApplyFingerprint(plan, command),
      operationId: "operation_atomic_rollback_01",
      claimedAt: "2026-08-11T12:03:00.000Z",
    });
    await repository.markExecuting("operation_atomic_rollback_01");
    await expectCode(
      repository.completeWithAudit({
        operationId: "operation_atomic_rollback_01",
        outcome: completed as Extract<ApplyOutcome, { outcome: "completed" }>,
        plan: markPlanApplied(plan),
        audit: {
          id: "audit_atomic_rollback_01",
          eventType: "plan.apply.completed",
          tenantId: tenantA,
          projectId: projectA,
          planId: plan.id,
          planRevision: plan.revision,
          planDigest: plan.digest,
          operationId: "operation_atomic_rollback_01",
          actor: command.appliedBy,
          occurredAt: "2026-08-11T12:04:00.000Z",
          correlationId: command.correlationId,
          resultCode: "conflicting_code",
        },
      }),
      "audit_conflict",
    );
    const state = await admin.query<{ plan_status: string; attempt_status: string }>(
      `SELECT p.status AS plan_status, x.status AS attempt_status
       FROM policyapply.change_plans p
       JOIN policyapply.apply_attempts x
         ON x.tenant_id = p.tenant_id AND x.project_id = p.project_id
        AND x.plan_id = p.id
       WHERE x.operation_id = 'operation_atomic_rollback_01'`,
    );
    expect(state.rows[0]).toEqual({ plan_status: "approved", attempt_status: "executing" });
  });
});
