# PolicyApply

> Policy-first control plane for safe, tenant-aware operations by humans and AI agents.

## Status

PolicyApply is in **pre-release development**. The first admitted source slice
defines provider-neutral identity contracts and deny-by-default project
authorization. A second review slice adds immutable draft plans and independent
approval/rejection bound to an exact revision and digest. A third review slice
defines the provider-neutral idempotent apply protocol and payload-free
append-only audit receipts. A fourth review slice adds minimal PostgreSQL
reference persistence with forced RLS and disposable integration tests. A
fifth review slice adds an OpenAPI-first Fastify reference API over the shared
application policies. Apply is not connected to any real provider.

There are currently:

- no published packages;
- no tagged releases;
- no production deployment;
- no claims of users, adoption, benchmarks, or security certification;
- no source copied from a private product repository; admitted code is newly
  authored or independently rewritten against approved public invariants.

## What PolicyApply will be

PolicyApply is designed as a model-neutral TypeScript toolkit and self-hostable reference service for applications that expose consequential integration operations to humans and AI agents.

The intended lifecycle is:

```text
authenticated intent
  -> tenant and scope authorization
  -> immutable plan
  -> independent approval
  -> exact-version validation
  -> idempotent apply
  -> verification
  -> append-only audit receipt
```

UI, REST, SDK, CLI, model clients, and MCP adapters must share the same server-enforced application policies.

## Planned first release

- provider-neutral user, agent, and service principals;
- tenant- and project-scoped authorization;
- immutable change plans and separate approval;
- idempotent apply and append-only audit;
- integration manifests and adapter conformance tests;
- secret references rather than secret values in configuration;
- PostgreSQL reference persistence with forced Row-Level Security;
- Fastify/OpenAPI reference API and generated TypeScript SDK;
- fixed-tenant, read-only MCP example;
- synthetic adapters and a local Docker quickstart.

## Non-goals

PolicyApply is not an LLM, agent loop, prompt framework, generic policy language, secrets vault, hosted integration marketplace, or privileged MCP backend.

## Security model

The project is intended to fail closed:

- tenant identifiers supplied by a client are not authority;
- high-impact changes require plan, approval, and apply;
- external mutations must be idempotent and auditable;
- secret values must not enter plans, manifests, responses, logs, or audit records;
- MCP and model examples are clients of the API, not alternative backends;
- every integration adapter needs contract and failure-path tests.

See [SECURITY.md](SECURITY.md). Do not report vulnerabilities in public issues.

## Development

Implemented baseline:

- Node.js 22;
- TypeScript in strict mode;
- pnpm workspace;
- Vitest;
- canonical JSON and SHA-256 plan integrity metadata;
- immutable plan creation with independent approval/rejection.
- idempotent apply orchestration contracts with safe replay and uncertain-result
  handling;
- payload-free append-only audit receipts and a test-only in-memory repository.
- tenant-bound PostgreSQL reference persistence with forced RLS, atomic apply
  finalization, hashed idempotency keys, and disposable integration tests.
- an OpenAPI 3.1 contract and thin Fastify reference transport with injected
  authentication, exact-scope authorization, bounded validation, and
  secret-safe error responses.

Planned later in M1: a disposable Docker Compose quickstart.

Requirements: Node.js 22+ and pnpm 11.16.0.

```bash
pnpm install --frozen-lockfile
pnpm check
```

The packages are private and unpublished. Use the workspace commands above;
there is no supported production deployment.

## OpenAI and MCP

PolicyApply remains provider-neutral. A future optional OpenAI Responses API example may prepare plans using synthetic data, but it will not receive approval credentials or provider secrets. Mutable MCP tools are deferred until delegated sessions and tool-call audit are implemented.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Contributing

The repository is public for transparent preparation. Before submitting code, read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License

No OSS license has been granted yet. Apache-2.0 is the current recommendation, pending ownership, dependency-license, and legal review. Until a license is added, the repository is source-visible but not yet an open-source release.
