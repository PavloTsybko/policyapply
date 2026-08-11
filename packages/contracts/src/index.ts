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
}

export interface ChangePlan {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly digest: string;
  readonly status: "draft" | PlanDecision;
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
