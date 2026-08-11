import { readFileSync } from "node:fs";
import type { PolicyApplyControlPlane } from "@policyapply/application";
import { ControlPlaneError } from "@policyapply/application";
import type { PlanAction, PlanDecision, Principal } from "@policyapply/contracts";
import { ApplyProtocolError, ChangePlanError } from "@policyapply/domain";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

const openapi = JSON.parse(
  readFileSync(new URL("../openapi.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const opaqueId = { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" } as const;
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const correlationHeaders = {
  type: "object",
  required: ["x-correlation-id"],
  properties: { "x-correlation-id": opaqueId },
} as const;
const applyHeaders = {
  type: "object",
  required: ["x-correlation-id", "idempotency-key"],
  properties: {
    "x-correlation-id": opaqueId,
    "idempotency-key": {
      type: "string",
      pattern: "^[A-Za-z0-9._:-]{8,128}$",
    },
  },
} as const;
const projectParams = {
  type: "object",
  required: ["tenantId", "projectId"],
  additionalProperties: false,
  properties: { tenantId: opaqueId, projectId: opaqueId },
} as const;
const planParams = {
  type: "object",
  required: ["tenantId", "projectId", "planId"],
  additionalProperties: false,
  properties: { tenantId: opaqueId, projectId: opaqueId, planId: opaqueId },
} as const;
const actionSchema = {
  type: "object",
  required: ["id", "type", "schemaVersion", "targetRef", "parameters"],
  additionalProperties: false,
  properties: {
    id: opaqueId,
    type: { type: "string", minLength: 1, maxLength: 128 },
    schemaVersion: { type: "string", minLength: 1, maxLength: 32 },
    targetRef: { type: "string", minLength: 1, maxLength: 256 },
    parameters: {},
  },
} as const;

export interface ApiAuthenticator {
  authenticate(bearerToken: string): Promise<Principal | null>;
}

export interface BuildApiOptions {
  readonly controlPlane: PolicyApplyControlPlane;
  readonly authenticator: ApiAuthenticator;
}

interface ProjectParams {
  tenantId: string;
  projectId: string;
}

interface PlanParams extends ProjectParams {
  planId: string;
}

interface CorrelationHeaders {
  "x-correlation-id": string;
}

interface ApplyHeaders extends CorrelationHeaders {
  "idempotency-key": string;
}

interface CreateBody {
  actions: readonly PlanAction[];
}

interface DecisionBody {
  decision: PlanDecision;
  expectedRevision: number;
  expectedDigest: string;
}

interface ApplyBody {
  planRevision: number;
  planDigest: string;
}

const fallbackCorrelation = "correlation_unavailable";

const correlationFor = (request: FastifyRequest): string => {
  const value = request.headers["x-correlation-id"];
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : fallbackCorrelation;
};

const errorResponse = (
  reply: FastifyReply,
  status: number,
  code: string,
  correlationId: string,
): FastifyReply =>
  reply.status(status).send({
    error: { code, message: code.replaceAll("_", " ") },
    correlationId,
  });

const principalFor = async (
  request: FastifyRequest,
  reply: FastifyReply,
  authenticator: ApiAuthenticator,
): Promise<Principal | null> => {
  const authorization = request.headers.authorization;
  if (
    typeof authorization !== "string" ||
    !/^Bearer [A-Za-z0-9._~-]{16,512}$/.test(authorization)
  ) {
    errorResponse(reply, 401, "authentication_required", correlationFor(request));
    return null;
  }
  const principal = await authenticator.authenticate(authorization.slice(7));
  if (principal === null) {
    errorResponse(reply, 401, "authentication_required", correlationFor(request));
    return null;
  }
  return principal;
};

const mapError = (
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply => {
  const correlationId = correlationFor(request);
  if (error instanceof ControlPlaneError) {
    if (error.code === "authorization_denied") {
      return errorResponse(reply, 403, error.code, correlationId);
    }
    if (error.code === "not_found") {
      return errorResponse(reply, 404, error.code, correlationId);
    }
    return errorResponse(reply, 422, error.code, correlationId);
  }
  if (error instanceof ChangePlanError) {
    if (["invalid_state", "plan_conflict", "digest_mismatch", "self_approval"].includes(error.code)) {
      return errorResponse(reply, 409, error.code, correlationId);
    }
    return errorResponse(reply, 422, error.code, correlationId);
  }
  if (error instanceof ApplyProtocolError) {
    if (error.code === "apply_uncertain") {
      return errorResponse(reply, 503, error.code, correlationId);
    }
    if (
      [
        "invalid_state",
        "plan_conflict",
        "digest_mismatch",
        "idempotency_conflict",
        "apply_in_progress",
        "apply_failed",
        "audit_conflict",
      ].includes(error.code)
    ) {
      return errorResponse(reply, 409, error.code, correlationId);
    }
    return errorResponse(reply, 422, error.code, correlationId);
  }
  const candidate = error as { code?: string; validation?: unknown };
  if (candidate.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return errorResponse(reply, 413, "request_too_large", correlationId);
  }
  if (candidate.validation !== undefined) {
    return errorResponse(reply, 400, "invalid_request", correlationId);
  }
  return errorResponse(reply, 500, "internal_error", correlationId);
};

export const buildApi = (options: BuildApiOptions): FastifyInstance => {
  const app = Fastify({
    logger: false,
    bodyLimit: 128 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.setErrorHandler(mapError);

  app.get("/openapi.json", async (_request, reply) => reply.send(openapi));

  app.post<{ Params: ProjectParams; Headers: CorrelationHeaders; Body: CreateBody }>(
    "/v1/tenants/:tenantId/projects/:projectId/plans",
    {
      schema: {
        params: projectParams,
        headers: correlationHeaders,
        body: {
          type: "object",
          required: ["actions"],
          additionalProperties: false,
          properties: {
            actions: { type: "array", minItems: 1, maxItems: 100, items: actionSchema },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalFor(request, reply, options.authenticator);
      if (principal === null) return reply;
      const plan = await options.controlPlane.createPlan({
        principal,
        tenantId: request.params.tenantId,
        projectId: request.params.projectId,
        actions: request.body.actions,
      });
      return reply.status(201).send(plan);
    },
  );

  app.get<{ Params: PlanParams; Headers: CorrelationHeaders }>(
    "/v1/tenants/:tenantId/projects/:projectId/plans/:planId",
    { schema: { params: planParams, headers: correlationHeaders } },
    async (request, reply) => {
      const principal = await principalFor(request, reply, options.authenticator);
      if (principal === null) return reply;
      return options.controlPlane.getPlan({ principal, ...request.params });
    },
  );

  app.post<{ Params: PlanParams; Headers: CorrelationHeaders; Body: DecisionBody }>(
    "/v1/tenants/:tenantId/projects/:projectId/plans/:planId/decisions",
    {
      schema: {
        params: planParams,
        headers: correlationHeaders,
        body: {
          type: "object",
          required: ["decision", "expectedRevision", "expectedDigest"],
          additionalProperties: false,
          properties: {
            decision: { enum: ["approved", "rejected"] },
            expectedRevision: { type: "integer", minimum: 1 },
            expectedDigest: digest,
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalFor(request, reply, options.authenticator);
      if (principal === null) return reply;
      return options.controlPlane.decidePlan({
        principal,
        ...request.params,
        ...request.body,
      });
    },
  );

  app.post<{ Params: PlanParams; Headers: ApplyHeaders; Body: ApplyBody }>(
    "/v1/tenants/:tenantId/projects/:projectId/plans/:planId/apply",
    {
      schema: {
        params: planParams,
        headers: applyHeaders,
        body: {
          type: "object",
          required: ["planRevision", "planDigest"],
          additionalProperties: false,
          properties: { planRevision: { type: "integer", minimum: 1 }, planDigest: digest },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalFor(request, reply, options.authenticator);
      if (principal === null) return reply;
      return options.controlPlane.applyPlan({
        principal,
        ...request.params,
        ...request.body,
        idempotencyKey: request.headers["idempotency-key"],
        correlationId: request.headers["x-correlation-id"],
      });
    },
  );

  app.get<{ Params: ProjectParams; Headers: CorrelationHeaders }>(
    "/v1/tenants/:tenantId/projects/:projectId/audit",
    { schema: { params: projectParams, headers: correlationHeaders } },
    async (request, reply) => {
      const principal = await principalFor(request, reply, options.authenticator);
      if (principal === null) return reply;
      const items = await options.controlPlane.listAudit({
        principal,
        ...request.params,
      });
      return { items };
    },
  );

  return app;
};
