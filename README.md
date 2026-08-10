# PolicyApply

> Policy-first control plane for safe, tenant-aware operations by humans and AI agents.

## Status

PolicyApply is in **pre-release repository setup**. The public architecture and contribution rules are being prepared before any reusable source is admitted.

There are currently:

- no published packages;
- no tagged releases;
- no production deployment;
- no claims of users, adoption, benchmarks, or security certification;
- no source copied from a private product repository.

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

The implementation workspace is intentionally empty until the extraction, ownership, license, and security gates are complete.

Planned baseline:

- Node.js 22;
- TypeScript in strict mode;
- pnpm workspace;
- Fastify and OpenAPI;
- PostgreSQL 18;
- Vitest;
- Docker Compose for the disposable local environment.

No installation command is documented as working yet. Clean-clone installation will be added only after it is implemented and verified in CI.

## OpenAI and MCP

PolicyApply remains provider-neutral. A future optional OpenAI Responses API example may prepare plans using synthetic data, but it will not receive approval credentials or provider secrets. Mutable MCP tools are deferred until delegated sessions and tool-call audit are implemented.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Contributing

The repository is public for transparent preparation. Before submitting code, read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License

No OSS license has been granted yet. Apache-2.0 is the current recommendation, pending ownership, dependency-license, and legal review. Until a license is added, the repository is source-visible but not yet an open-source release.
