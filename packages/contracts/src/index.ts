/** Tenant and project identifiers are opaque application-assigned strings. */
export type TenantId = string;
export type ProjectId = string;
export type PrincipalId = string;
export type Scope = string;

export type PrincipalKind = "user" | "agent" | "service";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ProjectGrant {
  readonly projectId: ProjectId;
  readonly scopes: readonly Scope[];
}

/**
 * An authenticated identity after credential verification.
 * Client-supplied tenant or project identifiers never create authority.
 */
export interface Principal {
  readonly id: PrincipalId;
  readonly kind: PrincipalKind;
  readonly tenantId: TenantId;
  readonly projectGrants: readonly ProjectGrant[];
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface ProjectAuthorizationRequest {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly requiredScopes: readonly Scope[];
  readonly now: string;
}

export type AuthorizationDenialReason =
  | "invalid_request"
  | "tenant_mismatch"
  | "principal_revoked"
  | "principal_expired"
  | "project_not_granted"
  | "scope_missing";

export type AuthorizationDecision =
  | {
      readonly allowed: true;
      readonly principalId: PrincipalId;
      readonly tenantId: TenantId;
      readonly projectId: ProjectId;
      readonly grantedScopes: readonly Scope[];
    }
  | {
      readonly allowed: false;
      readonly reason: AuthorizationDenialReason;
      readonly missingScopes?: readonly Scope[];
    };

export interface ActorRef {
  readonly principalId: PrincipalId;
  readonly kind: PrincipalKind;
}

export interface PlanAction {
  readonly id: string;
  readonly type: string;
  readonly schemaVersion: string;
  readonly targetRef: string;
  readonly parameters: JsonValue;
}

export type PlanDecision = "approved" | "rejected";

export interface PlanApproval {
  readonly decision: PlanDecision;
  readonly decidedAt: string;
  readonly decidedBy: ActorRef;
  readonly planRevision: number;
  readonly planDigest: string;
  readonly digest: string;
}

export interface ChangePlan {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly digest: string;
  readonly status: "draft" | PlanDecision | "applied";
  readonly createdAt: string;
  readonly createdBy: ActorRef;
  readonly actions: readonly PlanAction[];
  readonly approval?: PlanApproval;
}

export type ChangePlanErrorCode =
  | "invalid_input"
  | "invalid_state"
  | "plan_conflict"
  | "digest_mismatch"
  | "content_tampered"
  | "self_approval";

export type ApplyMode = "execute-v1";

export interface ApplyCommand {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly planId: string;
  readonly planRevision: number;
  readonly planDigest: string;
  readonly appliedBy: ActorRef;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly mode: ApplyMode;
}

export type ApplyOutcome =
  | {
      readonly outcome: "completed";
      readonly code: string;
      readonly completedAt: string;
    }
  | {
      readonly outcome: "failed";
      readonly code: string;
      readonly failedAt: string;
      readonly retrySafe: boolean;
    }
  | {
      readonly outcome: "uncertain";
      readonly code: string;
      readonly observedAt: string;
    };

export type ApplyAttemptStatus =
  | "claimed"
  | "executing"
  | "completed"
  | "failed"
  | "uncertain";

export interface ApplyAttempt {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly status: ApplyAttemptStatus;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly planId: string;
  readonly planRevision: number;
  readonly planDigest: string;
  readonly appliedBy: ActorRef;
  readonly mode: ApplyMode;
  readonly claimedAt: string;
  readonly outcome?: ApplyOutcome;
}

export interface AuditReceipt {
  readonly id: string;
  readonly eventType: "plan.apply.completed";
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly planId: string;
  readonly planRevision: number;
  readonly planDigest: string;
  readonly operationId: string;
  readonly actor: ActorRef;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly resultCode: string;
}

export interface ApplyReceipt {
  readonly plan: {
    readonly id: string;
    readonly tenantId: TenantId;
    readonly projectId: ProjectId;
    readonly revision: number;
    readonly digest: string;
    readonly status: "applied";
  };
  readonly audit: AuditReceipt;
  readonly replayed: boolean;
}

export type ApplyErrorCode =
  | "invalid_input"
  | "invalid_state"
  | "plan_conflict"
  | "digest_mismatch"
  | "content_tampered"
  | "idempotency_conflict"
  | "apply_in_progress"
  | "apply_failed"
  | "apply_uncertain"
  | "executor_failure"
  | "audit_conflict";
