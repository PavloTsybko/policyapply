import { createHash, randomUUID } from "node:crypto";
import type {
  ActorRef,
  ChangePlan,
  ChangePlanErrorCode,
  JsonValue,
  PlanAction,
  PlanApproval,
  PlanDecision,
  ProjectId,
  TenantId,
} from "@policyapply/contracts";
import {
  CanonicalJsonError,
  canonicalJson,
  deepFreezeJson,
  normalizeJson,
} from "./canonical-json.js";

export class ChangePlanError extends Error {
  constructor(readonly code: ChangePlanErrorCode) {
    super(code);
    this.name = "ChangePlanError";
  }
}

export interface CreateChangePlanInput {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly createdBy: ActorRef;
  readonly createdAt: string;
  readonly actions: readonly PlanAction[];
}

export interface DecideChangePlanInput {
  readonly decidedBy: ActorRef;
  readonly decidedAt: string;
  readonly decision: PlanDecision;
  readonly expectedRevision: number;
  readonly expectedDigest: string;
}

export const computeApprovalDigest = (
  approval: Omit<PlanApproval, "digest">,
): string =>
  createHash("sha256").update(canonicalJson(approval)).digest("hex");

const kinds = new Set(["user", "agent", "service"]);

const isNonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeInstant = (value: string): string => {
  const milliseconds = Date.parse(value);
  if (!isNonEmpty(value) || Number.isNaN(milliseconds)) {
    throw new ChangePlanError("invalid_input");
  }
  return new Date(milliseconds).toISOString();
};

const normalizeActor = (actor: ActorRef): ActorRef => {
  if (
    !isRecord(actor) ||
    !isNonEmpty(actor.principalId) ||
    typeof actor.kind !== "string" ||
    !kinds.has(actor.kind)
  ) {
    throw new ChangePlanError("invalid_input");
  }
  return Object.freeze({ principalId: actor.principalId, kind: actor.kind });
};

const normalizeActions = (actions: readonly PlanAction[]): readonly PlanAction[] => {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new ChangePlanError("invalid_input");
  }

  const ids = new Set<string>();
  const result = actions.map((action) => {
    if (
      !isRecord(action) ||
      !isNonEmpty(action.id) ||
      !isNonEmpty(action.type) ||
      !isNonEmpty(action.schemaVersion) ||
      !isNonEmpty(action.targetRef) ||
      ids.has(action.id)
    ) {
      throw new ChangePlanError("invalid_input");
    }
    ids.add(action.id);

    let parameters: JsonValue;
    try {
      parameters = deepFreezeJson(normalizeJson(action.parameters));
    } catch (error) {
      if (error instanceof CanonicalJsonError) {
        throw new ChangePlanError("invalid_input");
      }
      throw error;
    }

    return Object.freeze({
      id: action.id,
      type: action.type,
      schemaVersion: action.schemaVersion,
      targetRef: action.targetRef,
      parameters,
    });
  });

  return Object.freeze(result);
};

const contentFor = (plan: {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly createdAt: string;
  readonly createdBy: ActorRef;
  readonly actions: readonly PlanAction[];
}): object => ({
  id: plan.id,
  tenantId: plan.tenantId,
  projectId: plan.projectId,
  revision: plan.revision,
  createdAt: plan.createdAt,
  createdBy: plan.createdBy,
  actions: plan.actions,
});

export const computePlanDigest = (plan: {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly createdAt: string;
  readonly createdBy: ActorRef;
  readonly actions: readonly PlanAction[];
}): string =>
  createHash("sha256").update(canonicalJson(contentFor(plan))).digest("hex");

export const freezeChangePlan = (plan: ChangePlan): ChangePlan => {
  if (plan.approval !== undefined) {
    Object.freeze(plan.approval.decidedBy);
    Object.freeze(plan.approval);
  }
  Object.freeze(plan.createdBy);
  for (const action of plan.actions) {
    deepFreezeJson(action.parameters);
    Object.freeze(action);
  }
  Object.freeze(plan.actions);
  return Object.freeze(plan);
};

export const createChangePlan = (input: CreateChangePlanInput): ChangePlan => {
  if (
    !isRecord(input) ||
    !isNonEmpty(input.tenantId) ||
    !isNonEmpty(input.projectId)
  ) {
    throw new ChangePlanError("invalid_input");
  }

  const createdBy = normalizeActor(input.createdBy);
  const createdAt = normalizeInstant(input.createdAt);
  const actions = normalizeActions(input.actions);
  const id = `plan_${randomUUID()}`;
  const revision = 1;
  const digest = computePlanDigest({
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    revision,
    createdAt,
    createdBy,
    actions,
  });

  return freezeChangePlan({
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    revision,
    digest,
    status: "draft",
    createdAt,
    createdBy,
    actions,
  });
};

export const decideChangePlan = (
  plan: ChangePlan,
  input: DecideChangePlanInput,
): ChangePlan => {
  if (!isRecord(plan) || !isRecord(input)) {
    throw new ChangePlanError("invalid_input");
  }
  if (plan.status !== "draft" || plan.approval !== undefined) {
    throw new ChangePlanError("invalid_state");
  }
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    !isNonEmpty(input.expectedDigest) ||
    !isNonEmpty(plan.id) ||
    !isNonEmpty(plan.tenantId) ||
    !isNonEmpty(plan.projectId) ||
    !/^[a-f0-9]{64}$/.test(plan.digest) ||
    !Number.isSafeInteger(plan.revision) ||
    plan.revision < 1
  ) {
    throw new ChangePlanError("invalid_input");
  }

  let actualDigest: string;
  try {
    normalizeActor(plan.createdBy);
    const createdAt = normalizeInstant(plan.createdAt);
    const actions = normalizeActions(plan.actions);
    actualDigest = computePlanDigest({ ...plan, createdAt, actions });
  } catch (error) {
    if (
      error instanceof CanonicalJsonError ||
      error instanceof ChangePlanError
    ) {
      throw new ChangePlanError("content_tampered");
    }
    throw error;
  }
  if (actualDigest !== plan.digest) {
    throw new ChangePlanError("content_tampered");
  }
  if (input.expectedRevision !== plan.revision) {
    throw new ChangePlanError("plan_conflict");
  }
  if (input.expectedDigest !== plan.digest) {
    throw new ChangePlanError("digest_mismatch");
  }

  const decidedBy = normalizeActor(input.decidedBy);
  if (decidedBy.principalId === plan.createdBy.principalId) {
    throw new ChangePlanError("self_approval");
  }
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new ChangePlanError("invalid_input");
  }

  const decidedAt = normalizeInstant(input.decidedAt);
  if (Date.parse(decidedAt) < Date.parse(plan.createdAt)) {
    throw new ChangePlanError("invalid_input");
  }

  const approvalContent: Omit<PlanApproval, "digest"> = {
    decision: input.decision,
    decidedAt,
    decidedBy,
    planRevision: plan.revision,
    planDigest: plan.digest,
  };
  const approval: PlanApproval = Object.freeze({
    ...approvalContent,
    digest: computeApprovalDigest(approvalContent),
  });

  return freezeChangePlan({
    ...plan,
    status: input.decision,
    approval,
  });
};
