# `@policyapply/api`

Minimal pre-release Fastify reference API for the PolicyApply control-plane
kernel. `openapi.json` is committed as the public contract and is served
unchanged at `/openapi.json`.

The API is intentionally a thin transport:

- bearer credentials are resolved by an injected authenticator;
- tenant and project path values are resource selectors, not authority;
- authorization, plan, approval, apply, idempotency, and audit behavior live in
  the shared application/domain packages;
- request bodies and credentials are not logged by the reference app;
- action parameters are never returned by apply or audit operations.

There is no production composition, network listener, database credential,
provider adapter, SDK, MCP server, package publication, or deployment in this
slice. Tests use synthetic principals, an in-memory plan store, and a fake
executor that performs no external operation.
