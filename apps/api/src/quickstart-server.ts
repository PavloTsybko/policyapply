import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ApplyService,
  PolicyApplyControlPlane,
} from "@policyapply/application";
import type { Principal } from "@policyapply/contracts";
import { PostgresApplyRepository } from "@policyapply/persistence-postgres";
import { Pool } from "pg";
import { buildApi } from "./app.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required configuration: ${name}`);
  }
  return value;
};

const readSecret = (name: string): string => {
  const value = readFileSync(required(name), "utf8").trim();
  if (!/^[A-Za-z0-9._~-]{32,512}$/.test(value)) {
    throw new Error(`invalid secret file: ${name}`);
  }
  return value;
};

const equalOpaque = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
};

const tenantId = process.env.POLICYAPPLY_TENANT_ID ?? "tenant_quickstart";
const projectId = process.env.POLICYAPPLY_PROJECT_ID ?? "project_quickstart";
const scopes = [
  "plans:create",
  "plans:read",
  "plans:approve",
  "plans:apply",
  "audit:read",
];
const principal = (id: string): Principal => ({
  id,
  kind: "user",
  tenantId,
  projectGrants: [{ projectId, scopes }],
});

const creatorToken = readSecret("POLICYAPPLY_CREATOR_TOKEN_FILE");
const approverToken = readSecret("POLICYAPPLY_APPROVER_TOKEN_FILE");
if (equalOpaque(creatorToken, approverToken)) {
  throw new Error("quickstart principals must use different credentials");
}

const pool = new Pool({
  host: process.env.PGHOST ?? "postgres",
  port: Number(process.env.PGPORT ?? "5432"),
  database: process.env.PGDATABASE ?? "policyapply_quickstart",
  user: process.env.PGUSER ?? "policyapply_runtime",
  password: readSecret("PGPASSWORD_FILE"),
  max: 5,
});
const repository = new PostgresApplyRepository(pool, tenantId);
const applyService = new ApplyService(
  repository,
  {
    execute: async () => ({
      outcome: "completed",
      code: "synthetic_applied",
      completedAt: new Date().toISOString(),
    }),
  },
  { now: () => new Date().toISOString() },
  {
    operationId: () => `operation_${randomUUID()}`,
    auditId: () => `audit_${randomUUID()}`,
  },
);
const controlPlane = new PolicyApplyControlPlane(
  repository,
  applyService,
  repository,
);
const app = buildApi({
  controlPlane,
  authenticator: {
    authenticate: async (token) => {
      if (equalOpaque(token, creatorToken)) return principal("principal_creator");
      if (equalOpaque(token, approverToken)) return principal("principal_approver");
      return null;
    },
  },
  readiness: async () => {
    await pool.query("SELECT 1");
    return true;
  },
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await pool.end();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

await app.listen({ host: "0.0.0.0", port: 3000 });
