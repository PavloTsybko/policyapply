import { createHash } from "node:crypto";
import { authorizeProjectAction } from "@policyapply/authorization";
import type {
  ApplyReceipt,
  AuditReceipt,
  ChangePlan,
  PlanAction,
  PlanDecision,
  Principal,
} from "@policyapply/contracts";
import {
  ApplyProtocolError,
  ChangePlanError,
  createChangePlan,
  decideChangePlan,
  markPlanApplied,
} from "@policyapply/domain";
import type { ApplyRepository } from "./ports.js";
import { ApplyService } from "./apply-service.js";

export type ControlPlaneErrorCode =
  | "authorization_denied"
  | "not_found"
  | "secret_like_parameter";

export class ControlPlaneError extends Error {
  constructor(readonly code: ControlPlaneErrorCode) {
    super(code);
    this.name = "ControlPlaneError";
  }
}

export interface ControlPlaneClock {
  now(): string;
}

export interface PlanRepository {
  create(plan: ChangePlan): Promise<void>;
  get(tenantId: string, projectId: string, planId: string): Promise<ChangePlan | null>;
  replaceExact(expected: ChangePlan, replacement: ChangePlan): Promise<void>;
}

const planKey = (tenantId: string, projectId: string, planId: string): string =>
  `${tenantId}\u0000${projectId}\u0000${planId}`;

/** Test/reference storage only; not durable or multi-process safe. */
export class InMemoryPlanRepository implements PlanRepository {
  readonly #plans = new Map<string, ChangePlan>();

  async create(plan: ChangePlan): Promise<void> {
    const key = planKey(plan.tenantId, plan.projectId, plan.id);
    if (this.#plans.has(key)) throw new ChangePlanError("plan_conflict");
    this.#plans.set(key, plan);
  }

  async get(
    tenantId: string,
    projectId: string,
    planId: string,
  ): Promise<ChangePlan | null> {
    return this.#plans.get(planKey(tenantId, projectId, planId)) ?? null;
  }

  async replaceExact(expected: ChangePlan, replacement: ChangePlan): Promise<void> {
    const key = planKey(expected.tenantId, expected.projectId, expected.id);
    if (
      this.#plans.get(key) !== expected ||
      replacement.tenantId !== expected.tenantId ||
      replacement.projectId !== expected.projectId ||
      replacement.id !== expected.id ||
      replacement.revision !== expected.revision ||
      replacement.digest !== expected.digest
    ) {
      throw new ChangePlanError("plan_conflict");
    }
    this.#plans.set(key, replacement);
  }
}

const secretLikeKey =
  /(secret|password|passphrase|token|api.?key|private.?key|authorization|cookie|credential)/i;

const containsSecretLikeKey = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretLikeKey);
  return Object.entries(value).some(
    ([key, child]) => secretLikeKey.test(key) || containsSecretLikeKey(child),
  );
};

const actorFor = (principal: Principal) => ({
  principalId: principal.id,
  kind: principal.kind,
});

export class PolicyApplyControlPlane {
  readonly #appliedKeyDigests = new Map<string, string>();

  constructor(
    private readonly plans: PlanRepository,
    private readonly applyService: ApplyService,
    private readonly applyRepository: ApplyRepository,
    private readonly clock: ControlPlaneClock = {
      now: () => new Date().toISOString(),
    },
  ) {}

  async createPlan(input: {
    readonly principal: Principal;
    readonly tenantId: string;
    readonly projectId: string;
    readonly actions: readonly PlanAction[];
  }): Promise<ChangePlan> {
    this.authorize(input.principal, input.tenantId, input.projectId, "plans:create");
    const plan = createChangePlan({
      tenantId: input.tenantId,
      projectId: input.projectId,
      createdBy: actorFor(input.principal),
      createdAt: this.clock.now(),
      actions: input.actions,
    });
    if (plan.actions.some(({ parameters }) => containsSecretLikeKey(parameters))) {
      throw new ControlPlaneError("secret_like_parameter");
    }
    await this.plans.create(plan);
    return plan;
  }

  async getPlan(input: {
    readonly principal: Principal;
    readonly tenantId: string;
    readonly projectId: string;
    readonly planId: string;
  }): Promise<ChangePlan> {
    this.authorize(input.principal, input.tenantId, input.projectId, "plans:read");
    return this.requiredPlan(input.tenantId, input.projectId, input.planId);
  }

  async decidePlan(input: {
    readonly principal: Principal;
    readonly tenantId: string;
    readonly projectId: string;
    readonly planId: string;
    readonly decision: PlanDecision;
    readonly expectedRevision: number;
    readonly expectedDigest: string;
  }): Promise<ChangePlan> {
    this.authorize(input.principal, input.tenantId, input.projectId, "plans:approve");
    const current = await this.requiredPlan(input.tenantId, input.projectId, input.planId);
    const decided = decideChangePlan(current, {
      decidedBy: actorFor(input.principal),
      decidedAt: this.clock.now(),
      decision: input.decision,
      expectedRevision: input.expectedRevision,
      expectedDigest: input.expectedDigest,
    });
    await this.plans.replaceExact(current, decided);
    return decided;
  }

  async applyPlan(input: {
    readonly principal: Principal;
    readonly tenantId: string;
    readonly projectId: string;
    readonly planId: string;
    readonly planRevision: number;
    readonly planDigest: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<ApplyReceipt> {
    this.authorize(input.principal, input.tenantId, input.projectId, "plans:apply");
    const current = await this.requiredPlan(input.tenantId, input.projectId, input.planId);
    const key = planKey(input.tenantId, input.projectId, input.planId);
    const suppliedKeyDigest = createHash("sha256")
      .update(input.idempotencyKey)
      .digest("hex");
    const appliedKeyDigest = this.#appliedKeyDigests.get(key);
    if (appliedKeyDigest !== undefined && appliedKeyDigest !== suppliedKeyDigest) {
      throw new ApplyProtocolError("idempotency_conflict");
    }
    if (current.status === "applied" && appliedKeyDigest === undefined) {
      throw new ApplyProtocolError("invalid_state");
    }
    const approvedView = current.status === "applied"
      ? { ...current, status: "approved" as const }
      : current;
    const receipt = await this.applyService.apply(approvedView, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      planId: input.planId,
      planRevision: input.planRevision,
      planDigest: input.planDigest,
      appliedBy: actorFor(input.principal),
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      requestedAt: this.clock.now(),
      mode: "execute-v1",
    });
    this.#appliedKeyDigests.set(key, suppliedKeyDigest);
    if (current.status !== "applied") {
      await this.plans.replaceExact(current, markPlanApplied(current));
    }
    return receipt;
  }

  async listAudit(input: {
    readonly principal: Principal;
    readonly tenantId: string;
    readonly projectId: string;
  }): Promise<readonly AuditReceipt[]> {
    this.authorize(input.principal, input.tenantId, input.projectId, "audit:read");
    const authorized = (await this.applyRepository.listAudit()).filter(
        ({ tenantId, projectId }) =>
          tenantId === input.tenantId && projectId === input.projectId,
      );
    return Object.freeze(authorized.slice(-100));
  }

  private authorize(
    principal: Principal,
    tenantId: string,
    projectId: string,
    scope: string,
  ): void {
    const decision = authorizeProjectAction(principal, {
      tenantId,
      projectId,
      requiredScopes: [scope],
      now: this.clock.now(),
    });
    if (!decision.allowed) throw new ControlPlaneError("authorization_denied");
  }

  private async requiredPlan(
    tenantId: string,
    projectId: string,
    planId: string,
  ): Promise<ChangePlan> {
    const plan = await this.plans.get(tenantId, projectId, planId);
    if (plan === null) throw new ControlPlaneError("not_found");
    return plan;
  }
}
