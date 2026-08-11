import { createHash } from "node:crypto";
import type {
  ApplyCommand,
  ApplyErrorCode,
  ChangePlan,
} from "@policyapply/contracts";
import { CanonicalJsonError, canonicalJson } from "./canonical-json.js";
import {
  computeApprovalDigest,
  computePlanDigest,
  freezeChangePlan,
} from "./change-plan.js";

export class ApplyProtocolError extends Error {
  constructor(readonly code: ApplyErrorCode) {
    super(code);
    this.name = "ApplyProtocolError";
  }
}

const isNonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isSafeOpaqueId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

const validActor = (value: ApplyCommand["appliedBy"]): boolean =>
  value !== null &&
  typeof value === "object" &&
  isSafeOpaqueId(value.principalId) &&
  ["user", "agent", "service"].includes(value.kind);

const validInstant = (value: unknown): value is string =>
  isNonEmpty(value) && !Number.isNaN(Date.parse(value));

export const assertApprovedPlan = (plan: ChangePlan): void => {
  if (!isRecord(plan)) {
    throw new ApplyProtocolError("invalid_input");
  }
  if (plan.status !== "approved" || plan.approval?.decision !== "approved") {
    throw new ApplyProtocolError("invalid_state");
  }
  if (
    plan.approval.planRevision !== plan.revision ||
    plan.approval.planDigest !== plan.digest ||
    !validActor(plan.approval.decidedBy) ||
    plan.approval.decidedBy.principalId === plan.createdBy.principalId ||
    !validInstant(plan.approval.decidedAt) ||
    Date.parse(plan.approval.decidedAt) < Date.parse(plan.createdAt) ||
    !/^[a-f0-9]{64}$/.test(plan.approval.digest) ||
    computeApprovalDigest({
      decision: plan.approval.decision,
      decidedAt: plan.approval.decidedAt,
      decidedBy: plan.approval.decidedBy,
      planRevision: plan.approval.planRevision,
      planDigest: plan.approval.planDigest,
    }) !== plan.approval.digest
  ) {
    throw new ApplyProtocolError("content_tampered");
  }
  try {
    if (computePlanDigest(plan) !== plan.digest) {
      throw new ApplyProtocolError("content_tampered");
    }
  } catch (error) {
    if (
      error instanceof CanonicalJsonError ||
      error instanceof ApplyProtocolError
    ) {
      throw new ApplyProtocolError("content_tampered");
    }
    throw error;
  }
};

export const validateApplyCommand = (
  plan: ChangePlan,
  command: ApplyCommand,
): void => {
  assertApprovedPlan(plan);
  if (!isRecord(command)) {
    throw new ApplyProtocolError("invalid_input");
  }
  if (
    !isSafeOpaqueId(command.tenantId) ||
    !isSafeOpaqueId(command.projectId) ||
    !isSafeOpaqueId(command.planId) ||
    !Number.isSafeInteger(command.planRevision) ||
    command.planRevision < 1 ||
    !/^[a-f0-9]{64}$/.test(command.planDigest) ||
    !validActor(command.appliedBy) ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(command.idempotencyKey) ||
    !isSafeOpaqueId(command.correlationId) ||
    !validInstant(command.requestedAt) ||
    command.mode !== "execute-v1"
  ) {
    throw new ApplyProtocolError("invalid_input");
  }
  if (
    command.tenantId !== plan.tenantId ||
    command.projectId !== plan.projectId ||
    command.planId !== plan.id ||
    command.planRevision !== plan.revision
  ) {
    throw new ApplyProtocolError("plan_conflict");
  }
  if (command.planDigest !== plan.digest) {
    throw new ApplyProtocolError("digest_mismatch");
  }
};

export const createApplyFingerprint = (
  plan: ChangePlan,
  command: ApplyCommand,
): string => {
  validateApplyCommand(plan, command);
  return createHash("sha256")
    .update(
      canonicalJson({
        tenantId: command.tenantId,
        projectId: command.projectId,
        planId: command.planId,
        planRevision: command.planRevision,
        planDigest: command.planDigest,
        appliedBy: command.appliedBy,
        mode: command.mode,
      }),
    )
    .digest("hex");
};

export const markPlanApplied = (plan: ChangePlan): ChangePlan => {
  assertApprovedPlan(plan);
  return freezeChangePlan({ ...plan, status: "applied" });
};

export const freezeApprovedPlan = (plan: ChangePlan): ChangePlan => {
  assertApprovedPlan(plan);
  return freezeChangePlan(plan);
};
