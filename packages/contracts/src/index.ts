/** Tenant and project identifiers are opaque application-assigned strings. */
export type TenantId = string;
export type ProjectId = string;
export type PrincipalId = string;
export type Scope = string;

export type PrincipalKind = "user" | "agent" | "service";

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
