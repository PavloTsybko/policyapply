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

`quickstart-server.ts` is a fixed local demonstration composition with generated
file-backed credentials, one synthetic tenant/project, PostgreSQL reference
persistence, and a fake executor. It is started only by the disposable Docker
quickstart and is not a production listener. There is no provider adapter, SDK,
MCP server, package/image publication, deployment, or release in this slice.
