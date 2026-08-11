import type {
  AuthorizationDecision,
  Principal,
  ProjectAuthorizationRequest,
  Scope,
} from "@policyapply/contracts";

const isNonEmpty = (value: string): boolean => value.trim().length > 0;

const uniqueScopes = (scopes: readonly Scope[]): readonly Scope[] => [
  ...new Set(scopes),
];

const principalKinds = new Set(["user", "agent", "service"]);

const hasValidGrants = (principal: Principal): boolean => {
  const projectIds = new Set<string>();
  for (const grant of principal.projectGrants) {
    if (
      !isNonEmpty(grant.projectId) ||
      grant.scopes.some((scope) => !isNonEmpty(scope)) ||
      projectIds.has(grant.projectId)
    ) {
      return false;
    }
    projectIds.add(grant.projectId);
  }
  return true;
};

/**
 * Authorize one project-bound operation using only verified principal state.
 * The function is deterministic, side-effect free, and deny-by-default.
 */
export function authorizeProjectAction(
  principal: Principal,
  request: ProjectAuthorizationRequest,
): AuthorizationDecision {
  if (
    !isNonEmpty(principal.id) ||
    !principalKinds.has(principal.kind) ||
    !isNonEmpty(principal.tenantId) ||
    !hasValidGrants(principal) ||
    !isNonEmpty(request.tenantId) ||
    !isNonEmpty(request.projectId) ||
    !isNonEmpty(request.now) ||
    request.requiredScopes.some((scope) => !isNonEmpty(scope))
  ) {
    return { allowed: false, reason: "invalid_request" };
  }

  const now = Date.parse(request.now);
  if (Number.isNaN(now)) {
    return { allowed: false, reason: "invalid_request" };
  }

  if (principal.tenantId !== request.tenantId) {
    return { allowed: false, reason: "tenant_mismatch" };
  }

  if (principal.revokedAt !== undefined) {
    const revokedAt = Date.parse(principal.revokedAt);
    if (Number.isNaN(revokedAt)) {
      return { allowed: false, reason: "invalid_request" };
    }
    if (revokedAt <= now) {
      return { allowed: false, reason: "principal_revoked" };
    }
  }

  if (principal.expiresAt !== undefined) {
    const expiresAt = Date.parse(principal.expiresAt);
    if (Number.isNaN(expiresAt)) {
      return { allowed: false, reason: "invalid_request" };
    }
    if (expiresAt <= now) {
      return { allowed: false, reason: "principal_expired" };
    }
  }

  const grant = principal.projectGrants.find(
    ({ projectId }) => projectId === request.projectId,
  );
  if (grant === undefined) {
    return { allowed: false, reason: "project_not_granted" };
  }

  const grantedScopes = uniqueScopes(grant.scopes);
  const granted = new Set(grantedScopes);
  const missingScopes = uniqueScopes(request.requiredScopes).filter(
    (scope) => !granted.has(scope),
  );
  if (missingScopes.length > 0) {
    return { allowed: false, reason: "scope_missing", missingScopes };
  }

  return {
    allowed: true,
    principalId: principal.id,
    tenantId: request.tenantId,
    projectId: request.projectId,
    grantedScopes,
  };
}
